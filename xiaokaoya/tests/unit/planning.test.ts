import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safetyContext, stripV6QuoteSnapshots } from './safety-helpers'
import { DATABASE_VERSION } from '../../src/shared/identity'
import { PlanningService } from '../../src/services/planning'
import { StudyService } from '../../src/services/study'
import { CurriculumService } from '../../src/services/curriculum'
import {
  inBacklog,
  monthCells,
  shiftMonth,
  unfinished,
  weekDates,
  weeklyOverview,
} from '../../src/domain/planning'
import { weekStart } from '../../src/domain/dates'
import { actualSeconds } from '../../src/domain/statistics'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import { validateData } from '../../src/shared/backup'
import { makeCsv } from '../../src/data/backup/csv'
import { V3_TABLES } from '../../src/data/schema'
import type { Task } from '../../src/domain/models'

let ctx: Awaited<ReturnType<typeof safetyContext>>, service: PlanningService
beforeEach(async () => {
  ctx = await safetyContext()
  service = new PlanningService(ctx.database)
})
afterEach(async () => {
  vi.restoreAllMocks()
  ctx.database.close()
  await ctx.database.delete()
})
const week = '2027-02-01'
async function current() {
  return (await ctx.database.tasks.get(ctx.task.id))!
}
async function baseWeek() {
  return (await ctx.database.weeklyPlans.get(week))!
}
const goal = (targets: { cycleId: string; targetMinutes: number }[] = []) => ({
  weekStart: week,
  goalMinutes: 840,
  focus: '按自己的节奏来',
  targets,
})

describe('generated calendars and pending membership', () => {
  it('generates leap months and Monday-first grids without hardcoded exam years', () => {
    for (const date of ['2027-01-01', '2028-02-29', '2029-12-31', '2031-03-01']) {
      const cells = monthCells(date)
      expect(cells).toHaveLength(42)
      expect(new Date(cells[0] + 'T00:00:00Z').getUTCDay()).toBe(1)
      expect(new Set(cells).size).toBe(42)
    }
    expect(monthCells('2028-02-01')).toContain('2028-02-29')
    expect(monthCells('2027-02-01')).not.toContain('2027-02-29')
  })
  it('retains correct cross-year weeks and clamps month navigation at leap and supported boundaries', () => {
    expect(weekDates('2028-01-02')).toEqual([
      '2027-12-27',
      '2027-12-28',
      '2027-12-29',
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
    ])
    expect(shiftMonth('2028-01-31', 1)).toBe('2028-02-29')
    expect(shiftMonth('2028-02-29', 12)).toBe('2029-02-28')
    expect(shiftMonth('1900-01-01', -1)).toBeNull()
    expect(shiftMonth('9999-12-31', 1)).toBeNull()
    expect(weekDates('9999-12-31')).toEqual([
      '9999-12-27',
      '9999-12-28',
      '9999-12-29',
      '9999-12-30',
      '9999-12-31',
    ])
    expect(weekDates('1900-01-01')[0]).toBe('1900-01-01')
  })
  it('exposes overdue unfinished tasks in the pool without changing their original dates', () => {
    const task = { plannedDate: '2027-01-01', status: 'partial' } as Task
    expect(inBacklog(task, '2027-01-02')).toBe(true)
    expect(task.plannedDate).toBe('2027-01-01')
    expect(inBacklog({ ...task, status: 'completed' }, '2027-01-02')).toBe(false)
    expect(inBacklog({ ...task, status: 'cancelled' }, '2027-01-02')).toBe(false)
    expect(inBacklog({ ...task, plannedDate: null }, '2026-01-01')).toBe(true)
    expect(unfinished({ ...task, status: 'deferred' })).toBe(true)
  })
})

describe('one task identity and atomic date history', () => {
  it('creates undated review tasks and schedules them into a leap day without copying', async () => {
    const task = await ctx.study.createTask({
      cycleId: ctx.cycle.id,
      chapterId: null,
      title: '复习任务',
      kind: 'review',
      plannedDate: null,
      estimatedMinutes: 30,
      notes: '',
    })
    expect(inBacklog(task, '2027-01-01')).toBe(true)
    expect(weeklyOverview([task], [], [], '2028-02-29').plannedSeconds).toBe(0)
    const moved = await service.scheduleTask(task, '2028-02-29', 'schedule')
    expect(moved.id).toBe(task.id)
    expect(moved.kind).toBe('review')
    expect(await ctx.database.tasks.count()).toBe(2)
    const history = await ctx.database.taskScheduleHistory
      .where('taskId')
      .equals(task.id)
      .sortBy('taskRevision')
    expect(history.map((item) => [item.fromDate, item.toDate])).toEqual([
      [null, null],
      [null, '2028-02-29'],
    ])
    validateData(await readPayload(ctx.database), DATABASE_VERSION)
  })
  it('reschedules, unschedules and reassigns with a continuous history and no duplicate time', async () => {
    const id = crypto.randomUUID()
    let task = await service.scheduleTask(ctx.task, '2027-12-31', 'schedule', '跨年计划', id)
    await service.scheduleTask(ctx.task, '2027-12-31', 'schedule', '跨年计划', id)
    expect(await ctx.database.tasks.count()).toBe(1)
    await expect(
      service.scheduleTask(ctx.task, '2028-01-01', 'schedule', '跨年计划', id),
    ).rejects.toThrow('标识')
    task = await service.scheduleTask(task, null, 'unschedule')
    expect(task.plannedDate).toBeNull()
    task = await service.scheduleTask(task, '2028-01-01', 'schedule')
    const history = await ctx.database.taskScheduleHistory
      .where('taskId')
      .equals(task.id)
      .sortBy('taskRevision')
    expect(history.map((item) => item.toDate)).toEqual([
      '2027-02-01',
      '2027-12-31',
      null,
      '2028-01-01',
    ])
    expect(task.cycleId).toBe(ctx.cycle.id)
    expect(
      actualSeconds(
        await ctx.database.studySessions.toArray(),
        await ctx.database.timeSegments.toArray(),
      ),
    ).toBe(0)
    validateData(await readPayload(ctx.database), DATABASE_VERSION)
  })
  it('only defers unfinished dated tasks to a later date', async () => {
    await expect(service.scheduleTask(ctx.task, '2027-02-01', 'defer')).rejects.toThrow('晚于')
    let task = await service.scheduleTask(ctx.task, '2027-02-02', 'defer')
    expect(task.status).toBe('deferred')
    expect(task.id).toBe(ctx.task.id)
    await ctx.study.setTaskStatus(task, 'completed')
    task = await current()
    await expect(service.scheduleTask(task, '2027-02-03', 'defer')).rejects.toThrow('未完成')
    expect(await ctx.database.tasks.count()).toBe(1)
  })
  it('records date changes made through the existing task editor too', async () => {
    await ctx.study.updateTask(ctx.task, {
      cycleId: ctx.cycle.id,
      title: ctx.task.title,
      plannedDate: null,
      estimatedMinutes: 60,
      notes: ctx.task.notes,
      kind: 'review',
    })
    const task = await current()
    expect(task.plannedDate).toBeNull()
    expect(task.kind).toBe('review')
    expect(
      (
        await ctx.database.taskScheduleHistory
          .where('taskId')
          .equals(task.id)
          .sortBy('taskRevision')
      ).at(-1)?.action,
    ).toBe('unscheduled')
    validateData(await readPayload(ctx.database), DATABASE_VERSION)
  })
  it('rejects stale dates without appending history or overwriting the newer plan', async () => {
    await service.scheduleTask(ctx.task, '2027-02-02', 'schedule')
    const before = await ctx.database.taskScheduleHistory.toArray()
    await expect(service.scheduleTask(ctx.task, '2027-02-03', 'schedule')).rejects.toThrow('变化')
    expect((await current()).plannedDate).toBe('2027-02-02')
    expect(await ctx.database.taskScheduleHistory.toArray()).toEqual(before)
  })
  it('rolls back both the task date and its new event if the task write fails', async () => {
    const before = await ctx.database.taskScheduleHistory.toArray(),
      hook = () => {
        throw new Error('task write failure')
      }
    ctx.database.tasks.hook('updating', hook)
    await expect(service.scheduleTask(ctx.task, '2027-02-02', 'schedule')).rejects.toThrow(
      'task write failure',
    )
    ctx.database.tasks.hook('updating').unsubscribe(hook)
    expect(await current()).toEqual(ctx.task)
    expect(await ctx.database.taskScheduleHistory.toArray()).toEqual(before)
  })
  it('preserves the actual study date and duration when a task moves to another week', async () => {
    const now = new Date().toISOString()
    await ctx.database.studySessions.add({
      id: crypto.randomUUID(),
      cycleId: ctx.cycle.id,
      taskId: ctx.task.id,
      studyDate: week,
      status: 'confirmed',
      timeMode: 'duration_only',
      durationOnlySeconds: 2700,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    })
    const before = await ctx.database.studySessions.toArray()
    await service.scheduleTask(ctx.task, '2028-02-29', 'schedule')
    const tasks = await ctx.database.tasks.toArray(),
      segments = await ctx.database.timeSegments.toArray()
    expect(weeklyOverview(tasks, before, segments, week)).toMatchObject({
      plannedSeconds: 0,
      actualSeconds: 2700,
    })
    expect(weeklyOverview(tasks, before, segments, '2028-02-29')).toMatchObject({
      plannedSeconds: 3600,
      actualSeconds: 0,
    })
    expect(await ctx.database.studySessions.toArray()).toEqual(before)
    expect(actualSeconds(before, segments)).toBe(2700)
  })
  it('retains archived history but blocks new date arrangements until the cycle is restored', async () => {
    await new CurriculumService(ctx.database).archiveCycle(
      (await ctx.database.cycles.get(ctx.cycle.id))!,
      true,
    )
    await expect(service.scheduleTask(ctx.task, null, 'unschedule')).rejects.toThrow('归档')
    expect((await current()).plannedDate).toBe(ctx.task.plannedDate)
  })
})

describe('weekly goals without equal daily assignments', () => {
  it('saves a weekly total and freely selected subject allocations, allowing a different sum', async () => {
    const tax = (await ctx.database.cycles.where('subjectId').equals('tax-1').first())!
    await service.saveWeek(
      goal([
        { cycleId: ctx.cycle.id, targetMinutes: 240 },
        { cycleId: tax.id, targetMinutes: 360 },
      ]),
    )
    expect((await baseWeek()).goalSeconds).toBe(14 * 3600)
    expect(
      (await ctx.database.weeklySubjectTargets.toArray()).reduce(
        (sum, row) => sum + row.targetSeconds,
        0,
      ),
    ).toBe(10 * 3600)
    expect(await ctx.database.tasks.get(ctx.task.id)).toEqual(ctx.task)
    await service.saveWeek({
      weekStart: '2027-02-08',
      goalMinutes: 0,
      focus: '休息周',
      targets: [],
    })
    expect(await ctx.database.weeklyPlans.count()).toBe(2)
    expect((await baseWeek()).goalSeconds).toBe(14 * 3600)
  })
  it('requires Monday starts and forbids duplicate subject allocations atomically', async () => {
    await expect(service.saveWeek({ ...goal(), weekStart: '2027-02-02' })).rejects.toThrow('周一')
    await expect(
      service.saveWeek(
        goal([
          { cycleId: ctx.cycle.id, targetMinutes: 60 },
          { cycleId: ctx.cycle.id, targetMinutes: 30 },
        ]),
      ),
    ).rejects.toThrow('重复')
    expect(await ctx.database.weeklyPlans.count()).toBe(0)
    expect(await ctx.database.weeklySubjectTargets.count()).toBe(0)
  })
  it('retains deselected target rows and independently saves other weeks', async () => {
    await service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 120 }]))
    const first = (await ctx.database.weeklySubjectTargets.toArray())[0]
    await service.saveWeek({ ...goal(), focus: '仅保留总目标' }, await baseWeek())
    expect((await ctx.database.weeklySubjectTargets.get(first.id))?.active).toBe(false)
    await service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 180 }]), await baseWeek())
    expect(await ctx.database.weeklySubjectTargets.count()).toBe(1)
    expect((await ctx.database.weeklySubjectTargets.get(first.id))?.targetSeconds).toBe(10800)
  })
  it('rolls back the weekly plan if a subject allocation cannot be written', async () => {
    const hook = () => {
      throw new Error('target write failed')
    }
    ctx.database.weeklySubjectTargets.hook('creating', hook)
    await expect(
      service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 60 }])),
    ).rejects.toThrow('target write failed')
    ctx.database.weeklySubjectTargets.hook('creating').unsubscribe(hook)
    expect(await ctx.database.weeklyPlans.count()).toBe(0)
    expect(await ctx.database.weeklySubjectTargets.count()).toBe(0)
  })
  it('detects stale weekly edits and preserves archived subject targets when changing only the total', async () => {
    const input = goal([{ cycleId: ctx.cycle.id, targetMinutes: 120 }])
    await service.saveWeek(input)
    const previous = await baseWeek()
    await new CurriculumService(ctx.database).archiveCycle(
      (await ctx.database.cycles.get(ctx.cycle.id))!,
      true,
    )
    await service.saveWeek({ ...input, goalMinutes: 1000 }, previous)
    await expect(service.saveWeek({ ...input, goalMinutes: 500 }, previous)).rejects.toThrow('变化')
    await expect(
      service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 180 }]), await baseWeek()),
    ).rejects.toThrow('归档')
    expect((await baseWeek()).goalSeconds).toBe(60000)
  })
})

describe('calendar dates and complete backup compatibility', () => {
  it('keeps exam dates synced with the dossier without changing registration, learning or result', async () => {
    const cycle = (await ctx.database.cycles.get(ctx.cycle.id))!,
      status = (await ctx.database.cycleStatuses.get(ctx.cycle.id))!
    await new CurriculumService(ctx.database).saveCycle(cycle, status, {
      learningStatus: 'studying',
      registrationStatus: 'registered',
      examResult: 'passed',
      examDate: null,
      notes: '保留考试备注',
    })
    const before = (await ctx.database.cycleStatuses.get(cycle.id))!
    await service.setExamDate(cycle.id, '2028-02-29', before)
    expect(await ctx.database.cycleStatuses.get(cycle.id)).toMatchObject({
      registrationStatus: 'registered',
      examResult: 'passed',
      examDate: '2028-02-29',
      notes: '保留考试备注',
    })
    expect((await ctx.database.cycles.get(cycle.id))?.learningStatus).toBe('studying')
    const after = (await ctx.database.cycleStatuses.get(cycle.id))!
    await service.setExamDate(cycle.id, null, after)
    expect((await ctx.database.cycleStatuses.get(cycle.id))?.examDate).toBeNull()
  })
  it('saves, stops and restores the same milestone rather than duplicating it', async () => {
    const input = {
      cycleId: ctx.cycle.id,
      kind: 'registration_close' as const,
      date: '2027-03-01',
      notes: '自行记录',
    }
    const id = crypto.randomUUID()
    await Promise.all([
      service.saveMilestone(input, undefined, id),
      service.saveMilestone(input, undefined, id),
    ])
    expect(await ctx.database.examMilestones.count()).toBe(1)
    let record = (await ctx.database.examMilestones.get(id))!
    await service.archiveMilestone(record, true)
    record = (await ctx.database.examMilestones.get(id))!
    await service.saveMilestone({ ...input, date: '2027-03-02' }, record)
    expect((await ctx.database.examMilestones.get(id))?.archivedAt).toBeNull()
    expect(await ctx.database.examMilestones.count()).toBe(1)
    await expect(service.saveMilestone({ ...input, date: '2027-02-29' }, record)).rejects.toThrow(
      '日期',
    )
  })
  it('round-trips weekly goals, nullable tasks, histories and dates through full JSON and each CSV', async () => {
    await service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 60 }]))
    await service.scheduleTask(ctx.task, null, 'unschedule', '以后安排')
    await service.saveMilestone({
      cycleId: ctx.cycle.id,
      kind: 'payment_due',
      date: '2027-02-15',
      notes: '=SUM(1,2)',
    })
    const payload = await readPayload(ctx.database),
      envelope = await makeBackup(payload, '0.4.0', 'export')
    await service.scheduleTask(await current(), '2027-02-02', 'schedule')
    await ctx.service.restore(await ctx.service.preview(JSON.stringify(envelope), 'v4.json'))
    expect(await readPayload(ctx.database)).toEqual(payload)
    expect((await ctx.service.preview(JSON.stringify(envelope), 'same.json')).identical).toBe(true)
    expect(makeCsv(payload, 'tasks')).toContain('"","CPA"')
    expect(makeCsv(payload, 'weekly-plans')).toContain('"840"')
    expect(makeCsv(payload, 'weekly-targets')).toContain('"60"')
    expect(makeCsv(payload, 'schedule-history')).toContain('以后安排')
    expect(makeCsv(payload, 'exam-dates')).toContain("'=SUM")
  })
  it('preflight catches orphan goals, corrupt date chains and invalid weekdays', async () => {
    await service.saveWeek(goal([{ cycleId: ctx.cycle.id, targetMinutes: 60 }]))
    await service.scheduleTask(ctx.task, '2027-02-02', 'schedule')
    const data = await readPayload(ctx.database)
    expect(() => validateData(data, DATABASE_VERSION)).not.toThrow()
    for (const change of [
      (copy: typeof data) => {
        copy.weeklySubjectTargets[0].cycleId = 'missing'
      },
      (copy: typeof data) => {
        copy.weeklyPlans[0].weekStart = '2027-02-02'
      },
      (copy: typeof data) => {
        copy.taskScheduleHistory[1].fromDate = '2027-01-01'
      },
      (copy: typeof data) => {
        copy.taskScheduleHistory[1].toDate = '2027-02-03'
      },
    ]) {
      const copy = structuredClone(data)
      change(copy)
      expect(() => validateData(copy, DATABASE_VERSION)).toThrow()
    }
  })
  it('does not silently accept nullable dates or task kinds in V3 files', async () => {
    const source = Object.fromEntries(
      V3_TABLES.map((table) => [table, structuredClone(ctx.envelope.data[table])]),
    )
    source.tasks = source.tasks.map(({ kind, ...task }) => task)
    stripV6QuoteSnapshots(source)
    source.migrationHistory = source.migrationHistory.map((row) => ({ ...row, toVersion: 3 }))
    expect(() => validateData(source, 3)).not.toThrow()
    source.tasks[0].plannedDate = null
    expect(() => validateData(source, 3)).toThrow('旧版任务')
    source.tasks[0].plannedDate = ctx.task.plannedDate
    source.tasks[0].kind = 'review'
    expect(() => validateData(source, 3)).toThrow('旧版任务')
  })
})

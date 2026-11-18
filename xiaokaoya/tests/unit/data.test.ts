import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { StudyDatabase } from '../../src/data/database'
import { StudyService } from '../../src/services/study'
import { actualSeconds } from '../../src/domain/statistics'
let db: StudyDatabase
let service: StudyService
beforeEach(async () => {
  db = new StudyDatabase(`Test-${crypto.randomUUID()}`)
  service = new StudyService(db)
  await db.open()
})
afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await db.delete()
})
const input = (cycleId: string) => ({
  cycleId,
  title: '测试：读会计第一章',
  plannedDate: '2027-01-01',
  estimatedMinutes: 90,
  notes: '仅测试数据',
})
async function cycle() {
  await service.selectSubjects(2027, ['cpa-1'])
  return (await db.cycles.toArray())[0]
}

describe('local data and historical integrity', () => {
  it('initializes only 12 catalog subjects and 2 comprehensive subitems, no selected cycles or fake learning', async () => {
    expect(await db.subjects.count()).toBe(12)
    expect(await db.subjectParts.count()).toBe(2)
    expect(await db.cycles.count()).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    expect(await db.studySessions.count()).toBe(0)
  })
  it('keeps independent years and pauses unchecked cycles without deleting tasks', async () => {
    const old = await cycle()
    const task = await service.createTask(input(old.id))
    await service.selectSubjects(2028, ['cpa-1', 'tax-1'])
    await service.selectSubjects(2027, [])
    expect(await db.cycles.count()).toBe(3)
    expect((await db.cycles.get(old.id))?.learningStatus).toBe('paused')
    expect((await db.tasks.get(task.id))?.cycleId).toBe(old.id)
    await service.selectSubjects(2027, ['cpa-1'])
    expect(await db.cycles.count()).toBe(3)
    expect((await db.cycles.get(old.id))?.learningStatus).toBe('planned')
  })
  it('rejects unknown subjects atomically, including no stray annual plan', async () => {
    await expect(service.selectSubjects(2031, ['cpa-1', 'missing'])).rejects.toThrow('不存在')
    expect(await db.annualPlans.count()).toBe(0)
    expect(await db.cycles.count()).toBe(0)
  })
  it('rolls back annual plan and first cycle if a later cycle write fails', async () => {
    const original = db.cycles.add.bind(db.cycles)
    vi.spyOn(db.cycles, 'add')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('simulated disk error'))
    await expect(service.selectSubjects(2027, ['cpa-1', 'tax-1'])).rejects.toThrow('disk error')
    expect(await db.annualPlans.count()).toBe(0)
    expect(await db.cycles.count()).toBe(0)
  })
  it('validates tasks and forbids new tasks for paused cycles', async () => {
    const c = await cycle()
    for (const invalid of [
      { title: ' ' },
      { plannedDate: '2027-02-29' },
      { estimatedMinutes: 0 },
      { estimatedMinutes: 1.5 },
      { cycleId: 'missing' },
    ]) {
      await expect(service.createTask({ ...input(c.id), ...invalid })).rejects.toThrow()
    }
    await service.selectSubjects(2027, [])
    await expect(service.createTask(input(c.id))).rejects.toThrow('暂停')
    expect(await db.tasks.count()).toBe(0)
  })
  it('makes retried submissions idempotent and detects mismatched operation reuse', async () => {
    const c = await cycle()
    const id = crypto.randomUUID()
    await Promise.all([service.createTask(input(c.id), id), service.createTask(input(c.id), id)])
    expect(await db.tasks.count()).toBe(1)
    await expect(service.createTask({ ...input(c.id), title: '不同任务' }, id)).rejects.toThrow(
      '标识',
    )
  })
  it('detects stale edits and never counts completion as actual time', async () => {
    const c = await cycle()
    const task = await service.createTask(input(c.id))
    await service.setTaskStatus(task, 'completed')
    await expect(service.updateTask(task, { ...input(c.id), title: '旧编辑' })).rejects.toThrow(
      '变化',
    )
    expect(actualSeconds(await db.studySessions.toArray(), await db.timeSegments.toArray())).toBe(0)
    expect((await db.tasks.get(task.id))?.estimatedSeconds).toBe(5400)
  })
  it('keeps daily assignment stable including concurrent initialization and manual changes', async () => {
    const first = await Promise.all([
      service.dailyQuote('2028-02-29'),
      service.dailyQuote('2028-02-29'),
    ])
    expect(first[0].quoteId).toBe(first[1].quoteId)
    expect(await db.quoteHistory.count()).toBe(1)
    const changed = await service.dailyQuote('2028-02-29', true)
    expect(changed.quoteId).not.toBe(first[0].quoteId)
    expect((await service.dailyQuote('2028-02-29')).quoteId).toBe(changed.quoteId)
    expect(await db.quoteHistory.count()).toBe(2)
  })
  it('keeps data across database connection reopen and does not reseed preferences', async () => {
    const c = await cycle()
    await service.createTask(input(c.id))
    await service.setCompanion('cat')
    const name = db.name
    db.close()
    db = new StudyDatabase(name)
    await db.open()
    expect(await db.tasks.count()).toBe(1)
    expect((await db.preferences.get('preferences'))?.companionId).toBe('cat')
    expect(await db.subjects.count()).toBe(12)
  })
  it('changing companion leaves study data untouched and rejects invalid assets', async () => {
    const c = await cycle()
    await service.createTask(input(c.id))
    const before = await db.tasks.toArray()
    await service.setCompanion('rabbit')
    expect(await db.tasks.toArray()).toEqual(before)
    await expect(service.setCompanion('../bad')).rejects.toThrow('不存在')
  })
})

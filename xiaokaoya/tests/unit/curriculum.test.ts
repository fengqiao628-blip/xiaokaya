import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safetyContext } from './safety-helpers'
import { CurriculumService } from '../../src/services/curriculum'
import { readPayload, makeBackup } from '../../src/data/backup/payload'
import { inspectBackup, validateData } from '../../src/shared/backup'
import { makeCsv } from '../../src/data/backup/csv'
import { DATABASE_VERSION } from '../../src/shared/identity'
import type { Chapter, LearningMaterial } from '../../src/domain/models'

let ctx: Awaited<ReturnType<typeof safetyContext>>, service: CurriculumService
beforeEach(async () => {
  ctx = await safetyContext()
  service = new CurriculumService(ctx.database)
})
afterEach(async () => {
  vi.restoreAllMocks()
  ctx.database.close()
  await ctx.database.delete()
})
const bookInput = { title: '会计教材', kind: 'textbook' as const, edition: '2027版', partId: null }
const chapterInput = {
  title: '第一章 总论',
  partId: null,
  completionStatus: 'not_started' as const,
  masteryStars: null,
  notes: '',
}
async function addMaterial(cycleId = ctx.cycle.id) {
  const id = await service.saveMaterial(cycleId, bookInput)
  return (await ctx.database.materials.get(id))!
}
async function addChapter(cycleId = ctx.cycle.id) {
  const id = await service.saveChapter(cycleId, chapterInput)
  return (await ctx.database.chapters.get(id))!
}
async function examInput() {
  const cycle = (await ctx.database.cycles.get(ctx.cycle.id))!
  const status = (await ctx.database.cycleStatuses.get(cycle.id))!
  return {
    cycle,
    status,
    input: {
      learningStatus: cycle.learningStatus,
      registrationStatus: status.registrationStatus,
      examResult: status.examResult,
      examDate: status.examDate,
      notes: status.notes,
    },
  }
}

describe('independent yearly exam records', () => {
  it('keeps all three state axes independent, including passed while learning remains paused and unregistered', async () => {
    let state = await examInput()
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      learningStatus: 'paused',
      examResult: 'passed',
    })
    state = await examInput()
    expect(state.input).toMatchObject({
      learningStatus: 'paused',
      registrationStatus: 'not_planned',
      examResult: 'passed',
    })
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      registrationStatus: 'attended',
      examDate: '2028-02-29',
    })
    expect((await examInput()).input).toMatchObject({
      learningStatus: 'paused',
      registrationStatus: 'attended',
      examResult: 'passed',
      examDate: '2028-02-29',
    })
    state = await examInput()
    await expect(
      service.saveCycle(state.cycle, state.status, { ...state.input, examDate: '2027-02-29' }),
    ).rejects.toThrow('日期')
  })
  it('retains 2027 records when the same subject is selected in 2028 and 2029', async () => {
    const material = await addMaterial(),
      chapter = await addChapter(),
      state = await examInput()
    await service.saveCycle(state.cycle, state.status, { ...state.input, examResult: 'passed' })
    await service.setProgress(material.id, chapter.id, 100)
    for (const year of [2028, 2029]) await ctx.study.selectSubjects(year, ['cpa-1'])
    const all = await ctx.database.cycles.where('subjectId').equals('cpa-1').toArray()
    expect(all).toHaveLength(3)
    for (const cycle of all.filter((cycle) => cycle.id !== ctx.cycle.id)) {
      expect((await ctx.database.cycleStatuses.get(cycle.id))?.examResult).toBe('unrecorded')
      expect(await ctx.database.chapters.where('cycleId').equals(cycle.id).count()).toBe(0)
    }
    expect(await ctx.database.materialProgress.count()).toBe(1)
    expect((await ctx.database.tasks.get(ctx.task.id))?.cycleId).toBe(ctx.cycle.id)
  })
  it('pauses and restores selections without replacing registration or results', async () => {
    const state = await examInput()
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      registrationStatus: 'registered',
      examResult: 'failed',
    })
    const original = await ctx.database.cycleStatuses.get(state.cycle.id)
    await ctx.study.selectSubjects(2027, [])
    await ctx.study.selectSubjects(2027, ['cpa-1'])
    expect(await ctx.database.cycleStatuses.get(state.cycle.id)).toEqual(original)
  })
  it('archives and restores without deleting history or changing any of the three axes', async () => {
    const state = await examInput()
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      learningStatus: 'paused',
      examResult: 'passed',
    })
    let cycle = (await ctx.database.cycles.get(state.cycle.id))!
    await service.archiveCycle(cycle, true)
    await expect(addChapter()).rejects.toThrow('归档')
    await expect(ctx.study.selectSubjects(2027, ['cpa-1'])).rejects.toThrow('归档')
    cycle = (await ctx.database.cycles.get(cycle.id))!
    await service.archiveCycle(cycle, false)
    expect((await ctx.database.cycles.get(cycle.id))?.learningStatus).toBe('paused')
    expect((await ctx.database.cycleStatuses.get(cycle.id))?.examResult).toBe('passed')
    expect(await ctx.database.tasks.get(ctx.task.id)).toEqual(ctx.task)
  })
  it('rejects stale cycle edits and rolls both tables back if the second write fails', async () => {
    const state = await examInput(),
      before = await readPayload(ctx.database)
    const hook = () => {
      throw new Error('status write failed')
    }
    ctx.database.cycleStatuses.hook('updating', hook)
    await expect(
      service.saveCycle(state.cycle, state.status, {
        ...state.input,
        learningStatus: 'studying',
        examResult: 'passed',
      }),
    ).rejects.toThrow('status write failed')
    ctx.database.cycleStatuses.hook('updating').unsubscribe(hook)
    expect((await readPayload(ctx.database)).cycles).toEqual(before.cycles)
    expect((await readPayload(ctx.database)).cycleStatuses).toEqual(before.cycleStatuses)
    await service.saveCycle(state.cycle, state.status, { ...state.input, examResult: 'passed' })
    await expect(service.saveCycle(state.cycle, state.status, state.input)).rejects.toThrow('变化')
  })
  it('does not pause an archived historical cycle when adjusting other subjects in the same year', async () => {
    const state = await examInput()
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      learningStatus: 'studying',
      examResult: 'passed',
    })
    await service.archiveCycle((await ctx.database.cycles.get(state.cycle.id))!, true)
    const before = await ctx.database.cycles.get(state.cycle.id),
      exam = await ctx.database.cycleStatuses.get(state.cycle.id)
    await ctx.study.selectSubjects(2027, ['tax-1'])
    expect(await ctx.database.cycles.get(state.cycle.id)).toEqual(before)
    expect(await ctx.database.cycleStatuses.get(state.cycle.id)).toEqual(exam)
  })
  it('rolls selection back if a new independent exam-state row cannot be created', async () => {
    const before = await readPayload(ctx.database),
      hook = () => {
        throw new Error('no exam row')
      }
    ctx.database.cycleStatuses.hook('creating', hook)
    await expect(ctx.study.selectSubjects(2030, ['cpa-1'])).rejects.toThrow('no exam row')
    ctx.database.cycleStatuses.hook('creating').unsubscribe(hook)
    expect((await readPayload(ctx.database)).cycles).toEqual(before.cycles)
    expect((await readPayload(ctx.database)).annualPlans).toEqual(before.annualPlans)
  })
})

describe('curriculum integrity and separate progress', () => {
  it('never infers mastery or chapter completion from 100% textbook progress', async () => {
    const material = await addMaterial(),
      chapter = await addChapter()
    await service.setProgress(material.id, chapter.id, 100)
    const videoId = await service.saveMaterial(ctx.cycle.id, {
      ...bookInput,
      title: '基础视频',
      kind: 'video',
    })
    await service.setProgress(videoId, chapter.id, 25)
    expect(await ctx.database.chapters.get(chapter.id)).toEqual(chapter)
    await service.saveChapter(
      ctx.cycle.id,
      { ...chapterInput, completionStatus: 'completed', masteryStars: 1 },
      chapter,
    )
    expect((await ctx.database.chapters.get(chapter.id))?.masteryStars).toBe(1)
    expect(
      (await ctx.database.materialProgress.toArray())
        .map((item) => item.progressPercent)
        .sort((a, b) => a - b),
    ).toEqual([25, 100])
  })
  it('preserves referenced editions and archives without deleting progress or task references', async () => {
    const material = await addMaterial(),
      chapter = await addChapter()
    await service.setProgress(material.id, chapter.id, 70)
    const task = await ctx.study.createTask({
      cycleId: ctx.cycle.id,
      chapterId: chapter.id,
      title: '关联章节',
      plannedDate: '2027-02-02',
      estimatedMinutes: 30,
      notes: '',
    })
    await expect(
      service.saveMaterial(ctx.cycle.id, { ...bookInput, edition: '2028版' }, material),
    ).rejects.toThrow('新版本')
    await service.archiveItem('materials', material, true)
    await service.archiveItem('chapters', chapter, true)
    expect((await ctx.database.tasks.get(task.id))?.chapterId).toBe(chapter.id)
    expect(await ctx.database.materialProgress.count()).toBe(1)
    await expect(service.setProgress(material.id, chapter.id, 80)).rejects.toThrow('归档')
    await expect(
      ctx.study.createTask({
        cycleId: ctx.cycle.id,
        chapterId: chapter.id,
        title: '不许新关联',
        plannedDate: '2027-02-02',
        estimatedMinutes: 30,
        notes: '',
      }),
    ).rejects.toThrow('归档')
    await service.archiveItem('materials', (await ctx.database.materials.get(material.id))!, false)
    await service.archiveItem('chapters', (await ctx.database.chapters.get(chapter.id))!, false)
    expect((await ctx.database.materialProgress.toArray())[0].progressPercent).toBe(70)
  })
  it('rejects cross-year references, invalid percentages and incompatible comprehensive papers', async () => {
    const material = await addMaterial(),
      chapter = await addChapter()
    await ctx.study.selectSubjects(2028, ['cpa-1', 'cpa-comprehensive'])
    const plan = (await ctx.database.annualPlans.where('year').equals(2028).first())!
    const cycles = await ctx.database.cycles.where('annualPlanId').equals(plan.id).toArray()
    const other = cycles.find((c) => c.subjectId === 'cpa-1')!,
      comprehensive = cycles.find((c) => c.subjectId === 'cpa-comprehensive')!
    const otherChapter = await addChapter(other.id)
    await expect(service.setProgress(material.id, otherChapter.id, 50)).rejects.toThrow('同一年度')
    await expect(
      ctx.study.createTask({
        cycleId: other.id,
        chapterId: chapter.id,
        title: '跨年错误',
        plannedDate: '2028-02-29',
        estimatedMinutes: 30,
        notes: '',
      }),
    ).rejects.toThrow('其他年度')
    for (const value of [-1, 101, NaN, 2.5])
      await expect(service.setProgress(material.id, chapter.id, value)).rejects.toThrow()
    await expect(
      service.saveChapter(ctx.cycle.id, { ...chapterInput, partId: 'cpa-comprehensive-1' }),
    ).rejects.toThrow('试卷')
    const first = await service.saveChapter(comprehensive.id, {
      ...chapterInput,
      partId: 'cpa-comprehensive-1',
    })
    const secondMaterial = await service.saveMaterial(comprehensive.id, {
      ...bookInput,
      partId: 'cpa-comprehensive-2',
    })
    await expect(service.setProgress(secondMaterial, first, 1)).rejects.toThrow('试卷')
  })
  it('makes new records retry-safe and refuses stale progress or material/chapter edits', async () => {
    const id = crypto.randomUUID()
    await Promise.all([
      service.saveMaterial(ctx.cycle.id, bookInput, undefined, id),
      service.saveMaterial(ctx.cycle.id, bookInput, undefined, id),
    ])
    expect(await ctx.database.materials.count()).toBe(1)
    const material = (await ctx.database.materials.get(id))!,
      chapter = await addChapter(),
      progressId = crypto.randomUUID()
    await Promise.all([
      service.setProgress(id, chapter.id, 20, undefined, progressId),
      service.setProgress(id, chapter.id, 20, undefined, progressId),
    ])
    const progress = (await ctx.database.materialProgress.get(progressId))!
    expect(await ctx.database.materialProgress.count()).toBe(1)
    await service.setProgress(id, chapter.id, 30, progress)
    await expect(service.setProgress(id, chapter.id, 40, progress)).rejects.toThrow('变化')
    await service.saveMaterial(ctx.cycle.id, { ...bookInput, title: '新名称' }, material)
    await expect(service.saveMaterial(ctx.cycle.id, bookInput, material)).rejects.toThrow('变化')
    await service.saveChapter(ctx.cycle.id, { ...chapterInput, masteryStars: 2 }, chapter)
    await expect(service.saveChapter(ctx.cycle.id, chapterInput, chapter)).rejects.toThrow('变化')
    await expect(
      service.saveMaterial(ctx.cycle.id, { ...bookInput, title: '另一资料' }, undefined, id),
    ).rejects.toThrow('标识')
  })
  it('includes every new table and separate metrics in full JSON restore and CSV', async () => {
    const material = await addMaterial(),
      chapter = await addChapter()
    await service.setProgress(material.id, chapter.id, 100)
    await service.saveChapter(ctx.cycle.id, { ...chapterInput, masteryStars: 1 }, chapter)
    const state = await examInput()
    await service.saveCycle(state.cycle, state.status, {
      ...state.input,
      registrationStatus: 'registered',
      examResult: 'passed',
    })
    const envelope = await makeBackup(await readPayload(ctx.database), '0.3.0', 'export')
    await service.archiveItem('materials', material, true)
    await ctx.service.restore(await ctx.service.preview(JSON.stringify(envelope), 'v3.json'))
    const restored = await readPayload(ctx.database)
    expect(restored).toEqual((await inspectBackup(envelope)).data)
    const csv = makeCsv(restored, 'chapters')
    expect(csv).toContain('"1"')
    expect(csv).toContain('"100"')
    expect(csv).toContain('未开始')
    expect(makeCsv(restored, 'cycles')).toContain('已报名')
    expect(makeCsv(restored, 'cycles')).toContain('已通过')
    expect(makeCsv(restored, 'materials')).toContain('2027版')
  })
  it('preflight rejects orphan states, cross-cycle progress, invalid stars and missing chapters', async () => {
    const material = await addMaterial(),
      chapter = await addChapter()
    await service.setProgress(material.id, chapter.id, 50)
    const data = await readPayload(ctx.database)
    for (const modify of [
      (copy: typeof data) => {
        copy.cycleStatuses = []
      },
      (copy: typeof data) => {
        copy.chapters[0].masteryStars = 6
      },
      (copy: typeof data) => {
        copy.materialProgress[0].chapterId = 'missing'
      },
      (copy: typeof data) => {
        copy.materials[0].cycleId = ctx.envelope.data.cycles.find((c) => c.id !== ctx.cycle.id)!.id
      },
    ]) {
      const copy = structuredClone(data)
      modify(copy)
      expect(() => validateData(copy, DATABASE_VERSION)).toThrow()
    }
  })
})

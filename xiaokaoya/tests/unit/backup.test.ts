import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { safetyContext } from './safety-helpers'
import {
  fingerprint,
  inspectBackup,
  parseBackup,
  sealBackup,
  validateData,
  type BackupEnvelope,
} from '../../src/shared/backup'
import { readPayload } from '../../src/data/backup/payload'
import { makeCsv } from '../../src/data/backup/csv'
import { SnapshotStore, atomicWrite } from '../../src/main/backup-files'
import { todayKey } from '../../src/domain/dates'
import { DATABASE_VERSION } from '../../src/shared/identity'

let ctx: Awaited<ReturnType<typeof safetyContext>>
beforeEach(async () => {
  ctx = await safetyContext()
})
afterEach(async () => {
  vi.restoreAllMocks()
  ctx.database.close()
  await ctx.database.delete()
})
async function reseal(data: BackupEnvelope['data'], changes: Partial<BackupEnvelope> = {}) {
  const { checksum, counts, format, formatVersion, ...input } = { ...ctx.envelope, ...changes }
  return sealBackup({ ...input, data })
}

describe('complete backup integrity', () => {
  it('round-trips every table, key and relation through JSON and an actual verified file', async () => {
    const saved = await ctx.service.exportJson()
    const text = await readFile(saved!.path, 'utf8')
    const parsed = await parseBackup(text)
    const checked = await inspectBackup(parsed)
    expect(checked.data).toEqual(ctx.envelope.data)
    expect(Object.keys(checked.data)).toHaveLength(ctx.database.tables.length)
    expect((await ctx.store.status()).lastExport?.path).toBe(saved!.path)
  })
  it('rejects truncated JSON, checksum tampering and future format without writes', async () => {
    const before = await fingerprint(await readPayload(ctx.database), true)
    for (const text of [
      '{"format":',
      JSON.stringify({ ...ctx.envelope, appVersion: 'modified' }),
      JSON.stringify({ ...ctx.envelope, formatVersion: 99 }),
    ]) {
      await expect(ctx.service.preview(text, 'bad.json')).rejects.toThrow()
    }
    expect(await fingerprint(await readPayload(ctx.database), true)).toBe(before)
  })
  it('rejects unsupported database version and table mismatches even with a valid checksum', async () => {
    await expect(
      inspectBackup(await reseal(ctx.envelope.data, { schemaVersion: 99 })),
    ).rejects.toThrow('版本')
    const data = structuredClone(ctx.envelope.data)
    delete data.tasks
    await expect(inspectBackup(await reseal(data))).rejects.toThrow('数据表')
    data.futureTable = []
    await expect(inspectBackup(await reseal(data))).rejects.toThrow('数据表')
  })
  it('checks manifest counts, duplicate keys and duplicated subject-years', async () => {
    const duplicate = structuredClone(ctx.envelope.data)
    duplicate.tasks.push({ ...duplicate.tasks[0] })
    await expect(inspectBackup(await reseal(duplicate))).rejects.toThrow('重复')
    const cycles = structuredClone(ctx.envelope.data)
    cycles.cycles.push({ ...cycles.cycles[0], id: crypto.randomUUID() })
    await expect(inspectBackup(await reseal(cycles))).rejects.toThrow('年度科目周期')
    const incorrect = structuredClone(ctx.envelope)
    incorrect.counts.tasks = 9
    const { checksum, ...body } = incorrect
    const { sha256, canonical } = await import('../../src/shared/backup')
    incorrect.checksum.value = await sha256(canonical(body))
    await expect(inspectBackup(incorrect)).rejects.toThrow('数量')
  })
  it('checks subject, cycle, task and chapter references and rejects impossible dates', async () => {
    for (const change of [
      { cycleId: 'missing' },
      { chapterId: 'missing-chapter' },
      { plannedDate: '2027-02-29' },
    ]) {
      const data = structuredClone(ctx.envelope.data)
      Object.assign(data.tasks[0], change)
      await expect(inspectBackup(await reseal(data))).rejects.toThrow()
    }
    const data = structuredClone(ctx.envelope.data)
    data.cycles[0].subjectId = 'missing'
    await expect(inspectBackup(await reseal(data))).rejects.toThrow('不存在')
  })
  it('retains unknown animal preference while explicitly warning about fallback art', async () => {
    const data = structuredClone(ctx.envelope.data)
    data.preferences[0].companionId = 'future-fox'
    const checked = await inspectBackup(await reseal(data))
    expect(checked.data.preferences[0].companionId).toBe('future-fox')
    expect(checked.warnings.join('')).toContain('默认伙伴')
  })
  it('rejects overlapping confirmed time and mixed sources; duration-only records are labelled unverifiable', async () => {
    const data = structuredClone(ctx.envelope.data),
      now = new Date().toISOString()
    const session = {
      id: 's1',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      cycleId: ctx.cycle.id,
      taskId: ctx.task.id,
      studyDate: '2027-02-01',
      status: 'confirmed',
      timeMode: 'segments',
      durationOnlySeconds: null,
    }
    data.studySessions = [session, { ...session, id: 's2' }]
    data.timeSegments = [
      {
        id: 't1',
        createdAt: now,
        updatedAt: now,
        revision: 1,
        sessionId: 's1',
        startedAt: '2027-02-01T01:00:00Z',
        endedAt: '2027-02-01T02:00:00Z',
      },
      {
        id: 't2',
        createdAt: now,
        updatedAt: now,
        revision: 1,
        sessionId: 's2',
        startedAt: '2027-02-01T01:30:00Z',
        endedAt: '2027-02-01T02:30:00Z',
      },
    ]
    expect(() => validateData(data, DATABASE_VERSION)).toThrow('重叠')
    data.timeSegments = []
    data.studySessions = [{ ...session, timeMode: 'duration_only', durationOnlySeconds: 3600 }]
    expect(validateData(data, DATABASE_VERSION).join('')).toContain('无法核验')
    data.studySessions[0].timeMode = 'segments'
    expect(() => validateData(data, DATABASE_VERSION)).toThrow('同时保存')
  })
})

describe('restore protection and idempotency', () => {
  it('restores the complete dataset and repeated import does not append or duplicate', async () => {
    await ctx.study.createTask({
      cycleId: ctx.cycle.id,
      title: '恢复前新增任务',
      plannedDate: '2027-02-02',
      estimatedMinutes: 30,
      notes: '',
    })
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'original.json')
    expect(preview.identical).toBe(false)
    const result = await ctx.service.restore(preview)
    expect(result.unchanged).toBe(false)
    expect(await ctx.database.tasks.count()).toBe(1)
    const before = await inspectBackup(
      await parseBackup(await ctx.store.readSnapshot(result.snapshotId!)),
    )
    expect(before.data.tasks).toHaveLength(2)
    expect((await ctx.store.status()).journal?.status).toBe('committed')
    const same = await ctx.service.preview(JSON.stringify(ctx.envelope), 'same-again.json')
    expect(same.identical).toBe(true)
    expect((await ctx.service.restore(same)).unchanged).toBe(true)
    expect((await ctx.store.listSnapshots()).snapshots).toHaveLength(1)
  })
  it('does not skip a previously imported backup when real data has subsequently changed', async () => {
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'same.json')
    expect((await ctx.service.restore(preview)).unchanged).toBe(true)
    await ctx.study.setCompanion('dog')
    const changed = await ctx.service.preview(JSON.stringify(ctx.envelope), 'same.json')
    expect(changed.identical).toBe(false)
    await ctx.service.restore(changed)
    expect((await ctx.database.preferences.get('preferences'))?.companionId).toBe('duck')
  })
  it('stops if current data changed after preview', async () => {
    await ctx.study.setCompanion('cat')
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'older.json')
    await ctx.study.setCompanion('dog')
    await expect(ctx.service.restore(preview)).rejects.toThrow('预检后')
    expect((await ctx.database.preferences.get('preferences'))?.companionId).toBe('dog')
    expect((await ctx.store.listSnapshots()).snapshots).toHaveLength(0)
  })
  it('stops before clearing any table when automatic snapshot creation fails', async () => {
    await ctx.study.setCompanion('cat')
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'older.json')
    const before = await fingerprint(await readPayload(ctx.database), true)
    vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockRejectedValueOnce(new Error('disk full'))
    await expect(ctx.service.restore(preview)).rejects.toThrow('disk full')
    expect(await fingerprint(await readPayload(ctx.database), true)).toBe(before)
  })
  it('rolls back all cleared tables when a later bulk write fails', async () => {
    await ctx.study.setCompanion('cat')
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'older.json')
    const before = await fingerprint(await readPayload(ctx.database), true)
    ctx.database.tasks.hook('creating', () => {
      throw new Error('simulated mid-write failure')
    })
    await expect(ctx.service.restore(preview)).rejects.toThrow('回滚')
    expect(await fingerprint(await readPayload(ctx.database), true)).toBe(before)
    expect((await ctx.store.status()).journal?.status).toBe('rolled-back')
  })
  it('refuses mismatched snapshot readback before performing any replacement', async () => {
    await ctx.study.setCompanion('cat')
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'older.json')
    vi.spyOn(ctx.desktop.backup, 'readSnapshot').mockResolvedValueOnce(JSON.stringify(ctx.envelope))
    await expect(ctx.service.restore(preview)).rejects.toThrow('回读失败')
    expect((await ctx.database.preferences.get('preferences'))?.companionId).toBe('cat')
  })
  it('serializes task writes behind a pending protected restore', async () => {
    await ctx.study.setCompanion('cat')
    const preview = await ctx.service.preview(JSON.stringify(ctx.envelope), 'older.json')
    const original = ctx.desktop.backup.saveSnapshot
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(ctx.desktop.backup, 'saveSnapshot').mockImplementationOnce(async (content) => {
      await wait
      return original(content)
    })
    const restore = ctx.service.restore(preview)
    const created = ctx.study.createTask({
      cycleId: ctx.cycle.id,
      title: '恢复后排队保存',
      plannedDate: '2027-02-03',
      estimatedMinutes: 10,
      notes: '',
    })
    release()
    await restore
    await created
    expect(await ctx.database.tasks.count()).toBe(2)
  })
})

describe('files, retention and CSV', () => {
  it('reports a verified export as successful even if its local receipt cannot be saved', async () => {
    const store = new SnapshotStore(ctx.root, async (file, content) => {
      if (file.endsWith('last-export.json')) throw new Error('receipt disk full')
      await atomicWrite(file, content)
    })
    const saved = await store.writeExport(
      join(ctx.root, 'verified-even-without-receipt.json'),
      JSON.stringify(ctx.envelope),
      'json',
    )
    expect(saved.warning).toContain('已导出并校验')
    expect((await parseBackup(await readFile(saved.path, 'utf8'))).checksum.value).toBe(
      ctx.envelope.checksum.value,
    )
  })
  it('round-trips 20000 records spanning 2027–2029 and exports canonical actual time', async () => {
    const data = structuredClone(ctx.envelope.data),
      base = data.tasks[0],
      now = new Date().toISOString()
    data.tasks = []
    data.taskScheduleHistory = []
    data.studySessions = []
    data.timeSegments = []
    for (let n = 0; n < 20000; n++) {
      const start = new Date(Date.UTC(2027, 0, 1) + n * 3600000),
        end = new Date(start.getTime() + 360000)
      const date = todayKey(start)
      const common = { createdAt: now, updatedAt: now, revision: 1 }
      data.tasks.push({ ...base, id: `load-task-${n}`, plannedDate: date })
      data.studySessions.push({
        ...common,
        id: `load-session-${n}`,
        cycleId: ctx.cycle.id,
        taskId: `load-task-${n}`,
        studyDate: date,
        status: 'confirmed',
        timeMode: 'segments',
        durationOnlySeconds: null,
      })
      data.timeSegments.push({
        ...common,
        id: `load-time-${n}`,
        sessionId: `load-session-${n}`,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
      })
    }
    const backup = await reseal(data)
    const inspection = await inspectBackup(await parseBackup(JSON.stringify(backup)))
    expect(inspection.counts.studySessions).toBe(20000)
    const preview = await ctx.service.preview(JSON.stringify(backup), 'three-year-load.json')
    await ctx.service.restore(preview)
    expect(await ctx.database.tasks.count()).toBe(20000)
    expect(await ctx.database.studySessions.count()).toBe(20000)
    const csv = makeCsv(inspection.data, 'tasks')
    expect(csv).toContain('"6"')
    expect(csv.split('\r\n')).toHaveLength(20002)
  }, 60000)
  it('creates at most one verified daily snapshot per dataset and day', async () => {
    await ctx.service.ensureDailySnapshot()
    await ctx.service.ensureDailySnapshot()
    expect((await ctx.store.listSnapshots()).snapshots).toHaveLength(1)
  })
  it('retains critical snapshots while rotating verified daily snapshots', async () => {
    const raw = await readPayload(ctx.database)
    for (let n = 0; n < 16; n++) {
      const envelope = await sealBackup({
        data: raw,
        schemaVersion: DATABASE_VERSION,
        appVersion: '0.2.0',
        backupId: crypto.randomUUID(),
        datasetId: String(raw.datasetMeta[0].datasetId),
        purpose: 'daily',
        exportedAt: new Date(Date.UTC(2027, 0, n + 1)).toISOString(),
      })
      await ctx.store.saveSnapshot(JSON.stringify(envelope))
    }
    await ctx.service.createSnapshot('manual')
    const list = await ctx.store.listSnapshots()
    expect(list.snapshots.filter((item) => item.purpose === 'daily')).toHaveLength(14)
    expect(list.snapshots.filter((item) => item.purpose === 'manual')).toHaveLength(1)
  })
  it('keeps corrupt snapshots visible as problems, rather than deleting them', async () => {
    await ctx.store.initialize()
    const name = `snapshot-${crypto.randomUUID()}.json`
    await writeFile(join(ctx.store.root, name), 'truncated', 'utf8')
    const list = await ctx.store.listSnapshots()
    expect(list.problems[0]).toContain(name)
    expect(await readFile(join(ctx.store.root, name), 'utf8')).toBe('truncated')
  })
  it('prevents traversal and refuses writing exports inside Chromium profile', async () => {
    await expect(ctx.store.readSnapshot('../../outside')).rejects.toThrow('标识')
    await expect(
      ctx.store.writeExport(
        join(ctx.root, 'profile', 'wrong.json'),
        JSON.stringify(ctx.envelope),
        'json',
      ),
    ).rejects.toThrow('profile')
  })
  it('failed atomic replacement preserves the previous destination file', async () => {
    const target = join(ctx.root, 'keep.json')
    await writeFile(target, 'old', 'utf8')
    // A directory target makes rename fail after the temporary file is fully written.
    const directory = join(ctx.root, 'directory.json')
    await mkdir(directory)
    await expect(atomicWrite(directory, 'new')).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('old')
    const failingStore = new SnapshotStore(ctx.root, async () => {
      throw new Error('simulated write failure')
    })
    await expect(
      failingStore.writeExport(target, JSON.stringify(ctx.envelope), 'json'),
    ).rejects.toThrow('write failure')
    expect(await readFile(target, 'utf8')).toBe('old')
  })
  it('exports quoted Chinese CSV, escapes newlines and neutralizes spreadsheet formulas', async () => {
    const data = await readPayload(ctx.database)
    data.tasks[0].title = '=HYPERLINK("https://invalid")'
    const csv = makeCsv(data, 'tasks')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'=HYPERLINK(""https://invalid"")"')
    expect(csv).toContain('"保留中文、逗号, 和换行\n第二行"')
    expect(makeCsv(data, 'sessions')).toContain('实际分钟')
  })
})

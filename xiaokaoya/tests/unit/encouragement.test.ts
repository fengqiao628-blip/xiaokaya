import { expect, it } from 'vitest'
import {
  encouragementLibrary,
  learningMood,
  pickEncouragement,
  type EncouragementMood,
} from '../../src/companions/encouragement'
import { task, entity } from '../fixtures/analytics'
import type { FocusTimer } from '../../src/domain/models'
const today = '2024-02-29'
const timer = (override: Partial<FocusTimer> = {}): FocusTimer => ({
  ...entity,
  id: 'timer',
  cycleId: 'a27',
  taskId: null,
  chapterId: null,
  targetSeconds: 60,
  status: 'running',
  reason: 'started',
  checkpointAt: entity.updatedAt,
  intervals: [],
  sessionIds: [],
  ...override,
})
it('supplies at least 12 distinct original versions for each of 10 learning contexts', () => {
  expect(Object.keys(encouragementLibrary)).toHaveLength(10)
  const all = Object.values(encouragementLibrary).flat()
  expect(all.length).toBeGreaterThanOrEqual(120)
  expect(new Set(all).size).toBe(all.length)
  for (const list of Object.values(encouragementLibrary))
    expect(list.length).toBeGreaterThanOrEqual(12)
})
it('cycles without repeating until every version has been shown, for all partners and moods', () => {
  for (const pet of ['duck', 'cat', 'bear', 'rabbit', 'dog'])
    for (const mood of Object.keys(encouragementLibrary) as EncouragementMood[]) {
      const count = encouragementLibrary[mood].length
      const values = Array.from({ length: count }, (_, i) =>
        pickEncouragement(mood, `${today}:${pet}`, i),
      )
      expect(new Set(values).size).toBe(count)
      expect(pickEncouragement(mood, `${today}:${pet}`, count)).toBe(values[0])
    }
})
it('keeps text stable across repeated reads, renders and unrelated timer heartbeats', () => {
  const first = pickEncouragement('studying', 'session')
  for (let i = 0; i < 100; i++) expect(pickEncouragement('studying', 'session')).toBe(first)
  expect(learningMood([], [timer()], today)).toBe('studying')
  expect(learningMood([], [timer({ revision: 200 })], today)).toBe('studying')
})
it('prioritizes actual running, pause and end state over old completed task greetings', () => {
  const tasks = [task('done', { status: 'completed' })]
  expect(learningMood(tasks, [timer()], today)).toBe('studying')
  expect(learningMood(tasks, [timer({ status: 'paused', reason: 'paused' })], today)).toBe('paused')
  expect(learningMood(tasks, [timer({ status: 'review', reason: 'stopped' })], today)).toBe('ended')
})
it('recognizes timer due without claiming the task was completed', () => {
  const tasks = [task('pending')]
  expect(learningMood(tasks, [timer({ status: 'review', reason: 'due' })], today)).toBe('due')
  expect(tasks[0].status).toBe('pending')
  expect(encouragementLibrary.due.some((s) => s.includes('任务完成啦'))).toBe(false)
})
it('celebrates only actual completed tasks and excludes cancelled or different-day tasks', () => {
  expect(learningMood([task('p')], [], today)).toBe('ready')
  expect(learningMood([task('a', { status: 'completed' }), task('b')], [], today)).toBe('completed')
  expect(
    learningMood(
      [task('a', { status: 'completed' }), task('c', { status: 'cancelled' })],
      [],
      today,
    ),
  ).toBe('allDone')
  expect(
    learningMood([task('old', { status: 'completed', plannedDate: '2024-02-28' })], [], today),
  ).toBe('ready')
})
it('uses the local study day for a saved learning run and ignores discarded runs', () => {
  const updatedAt = new Date(2024, 1, 29, 23, 45).toISOString()
  expect(learningMood([], [timer({ updatedAt, status: 'saved' })], today)).toBe('ended')
  expect(learningMood([], [timer({ updatedAt, status: 'discarded' })], today)).toBe('ready')
  expect(learningMood([], [timer({ updatedAt, status: 'saved' })], '2024-03-01')).toBe('ready')
})
it('never changes tasks, focus records or time while deriving encouragement', () => {
  const data = { tasks: [task('a')], timers: [timer()] }
  const original = structuredClone(data)
  for (let i = 0; i < 24; i++)
    pickEncouragement(learningMood(data.tasks, data.timers, today), 'seed', i)
  expect(data).toEqual(original)
})

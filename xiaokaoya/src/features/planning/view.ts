import type { Snapshot } from '../dashboard/readDashboard'
import type { MilestoneKind } from '../../domain/models'

export type PlannerView = 'year' | 'month' | 'week' | 'day' | 'backlog'
export interface CalendarReminder {
  id: string
  cycleId: string
  kind: MilestoneKind | 'exam'
  date: string
  notes: string
  archived: boolean
}
export function cycleLabel(data: Snapshot, id: string) {
  const cycle = data.cycles.find((item) => item.id === id),
    subject = data.subjects.find((item) => item.id === cycle?.subjectId)
  const year = data.plans.find((item) => item.id === cycle?.annualPlanId)?.year
  return `${subject?.system === 'cpa' ? 'CPA' : '税务师'} · ${subject?.name ?? '未知科目'} · ${year ?? ''}`
}
export function calendarReminders(data: Snapshot): CalendarReminder[] {
  return [
    ...data.examMilestones.map((item) => ({
      id: item.id,
      cycleId: item.cycleId,
      kind: item.kind,
      date: item.date,
      notes: item.notes,
      archived: !!item.archivedAt,
    })),
    ...data.cycleStatuses
      .filter((item) => item.examDate !== null)
      .map((item) => ({
        id: `exam-${item.id}`,
        cycleId: item.id,
        kind: 'exam' as const,
        date: item.examDate!,
        notes: item.notes,
        archived: false,
      })),
  ]
}

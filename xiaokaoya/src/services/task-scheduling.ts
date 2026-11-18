import type { ScheduleAction, Task, TaskScheduleEvent } from '../domain/models'

export function scheduleEvent(
  task: Task,
  toDate: string | null,
  action: ScheduleAction,
  id: string,
  taskRevision: number,
  changedAt: string,
  note = '',
): TaskScheduleEvent {
  return {
    id,
    taskId: task.id,
    taskRevision,
    fromDate: action === 'created' ? null : task.plannedDate,
    toDate,
    action,
    changedAt,
    note,
  }
}

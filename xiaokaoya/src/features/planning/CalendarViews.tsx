import { CalendarDays } from 'lucide-react'
import { durationText, prettyDate, validDate } from '../../domain/dates'
import { monthCells, weekDates } from '../../domain/planning'
import type { Task } from '../../domain/models'
import { MILESTONE_LABELS } from '../../domain/models'
import type { CalendarReminder } from './view'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
type Props = {
  date: string
  today: string
  tasksByDate: Map<string, Task[]>
  remindersByDate: Map<string, CalendarReminder[]>
  busy: boolean
  onDate: (value: string) => void
}
export function MonthCalendar({
  date,
  today,
  tasksByDate,
  remindersByDate,
  busy,
  onDate,
  compact = false,
  onMonth,
  selectedDate = date,
}: Props & { compact?: boolean; onMonth?: () => void; selectedDate?: string }) {
  const month = date.slice(0, 7)
  return (
    <div className={`month-calendar ${compact ? 'compact' : ''}`}>
      {compact && (
        <button className="year-month-title" disabled={busy} onClick={onMonth}>
          {Number(date.slice(5, 7))}月
        </button>
      )}
      <div className="month-weekdays">
        {weekdays.map((day, i) => (
          <span className={i > 4 ? 'weekend' : ''} key={day}>
            周{day}
          </span>
        ))}
      </div>
      <div className="month-date-grid">
        {monthCells(date).map((day) => {
          const inMonth = day.startsWith(month),
            valid = validDate(day),
            tasks = tasksByDate.get(day) ?? [],
            reminders = remindersByDate.get(day) ?? []
          if (compact && !inMonth) return <span className="empty-date-cell" key={day} />
          return (
            <button
              key={day}
              className={`calendar-date ${!inMonth ? 'outside-month' : ''} ${today === day ? 'today' : ''} ${selectedDate === day ? 'selected' : ''}`}
              aria-label={`查看${day}`}
              aria-pressed={selectedDate === day}
              disabled={busy || !valid}
              onClick={() => onDate(day)}
            >
              <span className="calendar-date-number">{Number(day.split('-').at(-1))}</span>
              {tasks.length > 0 && (
                <span className="calendar-task-count">
                  {compact ? '•' : `${tasks.length}项任务`}
                </span>
              )}
              {reminders.length > 0 && (
                <span className="calendar-reminder-count">
                  {compact ? '◆' : `${reminders.length}项日期提醒`}
                </span>
              )}
              {!compact && (
                <span className="calendar-peek">
                  {tasks.slice(0, 2).map((task) => (
                    <span key={task.id} className={task.status === 'completed' ? 'done' : ''}>
                      {task.kind === 'review' ? '复习 · ' : ''}
                      {task.title}
                    </span>
                  ))}
                  {reminders.slice(0, 1).map((item) => (
                    <span className="reminder-peek" key={item.id}>
                      {MILESTONE_LABELS[item.kind]}
                    </span>
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
export function YearCalendar(props: Props & { onMonth: (value: string) => void }) {
  const year = props.date.slice(0, 4)
  return (
    <div className="year-calendar" aria-label={`${year}年全年日历`}>
      {Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`).map(
        (first) => (
          <MonthCalendar
            {...props}
            date={first}
            selectedDate={props.date}
            compact
            key={first}
            onMonth={() => props.onMonth(first)}
          />
        ),
      )}
    </div>
  )
}
export function WeekCalendar({
  date,
  today,
  tasksByDate,
  remindersByDate,
  busy,
  onDate,
  onDay,
  onCreate,
}: Props & { onDay: (value: string) => void; onCreate: (value: string) => void }) {
  return (
    <div className="week-calendar" aria-label="周一开始的周日历">
      {weekDates(date).map((day) => {
        const tasks = tasksByDate.get(day) ?? [],
          reminders = remindersByDate.get(day) ?? [],
          weekend = [0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay())
        const seconds = tasks
          .filter((task) => task.status !== 'cancelled')
          .reduce((sum, task) => sum + task.estimatedSeconds, 0)
        return (
          <section
            key={day}
            className={`week-day-card ${date === day ? 'selected' : ''} ${today === day ? 'today' : ''}`}
            aria-label={`${day}安排`}
          >
            <button
              className="week-day-heading"
              disabled={busy}
              onClick={() => onDate(day)}
              aria-label={`查看${day}`}
              aria-pressed={date === day}
            >
              <span>{prettyDate(day, { weekday: 'short' })}</span>
              <strong>{Number(day.slice(-2))}</strong>
              {today === day && <small>今天</small>}
            </button>
            <span className="week-day-load">预计 {durationText(seconds)}</span>
            <div className="week-day-items">
              {tasks.slice(0, 3).map((task) => (
                <button
                  className={`week-task-peek ${task.status === 'completed' ? 'done' : ''}`}
                  key={task.id}
                  disabled={busy}
                  onClick={() => onDay(day)}
                >
                  {task.kind === 'review' ? '复习 · ' : ''}
                  {task.title}
                </button>
              ))}
              {tasks.length > 3 && (
                <button className="text-button" disabled={busy} onClick={() => onDay(day)}>
                  另{tasks.length - 3}项
                </button>
              )}
              {reminders.map((item) => (
                <button
                  className="week-reminder-peek"
                  key={item.id}
                  disabled={busy}
                  onClick={() => onDay(day)}
                >
                  <CalendarDays size={11} />
                  {MILESTONE_LABELS[item.kind]}
                </button>
              ))}
            </div>
            <button
              className="week-day-add"
              disabled={busy}
              onClick={() => onCreate(day)}
              aria-label={`在${day}添加任务`}
            >
              ＋ 添加任务
            </button>
            {weekend && <small className="weekend-hint">周末灵活安排</small>}
          </section>
        )
      })}
    </div>
  )
}

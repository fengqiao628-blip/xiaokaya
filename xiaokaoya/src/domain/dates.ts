const learningDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export function todayKey(date = new Date()): string {
  const parts = learningDateFormatter.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function validDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = new Date(`${key}T00:00:00Z`)
  return (
    !isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === key &&
    Number(key.slice(0, 4)) >= 1900
  )
}
export function shiftDate(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().split('T')[0]
}
export function weekStart(key: string): string {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay()
  return shiftDate(key, -((day + 6) % 7))
}
export function prettyDate(
  key: string,
  options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'long' },
): string {
  return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: 'UTC' }).format(
    new Date(key + 'T00:00:00Z'),
  )
}
export function durationText(seconds: number): string {
  if (seconds > 0 && seconds < 60) return `${Math.floor(seconds)}秒`
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分钟` : ''}`
    : `${minutes}分钟`
}

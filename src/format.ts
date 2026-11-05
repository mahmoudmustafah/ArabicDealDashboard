import { DAY, HOUR, NOW } from './data'

const tz = 'Africa/Cairo'
const loc = 'ar-EG-u-nu-latn'

export const price = (n: number) => n.toLocaleString('en-US')
export const pct = (n: number) => `${Math.round(n)}%`

export const time = (t: number) =>
  new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(t)
export const date = (t: number) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', timeZone: tz }).format(t)
export const shortDate = (t: number) =>
  new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: tz }).format(t)
export const dateTime = (t: number) => `${date(t)}، ${time(t)}`

function unit(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one
  if (n === 2) return two
  if (n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}

export function ago(t: number) {
  const d = NOW - t
  if (d < 60e3) return 'دلوقتي'
  if (d < HOUR) return `منذ ${unit(Math.round(d / 60e3), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`
  if (d < DAY) return `منذ ${unit(Math.round(d / HOUR), 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`
  return `منذ ${unit(Math.round(d / DAY), 'يوم', 'يومين', 'أيام', 'يوم')}`
}

export const days = (n: number) => unit(Math.max(1, Math.round(n)), 'يوم واحد', 'يومين', 'أيام', 'يوم')
export const readings = (n: number) => unit(n, 'قراءة واحدة', 'قراءتين', 'قراءات', 'قراءة')

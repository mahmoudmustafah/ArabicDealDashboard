import { DAY, HOUR, NOW } from './data'
import { isAr, L } from './i18n'

const tz = 'Africa/Cairo'
const loc = () => (isAr() ? 'ar-EG-u-nu-latn' : 'en-GB')

export const price = (n: number) => n.toLocaleString('en-US')
export const pct = (n: number) => `${Math.round(n)}%`
export const currency = () => L('ج.م', 'EGP')

export const time = (t: number) =>
  new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(t)
export const date = (t: number) => new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'long', timeZone: tz }).format(t)
export const shortDate = (t: number) =>
  new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', timeZone: tz }).format(t)
export const dateTime = (t: number) => `${date(t)}${L('، ', ', ')}${time(t)}`

function unitAr(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one
  if (n === 2) return two
  if (n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}
const unitEn = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ago(t: number) {
  const d = NOW - t
  if (d < 60e3) return L('دلوقتي', 'just now')
  if (d < HOUR) {
    const n = Math.round(d / 60e3)
    return L(`منذ ${unitAr(n, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`, `${n} min ago`)
  }
  if (d < DAY) {
    const n = Math.round(d / HOUR)
    return L(`منذ ${unitAr(n, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`, `${unitEn(n, 'hour')} ago`)
  }
  const n = Math.round(d / DAY)
  return L(`منذ ${unitAr(n, 'يوم', 'يومين', 'أيام', 'يوم')}`, `${unitEn(n, 'day')} ago`)
}

export const days = (x: number) => {
  const n = Math.max(1, Math.round(x))
  return L(unitAr(n, 'يوم واحد', 'يومين', 'أيام', 'يوم'), unitEn(n, 'day'))
}
export const readings = (n: number) => L(unitAr(n, 'قراءة واحدة', 'قراءتين', 'قراءات', 'قراءة'), unitEn(n, 'reading'))

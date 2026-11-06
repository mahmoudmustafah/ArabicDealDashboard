import { useEffect, useState } from 'react'
import { cx } from './ui'
import { isAr } from './i18n'

/** The real time, re-rendering every `everyMs`. */
export function useNow(everyMs = 1000) {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return t
}

const tz = 'Africa/Cairo'
export const clock = (t: number) =>
  new Intl.DateTimeFormat(isAr() ? 'ar-EG-u-nu-latn' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: tz,
  }).format(t)

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const Mm = ({ ms, className }: { ms: number; className?: string }) => (
  <bdi dir="ltr" className={cx('num', className)}>
    {mmss(ms)}
  </bdi>
)

/** Relative time against the ticking clock. */
export function agoAt(now: number, t: number) {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (!isAr()) {
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`
  }
  if (s < 60) return `منذ ${s} ثانية`
  const m = Math.round(s / 60)
  if (m < 60) return m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : m <= 10 ? `منذ ${m} دقائق` : `منذ ${m} دقيقة`
  const h = Math.round(m / 60)
  return h === 1 ? 'منذ ساعة' : h === 2 ? 'منذ ساعتين' : `منذ ${h} ساعات`
}

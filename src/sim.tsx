import { useEffect, useRef, useState } from 'react'
import { NOW } from './data'
import { cx } from './ui'
import { isAr, L } from './i18n'

/** Simulated clock that starts at the sample NOW and advances in real time (optionally sped up for preview). */
export function useSimClock(speed: number) {
  const [t, setT] = useState(NOW)
  const speedRef = useRef(speed)
  speedRef.current = speed
  useEffect(() => {
    let last = Date.now()
    const id = setInterval(() => {
      const n = Date.now()
      setT((x) => x + (n - last) * speedRef.current)
      last = n
    }, 250)
    return () => clearInterval(id)
  }, [])
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

/** Relative time against a moving clock. */
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

export function SpeedControl({ speed, setSpeed }: { speed: number; setSpeed: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-mute">{L('سرعة المعاينة', 'Preview speed')}</span>
      <div className="flex rounded-lg border border-dashed border-line-strong bg-white p-0.5">
        {[1, 10, 30].map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            aria-pressed={speed === s}
            className={cx('num h-7 rounded-md px-2.5 text-[12px] font-semibold', speed === s ? 'bg-ink text-white' : 'text-body')}
          >
            ×{s}
          </button>
        ))}
      </div>
    </div>
  )
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Obs } from './data'
import { DAY, NOW } from './data'
import { dateTime, price, shortDate } from './format'
import { L, isAr } from './i18n'

type Props = { history: Obs[]; fromT: number; median?: number; lowest?: number; listPrice?: number }

export function PriceChart({ history, fromT, median, lowest }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  const [hover, setHover] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pts = useMemo(() => history.filter((o) => o.t >= fromT), [history, fromT])
  const H = 220
  const pad = { l: 8, r: 58, t: 16, b: 28 }
  const x0 = Math.min(fromT, pts[0]?.t ?? fromT)
  const x1 = NOW
  const prices = pts.map((p) => p.price).concat(median ? [median] : [])
  let lo = Math.min(...prices)
  let hi = Math.max(...prices)
  const span = Math.max(hi - lo, hi * 0.06)
  lo = lo - span * 0.15
  hi = hi + span * 0.15
  const X = (t: number) => pad.l + ((t - x0) / (x1 - x0)) * (w - pad.l - pad.r)
  const Y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b)

  // step path: price holds until next reading
  let d = ''
  pts.forEach((p, i) => {
    if (i === 0) d += `M${X(p.t)},${Y(p.price)}`
    else d += `H${X(p.t)}V${Y(p.price)}`
  })
  const last = pts[pts.length - 1]
  const area = pts.length ? `${d}V${H - pad.b}H${X(pts[0].t)}Z` : ''

  const ticks = 4
  const yTicks = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / ticks)
  const totalDays = (x1 - x0) / DAY
  const xTickN = w < 380 ? 3 : 5
  const xTicks = Array.from({ length: xTickN }, (_, i) => x0 + ((x1 - x0) * i) / (xTickN - 1))

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    let best = 0
    let bd = Infinity
    pts.forEach((p, i) => {
      const dd = Math.abs(X(p.t) - mx)
      if (dd < bd) {
        bd = dd
        best = i
      }
    })
    setHover(best)
  }
  const hp = hover !== null ? pts[hover] : null

  return (
    <div ref={ref} className="relative w-full overflow-hidden select-none" dir="ltr">
      <svg
        width={w}
        height={H}
        className="block touch-none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={L('رسم بياني لسجل السعر', 'Price history chart')}
      >
        <defs>
          <linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop className="[stop-color:var(--color-drop)]" offset="0%" stopOpacity="0.16" />
            <stop className="[stop-color:var(--color-drop)]" offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="stroke-grid" x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} />
            <text x={w - pad.r + 8} y={Y(v) + 4} fontSize="11" className="fill-mute num">
              {price(Math.round(v / 10) * 10)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={X(t)}
            y={H - 8}
            fontSize="11"
            className="fill-mute"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {i === xTicks.length - 1 ? L('اليوم', 'Today') : totalDays < 3 ? '' : shortDate(t)}
          </text>
        ))}
        {median && (
          <g>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={Y(median)}
              y2={Y(median)}
              className="stroke-body"
              strokeDasharray="4 4"
              strokeWidth={1.2}
            />
            <rect className="fill-white" x={pad.l} y={Y(median) - 19} width={isAr() ? 112 : 160} height={16} rx={4} opacity={0.9} />
            <text className="fill-body" x={pad.l + 4} y={Y(median) - 7} fontSize="10.5">
              {L('المرجع المرصود (الوسيط)', 'Observed reference (median)')}
            </text>
          </g>
        )}
        <path d={area} fill="url(#pc-fill)" />
        <path className="stroke-drop" d={d} fill="none" strokeWidth={2} strokeLinejoin="round" />
        {lowest !== undefined &&
          pts
            .filter((p) => p.price === lowest)
            .slice(-1)
            .map((p) => <circle className="fill-white stroke-drop" key="low" cx={X(p.t)} cy={Y(p.price)} r={4} strokeWidth={2} />)}
        {last && <circle className="fill-drop stroke-white" cx={X(last.t)} cy={Y(last.price)} r={5} strokeWidth={2} />}
        {hp && (
          <g pointerEvents="none">
            <line className="stroke-ink" x1={X(hp.t)} x2={X(hp.t)} y1={pad.t} y2={H - pad.b} strokeWidth={1} opacity={0.35} />
            <circle className="fill-ink stroke-white" cx={X(hp.t)} cy={Y(hp.price)} r={5} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg bg-ink px-2.5 py-1.5 text-white shadow-lg"
          style={{
            left: Math.min(Math.max(X(hp.t) - 70, 0), w - 150),
          }}
          dir={isAr() ? 'rtl' : 'ltr'}
        >
          <div className="num text-sm font-bold">{price(hp.price)} {L('ج.م', 'EGP')}</div>
          <div className="text-[11px] text-white/70">{dateTime(hp.t)}</div>
        </div>
      )}
    </div>
  )
}

export function Sparkline({ history, w = 96, h = 28 }: { history: Obs[]; w?: number; h?: number }) {
  const pts = history.filter((o) => o.t >= NOW - 30 * DAY)
  if (pts.length < 2) return <div style={{ width: w, height: h }} className="flex items-center text-[11px] text-mute">—</div>
  const lo = Math.min(...pts.map((p) => p.price))
  const hi = Math.max(...pts.map((p) => p.price))
  const t0 = pts[0].t
  const X = (t: number) => ((t - t0) / (NOW - t0)) * (w - 4) + 2
  const Y = (p: number) => (hi === lo ? h / 2 : 3 + (1 - (p - lo) / (hi - lo)) * (h - 6))
  let d = ''
  pts.forEach((p, i) => (d += i === 0 ? `M${X(p.t)},${Y(p.price)}` : `H${X(p.t)}V${Y(p.price)}`))
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} aria-hidden>
      <path className="stroke-drop" d={d} fill="none" strokeWidth={1.6} />
      <circle className="fill-drop" cx={X(last.t)} cy={Y(last.price)} r={2.5} />
    </svg>
  )
}

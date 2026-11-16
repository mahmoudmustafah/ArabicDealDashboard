import { evidence as E, timezone } from './config.ts'

/**
 * Evidence engine (brief §7–§10). History comes only from our own observations.
 * The crossed-out price is reported as "advertised" and is never treated as a past price.
 */

export type Obs = { t: number; price: number }

export type DealLabel = 'exceptional' | 'below_usual' | 'observed_drop' | 'insufficient' | 'advertised_only'
export type Basis = 'observed' | 'below_usual' | 'advertised'

export type Analysis = {
  current: Obs
  count: number
  spanDays: number
  coveredDays: number
  sufficient: boolean
  lowest: Obs
  /** First time the current price (±band) was observed. */
  detectedAt: number
  /** Most recent higher reading before the current price run. */
  prevHigher?: Obs
  observedDropPct?: number
  /** A short-lived higher price right before the drop (possible inflated reference). */
  inflatedBeforeDrop?: { hikeStart: number; preHikePrice: number }
  usual?: number
  usualWindowDays?: number
  usualDays?: number
  belowUsual: boolean
  belowUsualPct?: number
  exceptional: boolean
  advertisedPct?: number
  labels: DealLabel[]
  /** The store's crossed-out price, when it is above the current price. */
  listPrice?: number
  /** Strongest evidence we can state truthfully, with its percentage. */
  best?: { basis: Basis; pct: number; refPrice: number }
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
export const cairoDay = (t: number) => dayFmt.format(t)

export function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * One value per Cairo day (that day's median), so a day with 144 ten-minute readings
 * weighs the same as a day with 3 (brief §8).
 */
export function dailySummaries(h: Obs[]): { day: string; price: number; t: number }[] {
  const by = new Map<string, Obs[]>()
  for (const o of h) {
    const d = cairoDay(o.t)
    const list = by.get(d)
    if (list) list.push(o)
    else by.set(d, [o])
  }
  return [...by.entries()].map(([day, list]) => ({ day, price: median(list.map((o) => o.price)), t: list[0].t }))
}

const within = (a: number, b: number) => Math.abs(a - b) / b <= E.samePriceBandPct / 100
const pct = (from: number, to: number) => ((from - to) / from) * 100
const DAY = 86_400_000

export function analyze(history: Obs[], listPrice?: number): Analysis {
  if (!history.length) throw new Error('analyze() needs at least one observation')
  const h = [...history].sort((a, b) => a.t - b.t)
  const current = h[h.length - 1]
  const first = h[0]
  const spanDays = (current.t - first.t) / DAY
  const days = dailySummaries(h)
  const coveredDays = days.length
  const sufficient = h.length >= E.minObservations && spanDays >= E.minSpanDays && coveredDays >= E.minCoveredDays

  // Current price run: readings within ±band of the current price.
  let runStart = h.length - 1
  while (runStart > 0 && within(h[runStart - 1].price, current.price)) runStart--
  const justBefore = runStart > 0 ? h[runStart - 1] : undefined
  let prevHigher = justBefore && justBefore.price > current.price ? justBefore : undefined
  let observedDropPct = prevHigher ? pct(prevHigher.price, current.price) : undefined

  // Hike-then-drop: the higher run lasted only briefly and the price before it was lower.
  let inflatedBeforeDrop: Analysis['inflatedBeforeDrop']
  if (prevHigher) {
    let hikeStart = runStart - 1
    while (hikeStart > 0 && within(h[hikeStart - 1].price, prevHigher.price)) hikeStart--
    const hikeHours = (h[runStart].t - h[hikeStart].t) / 3_600_000
    const preHike = hikeStart > 0 ? h[hikeStart - 1] : undefined
    if (preHike && hikeHours < E.inflatedRunMaxHours && preHike.price < prevHigher.price && !within(preHike.price, prevHigher.price)) {
      inflatedBeforeDrop = { hikeStart: h[hikeStart].t, preHikePrice: preHike.price }
      const real = pct(preHike.price, current.price)
      if (real > E.samePriceBandPct) {
        observedDropPct = real
        prevHigher = preHike
      } else {
        observedDropPct = undefined
        prevHigher = undefined
      }
    }
  }

  let usual: number | undefined
  let usualWindowDays: number | undefined
  let usualDays: number | undefined
  if (sufficient) {
    usualWindowDays = spanDays >= E.longWindowFromDays ? 90 : 30
    const today = cairoDay(current.t)
    const from = current.t - usualWindowDays * DAY
    const src = days.filter((d) => d.t >= from && d.day !== today)
    if (src.length) {
      usual = median(src.map((d) => d.price))
      usualDays = src.length
    }
  }
  const belowUsualPct = usual !== undefined ? pct(usual, current.price) : undefined
  const belowUsual = belowUsualPct !== undefined && belowUsualPct > E.belowUsualPct
  const exceptional = (observedDropPct ?? 0) >= E.exceptionalPct || (belowUsual && (belowUsualPct ?? 0) >= E.exceptionalPct)
  const advertisedPct = listPrice && listPrice > current.price ? pct(listPrice, current.price) : undefined

  const labels: DealLabel[] = []
  if (exceptional) labels.push('exceptional')
  else {
    if (belowUsual) labels.push('below_usual')
    if (prevHigher) labels.push('observed_drop')
  }
  if (!sufficient) labels.push('insufficient')
  if (!labels.some((l) => l !== 'insufficient') && advertisedPct) labels.push('advertised_only')

  let best: Analysis['best']
  if (prevHigher && observedDropPct) best = { basis: 'observed', pct: observedDropPct, refPrice: prevHigher.price }
  if (belowUsual && usual && (!best || belowUsualPct! > best.pct)) best = { basis: 'below_usual', pct: belowUsualPct!, refPrice: usual }
  if (!best && advertisedPct && listPrice) best = { basis: 'advertised', pct: advertisedPct, refPrice: listPrice }

  return {
    current,
    count: h.length,
    spanDays,
    coveredDays,
    sufficient,
    lowest: h.reduce((a, b) => (b.price < a.price ? b : a)),
    detectedAt: h[runStart].t,
    prevHigher,
    observedDropPct,
    inflatedBeforeDrop,
    usual,
    usualWindowDays,
    usualDays,
    belowUsual,
    belowUsualPct,
    exceptional,
    advertisedPct,
    labels,
    listPrice: advertisedPct ? listPrice : undefined,
    best,
  }
}

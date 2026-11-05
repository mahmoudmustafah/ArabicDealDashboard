import { DAY, NOW, type Obs, type Product, type Scan } from './data'
import { L } from './i18n'

export const MIN_OBS = 10
export const MIN_SPAN_DAYS = 21
export const EXCEPTIONAL_PCT = 35

export type Analysis = {
  current: Obs
  count: number
  first: Obs
  spanDays: number
  sufficient: boolean
  lowest: Obs
  /** Most recent higher reading before the current price run started. */
  prevHigher?: Obs
  /** First time the current price was observed. */
  detectedAt: number
  observedDropPct?: number
  median?: number
  medianWindowDays?: number
  medianCount?: number
  belowUsual: boolean
  belowUsualPct?: number
  exceptional: boolean
  advertisedPct?: number
  recentChange?: { from: Obs; to: Obs; delta: number }
}

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function analyze(p: Product): Analysis {
  const h = p.history
  const current = h[h.length - 1]
  const first = h[0]
  const spanDays = (current.t - first.t) / DAY
  const count = h.length
  const sufficient = count >= MIN_OBS && spanDays >= MIN_SPAN_DAYS

  let runStart = h.length - 1
  // readings within ±2% of the current price count as the same price run (ignores tiny jitter)
  const same = (x: number) => Math.abs(x - current.price) / current.price <= 0.02
  while (runStart > 0 && same(h[runStart - 1].price)) runStart--
  const before = h.slice(0, runStart)
  const justBefore = before[before.length - 1]
  const prevHigher = justBefore && justBefore.price > current.price ? justBefore : undefined
  const observedDropPct = prevHigher ? ((prevHigher.price - current.price) / prevHigher.price) * 100 : undefined

  let med: number | undefined
  let medianWindowDays: number | undefined
  let medianCount: number | undefined
  if (sufficient) {
    medianWindowDays = spanDays >= 85 ? 90 : 30
    const src = h.slice(0, -1).filter((o) => o.t >= current.t - medianWindowDays! * DAY)
    med = median(src.map((o) => o.price))
    medianCount = src.length
  }
  const belowUsual = med !== undefined && current.price < med * 0.97
  const belowUsualPct = med !== undefined ? ((med - current.price) / med) * 100 : undefined
  const exceptional = (observedDropPct ?? 0) >= EXCEPTIONAL_PCT || (belowUsualPct ?? 0) >= EXCEPTIONAL_PCT

  const lowest = h.reduce((a, b) => (b.price < a.price ? b : a), h[0])
  const advertisedPct =
    p.listPrice && p.listPrice > current.price ? ((p.listPrice - current.price) / p.listPrice) * 100 : undefined

  let recentChange: Analysis['recentChange']
  if (runStart > 0) {
    const from = h[runStart - 1]
    const to = h[runStart]
    recentChange = { from, to, delta: to.price - from.price }
  }

  return {
    current,
    count,
    first,
    spanDays,
    sufficient,
    lowest,
    prevHigher,
    detectedAt: h[runStart].t,
    observedDropPct,
    median: med,
    medianWindowDays,
    medianCount,
    belowUsual,
    belowUsualPct,
    exceptional,
    advertisedPct,
    recentChange,
  }
}

export type DealStatus = 'exceptional' | 'below_usual' | 'observed_drop' | 'insufficient' | 'advertised_only'

export const statusLabel = (s: DealStatus) =>
  ({
    exceptional: L('نزول استثنائي — قيد التحقق', 'Exceptional drop — verifying'),
    below_usual: L('أقل من المعتاد', 'Below usual'),
    observed_drop: L('نزول مرصود', 'Observed drop'),
    insufficient: L('بيانات غير كافية', 'Not enough data'),
    advertised_only: L('خصم معلن فقط', 'Advertised discount only'),
  })[s]

/** All evidence labels that apply, strongest first. */
export function statuses(a: Analysis): DealStatus[] {
  const out: DealStatus[] = []
  if (a.exceptional) out.push('exceptional')
  else {
    if (a.belowUsual) out.push('below_usual')
    if (a.prevHigher) out.push('observed_drop')
  }
  if (!a.sufficient) out.push('insufficient')
  if (!out.length && a.advertisedPct) out.push('advertised_only')
  return out
}

export type Enriched = Product & { a: Analysis; checkedAt: number; stale: boolean; skippedLastScan: boolean }

export function lastSuccess(scans: Scan[]) {
  return scans.find((s) => s.status === 'success')
}

export function enrich(products: Product[], scans: Scan[]): Enriched[] {
  const latestDone = scans.find((s) => s.status !== 'running')!
  const ok = lastSuccess(scans)!
  return products.map((p, i) => {
    const a = analyze(p)
    let checkedAt = ok.at
    let skippedLastScan = false
    if (latestDone.status === 'partial') {
      if (i % 3 === 0) {
        checkedAt = ok.at
        skippedLastScan = true
      } else checkedAt = latestDone.at
    }
    if (p.staleAt) checkedAt = p.staleAt
    checkedAt = Math.max(checkedAt, a.current.t)
    return {
      ...p,
      name: L(p.name, p.nameEn),
      fullName: L(p.fullName, p.fullNameEn),
      a,
      checkedAt,
      stale: NOW - checkedAt > DAY,
      skippedLastScan,
    }
  })
}

export const amazonUrl = (p: Product) =>
  `https://www.amazon.eg/s?k=${encodeURIComponent(p.fullNameEn.split(',')[0])}&language=${L('ar_AE', 'en_AE')}`

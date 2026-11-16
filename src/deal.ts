import type { DealLabel, Obs, ProductView, ScanRun, SourceId } from './api'
import { L } from './i18n'

/** Same thresholds as server/src/config.ts, shown in the evidence text. */
export const MIN_OBS = 10
export const MIN_SPAN_DAYS = 21
export const EXCEPTIONAL_PCT = 35

export type Analysis = {
  current: Obs
  count: number
  spanDays: number
  sufficient: boolean
  lowest?: Obs
  prevHigher?: Obs
  detectedAt: number
  observedDropPct?: number
  median?: number
  medianWindowDays?: number
  belowUsual: boolean
  belowUsualPct?: number
  exceptional: boolean
  inflatedBeforeDrop: boolean
  advertisedPct?: number
  bestPct: number
  labels: DealLabel[]
}

export type DealStatus = DealLabel

export const statusLabel = (s: DealStatus) =>
  ({
    exceptional: L('نزول استثنائي — قيد التحقق', 'Exceptional drop — verifying'),
    below_usual: L('أقل من المعتاد', 'Below usual'),
    observed_drop: L('نزول مرصود', 'Observed drop'),
    insufficient: L('بيانات غير كافية', 'Not enough data'),
    advertised_only: L('خصم معلن فقط', 'Advertised discount only'),
  })[s]

/** All evidence labels that apply, strongest first (the server already orders them). */
export const statuses = (a: Analysis): DealStatus[] => a.labels

export type Item<V extends ProductView = ProductView> = V & { a: Analysis; checked: number }

export function toItem<V extends ProductView>(v: V): Item<V> {
  const e = v.evidence
  const checked = v.checkedAt ?? v.discoveredAt
  return {
    ...v,
    checked,
    a: {
      current: { t: checked, price: v.price ?? 0 },
      count: e?.readings ?? 0,
      spanDays: e?.spanDays ?? 0,
      sufficient: e?.sufficient ?? false,
      lowest: e?.lowest,
      prevHigher: e?.prevHigher,
      detectedAt: e?.detectedAt ?? checked,
      observedDropPct: e?.observedDropPct,
      median: e?.usual,
      medianWindowDays: e?.usualWindowDays,
      belowUsual: e?.belowUsualPct !== undefined,
      belowUsualPct: e?.belowUsualPct,
      exceptional: !!e?.labels.includes('exceptional'),
      inflatedBeforeDrop: !!e?.inflatedBeforeDrop,
      advertisedPct: e?.advertisedPct,
      bestPct: e?.best?.pct ?? 0,
      labels: e?.labels ?? [],
    },
  }
}

export const stores: { id: SourceId; label: string; short: () => string; view: () => string }[] = [
  { id: 'amazon', label: 'Amazon Egypt', short: () => L('أمازون', 'Amazon'), view: () => L('عرض على أمازون', 'View on Amazon') },
  { id: 'noon', label: 'Noon Egypt', short: () => L('نون', 'Noon'), view: () => L('عرض على نون', 'View on Noon') },
  { id: 'emarati', label: 'Emarati Scents', short: () => L('إماراتي سنتس', 'Emarati'), view: () => L('عرض على إماراتي سنتس', 'View on Emarati Scents') },
]
export const store = (id: SourceId) => stores.find((s) => s.id === id)!

export const lastSuccess = (scans: ScanRun[]) => scans.find((s) => s.status === 'success')

/** The newest finished run of each job. */
export function latestPerJob(scans: ScanRun[]) {
  const seen = new Map<string, ScanRun>()
  for (const s of scans) if (s.status !== 'running' && !seen.has(s.job_id)) seen.set(s.job_id, s)
  return [...seen.values()]
}

/** Plain-language reason for a failed or partial run, from the error text the server records. */
export function runError(error: string | null) {
  if (!error) return ''
  if (/blocked/.test(error)) return L('المتجر حدّ من الطلبات أو طلب تحقق — هنحاول تاني الجولة الجاية', 'The store rate-limited or challenged the request — retrying next round')
  if (/layout_changed/.test(error)) return L('صفحة النتايج مفيهاش منتجات أو شكلها اتغير', 'The results page had no products or its layout changed')
  if (/network|timeout/.test(error)) return L('تعذّر الاتصال بالمتجر', 'Could not reach the store')
  if (/time limit/.test(error)) return L('الجولة وصلت للحد الأقصى للوقت', 'The round hit its time limit')
  if (/Interrupted/.test(error)) return L('الخدمة اتعاد تشغيلها أثناء الجولة', 'The service restarted during the round')
  return error
}

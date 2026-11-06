import { useCallback, useEffect, useRef, useState } from 'react'

/** Client for the Deal Radar API (server/). All timestamps are UTC milliseconds. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export type SourceId = 'amazon' | 'noon' | 'emarati'
export type DealLabel = 'exceptional' | 'below_usual' | 'observed_drop' | 'insufficient' | 'advertised_only'
export type Basis = 'observed' | 'below_usual' | 'advertised'
export type Obs = { t: number; price: number }
export type Promo = { kind: 'coupon' | 'member' | 'bogo' | 'multibuy' | 'min_order' | 'other'; text: string }

export type Evidence = {
  labels: DealLabel[]
  best?: { basis: Basis; pct: number; refPrice?: number }
  observedDropPct?: number
  belowUsualPct?: number
  advertisedPct?: number
  usual?: number
  usualWindowDays?: number
  lowest: Obs
  prevHigher?: Obs
  inflatedBeforeDrop?: boolean
  detectedAt: number
  readings: number
  spanDays: number
  coveredDays: number
  sufficient: boolean
}

export type ProductView = {
  id: number
  source: SourceId
  category: string
  name: string
  brand: string | null
  image: string | null
  url: string
  variant: string | null
  seller: string | null
  available: boolean | null
  promos: Promo[]
  listPrice: number | null
  price: number | null
  checkedAt: number | null
  stale: boolean
  notRefreshed: boolean
  lastFailure: string | null
  discoveredAt: number
  evidence?: Evidence
}

export type Attempt = { at: number; ok: boolean; error?: string; recheck?: boolean; dryRun?: boolean }
export type Delivery = {
  channel: 'priority' | 'general'
  state: 'scheduled' | 'retrying' | 'sent' | 'failed' | 'cancelled'
  scheduledAt: number
  nextAttemptAt: number | null
  sentAt: number | null
  messageId: number | null
  dryRun: boolean
  cancelReason: string | null
  postedPrice: number | null
  attempts: Attempt[]
}
export type OfferView = {
  id: number
  productId: number
  name?: string
  source?: SourceId
  image?: string
  detectedAt: number
  price: number
  refPrice: number | null
  basis: Basis
  pct: number
  labels: DealLabel[]
  priority: boolean
  decision: string
  reason: string
  status: string
  verifiedAt: number | null
  deliveries: Delivery[]
}

export type ProductDetail = ProductView & {
  watched: boolean
  daily: { day: string; price: number; t: number }[]
  recent: Obs[]
  failures: { t: number; reason: string }[]
  offers: OfferView[]
}
export type WatchItem = ProductView & {
  addedAt: number
  latestChange?: { from: number; to: number; at: number }
  last30: { day: string; price: number; t: number }[]
}
export type ScanRun = {
  id: number
  job_id: string
  source: SourceId
  category: string
  due_at: number
  started_at: number
  finished_at: number | null
  status: 'running' | 'success' | 'partial' | 'failed'
  pages_planned: number
  pages_ok: number
  products_read: number
  products_new: number
  revisit_attempted: number
  revisit_ok: number
  offers_found: number
  error: string | null
}
export type JobView = {
  id: string
  source: SourceId
  category: string
  state: 'idle' | 'queued' | 'running'
  dueAt: number | null
  nextDueAt: number | null
  overdue: boolean
  overlaps: number
  runs: ScanRun[]
}
export type Meta = {
  sources: { id: SourceId; name: string; ar: string; enabled: boolean }[]
  categories: { id: string; ar: string; en: string }[]
  tracked: number
  telegram: { priority: boolean; general: boolean }
}
export type OffersResponse = { total: number; offers: ProductView[] }

async function req<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<T> {
  const res = await fetch(API_URL + path, { method, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export const api = {
  meta: () => req<Meta>('/api/meta'),
  /** The feed filters and sorts on the client, so it asks for every current offer. */
  offers: () => req<OffersResponse>('/api/offers?limit=100000'),
  product: (id: number) => req<ProductDetail>(`/api/products/${id}`),
  watchlist: () => req<WatchItem[]>('/api/watchlist'),
  watch: (id: number) => req<{ ok: true }>(`/api/watchlist/${id}`, 'POST'),
  unwatch: (id: number) => req<{ ok: true }>(`/api/watchlist/${id}`, 'DELETE'),
  jobs: () => req<JobView[]>('/api/jobs'),
  scans: (limit = 100) => req<ScanRun[]>(`/api/scans?limit=${limit}`),
  stale: () => req<ProductView[]>('/api/stale'),
  posts: (limit = 200) => req<OfferView[]>(`/api/posts?limit=${limit}`),
}

export type Loaded<T> = { data?: T; error?: Error; loading: boolean; reload: () => void }

/** Loads on mount and polls. A failed poll keeps the last real data and sets `error`. */
export function useApi<T>(load: () => Promise<T>, intervalMs: number, key: unknown = null): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)
  const reload = useCallback(() => {
    const mine = ++seq.current
    loadRef.current().then(
      (data) => mine === seq.current && setState({ data, loading: false }),
      (error: Error) => mine === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
    )
  }, [])
  useEffect(() => {
    setState({ loading: true })
    reload()
    const id = setInterval(reload, intervalMs)
    return () => {
      clearInterval(id)
      seq.current++
    }
  }, [key, intervalMs, reload])
  return { ...state, reload }
}

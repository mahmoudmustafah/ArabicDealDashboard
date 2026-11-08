import { Info, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Meta, ScanRun, SourceId } from './api'
import { latestPerJob, MIN_OBS, MIN_SPAN_DAYS, statuses, stores, type Item } from './deal'
import { DAY, HOUR } from './format'
import { isAr, L, tx, type T as Tx } from './i18n'
import { OfferCard } from './OfferCard'
import { cx } from './ui'

const PAGE = 60

type Sort = 'newest' | 'drop' | 'price'
const priceRanges = {
  all: { label: { ar: 'كل الأسعار', en: 'Any price' }, min: 0, max: Infinity },
  u2: { label: { ar: 'أقل من 2,000 ج.م', en: 'Under EGP 2,000' }, min: 0, max: 2000 },
  '2-6': { label: { ar: '2,000 – 6,000 ج.م', en: 'EGP 2,000 – 6,000' }, min: 2000, max: 6000 },
  '6-12': { label: { ar: '6,000 – 12,000 ج.م', en: 'EGP 6,000 – 12,000' }, min: 6000, max: 12000 },
  o12: { label: { ar: 'أكتر من 12,000 ج.م', en: 'Over EGP 12,000' }, min: 12000, max: Infinity },
}
const priceOptions = Object.fromEntries(Object.entries(priceRanges).map(([k, v]) => [k, v.label])) as Record<
  keyof typeof priceRanges,
  Tx
>
const dealFilters = {
  all: { ar: 'كل الحالات', en: 'All' },
  observed: { ar: 'نزول مرصود', en: 'Observed drop' },
  below_usual: { ar: 'أقل من المعتاد', en: 'Below usual' },
  exceptional: { ar: 'نزول استثنائي — قيد التحقق', en: 'Exceptional drop — verifying' },
  insufficient: { ar: 'بيانات غير كافية', en: 'Not enough data' },
  advertised_only: { ar: 'خصم معلن فقط', en: 'Advertised discount only' },
}
const timeFilters = {
  all: { ar: 'أي وقت', en: 'Any time' },
  '1h': { ar: 'آخر 3 ساعات', en: 'Last 3 hours' },
  '24h': { ar: 'آخر 24 ساعة', en: 'Last 24 hours' },
  '7d': { ar: 'آخر 7 أيام', en: 'Last 7 days' },
}
const timeMs = { all: Infinity, '1h': HOUR * 3, '24h': DAY, '7d': 7 * DAY }

type Props = {
  items: Item[]
  scans: ScanRun[]
  info?: Meta
  saved: Set<number>
  toggleSave: (id: number) => void
  openId: number | null
  open: (id: number) => void
  goScans: () => void
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: Record<T, Tx>
  label: string
}) {
  return (
    <label className="relative flex min-w-0 flex-col">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cx(
          'h-10 w-full cursor-pointer appearance-none rounded-lg border bg-white ps-3 pe-8 text-[13px] font-medium outline-none focus:border-ink',
          value !== 'all' ? 'border-ink' : 'border-line',
        )}
      >
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {k === 'all' ? `${label}: ${tx(options[k])}` : tx(options[k])}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-3 size-4 text-mute" />
    </label>
  )
}

export function Feed({ items, scans, info, saved, toggleSave, openId, open, goScans }: Props) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [src, setSrc] = useState<'all' | SourceId>('all')
  const [pr, setPr] = useState<keyof typeof priceRanges>('all')
  const [deal, setDeal] = useState<keyof typeof dealFilters>('all')
  const [tf, setTf] = useState<keyof typeof timeFilters>('all')
  const [sort, setSort] = useState<Sort>('drop')
  const [showFilters, setShowFilters] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const issues = latestPerJob(scans).filter((s) => s.status !== 'success')
  const staleCount = items.filter((i) => i.stale).length

  const stats = useMemo(
    () => ({
      offers: items.length,
      observed: items.filter((i) => i.a.prevHigher).length,
      sufficient: items.filter((i) => i.a.sufficient).length,
      // The product we have followed longest, counted in days, and how many have a useful number of readings.
      historyDay: Math.min(MIN_SPAN_DAYS, Math.ceil(items.reduce((most, i) => Math.max(most, i.a.spanDays), 0))),
      withReadings: items.filter((i) => i.a.count >= MIN_OBS).length,
      pending: items.filter((i) => i.a.exceptional).length,
    }),
    [items],
  )

  const list = useMemo(() => {
    const r = priceRanges[pr]
    const now = Date.now()
    const text = q.trim().toLowerCase()
    const out = items.filter((i) => {
      if (cat !== 'all' && i.category !== cat) return false
      if (src !== 'all' && i.source !== src) return false
      if (text && !`${i.name} ${i.brand ?? ''}`.toLowerCase().includes(text)) return false
      if (i.a.current.price < r.min || i.a.current.price >= r.max) return false
      if (now - i.a.detectedAt > timeMs[tf]) return false
      const st = statuses(i.a)
      if (deal === 'observed' && !(st.includes('observed_drop') || st.includes('below_usual'))) return false
      if (deal !== 'all' && deal !== 'observed' && !st.includes(deal)) return false
      return true
    })
    const dropOf = (i: Item) => Math.max(i.a.observedDropPct ?? 0, i.a.belowUsual ? (i.a.belowUsualPct ?? 0) : 0)
    out.sort((x, y) =>
      sort === 'newest'
        ? y.a.detectedAt - x.a.detectedAt
        : sort === 'price'
          ? x.a.current.price - y.a.current.price
          : dropOf(y) - dropOf(x) || y.a.bestPct - x.a.bestPct,
    )
    return out
  }, [items, cat, src, q, pr, deal, tf, sort])

  useEffect(() => setLimit(PAGE), [cat, src, q, pr, deal, tf, sort])

  const activeFilters = [pr !== 'all', deal !== 'all', tf !== 'all', src !== 'all'].filter(Boolean).length
  const reset = () => {
    setQ('')
    setCat('all')
    setSrc('all')
    setPr('all')
    setDeal('all')
    setTf('all')
  }
  const catLabel = (id: string) => {
    const c = info?.categories.find((x) => x.id === id)
    return c ? (isAr() ? c.ar : c.en) : id
  }
  const chips = (info?.categories ?? [])
    .map((c) => ({ id: c.id, label: isAr() ? c.ar : c.en, n: items.filter((i) => i.category === c.id).length }))
    .filter((c) => c.n > 0)
  const storeOptions = { all: { ar: 'كل المتاجر', en: 'All stores' }, ...Object.fromEntries(stores.map((s) => [s.id, { ar: s.label, en: s.label }])) } as Record<'all' | SourceId, Tx>

  return (
    <div className="flex flex-col gap-5">
      {issues.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-[13.5px] leading-6">
          <Info className="mt-0.5 size-5 shrink-0 text-body" />
          <div className="flex-1">
            <b className="num">{issues.length}</b>{' '}
            {L('من عمليات البحث آخر جولة ليها ما كملتش. المنتجات اللي ما اتقرتش ظاهرة بآخر سعر ناجح، وكل سعر عليه وقت فحصه.', 'search jobs did not finish their last round. Products not read keep their last successful price, and each price shows when it was checked.')}
          </div>
          <button onClick={goScans} className="shrink-0 text-[13px] font-semibold underline underline-offset-4">
            {L('سجل الفحص', 'Scan history')}
          </button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Stat label={L('عروض لقيناها', 'Offers found')} value={stats.offers} hint={L('فيها خصم معلن أو نزول مرصود', 'Advertised discount or observed drop')} />
        <Stat label={L('نزول مرصود', 'Observed drops')} value={stats.observed} hint={L('اترصد قبل كده بسعر أعلى', 'Seen before at a higher price')} tone="drop" />
        {stats.sufficient > 0 ? (
          <Stat
            label={L('ليها سجل سعر كافي', 'Enough price history')}
            value={stats.sufficient}
            total={items.length}
            hint={L('10 قراءات على الأقل في 21 يوم', 'At least 10 readings over 21 days')}
          />
        ) : (
          <HistoryProgress day={stats.historyDay} products={items.length} withReadings={stats.withReadings} />
        )}
        <Stat label={L('قيد التحقق', 'Verifying')} value={stats.pending} hint={L('نزول كبير مستني فحص تاني', 'Large drop awaiting a second check')} tone="pending" />
      </section>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:px-0">
        {[{ id: 'all', label: L('الكل', 'All'), n: items.length }, ...chips].map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={cx(
              'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition',
              cat === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-line-strong',
            )}
          >
            {c.label}
            <span className={cx('num text-[11.5px]', cat === c.id ? 'text-white/60' : 'text-mute')}>{c.n}</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-3">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{L('بحث', 'Search')}</span>
            <Search className="pointer-events-none absolute start-3 top-3 size-4 text-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L('دوّر على منتج… مثلًا: سامسونج، عطر', 'Search products… e.g. Samsung, perfume')}
              className="h-10 w-full rounded-lg border border-line bg-canvas/60 ps-9 pe-3 text-[13.5px] outline-none placeholder:text-mute focus:border-ink focus:bg-white"
            />
          </label>
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="relative inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold lg:hidden"
          >
            <SlidersHorizontal className="size-4" />
            {L('فلاتر', 'Filters')}
            {activeFilters > 0 && (
              <span className="num grid size-5 place-items-center rounded-full bg-ink text-[11px] text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
        <div className={cx('gap-2 @xl:grid-cols-4 @5xl:grid-cols-[1fr_1fr_1.3fr_1fr_auto]', showFilters ? 'grid' : 'hidden lg:grid')}>
          <Select label={L('المتجر', 'Store')} value={src} onChange={setSrc} options={storeOptions} />
          <Select label={L('السعر', 'Price')} value={pr} onChange={setPr} options={priceOptions} />
          <Select label={L('حالة العرض', 'Deal status')} value={deal} onChange={setDeal} options={dealFilters} />
          <Select label={L('وقت الرصد', 'Detected')} value={tf} onChange={setTf} options={timeFilters} />
          <div className="flex rounded-lg border border-line bg-canvas/60 p-0.5 @xl:col-span-4 @5xl:col-span-1" role="radiogroup" aria-label={L('الترتيب', 'Sort')}>
            {(
              [
                ['drop', L('أكبر نزول مرصود', 'Biggest observed drop')],
                ['newest', L('الأحدث', 'Newest')],
                ['price', L('أقل سعر', 'Lowest price')],
              ] as [Sort, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="radio"
                aria-checked={sort === k}
                onClick={() => setSort(k)}
                className={cx(
                  'h-[34px] flex-1 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap transition',
                  sort === k ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-body hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-2 text-[13px] text-body">
        <div>
          <span className="num font-bold text-ink">{list.length}</span> {L('عرض', 'offers')}
          {staleCount > 0 && (
            <span className="ms-1 text-mute">
              · <span className="num">{staleCount}</span> {L('سعره قديم (أكتر من 24 ساعة)', 'with stale price (over 24 hours)')}
            </span>
          )}
        </div>
      </div>

      {list.length ? (
        <section className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
          {list.slice(0, limit).map((p) => (
            <OfferCard
              key={p.id}
              p={p}
              category={catLabel(p.category)}
              active={openId === p.id}
              saved={saved.has(p.id)}
              onToggleSave={() => toggleSave(p.id)}
              onOpen={() => open(p.id)}
            />
          ))}
          {list.length > limit && (
            <button
              onClick={() => setLimit((n) => n + PAGE)}
              className="col-span-full h-11 rounded-xl border border-line bg-white text-[13.5px] font-semibold hover:bg-canvas"
            >
              {L('اعرض كمان', 'Show more')} <span className="num text-mute">({list.length - limit})</span>
            </button>
          )}
        </section>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white py-16 text-center">
          <Search className="size-6 text-mute" />
          <div className="font-semibold">
            {items.length ? L('مفيش عروض بالفلاتر دي', 'No offers match these filters') : L('لسه مفيش عروض — أول جولات الفحص لسه بتشتغل', 'No offers yet — the first scans are still running')}
          </div>
          <button onClick={reset} className="inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-4">
            <X className="size-3.5" /> {L('امسح الفلاتر', 'Clear filters')}
          </button>
        </div>
      )}
    </div>
  )
}

function HistoryProgress({ day, products, withReadings }: { day: number; products: number; withReadings: number }) {
  const n = (x: number) => x.toLocaleString('en-US')
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="text-[12.5px] font-semibold text-body">{L('سجل الأسعار', 'Price history')}</div>
      <div className="num mt-1 text-[30px] leading-9 font-bold tracking-tight">
        {L(`يوم ${day}`, `Day ${day}`)}
        <span className="text-[16px] font-medium text-mute"> {L(`من ${MIN_SPAN_DAYS}`, `of ${MIN_SPAN_DAYS}`)}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={day}
        aria-valuemin={0}
        aria-valuemax={MIN_SPAN_DAYS}
        aria-label={L('أيام سجل الأسعار', 'Days of price history')}
      >
        <div className="h-full rounded-full bg-drop" style={{ width: `${(day / MIN_SPAN_DAYS) * 100}%` }} />
      </div>
      <div className="num mt-1.5 text-[11.5px] leading-4 text-mute">
        {L(`${n(products)} منتج بنتابعهم · ${n(withReadings)} ليهم ${MIN_OBS} قراءات أو أكتر`, `${n(products)} products tracked · ${n(withReadings)} with ${MIN_OBS}+ readings`)}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  total,
  hint,
  tone,
}: {
  label: string
  value: number
  total?: number
  hint: string
  tone?: 'drop' | 'pending'
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
        {tone && <span className={cx('size-2 rounded-full', tone === 'drop' ? 'bg-drop' : 'bg-pending')} />}
        {label}
      </div>
      <div className="num mt-1 text-[30px] leading-9 font-bold tracking-tight">
        {value}
        {total !== undefined && <span className="text-[16px] font-medium text-mute"> / {total}</span>}
      </div>
      <div className="mt-0.5 text-[11.5px] leading-4 text-mute">{hint}</div>
    </div>
  )
}

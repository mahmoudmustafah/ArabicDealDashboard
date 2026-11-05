import { AlertOctagon, ChevronDown, Info, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { categories, DAY, HOUR, NOW, TRACKED_TOTAL, type CategoryId, type Scan } from './data'
import { lastSuccess, statuses, type Enriched } from './deal'
import { ago, time } from './format'
import { L, tx, type T as Tx } from './i18n'
import { OfferCard } from './OfferCard'
import { cx, SampleTag } from './ui'

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
  items: Enriched[]
  scans: Scan[]
  saved: Set<string>
  toggleSave: (id: string) => void
  openId: string | null
  open: (id: string) => void
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

export function Feed({ items, scans, saved, toggleSave, openId, open, goScans }: Props) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | CategoryId>('all')
  const [pr, setPr] = useState<keyof typeof priceRanges>('all')
  const [deal, setDeal] = useState<keyof typeof dealFilters>('all')
  const [tf, setTf] = useState<keyof typeof timeFilters>('all')
  const [sort, setSort] = useState<Sort>('drop')
  const [showFilters, setShowFilters] = useState(false)

  const ok = lastSuccess(scans)!
  const latest = scans.find((s) => s.status !== 'running')!
  const running = scans.find((s) => s.status === 'running')
  const staleCount = items.filter((i) => i.stale).length

  const stats = useMemo(
    () => ({
      offers: items.filter((i) => i.a.advertisedPct || i.a.prevHigher).length,
      observed: items.filter((i) => i.a.prevHigher).length,
      sufficient: items.filter((i) => i.a.sufficient).length,
      pending: items.filter((i) => i.a.exceptional).length,
    }),
    [items],
  )

  const list = useMemo(() => {
    const r = priceRanges[pr]
    const out = items.filter((i) => {
      if (cat !== 'all' && i.category !== cat) return false
      if (q && !(i.name + i.fullName).toLowerCase().includes(q.trim().toLowerCase())) return false
      if (i.a.current.price < r.min || i.a.current.price >= r.max) return false
      if (NOW - i.a.detectedAt > timeMs[tf]) return false
      const st = statuses(i.a)
      if (deal === 'observed' && !(st.includes('observed_drop') || st.includes('below_usual'))) return false
      if (deal !== 'all' && deal !== 'observed' && !st.includes(deal)) return false
      return true
    })
    const dropOf = (i: Enriched) => Math.max(i.a.observedDropPct ?? 0, i.a.belowUsual ? (i.a.belowUsualPct ?? 0) : 0)
    out.sort((x, y) =>
      sort === 'newest'
        ? y.a.detectedAt - x.a.detectedAt
        : sort === 'price'
          ? x.a.current.price - y.a.current.price
          : dropOf(y) - dropOf(x),
    )
    return out
  }, [items, cat, q, pr, deal, tf, sort])

  const activeFilters = [pr !== 'all', deal !== 'all', tf !== 'all'].filter(Boolean).length
  const reset = () => {
    setQ('')
    setCat('all')
    setPr('all')
    setDeal('all')
    setTf('all')
  }

  return (
    <div className="flex flex-col gap-5">
      {latest.status === 'failed' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-fail/25 bg-fail-soft p-4 sm:flex-row sm:items-center">
          <AlertOctagon className="size-5 shrink-0 text-fail" />
          <div className="flex-1 text-[13.5px] leading-6">
            <div className="font-bold text-fail">{L('فشل آخر فحص — الساعة', 'Last scan failed at')} {time(latest.at)}</div>
            <div className="text-body">
              {L('الأسعار الظاهرة من آخر فحص ناجح الساعة', 'Prices shown are from the last successful scan at')}{' '}
              <b className="text-ink">{time(ok.at)}</b> ({ago(ok.at)}).{' '}
              {L('وقت الفحص مكتوب على كل منتج.', 'Each product shows when it was checked.')}
            </div>
          </div>
          <button
            onClick={goScans}
            className="h-9 rounded-lg border border-fail/30 bg-white px-3 text-[13px] font-semibold text-fail"
          >
            {L('تفاصيل الفحص', 'Scan details')}
          </button>
        </div>
      )}
      {latest.status === 'partial' && !running && (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-[13.5px] leading-6">
          <Info className="mt-0.5 size-5 shrink-0 text-body" />
          <div className="flex-1">
            <b>{L('نتايج جزئية:', 'Partial results:')}</b> {L('آخر فحص', 'the last scan')} ({time(latest.at)}){' '}
            {L('قرا', 'read')} <span className="num font-semibold">{latest.read}</span> {L('من', 'of')}{' '}
            <span className="num">{TRACKED_TOTAL}</span> {L('منتج.', 'products.')}{' '}
            {L('المنتجات اللي ما اتقرتش ظاهرة بآخر سعر ناجح من', 'Products not read show their last successful price from')}{' '}
            {time(ok.at)}.
          </div>
          <button onClick={goScans} className="shrink-0 text-[13px] font-semibold underline underline-offset-4">
            {L('سجل الفحص', 'Scan history')}
          </button>
        </div>
      )}
      {running && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 text-[13.5px]">
          <Loader2 className="size-5 shrink-0 animate-spin text-ink" />
          <div className="flex-1">
            <div className="font-semibold">
              {L('جاري فحص أمازون مصر…', 'Scanning Amazon Egypt…')} <span className="num">{running.read}</span> /{' '}
              <span className="num">{TRACKED_TOTAL}</span> {L('منتج', 'products')}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-ink" style={{ width: `${(running.read / TRACKED_TOTAL) * 100}%` }} />
            </div>
          </div>
          <span className="hidden text-[12px] text-mute sm:block">{L('الأسعار الحالية من فحص', 'Current prices from scan at')} {time(ok.at)}</span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Stat label={L('عروض لقيناها', 'Offers found')} value={stats.offers} hint={L('فيها خصم معلن أو نزول مرصود', 'Advertised discount or observed drop')} />
        <Stat label={L('نزول مرصود', 'Observed drops')} value={stats.observed} hint={L('اترصد قبل كده بسعر أعلى', 'Seen before at a higher price')} tone="drop" />
        <Stat
          label={L('ليها سجل سعر كافي', 'Enough price history')}
          value={stats.sufficient}
          total={items.length}
          hint={L('10 قراءات على الأقل في 21 يوم', 'At least 10 readings over 21 days')}
        />
        <Stat label={L('قيد التحقق', 'Verifying')} value={stats.pending} hint={L('نزول كبير مستني فحص تاني', 'Large drop awaiting a second check')} tone="pending" />
      </section>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:px-0">
        {[{ id: 'all' as const, label: { ar: 'الكل', en: 'All' } }, ...categories].map((c) => {
          const n = c.id === 'all' ? items.length : items.filter((i) => i.category === c.id).length
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cx(
                'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition',
                cat === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-line-strong',
              )}
            >
              {tx(c.label)}
              <span className={cx('num text-[11.5px]', cat === c.id ? 'text-white/60' : 'text-mute')}>{n}</span>
            </button>
          )
        })}
        {[L('موبايلات', 'Mobiles'), L('أجهزة منزلية', 'Home appliances')].map((l) => (
          <span
            key={l}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line px-3.5 text-[13px] text-mute"
          >
            {l} <span className="text-[11px]">· {L('قريبًا', 'Soon')}</span>
          </span>
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
              placeholder={L('دوّر على منتج… مثلًا: سامسونج، 27 بوصة', 'Search products… e.g. Samsung, 27 inch')}
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
        <div className={cx('gap-2 @xl:grid-cols-3 @5xl:grid-cols-[1fr_1.3fr_1fr_auto]', showFilters ? 'grid' : 'hidden lg:grid')}>
          <Select label={L('السعر', 'Price')} value={pr} onChange={setPr} options={priceOptions} />
          <Select label={L('حالة العرض', 'Deal status')} value={deal} onChange={setDeal} options={dealFilters} />
          <Select label={L('وقت الرصد', 'Detected')} value={tf} onChange={setTf} options={timeFilters} />
          <div className="flex rounded-lg border border-line bg-canvas/60 p-0.5 @xl:col-span-3 @5xl:col-span-1" role="radiogroup" aria-label={L('الترتيب', 'Sort')}>
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
        <SampleTag />
      </div>

      {list.length ? (
        <section className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
          {list.map((p) => (
            <OfferCard
              key={p.id}
              p={p}
              active={openId === p.id}
              saved={saved.has(p.id)}
              onToggleSave={() => toggleSave(p.id)}
              onOpen={() => open(p.id)}
            />
          ))}
        </section>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white py-16 text-center">
          <Search className="size-6 text-mute" />
          <div className="font-semibold">{L('مفيش عروض بالفلاتر دي', 'No offers match these filters')}</div>
          <button onClick={reset} className="inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-4">
            <X className="size-3.5" /> {L('امسح الفلاتر', 'Clear filters')}
          </button>
        </div>
      )}
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

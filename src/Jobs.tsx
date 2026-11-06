import {
  AlertOctagon,
  CheckCircle2,
  CircleDashed,
  Flame,
  Gauge,
  Gift,
  Headphones,
  HardDrive,
  Keyboard,
  Loader2,
  Monitor,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  SprayCan,
  Timer,
  Tv,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { api, useApi, type JobView, type Meta, type ScanRun, type SourceId } from './api'
import { clock, Mm, mmss, useNow } from './clock'
import { runError, store, stores } from './deal'
import { isAr, L } from './i18n'
import { ApiDown, Loading, SourceChip, cx } from './ui'

const CYCLE = 10 * 60e3

const icons: Record<string, LucideIcon> = {
  mobiles: Smartphone,
  tvs: Tv,
  monitors: Monitor,
  electronics: Headphones,
  keyboards: Keyboard,
  storage: HardDrive,
  perfumes: SprayCan,
  cosmetics: Sparkles,
  'mens-fragrance': SprayCan,
  'womens-fragrance': Sparkles,
  'oud-bakhoor': Flame,
  'gift-sets': Gift,
  supermarket: ShoppingBasket,
}

type RunStatus = ScanRun['status']
const roundMeta = (): Record<RunStatus, { label: string; cls: string; bar: string; icon: LucideIcon }> => ({
  success: { label: L('خلصت', 'Done'), cls: 'bg-drop-soft text-drop', bar: 'bg-drop', icon: CheckCircle2 },
  partial: { label: L('جزئية', 'Partial'), cls: 'bg-adv-soft text-ink', bar: 'bg-mute', icon: CircleDashed },
  failed: { label: L('فشلت', 'Failed'), cls: 'bg-fail-soft text-fail', bar: 'bg-fail', icon: AlertOctagon },
  running: { label: L('جارية', 'Running'), cls: 'bg-ink text-white', bar: 'bg-ink', icon: Loader2 },
})

function RoundBadge({ s }: { s: RunStatus }) {
  const m = roundMeta()[s]
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold', m.cls)}>
      <m.icon className={cx('size-3.5', s === 'running' && 'animate-spin')} />
      {m.label}
    </span>
  )
}

type Filter = 'all' | 'running' | 'waiting' | 'issues'
const finished = (j: JobView) => j.runs.filter((r) => r.status !== 'running')
const lastRun = (j: JobView): ScanRun | undefined => finished(j)[0]
const hasIssue = (j: JobView) => {
  const r = lastRun(j)
  return j.overdue || (!!r && r.status !== 'success')
}

export function Jobs({ info }: { info?: Meta }) {
  const q = useApi(api.jobs, 15_000)
  const t = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [source, setSource] = useState<'all' | SourceId>('all')
  if (!q.data) return q.error ? <ApiDown onRetry={q.reload} /> : <Loading />

  const all = q.data
  const label = (id: string) => {
    const c = info?.categories.find((x) => x.id === id)
    return c ? (isAr() ? c.ar : c.en) : id
  }
  const states = all.filter((j) => source === 'all' || j.source === source)
  const running = states.filter((j) => j.state === 'running')
  const waiting = states.filter((j) => j.state !== 'running')
  const issues = states.filter(hasIssue)
  const soonest = [...waiting].filter((j) => j.nextDueAt).sort((a, b) => a.nextDueAt! - b.nextDueAt!)[0]
  const dealsLast = states.reduce((n, j) => n + (lastRun(j)?.offers_found ?? 0), 0)
  const shown = states.filter((j) => (filter === 'running' ? j.state === 'running' : filter === 'waiting' ? j.state !== 'running' : filter === 'issues' ? hasIssue(j) : true))
  const cyclePos = t % CYCLE
  const log = states
    .flatMap((j) => finished(j).slice(0, 4))
    .sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))
    .slice(0, 12)

  return (
    <div className="flex flex-col gap-5">
      {q.error && <ApiDown compact onRetry={q.reload} />}
      <div className="flex items-center gap-2 text-[13px] text-body">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-drop opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-drop" />
        </span>
        {L('مباشر · الساعة', 'Live ·')} <b className="num text-ink">{clock(t)}</b>
        <span className="hidden text-mute @xl:inline">
          · {L(`كل قسم بيتبحث فيه كل 10 دقائق في ${stores.length} متاجر`, `each category is searched every 10 minutes across ${stores.length} stores`)}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Kpi
          label={L('جاري البحث الآن', 'Searching now')}
          value={String(running.length)}
          sub={running.map((j) => `${label(j.category)} (${store(j.source).short()})`).join(L('، ', ', ')) || L('مفيش', 'None')}
          dot="bg-ink"
        />
        <Kpi label={L('مستنية الجولة الجاية', 'Waiting for next round')} value={String(waiting.length)} sub={L(`من ${states.length} عملية بحث`, `of ${states.length} search jobs`)} dot="bg-drop" />
        <Kpi label={L('أقرب جولة جاية', 'Next round')} value={soonest ? mmss(soonest.nextDueAt! - t) : '—'} sub={soonest ? `${label(soonest.category)} · ${store(soonest.source).label}` : ''} ltr />
        <Kpi label={L('عروض في آخر جولة', 'Deals in last round')} value={dealsLast.toLocaleString('en-US')} sub={L('مجموع كل الأقسام', 'Across all categories')} />
      </section>

      {/* 10-minute cycle timeline */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold">
            <Timer className="size-4" /> {L('دورة الـ 10 دقائق', 'The 10-minute cycle')}
          </h3>
          <span className="text-[12px] text-mute">
            {L('الخط الأسود = دلوقتي', 'Dark line = now')} (<Mm ms={cyclePos} /> {L('من الدورة', 'into the cycle')})
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
          {states.map((j) => {
            const Icon = icons[j.category] ?? SprayCan
            const last = lastRun(j)
            const a = ((j.nextDueAt ?? 0) % CYCLE) / CYCLE
            const w = Math.max(0.012, Math.min(1, last?.finished_at ? (last.finished_at - last.started_at) / CYCLE : 0.012))
            const segs = a + w > 1 ? [[a, 1 - a], [0, a + w - 1]] : [[a, w]]
            return (
              <div key={j.id} className="grid grid-cols-[150px_1fr] items-center gap-3 @xl:grid-cols-[190px_1fr]">
                <div className="flex items-center gap-2 truncate text-[12.5px] font-semibold">
                  <Icon className="size-4 shrink-0 text-body" />
                  <span className="truncate">{label(j.category)}</span>
                  <SourceChip id={j.source} />
                </div>
                <div className="relative h-6 rounded-md bg-canvas">
                  {segs.map(([st, wd], i) => (
                    <div key={i} className={cx('absolute inset-y-1 rounded', j.state === 'running' ? 'bg-ink' : 'bg-line-strong')} style={{ insetInlineStart: `${st * 100}%`, width: `${wd * 100}%` }} />
                  ))}
                  <div className="absolute inset-y-[-3px] w-0.5 rounded bg-ink" style={{ insetInlineStart: `${(cyclePos / CYCLE) * 100}%` }} />
                </div>
              </div>
            )
          })}
          <div className="grid grid-cols-[150px_1fr] gap-3 @xl:grid-cols-[190px_1fr]">
            <span />
            <div className="num flex justify-between text-[11px] text-mute">
              {[0, 2, 4, 6, 8, 10].map((m) => (
                <span key={m}>
                  {m} {L('د', 'm')}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-[11.5px] text-body">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-ink" /> {L('شغال دلوقتي', 'Running now')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-line-strong" /> {L('ميعاد البحث ومدة آخر جولة', 'Slot and last round’s duration')}
          </span>
        </div>
      </section>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-mute">{L('المتجر', 'Store')}</span>
        <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-lg border border-line bg-white p-0.5">
          {([['all', L('كل المتاجر', 'All stores')], ...stores.map((x) => [x.id, x.label])] as ['all' | SourceId, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSource(k)}
              aria-pressed={source === k}
              className={cx('h-8 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap', source === k ? 'bg-ink text-white' : 'text-body hover:text-ink')}
            >
              <bdi>{l}</bdi>
              <span className={cx('num ms-1.5 text-[11px]', source === k ? 'text-white/60' : 'text-mute')}>{k === 'all' ? all.length : all.filter((j) => j.source === k).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:px-0">
        {(
          [
            ['all', L('كل الأقسام', 'All categories'), states.length],
            ['running', L('جاري الآن', 'Running now'), running.length],
            ['waiting', L('مستنية', 'Waiting'), waiting.length],
            ['issues', L('فيها مشكلة', 'Has issues'), issues.length],
          ] as [Filter, string, number][]
        ).map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cx('flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold', filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white')}
          >
            {l}
            <span className={cx('num text-[11.5px]', filter === k ? 'text-white/60' : 'text-mute')}>{n}</span>
          </button>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
        {shown.map((j) => (
          <JobCard key={j.id} j={j} t={t} label={label(j.category)} />
        ))}
        {!shown.length && (
          <div className="col-span-full rounded-2xl border border-dashed border-line bg-white py-12 text-center text-[13px] text-body">{L('مفيش أقسام في الحالة دي دلوقتي', 'No categories in this state right now')}</div>
        )}
      </section>

      {/* recent rounds log */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3 text-[14px] font-bold">{L('آخر الجولات', 'Recent rounds')}</div>
        <table className="w-full text-[13px]">
          <thead className="bg-canvas/70 text-[12px] text-body">
            <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-semibold">
              <th>{L('خلصت', 'Finished')}</th>
              <th>{L('القسم', 'Category')}</th>
              <th>{L('الحالة', 'Status')}</th>
              <th className="hidden sm:table-cell">{L('الصفحات', 'Pages')}</th>
              <th>{L('العروض', 'Deals')}</th>
              <th className="hidden md:table-cell">{L('ملاحظات', 'Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.id} className="border-t border-line [&>td]:px-4 [&>td]:py-2.5">
                <td className="num whitespace-nowrap">{r.finished_at ? clock(r.finished_at) : '—'}</td>
                <td className="font-semibold">
                  {label(r.category)} <SourceChip id={r.source} />
                </td>
                <td>
                  <RoundBadge s={r.status} />
                </td>
                <td className="num hidden sm:table-cell">
                  {r.pages_ok} <span className="text-mute">/ {r.pages_planned}</span>
                </td>
                <td className="num font-semibold">{r.offers_found}</td>
                <td className="hidden text-[12.5px] text-body md:table-cell" title={r.error ?? undefined}>{runError(r.error)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function JobCard({ j, t, label }: { j: JobView; t: number; label: string }) {
  const Icon = icons[j.category] ?? SprayCan
  const current = j.state === 'running' ? j.runs.find((r) => r.status === 'running') : undefined
  const last = lastRun(j)
  const history = finished(j)
  const rate = history.length ? Math.round((history.filter((r) => r.status === 'success').length / history.length) * 100) : 0
  const next = j.nextDueAt ?? 0
  return (
    <article className={cx('flex flex-col rounded-2xl border bg-white p-4', j.state === 'running' ? 'border-ink' : 'border-line')}>
      <div className="flex items-center gap-3">
        <div className={cx('grid size-10 place-items-center rounded-xl', j.state === 'running' ? 'bg-ink text-white' : 'bg-canvas text-ink')}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold">{label}</h3>
          <div className="text-[11.5px] text-mute">
            <span dir="ltr">{store(j.source).label}</span> · {L('كل 10 دقائق', 'every 10 min')}
          </div>
        </div>
        {j.state === 'running' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-white">
            <Loader2 className="size-3.5 animate-spin" /> {L('جاري البحث', 'Searching')}
          </span>
        ) : j.overdue ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-fail-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-fail">
            <Timer className="size-3.5" /> {L('متأخرة', 'Overdue')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-body">
            <Timer className="size-3.5" /> {j.state === 'queued' ? L('في الطابور', 'Queued') : L('مستنية', 'Waiting')}
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-canvas/80 p-3.5">
        {current ? (
          <>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-body">
                {L('صفحات اتقرت', 'Pages read')} <b className="num text-ink">{current.pages_ok}</b>
              </span>
              <span className="text-mute">
                {L('بدأت من', 'started')} <Mm ms={t - current.started_at} /> {L('', 'ago')}
              </span>
            </div>
            <div className="mt-2 text-[11.5px] text-mute">
              <span className="num">{current.products_read}</span> {L('منتج لحد دلوقتي', 'products so far')} · {L('الجولة الجاية الساعة', 'next round at')} {clock(next)}
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] text-body">{L('الجولة الجاية تبدأ بعد', 'Next round starts in')}</div>
            <Mm ms={next - t} className="text-[28px] leading-9 font-bold tracking-tight" />
            <div className="mt-2 text-[11.5px] text-mute">
              {last?.finished_at ? (
                <>
                  {L('آخر جولة خلصت الساعة', 'Last round finished at')} {clock(last.finished_at)}
                </>
              ) : (
                L('لسه ما خلصتش أي جولة', 'No round finished yet')
              )}
            </div>
          </>
        )}
      </div>

      {last && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Mini label={L('آخر جولة', 'Last round')} value={<RoundBadge s={last.status} />} />
          <Mini label={L('منتجات اتقرت', 'Products read')} value={<span className="num font-bold">{last.products_read}</span>} />
          <Mini label={L('عروض لقيناها', 'Deals found')} value={<span className="num font-bold text-drop">{last.offers_found}</span>} />
        </div>
      )}

      {last && last.status !== 'success' && last.error && (
        <div className={cx('mt-3 rounded-lg px-3 py-2 text-[12px] leading-5', last.status === 'failed' ? 'bg-fail-soft text-fail' : 'bg-adv-soft text-body')} title={last.error}>
          {runError(last.error)}
        </div>
      )}
      {j.overlaps > 0 && (
        <div className="mt-2 text-[11.5px] text-mute">
          {L('جولات اتخطت لأن اللي قبلها كانت لسه شغالة:', 'Rounds skipped because the previous one was still running:')} <span className="num">{j.overlaps}</span>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between text-[11px] text-mute">
            <span>{L(`آخر ${history.length} جولات`, `Last ${history.length} rounds`)}</span>
            <span className="flex items-center gap-1">
              <Gauge className="size-3.5" />
              {rate}% {L('نجاح', 'success')}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {[...history].reverse().map((r) => (
              <div key={r.id} title={`${r.finished_at ? clock(r.finished_at) : ''} — ${roundMeta()[r.status].label} · ${r.offers_found} ${L('عرض', 'deals')}`} className={cx('h-2 flex-1 rounded-full', roundMeta()[r.status].bar)} />
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-line px-1 py-2">
      <span className="text-[11px] text-mute">{label}</span>
      <span className="text-[14px]">{value}</span>
    </div>
  )
}

function Kpi({ label, value, sub, dot, ltr }: { label: string; value: string; sub: string; dot?: string; ltr?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-body">
        {dot && <span className={cx('size-2 rounded-full', dot)} />}
        {label}
      </div>
      <div className="num mt-1 text-[30px] leading-9 font-bold tracking-tight">{ltr ? <bdi dir="ltr">{value}</bdi> : value}</div>
      <div className="mt-0.5 truncate text-[11.5px] leading-4 text-mute">{sub}</div>
    </div>
  )
}

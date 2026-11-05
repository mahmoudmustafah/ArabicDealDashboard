import {
  AlertOctagon,
  CheckCircle2,
  CircleDashed,
  Flame,
  Gauge,
  Gift,
  Headphones,
  Loader2,
  Monitor,
  Smartphone,
  Sparkles,
  SprayCan,
  Timer,
  Tv,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NOW } from './data'
import { clock, Mm, mmss, SpeedControl, useSimClock } from './sim'
import { SampleTag, cx } from './ui'
import { L, tx, type T as Tx } from './i18n'

// SAMPLE DATA — simulated search jobs. Each category runs a deal search every 10 minutes.
const MIN = 60e3
export const CYCLE = 10 * MIN
const EPOCH = NOW - 1000 * CYCLE

type SourceId = 'amazon' | 'noon' | 'emarati'
export const jobSources: { id: SourceId; label: string; short: Tx }[] = [
  { id: 'amazon', label: 'Amazon Egypt', short: { ar: 'أمازون', en: 'Amazon' } },
  { id: 'noon', label: 'Noon Egypt', short: { ar: 'نون', en: 'Noon' } },
  { id: 'emarati', label: 'Emarati Scents', short: { ar: 'إماراتي سنتس', en: 'Emarati' } },
]
const sourceLabel = (id: SourceId) => jobSources.find((x) => x.id === id)!.label

type Job = {
  id: string
  source: SourceId
  label: Tx
  icon: LucideIcon
  offsetMin: number
  durationMin: number
  pages: number
}

const amazonJobs: Omit<Job, 'source'>[] = [
  { id: 'tv', label: { ar: 'تلفزيونات', en: "TVs" }, icon: Tv, offsetMin: 0.5, durationMin: 5.5, pages: 24 },
  { id: 'mobile', label: { ar: 'موبايلات', en: "Mobiles" }, icon: Smartphone, offsetMin: 2, durationMin: 6.5, pages: 32 },
  { id: 'perfume', label: { ar: 'عطور', en: "Perfumes" }, icon: SprayCan, offsetMin: 6, durationMin: 2.5, pages: 14 },
  { id: 'cosmetics', label: { ar: 'مستحضرات تجميل', en: "Cosmetics" }, icon: Sparkles, offsetMin: 7.5, durationMin: 4, pages: 20 },
  { id: 'monitors', label: { ar: 'شاشات كمبيوتر', en: "Monitors" }, icon: Monitor, offsetMin: 0, durationMin: 4, pages: 16 },
  { id: 'electronics', label: { ar: 'سماعات وإلكترونيات', en: "Headphones & electronics" }, icon: Headphones, offsetMin: 4.5, durationMin: 3, pages: 18 },
]
const noonJobs: Omit<Job, 'source'>[] = [
  { id: 'n-mobile', label: { ar: 'موبايلات', en: "Mobiles" }, icon: Smartphone, offsetMin: 1, durationMin: 6, pages: 30 },
  { id: 'n-tv', label: { ar: 'تلفزيونات', en: "TVs" }, icon: Tv, offsetMin: 3.5, durationMin: 5, pages: 22 },
  { id: 'n-perfume', label: { ar: 'عطور', en: "Perfumes" }, icon: SprayCan, offsetMin: 7, durationMin: 2.5, pages: 14 },
  { id: 'n-cosmetics', label: { ar: 'مستحضرات تجميل', en: "Cosmetics" }, icon: Sparkles, offsetMin: 8.5, durationMin: 3.5, pages: 18 },
]
const emaratiJobs: Omit<Job, 'source'>[] = [
  { id: 'e-men', label: { ar: 'عطور رجالي', en: "Men's perfumes" }, icon: SprayCan, offsetMin: 0.5, durationMin: 2, pages: 8 },
  { id: 'e-women', label: { ar: 'عطور حريمي', en: "Women's perfumes" }, icon: Sparkles, offsetMin: 3, durationMin: 2, pages: 8 },
  { id: 'e-oud', label: { ar: 'عود وبخور', en: "Oud & bakhoor" }, icon: Flame, offsetMin: 5.5, durationMin: 1.5, pages: 6 },
  { id: 'e-gifts', label: { ar: 'مجموعات هدايا', en: "Gift sets" }, icon: Gift, offsetMin: 8, durationMin: 1.5, pages: 5 },
]
const jobs: Job[] = [
  ...amazonJobs.map((j) => ({ ...j, source: 'amazon' as const })),
  ...noonJobs.map((j) => ({ ...j, source: 'noon' as const })),
  ...emaratiJobs.map((j) => ({ ...j, source: 'emarati' as const })),
]

type RoundStatus = 'success' | 'partial' | 'failed'
type Round = {
  k: number
  start: number
  end: number
  status: RoundStatus
  pagesRead: number
  products: number
  deals: number
  error?: Tx
}

function hash(s: string) {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return ((x >>> 0) % 10000) / 10000
}

const errors: Tx[] = [
  { ar: 'الموقع رجّع صفحة تحقق (CAPTCHA)', en: 'Site returned a CAPTCHA page' },
  { ar: 'انتهت مهلة الاتصال بالموقع', en: 'Connection to the site timed out' },
  { ar: 'صفحة النتايج اتغير شكلها', en: 'Results page layout changed' },
]

function round(job: Job, k: number): Round {
  const r = hash(job.id + k)
  const status: RoundStatus = r < 0.08 ? 'failed' : r < 0.18 ? 'partial' : 'success'
  const start = EPOCH + job.offsetMin * MIN + k * CYCLE
  const dur = job.durationMin * MIN * (0.85 + 0.3 * hash(job.id + 'd' + k)) * (status === 'failed' ? 0.3 : 1)
  const pagesRead =
    status === 'success'
      ? job.pages
      : status === 'partial'
        ? Math.round(job.pages * (0.55 + 0.25 * hash(job.id + 'p' + k)))
        : Math.round(job.pages * 0.25)
  const products = pagesRead * 24
  const deals = status === 'failed' ? 0 : Math.round(products * (0.03 + 0.05 * hash(job.id + 'x' + k)))
  return {
    k,
    start,
    end: start + dur,
    status,
    pagesRead,
    products,
    deals,
    error: status === 'failed' ? errors[Math.floor(hash(job.id + 'e' + k) * errors.length)] : undefined,
  }
}

type JobState = {
  job: Job
  running?: { round: Round; progress: number; pages: number }
  last: Round
  nextStart: number
  history: Round[]
}

function stateAt(job: Job, t: number): JobState {
  const k = Math.floor((t - EPOCH - job.offsetMin * MIN) / CYCLE)
  const cur = round(job, k)
  const isRunning = t < cur.end
  const lastK = isRunning ? k - 1 : k
  const history = Array.from({ length: 8 }, (_, i) => round(job, lastK - i))
  return {
    job,
    running: isRunning
      ? {
          round: cur,
          progress: (t - cur.start) / (cur.end - cur.start),
          pages: Math.max(1, Math.floor(((t - cur.start) / (cur.end - cur.start)) * cur.pagesRead)),
        }
      : undefined,
    last: history[0],
    nextStart: round(job, k + 1).start,
    history,
  }
}

const roundMeta = (): Record<RoundStatus, { label: string; cls: string; bar: string; icon: LucideIcon }> => ({
  success: { label: L('خلصت', 'Done'), cls: 'bg-drop-soft text-drop', bar: 'bg-drop', icon: CheckCircle2 },
  partial: { label: L('جزئية', 'Partial'), cls: 'bg-adv-soft text-ink', bar: 'bg-mute', icon: CircleDashed },
  failed: { label: L('فشلت', 'Failed'), cls: 'bg-fail-soft text-fail', bar: 'bg-fail', icon: AlertOctagon },
})

function RoundBadge({ s }: { s: RoundStatus }) {
  const m = roundMeta()[s]
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold', m.cls)}>
      <m.icon className="size-3.5" />
      {m.label}
    </span>
  )
}

type Filter = 'all' | 'running' | 'waiting' | 'issues'

export function Jobs() {
  const [speed, setSpeed] = useState(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [source, setSource] = useState<'all' | SourceId>('all')
  const t = useSimClock(speed)
  const states = useMemo(
    () => jobs.filter((j) => source === 'all' || j.source === source).map((j) => stateAt(j, t)),
    [t, source],
  )

  const running = states.filter((s) => s.running)
  const waiting = states.filter((s) => !s.running)
  const issues = states.filter((s) => s.last.status !== 'success')
  const soonest = [...waiting].sort((a, b) => a.nextStart - b.nextStart)[0]
  const dealsLast = states.reduce((n, s) => n + s.last.deals, 0)

  const shown = states.filter((s) =>
    filter === 'running' ? s.running : filter === 'waiting' ? !s.running : filter === 'issues' ? s.last.status !== 'success' : true,
  )
  const cyclePos = (((t - EPOCH) % CYCLE) + CYCLE) % CYCLE
  const log = states
    .flatMap((s) => s.history.slice(0, 4).map((r) => ({ job: s.job, r })))
    .sort((a, b) => b.r.end - a.r.end)
    .slice(0, 10)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-body">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-drop opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-drop" />
          </span>
          {L('مباشر · الساعة', 'Live ·')} <b className="num text-ink">{clock(t)}</b>
          <span className="hidden text-mute @xl:inline">
            · {L(`كل قسم بيتبحث فيه كل 10 دقائق في ${jobSources.length} متاجر`, `each category is searched every 10 minutes across ${jobSources.length} stores`)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SpeedControl speed={speed} setSpeed={setSpeed} />
          <SampleTag />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Kpi
          label={L('جاري البحث الآن', 'Searching now')}
          value={String(running.length)}
          sub={
            running.map((s) => `${tx(s.job.label)} (${tx(jobSources.find((x) => x.id === s.job.source)!.short)})`).join(L('، ', ', ')) ||
            L('مفيش', 'None')
          }
          dot="bg-ink"
        />
        <Kpi
          label={L('خلصت ومستنية الجولة الجاية', 'Done, waiting for next round')}
          value={String(waiting.length)}
          sub={L(`من ${states.length} عملية بحث`, `of ${states.length} search jobs`)}
          dot="bg-drop"
        />
        <Kpi
          label={L('أقرب جولة جاية', 'Next round')}
          value={soonest ? mmss(soonest.nextStart - t) : '—'}
          sub={soonest ? `${tx(soonest.job.label)} · ${sourceLabel(soonest.job.source)}` : ''}
          ltr
        />
        <Kpi
          label={L('عروض في آخر جولة', 'Deals in last round')}
          value={String(dealsLast)}
          sub={L('مجموع كل الأقسام', 'Across all categories')}
        />
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
          {states.map((s) => {
            const a = s.job.offsetMin / 10
            const w = s.job.durationMin / 10
            const segs = a + w > 1 ? [[a, 1 - a], [0, a + w - 1]] : [[a, w]]
            return (
              <div key={s.job.id} className="grid grid-cols-[150px_1fr] items-center gap-3 @xl:grid-cols-[190px_1fr]">
                <div className="flex items-center gap-2 truncate text-[12.5px] font-semibold">
                  <s.job.icon className="size-4 shrink-0 text-body" />
                  <span className="truncate">{tx(s.job.label)}</span>
                  <SourceChip id={s.job.source} />
                </div>
                <div className="relative h-6 rounded-md bg-canvas">
                  {segs.map(([st, wd], i) => (
                    <div
                      key={i}
                      className={cx('absolute inset-y-1 rounded', s.running ? 'bg-ink' : 'bg-line-strong')}
                      style={{ insetInlineStart: `${st * 100}%`, width: `${wd * 100}%` }}
                    />
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
            <span className="h-2.5 w-4 rounded-sm bg-line-strong" /> {L('ميعاد البحث في الدورة', 'Scheduled slot in the cycle')}
          </span>
        </div>
      </section>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-mute">{L('المتجر', 'Store')}</span>
        <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-lg border border-line bg-white p-0.5">
          {([['all', L('كل المتاجر', 'All stores')], ...jobSources.map((x) => [x.id, x.label])] as ['all' | SourceId, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSource(k)}
              aria-pressed={source === k}
              className={cx(
                'h-8 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap',
                source === k ? 'bg-ink text-white' : 'text-body hover:text-ink',
              )}
            >
              <bdi>{l}</bdi>
              <span className={cx('num ms-1.5 text-[11px]', source === k ? 'text-white/60' : 'text-mute')}>
                {k === 'all' ? jobs.length : jobs.filter((j) => j.source === k).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:px-0">
        {(
          [
            ['all', L('كل الأقسام', 'All categories'), states.length],
            ['running', L('جاري الآن', 'Running now'), running.length],
            ['waiting', L('خلصت ومستنية', 'Done & waiting'), waiting.length],
            ['issues', L('آخر جولة فيها مشكلة', 'Last round had issues'), issues.length],
          ] as [Filter, string, number][]
        ).map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cx(
              'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold',
              filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white',
            )}
          >
            {l}
            <span className={cx('num text-[11.5px]', filter === k ? 'text-white/60' : 'text-mute')}>{n}</span>
          </button>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
        {shown.map((s) => (
          <JobCard key={s.job.id} s={s} t={t} />
        ))}
        {!shown.length && (
          <div className="col-span-full rounded-2xl border border-dashed border-line bg-white py-12 text-center text-[13px] text-body">
            {L('مفيش أقسام في الحالة دي دلوقتي', 'No categories in this state right now')}
          </div>
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
              <th className="hidden sm:table-cell">{L('المتجر', 'Store')}</th>
              <th>{L('الحالة', 'Status')}</th>
              <th className="hidden sm:table-cell">{L('الصفحات', 'Pages')}</th>
              <th>{L('العروض', 'Deals')}</th>
              <th className="hidden md:table-cell">{L('ملاحظات', 'Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {log.map(({ job, r }) => (
              <tr key={job.id + r.k} className="border-t border-line [&>td]:px-4 [&>td]:py-2.5">
                <td className="num whitespace-nowrap">{clock(r.end)}</td>
                <td className="font-semibold">
                  {tx(job.label)}
                  <span className="ms-1.5 sm:hidden">
                    <SourceChip id={job.source} />
                  </span>
                </td>
                <td className="hidden sm:table-cell">
                  <SourceChip id={job.source} />
                </td>
                <td>
                  <RoundBadge s={r.status} />
                </td>
                <td className="num hidden sm:table-cell">
                  {r.pagesRead} <span className="text-mute">/ {job.pages}</span>
                </td>
                <td className="num font-semibold">{r.deals}</td>
                <td className="hidden text-[12.5px] text-body md:table-cell">
                  {r.error ? tx(r.error) : r.status === 'partial' ? L('بعض الصفحات ما اتقراتش', 'Some pages were not read') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function JobCard({ s, t }: { s: JobState; t: number }) {
  const { job, running, last } = s
  return (
    <article className={cx('flex flex-col rounded-2xl border bg-white p-4', running ? 'border-ink' : 'border-line')}>
      <div className="flex items-center gap-3">
        <div className={cx('grid size-10 place-items-center rounded-xl', running ? 'bg-ink text-white' : 'bg-canvas text-ink')}>
          <job.icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold">{tx(job.label)}</h3>
          <div className="text-[11.5px] text-mute">
            <span dir="ltr">{sourceLabel(job.source)}</span> · {L('كل 10 دقائق', 'every 10 min')} · {job.pages} {L('صفحة', 'pages')}
          </div>
        </div>
        {running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[12px] font-semibold text-white">
            <Loader2 className="size-3.5 animate-spin" /> {L('جاري البحث', 'Searching')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[12px] font-semibold text-body">
            <Timer className="size-3.5" /> {L('مستنية', 'Waiting')}
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-canvas/80 p-3.5">
        {running ? (
          <>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-body">
                {L('صفحة', 'Page')} <b className="num text-ink">{running.pages}</b> {L('من', 'of')}{' '}
                <span className="num">{job.pages}</span>
              </span>
              <span className="text-mute">
                {L('بدأت من', 'started')} <Mm ms={t - running.round.start} /> {L('', 'ago')}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-300"
                style={{ width: `${Math.min(100, (running.pages / job.pages) * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11.5px] text-mute">
              {L('الجولة رقم', 'Round #')}
              <span className="num">{running.round.k}</span> · {L('الجولة الجاية الساعة', 'next round at')} {clock(s.nextStart)}
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] text-body">{L('الجولة الجاية تبدأ بعد', 'Next round starts in')}</div>
            <Mm ms={s.nextStart - t} className="text-[28px] leading-9 font-bold tracking-tight" />
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-drop"
                style={{ width: `${Math.min(100, ((t - last.end) / (s.nextStart - last.end)) * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11.5px] text-mute">
              {L('آخر جولة خلصت الساعة', 'Last round finished at')} {clock(last.end)}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label={L('آخر جولة', 'Last round')} value={<RoundBadge s={last.status} />} />
        <Mini label={L('منتجات اتقرت', 'Products read')} value={<span className="num font-bold">{last.products}</span>} />
        <Mini label={L('عروض لقيناها', 'Deals found')} value={<span className="num font-bold text-drop">{last.deals}</span>} />
      </div>

      {last.status === 'failed' && (
        <div className="mt-3 rounded-lg bg-fail-soft px-3 py-2 text-[12px] leading-5 text-fail">
          {tx(last.error!)}.{' '}
          {L('آخر عروض ناجحة لسه ظاهرة، وهنحاول تاني في الجولة الجاية.', "Last successful deals stay visible; we'll retry next round.")}
        </div>
      )}
      {last.status === 'partial' && (
        <div className="mt-3 rounded-lg bg-adv-soft px-3 py-2 text-[12px] leading-5 text-body">
          {L('اتقرا', 'Read')} <span className="num">{last.pagesRead}</span> {L('من', 'of')}{' '}
          <span className="num">{job.pages}</span>{' '}
          {L('صفحة بس — الباقي بآخر سعر ناجح.', 'pages only — the rest keep their last successful price.')}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between text-[11px] text-mute">
          <span>{L('آخر 8 جولات', 'Last 8 rounds')}</span>
          <span className="flex items-center gap-1">
            <Gauge className="size-3.5" />
            {Math.round((s.history.filter((r) => r.status === 'success').length / s.history.length) * 100)}% {L('نجاح', 'success')}
          </span>
        </div>
        <div className="mt-1.5 flex gap-1">
          {[...s.history].reverse().map((r) => (
            <div
              key={r.k}
              title={`${clock(r.end)} — ${roundMeta()[r.status].label} · ${r.deals} ${L('عرض', 'deals')}`}
              className={cx('h-2 flex-1 rounded-full', roundMeta()[r.status].bar)}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function SourceChip({ id }: { id: SourceId }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10.5px] font-semibold',
        id === 'noon'
          ? 'bg-noon-soft text-noon-ink'
          : id === 'emarati'
            ? 'bg-emarati-soft text-emarati-ink'
            : 'bg-adv-soft text-adv',
      )}
    >
      {tx(jobSources.find((x) => x.id === id)!.short)}
    </span>
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
      <div className="num mt-1 text-[30px] leading-9 font-bold tracking-tight">
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] leading-4 text-mute">{sub}</div>
    </div>
  )
}

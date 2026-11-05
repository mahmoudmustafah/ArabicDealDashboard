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

// SAMPLE DATA — simulated search jobs. Each category runs a deal search every 10 minutes.
const MIN = 60e3
export const CYCLE = 10 * MIN
const EPOCH = NOW - 1000 * CYCLE

type SourceId = 'amazon' | 'noon' | 'emarati'
export const jobSources: { id: SourceId; label: string; short: string }[] = [
  { id: 'amazon', label: 'Amazon Egypt', short: 'أمازون' },
  { id: 'noon', label: 'Noon Egypt', short: 'نون' },
  { id: 'emarati', label: 'Emarati Scents', short: 'إماراتي سنتس' },
]
const sourceLabel = (id: SourceId) => jobSources.find((x) => x.id === id)!.label

type Job = {
  id: string
  source: SourceId
  label: string
  icon: LucideIcon
  offsetMin: number
  durationMin: number
  pages: number
}

const amazonJobs: Omit<Job, 'source'>[] = [
  { id: 'tv', label: 'تلفزيونات', icon: Tv, offsetMin: 0.5, durationMin: 5.5, pages: 24 },
  { id: 'mobile', label: 'موبايلات', icon: Smartphone, offsetMin: 2, durationMin: 6.5, pages: 32 },
  { id: 'perfume', label: 'عطور', icon: SprayCan, offsetMin: 6, durationMin: 2.5, pages: 14 },
  { id: 'cosmetics', label: 'مستحضرات تجميل', icon: Sparkles, offsetMin: 7.5, durationMin: 4, pages: 20 },
  { id: 'monitors', label: 'شاشات كمبيوتر', icon: Monitor, offsetMin: 0, durationMin: 4, pages: 16 },
  { id: 'electronics', label: 'سماعات وإلكترونيات', icon: Headphones, offsetMin: 4.5, durationMin: 3, pages: 18 },
]
const noonJobs: Omit<Job, 'source'>[] = [
  { id: 'n-mobile', label: 'موبايلات', icon: Smartphone, offsetMin: 1, durationMin: 6, pages: 30 },
  { id: 'n-tv', label: 'تلفزيونات', icon: Tv, offsetMin: 3.5, durationMin: 5, pages: 22 },
  { id: 'n-perfume', label: 'عطور', icon: SprayCan, offsetMin: 7, durationMin: 2.5, pages: 14 },
  { id: 'n-cosmetics', label: 'مستحضرات تجميل', icon: Sparkles, offsetMin: 8.5, durationMin: 3.5, pages: 18 },
]
const emaratiJobs: Omit<Job, 'source'>[] = [
  { id: 'e-men', label: 'عطور رجالي', icon: SprayCan, offsetMin: 0.5, durationMin: 2, pages: 8 },
  { id: 'e-women', label: 'عطور حريمي', icon: Sparkles, offsetMin: 3, durationMin: 2, pages: 8 },
  { id: 'e-oud', label: 'عود وبخور', icon: Flame, offsetMin: 5.5, durationMin: 1.5, pages: 6 },
  { id: 'e-gifts', label: 'مجموعات هدايا', icon: Gift, offsetMin: 8, durationMin: 1.5, pages: 5 },
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
  error?: string
}

function hash(s: string) {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return ((x >>> 0) % 10000) / 10000
}

const errors = ['أمازون رجّع صفحة تحقق (CAPTCHA)', 'انتهت مهلة الاتصال بـ amazon.eg', 'صفحة النتايج اتغير شكلها']

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

const roundMeta: Record<RoundStatus, { label: string; cls: string; bar: string; icon: LucideIcon }> = {
  success: { label: 'خلصت', cls: 'bg-drop-soft text-drop', bar: 'bg-drop', icon: CheckCircle2 },
  partial: { label: 'جزئية', cls: 'bg-adv-soft text-ink', bar: 'bg-[#8a929e]', icon: CircleDashed },
  failed: { label: 'فشلت', cls: 'bg-fail-soft text-fail', bar: 'bg-fail', icon: AlertOctagon },
}

function RoundBadge({ s }: { s: RoundStatus }) {
  const m = roundMeta[s]
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
          مباشر · الساعة <b className="num text-ink">{clock(t)}</b>
          <span className="hidden text-mute @xl:inline">
            · كل قسم بيتبحث فيه كل 10 دقائق في {jobSources.length} متاجر
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SpeedControl speed={speed} setSpeed={setSpeed} />
          <SampleTag />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <Kpi label="جاري البحث الآن" value={String(running.length)} sub={running.map((s) => `${s.job.label} (${jobSources.find((x) => x.id === s.job.source)!.short})`).join('، ') || 'مفيش'} dot="bg-ink" />
        <Kpi
          label="خلصت ومستنية الجولة الجاية"
          value={String(waiting.length)}
          sub={`من ${states.length} عملية بحث`}
          dot="bg-drop"
        />
        <Kpi
          label="أقرب جولة جاية"
          value={soonest ? mmss(soonest.nextStart - t) : '—'}
          sub={soonest ? `${soonest.job.label} · ${sourceLabel(soonest.job.source)}` : ''}
          ltr
        />
        <Kpi label="عروض في آخر جولة" value={String(dealsLast)} sub="مجموع كل الأقسام" />
      </section>

      {/* 10-minute cycle timeline */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold">
            <Timer className="size-4" /> دورة الـ 10 دقائق
          </h3>
          <span className="text-[12px] text-mute">
            الخط الأسود = دلوقتي (<Mm ms={cyclePos} /> من الدورة)
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
                  <span className="truncate">{s.job.label}</span>
                  <SourceChip id={s.job.source} />
                </div>
                <div className="relative h-6 rounded-md bg-canvas">
                  {segs.map(([st, wd], i) => (
                    <div
                      key={i}
                      className={cx('absolute inset-y-1 rounded', s.running ? 'bg-ink' : 'bg-[#c9ced5]')}
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
                <span key={m}>{m} د</span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-[11.5px] text-body">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-ink" /> شغال دلوقتي
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-[#c9ced5]" /> ميعاد البحث في الدورة
          </span>
        </div>
      </section>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-mute">المتجر</span>
        <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-lg border border-line bg-white p-0.5">
          {([['all', 'كل المتاجر'], ...jobSources.map((x) => [x.id, x.label])] as ['all' | SourceId, string][]).map(([k, l]) => (
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
            ['all', 'كل الأقسام', states.length],
            ['running', 'جاري الآن', running.length],
            ['waiting', 'خلصت ومستنية', waiting.length],
            ['issues', 'آخر جولة فيها مشكلة', issues.length],
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
            مفيش أقسام في الحالة دي دلوقتي
          </div>
        )}
      </section>

      {/* recent rounds log */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3 text-[14px] font-bold">آخر الجولات</div>
        <table className="w-full text-[13px]">
          <thead className="bg-canvas/70 text-[12px] text-body">
            <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-semibold">
              <th>خلصت</th>
              <th>القسم</th>
              <th className="hidden sm:table-cell">المتجر</th>
              <th>الحالة</th>
              <th className="hidden sm:table-cell">الصفحات</th>
              <th>العروض</th>
              <th className="hidden md:table-cell">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {log.map(({ job, r }) => (
              <tr key={job.id + r.k} className="border-t border-line [&>td]:px-4 [&>td]:py-2.5">
                <td className="num whitespace-nowrap">{clock(r.end)}</td>
                <td className="font-semibold">
                  {job.label}
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
                  {r.error ?? (r.status === 'partial' ? 'بعض الصفحات ما اتقراتش' : '')}
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
          <h3 className="truncate text-[15px] font-bold">{job.label}</h3>
          <div className="text-[11.5px] text-mute">
            <span dir="ltr">{sourceLabel(job.source)}</span> · كل 10 دقائق · {job.pages} صفحة
          </div>
        </div>
        {running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[12px] font-semibold text-white">
            <Loader2 className="size-3.5 animate-spin" /> جاري البحث
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[12px] font-semibold text-body">
            <Timer className="size-3.5" /> مستنية
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-canvas/80 p-3.5">
        {running ? (
          <>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-body">
                صفحة <b className="num text-ink">{running.pages}</b> من <span className="num">{job.pages}</span>
              </span>
              <span className="text-mute">
                بدأت من <Mm ms={t - running.round.start} />
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-300"
                style={{ width: `${Math.min(100, (running.pages / job.pages) * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11.5px] text-mute">
              الجولة رقم <span className="num">{running.round.k}</span> · الجولة الجاية الساعة {clock(s.nextStart)}
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] text-body">الجولة الجاية تبدأ بعد</div>
            <Mm ms={s.nextStart - t} className="text-[28px] leading-9 font-bold tracking-tight" />
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-drop"
                style={{ width: `${Math.min(100, ((t - last.end) / (s.nextStart - last.end)) * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-[11.5px] text-mute">آخر جولة خلصت الساعة {clock(last.end)}</div>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="آخر جولة" value={<RoundBadge s={last.status} />} />
        <Mini label="منتجات اتقرت" value={<span className="num font-bold">{last.products}</span>} />
        <Mini label="عروض لقيناها" value={<span className="num font-bold text-drop">{last.deals}</span>} />
      </div>

      {last.status === 'failed' && (
        <div className="mt-3 rounded-lg bg-fail-soft px-3 py-2 text-[12px] leading-5 text-fail">
          {last.error}. آخر عروض ناجحة لسه ظاهرة، وهنحاول تاني في الجولة الجاية.
        </div>
      )}
      {last.status === 'partial' && (
        <div className="mt-3 rounded-lg bg-adv-soft px-3 py-2 text-[12px] leading-5 text-body">
          اتقرا <span className="num">{last.pagesRead}</span> من <span className="num">{job.pages}</span> صفحة بس — الباقي بآخر سعر
          ناجح.
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between text-[11px] text-mute">
          <span>آخر 8 جولات</span>
          <span className="flex items-center gap-1">
            <Gauge className="size-3.5" />
            {Math.round((s.history.filter((r) => r.status === 'success').length / s.history.length) * 100)}% نجاح
          </span>
        </div>
        <div className="mt-1.5 flex gap-1">
          {[...s.history].reverse().map((r) => (
            <div
              key={r.k}
              title={`${clock(r.end)} — ${roundMeta[r.status].label} · ${r.deals} عرض`}
              className={cx('h-2 flex-1 rounded-full', roundMeta[r.status].bar)}
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
          ? 'bg-[#fff4b8] text-[#5a4a00]'
          : id === 'emarati'
            ? 'bg-[#f3e8da] text-[#6b4a1f]'
            : 'bg-adv-soft text-adv',
      )}
    >
      {jobSources.find((x) => x.id === id)!.short}
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

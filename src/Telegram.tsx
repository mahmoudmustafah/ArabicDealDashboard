import {
  AlertOctagon,
  ArrowLeft,
  Ban,
  CheckCheck,
  ChevronDown,
  Clock,
  Loader2,
  Megaphone,
  RotateCw,
  Search,
  Send,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NOW, products } from './data'
import { price } from './format'
import { agoAt, clock, Mm, SpeedControl, useSimClock } from './sim'
import { Money, SampleTag, Thumb, cx } from './ui'
import { L, tx, type T as Tx } from './i18n'

// SAMPLE DATA — simulated automatic Telegram posts. Nothing here is published by hand.
const S = 1000
const M = 60 * S
export const GENERAL_DELAY = 5 * M
export const PRIORITY_THRESHOLD = 50

type Store = 'Amazon Egypt' | 'Noon Egypt' | 'Emarati Scents'
type Attempt = { at: number; ok: boolean; error?: Tx }
type Delivery = { scheduledAt: number; attempts: Attempt[]; cancelledAt?: number; cancelReason?: Tx; msgId?: number }
type Post = {
  id: string
  name: Tx
  store: Store
  image?: string
  price: number
  was: number
  discountPct: number
  discountKind: 'advertised' | 'observed'
  exceptional?: boolean
  discoveredAt: number
  priority?: Delivery
  general: Delivery
}

const RATE: Tx = { ar: 'تليجرام طلب تهدئة الإرسال (429)', en: 'Telegram rate limit (429)' }
const TIMEOUT: Tx = { ar: 'انتهت مهلة الاتصال بتليجرام', en: 'Telegram connection timed out' }
const kindLabel = (k: Post['discountKind']) => (k === 'observed' ? L('مرصود', 'observed') : L('معلن', 'advertised'))

const channels = {
  priority: { name: { ar: 'رادار العروض — أولوية', en: 'Deal Radar — Priority' } as Tx, handle: '@DealRadarPriority', members: 2140 },
  general: { name: { ar: 'رادار العروض', en: 'Deal Radar' } as Tx, handle: '@DealRadarEG', members: 18630 },
}

const img = (id: string) => products.find((p) => p.id === id)?.image

type Seed = Omit<Post, 'priority' | 'general'> & {
  override?: { priority?: Partial<Delivery>; general?: Partial<Delivery> }
}

let msg = 4810
function build(p: Seed): Post {
  const isPriority = p.discountPct > PRIORITY_THRESHOLD || !!p.exceptional
  const d = p.discoveredAt
  const priority: Delivery | undefined = isPriority
    ? { scheduledAt: d, attempts: [{ at: d + 7 * S, ok: true }], msgId: msg++, ...p.override?.priority }
    : undefined
  const gAt = isPriority ? d + GENERAL_DELAY : d
  const general: Delivery = { scheduledAt: gAt, attempts: [{ at: gAt + 6 * S, ok: true }], msgId: msg++, ...p.override?.general }
  return { ...p, priority, general }
}

const seeds: Seed[] = [
  // appear live while the page is open
  { id: 'p13', name: { ar: 'سماعة سوني WH-CH720N لاسلكية', en: 'Sony WH-CH720N wireless headphones' }, store: 'Noon Egypt', price: 2899, was: 6299, discountPct: 54, discountKind: 'advertised', discoveredAt: NOW + 1.5 * M },
  { id: 'p14', name: { ar: 'كيبورد ريدراجون K552', en: 'Redragon K552 keyboard' }, store: 'Amazon Egypt', image: img('redragon-k552'), price: 1149, was: 1299, discountPct: 12, discountKind: 'observed', discoveredAt: NOW + 4 * M },
  // within the 5-minute delay
  { id: 'p1', name: { ar: 'عود ملكي — 100 مل', en: 'Royal Oud — 100 ml' }, store: 'Emarati Scents', price: 1350, was: 3400, discountPct: 60, discountKind: 'advertised', discoveredAt: NOW - 0.6 * M },
  {
    id: 'p2',
    name: { ar: 'شاشة شاومي A27i مقاس 27″', en: 'Xiaomi A27i 27″ monitor' },
    store: 'Amazon Egypt',
    image: img('xiaomi-a27i'),
    price: 2999,
    was: 5999,
    discountPct: 50,
    discountKind: 'observed',
    exceptional: true,
    discoveredAt: NOW - 2.2 * M,
  },
  {
    id: 'p3',
    name: { ar: 'كيبورد لوجيتك MX Keys S', en: 'Logitech MX Keys S keyboard' },
    store: 'Amazon Egypt',
    image: img('mx-keys-s'),
    price: 4799,
    was: 5299,
    discountPct: 9,
    discountKind: 'observed',
    discoveredAt: NOW - 3 * M,
    override: {
      general: {
        scheduledAt: NOW - 3 * M,
        attempts: [
          { at: NOW - 3 * M + 5 * S, ok: false, error: RATE },
          { at: NOW + 0.8 * M, ok: true },
        ],
      },
    },
  },
  // completed
  { id: 'p4', name: { ar: 'سامسونج جالاكسي A55 — 256 جيجا', en: 'Samsung Galaxy A55 — 256 GB' }, store: 'Noon Egypt', price: 9499, was: 20999, discountPct: 55, discountKind: 'advertised', discoveredAt: NOW - 7 * M },
  { id: 'p5', name: { ar: 'شاشة سامسونج أوديسي G5 مقاس 27″', en: 'Samsung Odyssey G5 27″ monitor' }, store: 'Amazon Egypt', image: img('odyssey-g5'), price: 11999, was: 14999, discountPct: 20, discountKind: 'observed', discoveredAt: NOW - 15 * M },
  { id: 'p6', name: { ar: 'تلفزيون LG ‏55 بوصة 4K UHD', en: 'LG 55-inch 4K UHD TV' }, store: 'Noon Egypt', price: 15999, was: 20499, discountPct: 22, discountKind: 'observed', discoveredAt: NOW - 22 * M },
  {
    id: 'p7',
    name: { ar: 'تلفزيون شاومي A Pro ‏43 بوصة', en: 'Xiaomi A Pro 43-inch TV' },
    store: 'Noon Egypt',
    price: 4499,
    was: 8999,
    discountPct: 50,
    discountKind: 'observed',
    exceptional: true,
    discoveredAt: NOW - 27 * M,
    override: {
      general: {
        cancelledAt: NOW - 24 * M,
        cancelReason: {
          ar: 'السعر رجع 8,999 ج.م قبل ميعاد القناة العامة — اتلغى النشر',
          en: 'Price went back to EGP 8,999 before the general slot — post cancelled',
        },
        attempts: [],
      },
    },
  },
  {
    id: 'p8',
    name: { ar: 'سماعة JBL Tune 520BT', en: 'JBL Tune 520BT headphones' },
    store: 'Amazon Egypt',
    image: img('jbl-tune-520'),
    price: 1899,
    was: 2199,
    discountPct: 14,
    discountKind: 'observed',
    discoveredAt: NOW - 34 * M,
    override: {
      general: {
        attempts: [
          { at: NOW - 34 * M + 5 * S, ok: false, error: RATE },
          { at: NOW - 33 * M, ok: true },
        ],
      },
    },
  },
  { id: 'p9', name: { ar: 'طقم بخور إماراتي فاخر', en: 'Luxury Emirati bakhoor set' }, store: 'Emarati Scents', price: 780, was: 1200, discountPct: 35, discountKind: 'advertised', discoveredAt: NOW - 41 * M },
  { id: 'p10', name: { ar: 'شاشة هواوي MateView SE ‏23.8″', en: 'Huawei MateView SE 23.8″ monitor' }, store: 'Amazon Egypt', image: img('huawei-mateview-se'), price: 3099, was: 5999, discountPct: 48, discountKind: 'advertised', discoveredAt: NOW - 55 * M },
  { id: 'p11', name: { ar: 'آيفون 15 — 128 جيجا', en: 'iPhone 15 — 128 GB' }, store: 'Noon Egypt', price: 32999, was: 55999, discountPct: 41, discountKind: 'observed', exceptional: true, discoveredAt: NOW - 68 * M },
  {
    id: 'p12',
    name: { ar: 'سيروم فيتامين سي 30 مل', en: 'Vitamin C serum 30 ml' },
    store: 'Noon Egypt',
    price: 499,
    was: 715,
    discountPct: 30,
    discountKind: 'advertised',
    discoveredAt: NOW - 80 * M,
    override: {
      general: {
        attempts: [
          { at: NOW - 80 * M + 5 * S, ok: false, error: TIMEOUT },
          { at: NOW - 79 * M, ok: false, error: TIMEOUT },
          { at: NOW - 77 * M, ok: false, error: TIMEOUT },
        ],
      },
    },
  },
]
const posts = seeds.map(build)

type DState =
  | { k: 'scheduled'; at: number }
  | { k: 'sending' }
  | { k: 'sent'; at: number; retried: boolean }
  | { k: 'retrying'; at: number; error?: string }
  | { k: 'failed'; error?: string; tries: number }
  | { k: 'cancelled'; reason?: string; at: number }

function dstate(d: Delivery, t: number): DState {
  if (d.cancelledAt !== undefined && t >= d.cancelledAt) return { k: 'cancelled', reason: d.cancelReason && tx(d.cancelReason), at: d.cancelledAt }
  if (t < d.scheduledAt) return { k: 'scheduled', at: d.scheduledAt }
  const done = d.attempts.filter((a) => a.at <= t)
  const last = done[done.length - 1]
  if (!last) return d.attempts.length ? { k: 'sending' } : { k: 'scheduled', at: d.cancelledAt ?? d.scheduledAt }
  if (last.ok) return { k: 'sent', at: last.at, retried: done.length > 1 }
  const next = d.attempts.find((a) => a.at > t)
  return next
    ? { k: 'retrying', at: next.at, error: last.error && tx(last.error) }
    : { k: 'failed', error: last.error && tx(last.error), tries: done.length }
}

function DeliveryCell({ d, t, compact }: { d?: Delivery; t: number; compact?: boolean }) {
  if (!d)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-mute">
        — {L('مش مطلوب', 'Not required')}
      </span>
    )
  const s = dstate(d, t)
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap'
  return (
    <div className="flex flex-col items-start gap-0.5">
      {s.k === 'sent' && (
        <>
          <span className={cx(pill, 'bg-drop-soft text-drop')}>
            <CheckCheck className="size-3.5" /> {L('اتنشر', 'Posted')}
          </span>
          <span className="num text-[11.5px] text-mute">
            {clock(s.at)}
            {s.retried && L(' · بعد إعادة محاولة', ' · after retry')}
          </span>
        </>
      )}
      {s.k === 'scheduled' && (
        <>
          <span className={cx(pill, 'bg-pending-soft text-pending')}>
            <Clock className="size-3.5" /> {L('هيتنشر بعد', 'Posts in')} <Mm ms={s.at - t} />
          </span>
          {!compact && <span className="num text-[11.5px] text-mute">
              {L('الساعة', 'at')} {clock(s.at)}
            </span>}
        </>
      )}
      {s.k === 'sending' && (
        <span className={cx(pill, 'bg-ink text-white')}>
          <Loader2 className="size-3.5 animate-spin" /> {L('جاري الإرسال', 'Sending')}
        </span>
      )}
      {s.k === 'retrying' && (
        <>
          <span className={cx(pill, 'bg-fail-soft text-fail')}>
            <RotateCw className="size-3.5" /> {L('إعادة تلقائية بعد', 'Auto-retry in')} <Mm ms={s.at - t} />
          </span>
          {!compact && <span className="text-[11.5px] text-mute">{s.error}</span>}
        </>
      )}
      {s.k === 'failed' && (
        <>
          <span className={cx(pill, 'bg-fail text-white')}>
            <AlertOctagon className="size-3.5" /> {L('فشل', 'Failed')}
          </span>
          {!compact && (
            <span className="text-[11.5px] text-mute">
              <span className="num">{s.tries}</span> {L('محاولات', 'attempts')} · {s.error}
            </span>
          )}
        </>
      )}
      {s.k === 'cancelled' && (
        <>
          <span className={cx(pill, 'bg-adv-soft text-adv')}>
            <Ban className="size-3.5" /> {L('اتلغى', 'Cancelled')}
          </span>
          {!compact && <span className="text-[11.5px] text-mute">{L('السعر رجع قبل الميعاد', 'Price reverted before slot')}</span>}
        </>
      )}
    </div>
  )
}

type Filter = 'all' | 'priority' | 'general' | 'waiting' | 'issues'

export function Telegram() {
  const [speed, setSpeed] = useState(1)
  const t = useSimClock(speed)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>('p2')

  const visible = useMemo(() => posts.filter((p) => p.discoveredAt <= t).sort((a, b) => b.discoveredAt - a.discoveredAt), [t])
  const st = (p: Post) => ({ pr: p.priority && dstate(p.priority, t), ge: dstate(p.general, t) })
  const isWaiting = (p: Post) => st(p).ge.k === 'scheduled'
  const hasIssue = (p: Post) => ['retrying', 'failed'].includes(st(p).ge.k) || ['retrying', 'failed'].includes(st(p).pr?.k ?? '')

  const list = visible.filter((p) => {
    if (q && !tx(p.name).toLowerCase().includes(q.trim().toLowerCase())) return false
    if (filter === 'priority') return !!p.priority
    if (filter === 'general') return !p.priority
    if (filter === 'waiting') return isWaiting(p)
    if (filter === 'issues') return hasIssue(p) || st(p).ge.k === 'cancelled'
    return true
  })

  const sentTo = (ch: 'priority' | 'general') =>
    visible.filter((p) => {
      const d = ch === 'priority' ? p.priority : p.general
      return d && dstate(d, t).k === 'sent'
    })
  const lastSent = (ch: 'priority' | 'general') =>
    sentTo(ch)
      .map((p) => ({ p, at: (dstate(ch === 'priority' ? p.priority! : p.general, t) as { at: number }).at }))
      .sort((a, b) => b.at - a.at)[0]
  const waiting = visible.filter(isWaiting)
  const nextGeneral = [...waiting].sort((a, b) => a.general.scheduledAt - b.general.scheduledAt)[0]
  const issues = visible.filter(hasIssue).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-body">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-drop opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-drop" />
          </span>
          {L('النشر تلقائي · الساعة', 'Automatic posting ·')} <b className="num text-ink">{clock(t)}</b>
          <span className="hidden text-mute @xl:inline">
            {L('· الصفحة دي للمتابعة بس، مفيش نشر يدوي', '· this page is for tracking only — no manual posting')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SpeedControl speed={speed} setSpeed={setSpeed} />
          <SampleTag />
        </div>
      </div>

      {/* routing rules */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="text-[14px] font-bold">{L('قواعد النشر التلقائي', 'Automatic posting rules')}</h3>
        <div className="mt-3 grid gap-3 @3xl:grid-cols-[1fr_auto_1.6fr]">
          <div className="rounded-xl bg-canvas p-3 text-[12.5px] leading-5">
            <div className="font-semibold">{L('عرض جديد اتلقى', 'New offer found')}</div>
            <div className="text-body">
              {L('هل الخصم أكبر من', 'Is the discount over')} <span className="num">{PRIORITY_THRESHOLD}%</span>{' '}
              {L('أو النزول استثنائي؟', 'or the drop exceptional?')}
            </div>
          </div>
          <ArrowLeft className="hidden size-4 self-center text-mute ltr:rotate-180 @3xl:block" />
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pending-line bg-pending-soft/60 p-2.5 text-[12.5px]">
              <span className="rounded bg-white px-1.5 font-semibold text-pending">{L('أيوه', 'Yes')}</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Zap className="size-3.5 text-pending" /> {L('قناة الأولوية فورًا', 'Priority channel immediately')}
              </span>
              <ArrowLeft className="size-3.5 text-mute ltr:rotate-180" />
              <span className="text-body">
                {L('بعد', 'after')} <span className="num">5</span> {L('دقائق', 'minutes')}
              </span>
              <ArrowLeft className="size-3.5 text-mute ltr:rotate-180" />
              <span className="inline-flex items-center gap-1 font-semibold">
                <Megaphone className="size-3.5" /> {L('القناة العامة', 'General channel')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-[12.5px]">
              <span className="rounded bg-canvas px-1.5 font-semibold text-body">{L('لأ', 'No')}</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Megaphone className="size-3.5" /> {L('القناة العامة على طول', 'General channel immediately')}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-5 text-mute">
          {L(
            'لو السعر رجع خلال الـ 5 دقائق، النشر في القناة العامة بيتلغى تلقائيًا. لو الإرسال فشل، بيتعاد تلقائيًا.',
            'If the price reverts within the 5 minutes, the general post is cancelled automatically. Failed sends are retried automatically.',
          )}
        </p>
      </section>

      {/* channels */}
      <section className="grid gap-3 @3xl:grid-cols-2">
        {(['priority', 'general'] as const).map((ch) => {
          const c = channels[ch]
          const last = lastSent(ch)
          const count = sentTo(ch).length
          return (
            <div key={ch} className={cx('rounded-2xl border bg-white p-4', ch === 'priority' ? 'border-pending-line' : 'border-line')}>
              <div className="flex items-center gap-3">
                <div
                  className={cx(
                    'grid size-10 place-items-center rounded-xl',
                    ch === 'priority' ? 'bg-pending-soft text-pending' : 'bg-canvas text-ink',
                  )}
                >
                  {ch === 'priority' ? <Zap className="size-5" /> : <Megaphone className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{tx(c.name)}</div>
                  <div className="text-[12px] text-mute">
                    <bdi dir="ltr">{c.handle}</bdi> · <span className="num">{c.members.toLocaleString('en-US')}</span>{' '}
                    {L('مشترك', 'subscribers')}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-drop-soft px-2 py-0.5 text-[12px] font-semibold text-drop">
                  <span className="size-1.5 rounded-full bg-drop" /> {L('متصل', 'Connected')}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <ChStat label={L('اتنشر النهارده', 'Posted today')} value={String(count)} />
                <ChStat label={L('آخر نشر', 'Last post')} value={last ? clock(last.at) : '—'} sub={last ? agoAt(t, last.at) : ''} />
                {ch === 'general' ? (
                  <ChStat
                    label={L('مستني الـ 5 دقائق', 'In 5-min delay')}
                    value={String(waiting.length)}
                    sub={
                      nextGeneral
                        ? `${L('الجاي بعد', 'next in')} ${mm(nextGeneral.general.scheduledAt - t)}`
                        : L('مفيش', 'None')
                    }
                  />
                ) : (
                  <ChStat
                    label={L('العتبة', 'Threshold')}
                    value={`+${PRIORITY_THRESHOLD}%`}
                    sub={L('أو نزول استثنائي', 'or exceptional drop')}
                  />
                )}
              </div>
              {last && (
                <div className="mt-3 truncate rounded-lg bg-canvas/70 px-3 py-2 text-[12px] text-body">
                  {L('آخر رسالة:', 'Last message:')} <b className="text-ink">{tx(last.p.name)}</b>
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* filters */}
      <section className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center">
        <div className="-mx-4 flex flex-1 gap-2 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:px-0">
          {(
            [
              ['all', L('كل العروض', 'All offers'), visible.length],
              ['priority', L('اتبعتت للأولوية', 'Sent to priority'), visible.filter((p) => p.priority).length],
              ['general', L('العامة بس', 'General only'), visible.filter((p) => !p.priority).length],
              ['waiting', L('مستنية القناة العامة', 'Waiting for general'), waiting.length],
              ['issues', L('فشل أو اتلغى', 'Failed or cancelled'), visible.filter((p) => hasIssue(p) || st(p).ge.k === 'cancelled').length],
            ] as [Filter, string, number][]
          ).map(([k, l, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cx(
                'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold',
                filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white',
                k === 'issues' && n > 0 && filter !== k && 'text-fail',
              )}
            >
              {l}
              <span className={cx('num text-[11.5px]', filter === k ? 'text-white/60' : 'text-mute')}>{n}</span>
            </button>
          ))}
        </div>
        <label className="relative @3xl:w-64">
          <span className="sr-only">{L('بحث', 'Search')}</span>
          <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L('دوّر على عرض…', 'Search offers…')}
            className="h-9 w-full rounded-lg border border-line bg-white ps-9 pe-3 text-[13px] outline-none focus:border-ink"
          />
        </label>
      </section>

      {issues > 0 && filter === 'all' && (
        <div className="flex items-center gap-2 rounded-xl bg-fail-soft px-3.5 py-2.5 text-[12.5px] text-fail">
          <AlertOctagon className="size-4 shrink-0" />
          <span>
            <span className="num font-bold">{issues}</span>{' '}
            {L('رسالة فيها مشكلة في الإرسال — النظام بيعيد المحاولة تلقائيًا.', 'messages had send problems — retrying automatically.')}
          </span>
        </div>
      )}

      {/* log */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1.1fr_1.1fr_28px] gap-3 border-b border-line bg-canvas/70 px-4 py-2.5 text-[12px] font-semibold text-body @4xl:grid">
          <span>{L('العرض', 'Offer')}</span>
          <span>{L('سبب التوجيه', 'Routing reason')}</span>
          <span className="flex items-center gap-1">
            <Zap className="size-3.5 text-pending" /> {L('قناة الأولوية', 'Priority channel')}
          </span>
          <span className="flex items-center gap-1">
            <Megaphone className="size-3.5" /> {L('القناة العامة', 'General channel')}
          </span>
          <span />
        </div>
        {list.map((p) => {
          const open = openId === p.id
          const isNew = t - p.discoveredAt < 20 * S
          return (
            <div key={p.id} className={cx('border-t border-line first:border-t-0', isNew && 'anim-fade bg-drop-soft/30')}>
              <button
                onClick={() => setOpenId(open ? null : p.id)}
                aria-expanded={open}
                className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-start hover:bg-canvas/40 @4xl:grid-cols-[minmax(0,2.2fr)_1fr_1.1fr_1.1fr_28px] @4xl:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb src={p.image} alt={tx(p.name)} className="size-11 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">{tx(p.name)}</div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-mute">
                      <bdi dir="ltr">{p.store}</bdi> · <Money n={p.price} className="text-[12px] font-semibold text-ink" /> ·
                      {L('اتلقى', 'found')} {agoAt(t, p.discoveredAt)}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cx('size-4 self-center text-mute transition @4xl:order-last', open && 'rotate-180')} />
                <div className="col-span-2 @4xl:col-span-1">
                  <Reason p={p} />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2 @4xl:contents">
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">{L('قناة الأولوية', 'Priority channel')}</div>
                    <DeliveryCell d={p.priority} t={t} compact />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">{L('القناة العامة', 'General channel')}</div>
                    <DeliveryCell d={p.general} t={t} compact />
                  </div>
                </div>
              </button>
              {open && <PostDetail p={p} t={t} />}
            </div>
          )
        })}
        {!list.length && <div className="py-12 text-center text-[13px] text-body">{L('مفيش رسايل بالفلتر ده', 'No messages match this filter')}</div>}
      </section>
    </div>
  )
}

const mm = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function Reason({ p }: { p: Post }) {
  if (p.exceptional)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-pending ring-1 ring-inset ring-pending-line">
        <Zap className="size-3.5" /> {L('استثنائي', 'Exceptional')} <span className="num">{p.discountPct}%</span>
      </span>
    )
  if (p.discountPct > PRIORITY_THRESHOLD)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-pending ring-1 ring-inset ring-pending-line">
        <Zap className="size-3.5" /> {L(`خصم ${kindLabel(p.discountKind)}`, `${p.discountKind === 'observed' ? 'Observed' : 'Advertised'} discount`)} <span className="num">{p.discountPct}%</span>
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-adv-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-adv">
      {L('عادي', 'Regular')} · {kindLabel(p.discountKind)} <span className="num">{p.discountPct}%</span>
    </span>
  )
}

function PostDetail({ p, t }: { p: Post; t: number }) {
  const steps: { label: string; at?: number; state: 'done' | 'next' | 'bad' | 'skip'; note?: string }[] = []
  steps.push({ label: L('اتلقى العرض', 'Offer found'), at: p.discoveredAt, state: 'done' })
  const push = (label: string, d: Delivery) => {
    const s = dstate(d, t)
    d.attempts
      .filter((a) => a.at <= t && !a.ok)
      .forEach((a) => steps.push({
          label: `${label} — ${L('محاولة فشلت', 'attempt failed')}`,
          at: a.at,
          state: 'bad',
          note: a.error && tx(a.error),
        }),
      )
    if (s.k === 'sent') steps.push({ label: `${L('اتنشر في', 'Posted to')} ${label}`, at: s.at, state: 'done' })
    else if (s.k === 'scheduled') steps.push({ label: `${L('هيتنشر في', 'Will post to')} ${label}`, at: s.at, state: 'next' })
    else if (s.k === 'retrying') steps.push({ label: `${L('إعادة محاولة تلقائية في', 'Auto-retry to')} ${label}`, at: s.at, state: 'next' })
    else if (s.k === 'failed') steps.push({
        label: `${L('فشل النشر في', 'Failed to post to')} ${label}`,
        state: 'bad',
        note: L('وقف بعد آخر محاولة', 'Stopped after last attempt'),
      })
    else if (s.k === 'cancelled') steps.push({ label: `${L('اتلغى النشر في', 'Cancelled post to')} ${label}`, at: s.at, state: 'skip', note: s.reason })
    else steps.push({ label: `${L('جاري الإرسال لـ', 'Sending to')} ${label}`, state: 'next' })
  }
  if (p.priority) push(L('قناة الأولوية', 'priority channel'), p.priority)
  push(L('القناة العامة', 'general channel'), p.general)
  const ge = dstate(p.general, t)

  return (
    <div className="anim-fade grid gap-4 border-t border-dashed border-line bg-canvas/40 px-4 py-4 @3xl:grid-cols-2">
      <div>
        <div className="text-[12px] font-semibold text-body">{L('مسار الرسالة', 'Message timeline')}</div>
        <ol className="mt-2 flex flex-col">
          {steps.map((s, i) => (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {i < steps.length - 1 && <span className="absolute start-[5px] top-3 h-full w-px bg-line" />}
              <span
                className={cx(
                  'relative mt-1 size-[11px] shrink-0 rounded-full border-2',
                  s.state === 'done' && 'border-drop bg-drop',
                  s.state === 'next' && 'border-pending bg-white',
                  s.state === 'bad' && 'border-fail bg-fail',
                  s.state === 'skip' && 'border-adv bg-white',
                )}
              />
              <div className="text-[12.5px] leading-5">
                <div className="font-semibold">{s.label}</div>
                <div className="text-[11.5px] text-mute">
                  {s.at !== undefined && <span className="num">{clock(s.at)}</span>}
                  {s.state === 'next' && s.at !== undefined && (
                    <>
                      {' '}
                      · {L('بعد', 'in')} <Mm ms={s.at - t} />
                    </>
                  )}
                  {s.note && <> · {s.note}</>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="flex items-center justify-between text-[12px] font-semibold text-body">
          <span>{L('نص الرسالة (معاينة)', 'Message text (preview)')}</span>
          {ge.k === 'sent' && p.general.msgId && (
            <bdi dir="ltr" className="text-[11.5px] font-normal text-mute">
              t.me/DealRadarEG/{p.general.msgId}
            </bdi>
          )}
        </div>
        <div className="mt-2 max-w-sm rounded-2xl rounded-ss-sm bg-white p-3 text-[13px] leading-6 shadow-sm ring-1 ring-line">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-tg">
            <Send className="size-3.5" /> {L('رادار العروض', 'Deal Radar')}
          </div>
          <div className="mt-1 font-bold">{tx(p.name)}</div>
          <div>
            {L('السعر دلوقتي:', 'Price now:')} <b className="num">{price(p.price)} {L('ج.م', 'EGP')}</b>
          </div>
          <div className="text-body">
            {p.discountKind === 'observed' ? L('نزول مرصود', 'Observed drop') : L('خصم معلن', 'Advertised discount')}{' '}
            <span className="num">{p.discountPct}%</span> — {L('كان', 'was')} <span className="num">{price(p.was)}</span>{' '}
            {L('ج.م', 'EGP')}
          </div>
          {p.exceptional && <div className="text-pending">{L('نزول استثنائي — قيد التحقق', 'Exceptional drop — verifying')}</div>}
          <div className="text-[12px] text-mute">
            {L('اتفحص', 'Checked')} {clock(p.discoveredAt)} · <bdi dir="ltr">{p.store}</bdi>
          </div>
          <div className="mt-1 text-[12.5px] font-semibold text-tg underline underline-offset-2">{L('افتح العرض', 'Open offer')}</div>
        </div>
      </div>
    </div>
  )
}

function ChStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-canvas/80 p-2.5">
      <div className="text-[11px] text-body">{label}</div>
      <div className="num mt-0.5 truncate text-[17px] font-bold">
        <bdi>{value}</bdi>
      </div>
      {sub !== undefined && <div className="truncate text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

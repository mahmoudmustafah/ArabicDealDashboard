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

// SAMPLE DATA — simulated automatic Telegram posts. Nothing here is published by hand.
const S = 1000
const M = 60 * S
export const GENERAL_DELAY = 5 * M
export const PRIORITY_THRESHOLD = 50

type Store = 'Amazon Egypt' | 'Noon Egypt' | 'Emarati Scents'
type Attempt = { at: number; ok: boolean; error?: string }
type Delivery = { scheduledAt: number; attempts: Attempt[]; cancelledAt?: number; cancelReason?: string; msgId?: number }
type Post = {
  id: string
  name: string
  store: Store
  image?: string
  price: number
  was: number
  discountPct: number
  discountKind: 'معلن' | 'مرصود'
  exceptional?: boolean
  discoveredAt: number
  priority?: Delivery
  general: Delivery
}

const channels = {
  priority: { name: 'رادار العروض — أولوية', handle: '@DealRadarPriority', members: 2140 },
  general: { name: 'رادار العروض', handle: '@DealRadarEG', members: 18630 },
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
  { id: 'p13', name: 'سماعة سوني WH-CH720N لاسلكية', store: 'Noon Egypt', price: 2899, was: 6299, discountPct: 54, discountKind: 'معلن', discoveredAt: NOW + 1.5 * M },
  { id: 'p14', name: 'كيبورد ريدراجون K552', store: 'Amazon Egypt', image: img('redragon-k552'), price: 1149, was: 1299, discountPct: 12, discountKind: 'مرصود', discoveredAt: NOW + 4 * M },
  // within the 5-minute delay
  { id: 'p1', name: 'عود ملكي — 100 مل', store: 'Emarati Scents', price: 1350, was: 3400, discountPct: 60, discountKind: 'معلن', discoveredAt: NOW - 0.6 * M },
  {
    id: 'p2',
    name: 'شاشة شاومي A27i مقاس 27″',
    store: 'Amazon Egypt',
    image: img('xiaomi-a27i'),
    price: 2999,
    was: 5999,
    discountPct: 50,
    discountKind: 'مرصود',
    exceptional: true,
    discoveredAt: NOW - 2.2 * M,
  },
  {
    id: 'p3',
    name: 'كيبورد لوجيتك MX Keys S',
    store: 'Amazon Egypt',
    image: img('mx-keys-s'),
    price: 4799,
    was: 5299,
    discountPct: 9,
    discountKind: 'مرصود',
    discoveredAt: NOW - 3 * M,
    override: {
      general: {
        scheduledAt: NOW - 3 * M,
        attempts: [
          { at: NOW - 3 * M + 5 * S, ok: false, error: 'تليجرام طلب تهدئة الإرسال (429)' },
          { at: NOW + 0.8 * M, ok: true },
        ],
      },
    },
  },
  // completed
  { id: 'p4', name: 'سامسونج جالاكسي A55 — 256 جيجا', store: 'Noon Egypt', price: 9499, was: 20999, discountPct: 55, discountKind: 'معلن', discoveredAt: NOW - 7 * M },
  { id: 'p5', name: 'شاشة سامسونج أوديسي G5 مقاس 27″', store: 'Amazon Egypt', image: img('odyssey-g5'), price: 11999, was: 14999, discountPct: 20, discountKind: 'مرصود', discoveredAt: NOW - 15 * M },
  { id: 'p6', name: 'تلفزيون LG ‏55 بوصة 4K UHD', store: 'Noon Egypt', price: 15999, was: 20499, discountPct: 22, discountKind: 'مرصود', discoveredAt: NOW - 22 * M },
  {
    id: 'p7',
    name: 'تلفزيون شاومي A Pro ‏43 بوصة',
    store: 'Noon Egypt',
    price: 4499,
    was: 8999,
    discountPct: 50,
    discountKind: 'مرصود',
    exceptional: true,
    discoveredAt: NOW - 27 * M,
    override: {
      general: {
        cancelledAt: NOW - 24 * M,
        cancelReason: 'السعر رجع 8,999 ج.م قبل ميعاد القناة العامة — اتلغى النشر',
        attempts: [],
      },
    },
  },
  {
    id: 'p8',
    name: 'سماعة JBL Tune 520BT',
    store: 'Amazon Egypt',
    image: img('jbl-tune-520'),
    price: 1899,
    was: 2199,
    discountPct: 14,
    discountKind: 'مرصود',
    discoveredAt: NOW - 34 * M,
    override: {
      general: {
        attempts: [
          { at: NOW - 34 * M + 5 * S, ok: false, error: 'تليجرام طلب تهدئة الإرسال (429)' },
          { at: NOW - 33 * M, ok: true },
        ],
      },
    },
  },
  { id: 'p9', name: 'طقم بخور إماراتي فاخر', store: 'Emarati Scents', price: 780, was: 1200, discountPct: 35, discountKind: 'معلن', discoveredAt: NOW - 41 * M },
  { id: 'p10', name: 'شاشة هواوي MateView SE ‏23.8″', store: 'Amazon Egypt', image: img('huawei-mateview-se'), price: 3099, was: 5999, discountPct: 48, discountKind: 'معلن', discoveredAt: NOW - 55 * M },
  { id: 'p11', name: 'آيفون 15 — 128 جيجا', store: 'Noon Egypt', price: 32999, was: 55999, discountPct: 41, discountKind: 'مرصود', exceptional: true, discoveredAt: NOW - 68 * M },
  {
    id: 'p12',
    name: 'سيروم فيتامين سي 30 مل',
    store: 'Noon Egypt',
    price: 499,
    was: 715,
    discountPct: 30,
    discountKind: 'معلن',
    discoveredAt: NOW - 80 * M,
    override: {
      general: {
        attempts: [
          { at: NOW - 80 * M + 5 * S, ok: false, error: 'انتهت مهلة الاتصال بتليجرام' },
          { at: NOW - 79 * M, ok: false, error: 'انتهت مهلة الاتصال بتليجرام' },
          { at: NOW - 77 * M, ok: false, error: 'انتهت مهلة الاتصال بتليجرام' },
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
  if (d.cancelledAt !== undefined && t >= d.cancelledAt) return { k: 'cancelled', reason: d.cancelReason, at: d.cancelledAt }
  if (t < d.scheduledAt) return { k: 'scheduled', at: d.scheduledAt }
  const done = d.attempts.filter((a) => a.at <= t)
  const last = done[done.length - 1]
  if (!last) return d.attempts.length ? { k: 'sending' } : { k: 'scheduled', at: d.cancelledAt ?? d.scheduledAt }
  if (last.ok) return { k: 'sent', at: last.at, retried: done.length > 1 }
  const next = d.attempts.find((a) => a.at > t)
  return next ? { k: 'retrying', at: next.at, error: last.error } : { k: 'failed', error: last.error, tries: done.length }
}

function DeliveryCell({ d, t, compact }: { d?: Delivery; t: number; compact?: boolean }) {
  if (!d)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-mute">
        — مش مطلوب
      </span>
    )
  const s = dstate(d, t)
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap'
  return (
    <div className="flex flex-col items-start gap-0.5">
      {s.k === 'sent' && (
        <>
          <span className={cx(pill, 'bg-drop-soft text-drop')}>
            <CheckCheck className="size-3.5" /> اتنشر
          </span>
          <span className="num text-[11.5px] text-mute">
            {clock(s.at)}
            {s.retried && ' · بعد إعادة محاولة'}
          </span>
        </>
      )}
      {s.k === 'scheduled' && (
        <>
          <span className={cx(pill, 'bg-pending-soft text-pending')}>
            <Clock className="size-3.5" /> هيتنشر بعد <Mm ms={s.at - t} />
          </span>
          {!compact && <span className="num text-[11.5px] text-mute">الساعة {clock(s.at)}</span>}
        </>
      )}
      {s.k === 'sending' && (
        <span className={cx(pill, 'bg-ink text-white')}>
          <Loader2 className="size-3.5 animate-spin" /> جاري الإرسال
        </span>
      )}
      {s.k === 'retrying' && (
        <>
          <span className={cx(pill, 'bg-fail-soft text-fail')}>
            <RotateCw className="size-3.5" /> إعادة تلقائية بعد <Mm ms={s.at - t} />
          </span>
          {!compact && <span className="text-[11.5px] text-mute">{s.error}</span>}
        </>
      )}
      {s.k === 'failed' && (
        <>
          <span className={cx(pill, 'bg-fail text-white')}>
            <AlertOctagon className="size-3.5" /> فشل
          </span>
          {!compact && (
            <span className="text-[11.5px] text-mute">
              <span className="num">{s.tries}</span> محاولات · {s.error}
            </span>
          )}
        </>
      )}
      {s.k === 'cancelled' && (
        <>
          <span className={cx(pill, 'bg-adv-soft text-adv')}>
            <Ban className="size-3.5" /> اتلغى
          </span>
          {!compact && <span className="text-[11.5px] text-mute">السعر رجع قبل الميعاد</span>}
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
    if (q && !p.name.includes(q.trim())) return false
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
          النشر تلقائي · الساعة <b className="num text-ink">{clock(t)}</b>
          <span className="hidden text-mute @xl:inline">· الصفحة دي للمتابعة بس، مفيش نشر يدوي</span>
        </div>
        <div className="flex items-center gap-2">
          <SpeedControl speed={speed} setSpeed={setSpeed} />
          <SampleTag />
        </div>
      </div>

      {/* routing rules */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="text-[14px] font-bold">قواعد النشر التلقائي</h3>
        <div className="mt-3 grid gap-3 @3xl:grid-cols-[1fr_auto_1.6fr]">
          <div className="rounded-xl bg-canvas p-3 text-[12.5px] leading-5">
            <div className="font-semibold">عرض جديد اتلقى</div>
            <div className="text-body">
              هل الخصم أكبر من <span className="num">{PRIORITY_THRESHOLD}%</span> أو النزول استثنائي؟
            </div>
          </div>
          <ArrowLeft className="hidden size-4 self-center text-mute @3xl:block" />
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pending-line bg-pending-soft/60 p-2.5 text-[12.5px]">
              <span className="rounded bg-white px-1.5 font-semibold text-pending">أيوه</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Zap className="size-3.5 text-pending" /> قناة الأولوية فورًا
              </span>
              <ArrowLeft className="size-3.5 text-mute" />
              <span className="text-body">
                بعد <span className="num">5</span> دقائق
              </span>
              <ArrowLeft className="size-3.5 text-mute" />
              <span className="inline-flex items-center gap-1 font-semibold">
                <Megaphone className="size-3.5" /> القناة العامة
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-[12.5px]">
              <span className="rounded bg-canvas px-1.5 font-semibold text-body">لأ</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Megaphone className="size-3.5" /> القناة العامة على طول
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-5 text-mute">
          لو السعر رجع خلال الـ 5 دقائق، النشر في القناة العامة بيتلغى تلقائيًا. لو الإرسال فشل، بيتعاد تلقائيًا.
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
                  <div className="truncate text-[15px] font-bold">{c.name}</div>
                  <div className="text-[12px] text-mute">
                    <bdi dir="ltr">{c.handle}</bdi> · <span className="num">{c.members.toLocaleString('en-US')}</span> مشترك
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-drop-soft px-2 py-0.5 text-[12px] font-semibold text-drop">
                  <span className="size-1.5 rounded-full bg-drop" /> متصل
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <ChStat label="اتنشر النهارده" value={String(count)} />
                <ChStat label="آخر نشر" value={last ? clock(last.at) : '—'} sub={last ? agoAt(t, last.at) : ''} />
                {ch === 'general' ? (
                  <ChStat
                    label="مستني الـ 5 دقائق"
                    value={String(waiting.length)}
                    sub={nextGeneral ? `الجاي بعد ${mm(nextGeneral.general.scheduledAt - t)}` : 'مفيش'}
                  />
                ) : (
                  <ChStat label="العتبة" value={`+${PRIORITY_THRESHOLD}%`} sub="أو نزول استثنائي" />
                )}
              </div>
              {last && (
                <div className="mt-3 truncate rounded-lg bg-canvas/70 px-3 py-2 text-[12px] text-body">
                  آخر رسالة: <b className="text-ink">{last.p.name}</b>
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
              ['all', 'كل العروض', visible.length],
              ['priority', 'اتبعتت للأولوية', visible.filter((p) => p.priority).length],
              ['general', 'العامة بس', visible.filter((p) => !p.priority).length],
              ['waiting', 'مستنية القناة العامة', waiting.length],
              ['issues', 'فشل أو اتلغى', visible.filter((p) => hasIssue(p) || st(p).ge.k === 'cancelled').length],
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
          <span className="sr-only">بحث</span>
          <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="دوّر على عرض…"
            className="h-9 w-full rounded-lg border border-line bg-white ps-9 pe-3 text-[13px] outline-none focus:border-ink"
          />
        </label>
      </section>

      {issues > 0 && filter === 'all' && (
        <div className="flex items-center gap-2 rounded-xl bg-fail-soft px-3.5 py-2.5 text-[12.5px] text-fail">
          <AlertOctagon className="size-4 shrink-0" />
          <span>
            <span className="num font-bold">{issues}</span> رسالة فيها مشكلة في الإرسال — النظام بيعيد المحاولة تلقائيًا.
          </span>
        </div>
      )}

      {/* log */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1.1fr_1.1fr_28px] gap-3 border-b border-line bg-canvas/70 px-4 py-2.5 text-[12px] font-semibold text-body @4xl:grid">
          <span>العرض</span>
          <span>سبب التوجيه</span>
          <span className="flex items-center gap-1">
            <Zap className="size-3.5 text-pending" /> قناة الأولوية
          </span>
          <span className="flex items-center gap-1">
            <Megaphone className="size-3.5" /> القناة العامة
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
                  <Thumb src={p.image} alt={p.name} className="size-11 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">{p.name}</div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-mute">
                      <bdi dir="ltr">{p.store}</bdi> · <Money n={p.price} className="text-[12px] font-semibold text-ink" /> ·
                      اتلقى {agoAt(t, p.discoveredAt)}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cx('size-4 self-center text-mute transition @4xl:order-last', open && 'rotate-180')} />
                <div className="col-span-2 @4xl:col-span-1">
                  <Reason p={p} />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2 @4xl:contents">
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">قناة الأولوية</div>
                    <DeliveryCell d={p.priority} t={t} compact />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">القناة العامة</div>
                    <DeliveryCell d={p.general} t={t} compact />
                  </div>
                </div>
              </button>
              {open && <PostDetail p={p} t={t} />}
            </div>
          )
        })}
        {!list.length && <div className="py-12 text-center text-[13px] text-body">مفيش رسايل بالفلتر ده</div>}
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
        <Zap className="size-3.5" /> استثنائي <span className="num">{p.discountPct}%</span>
      </span>
    )
  if (p.discountPct > PRIORITY_THRESHOLD)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-pending ring-1 ring-inset ring-pending-line">
        <Zap className="size-3.5" /> خصم {p.discountKind} <span className="num">{p.discountPct}%</span>
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-adv-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-adv">
      عادي · {p.discountKind} <span className="num">{p.discountPct}%</span>
    </span>
  )
}

function PostDetail({ p, t }: { p: Post; t: number }) {
  const steps: { label: string; at?: number; state: 'done' | 'next' | 'bad' | 'skip'; note?: string }[] = []
  steps.push({ label: 'اتلقى العرض', at: p.discoveredAt, state: 'done' })
  const push = (label: string, d: Delivery) => {
    const s = dstate(d, t)
    d.attempts
      .filter((a) => a.at <= t && !a.ok)
      .forEach((a) => steps.push({ label: `${label} — محاولة فشلت`, at: a.at, state: 'bad', note: a.error }))
    if (s.k === 'sent') steps.push({ label: `اتنشر في ${label}`, at: s.at, state: 'done' })
    else if (s.k === 'scheduled') steps.push({ label: `هيتنشر في ${label}`, at: s.at, state: 'next' })
    else if (s.k === 'retrying') steps.push({ label: `إعادة محاولة تلقائية في ${label}`, at: s.at, state: 'next' })
    else if (s.k === 'failed') steps.push({ label: `فشل النشر في ${label}`, state: 'bad', note: 'وقف بعد آخر محاولة' })
    else if (s.k === 'cancelled') steps.push({ label: `اتلغى النشر في ${label}`, at: s.at, state: 'skip', note: s.reason })
    else steps.push({ label: `جاري الإرسال لـ ${label}`, state: 'next' })
  }
  if (p.priority) push('قناة الأولوية', p.priority)
  push('القناة العامة', p.general)
  const ge = dstate(p.general, t)

  return (
    <div className="anim-fade grid gap-4 border-t border-dashed border-line bg-canvas/40 px-4 py-4 @3xl:grid-cols-2">
      <div>
        <div className="text-[12px] font-semibold text-body">مسار الرسالة</div>
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
                      · بعد <Mm ms={s.at - t} />
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
          <span>نص الرسالة (معاينة)</span>
          {ge.k === 'sent' && p.general.msgId && (
            <bdi dir="ltr" className="text-[11.5px] font-normal text-mute">
              t.me/DealRadarEG/{p.general.msgId}
            </bdi>
          )}
        </div>
        <div className="mt-2 max-w-sm rounded-2xl rounded-ss-sm bg-white p-3 text-[13px] leading-6 shadow-sm ring-1 ring-line">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#2a7ab0]">
            <Send className="size-3.5" /> رادار العروض
          </div>
          <div className="mt-1 font-bold">{p.name}</div>
          <div>
            السعر دلوقتي: <b className="num">{price(p.price)} ج.م</b>
          </div>
          <div className="text-body">
            {p.discountKind === 'مرصود' ? 'نزول مرصود' : 'خصم معلن'} <span className="num">{p.discountPct}%</span> — كان{' '}
            <span className="num">{price(p.was)}</span> ج.م
          </div>
          {p.exceptional && <div className="text-pending">نزول استثنائي — قيد التحقق</div>}
          <div className="text-[12px] text-mute">
            اتفحص {clock(p.discoveredAt)} · <bdi dir="ltr">{p.store}</bdi>
          </div>
          <div className="mt-1 text-[12.5px] font-semibold text-[#2a7ab0] underline underline-offset-2">افتح العرض</div>
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

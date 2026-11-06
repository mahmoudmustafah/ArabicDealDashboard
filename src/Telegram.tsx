import {
  AlertOctagon,
  ArrowLeft,
  Ban,
  CheckCheck,
  ChevronDown,
  CircleSlash,
  Clock,
  Megaphone,
  RotateCw,
  Search,
  Send,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { api, useApi, type Delivery, type Meta, type OfferView } from './api'
import { agoAt, clock, Mm, useNow } from './clock'
import { store } from './deal'
import { price } from './format'
import { ApiDown, Loading, Money, SourceChip, Thumb, cx } from './ui'
import { L } from './i18n'

const PRIORITY_THRESHOLD = 50

const channels = {
  priority: () => L('الشات الخاص — أولوية', 'Private chat — priority'),
  general: () => L('القناة العامة', 'General channel'),
}

const of = (p: OfferView, ch: Delivery['channel']) => p.deliveries.find((d) => d.channel === ch)
/** A dry run was recorded but never sent, so it must never count or display as posted. */
const reallySent = (d?: Delivery) => d?.state === 'sent' && !d.dryRun
const isDry = (d?: Delivery) => d?.state === 'sent' && d.dryRun

function DeliveryCell({ d, t, compact }: { d?: Delivery; t: number; compact?: boolean }) {
  if (!d) return <span className="inline-flex items-center gap-1 text-[12px] text-mute">— {L('مش مطلوب', 'Not required')}</span>
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap'
  const lastError = [...d.attempts].reverse().find((a) => !a.ok)?.error
  return (
    <div className="flex flex-col items-start gap-0.5">
      {reallySent(d) && (
        <>
          <span className={cx(pill, 'bg-drop-soft text-drop')}>
            <CheckCheck className="size-3.5" /> {L('اتنشر', 'Posted')}
          </span>
          {d.sentAt && (
            <span className="num text-[11.5px] text-mute">
              {clock(d.sentAt)}
              {d.attempts.filter((a) => !a.recheck).length > 1 && L(' · بعد إعادة محاولة', ' · after retry')}
            </span>
          )}
        </>
      )}
      {isDry(d) && (
        <>
          <span className={cx(pill, 'border border-dashed border-line-strong bg-white text-body')}>
            <CircleSlash className="size-3.5" /> {L('ما اتبعتش (تجربة)', 'Not sent (dry run)')}
          </span>
          {!compact && <span className="text-[11.5px] text-mute">{L('الوجهة دي مش متوصلة وقت الإرسال', 'This destination was not connected at the time')}</span>}
        </>
      )}
      {d.state === 'scheduled' && (
        <>
          <span className={cx(pill, 'bg-pending-soft text-pending')}>
            <Clock className="size-3.5" />
            {d.scheduledAt > t ? (
              <>
                {L('هيتنشر بعد', 'Posts in')} <Mm ms={d.scheduledAt - t} />
              </>
            ) : (
              L('مستني دوره', 'Waiting its turn')
            )}
          </span>
          {!compact && d.scheduledAt > t && (
            <span className="num text-[11.5px] text-mute">
              {L('الساعة', 'at')} {clock(d.scheduledAt)}
            </span>
          )}
        </>
      )}
      {d.state === 'retrying' && (
        <>
          <span className={cx(pill, 'bg-fail-soft text-fail')}>
            <RotateCw className="size-3.5" /> {L('إعادة تلقائية', 'Auto-retry')}
            {d.nextAttemptAt && d.nextAttemptAt > t && (
              <>
                {' '}
                {L('بعد', 'in')} <Mm ms={d.nextAttemptAt - t} />
              </>
            )}
          </span>
          {!compact && lastError && <span className="text-[11.5px] text-mute">{lastError}</span>}
        </>
      )}
      {d.state === 'failed' && (
        <>
          <span className={cx(pill, 'bg-fail text-white')}>
            <AlertOctagon className="size-3.5" /> {L('فشل', 'Failed')}
          </span>
          {!compact && (
            <span className="text-[11.5px] text-mute">
              <span className="num">{d.attempts.length}</span> {L('محاولات', 'attempts')}
              {lastError && ` · ${lastError}`}
            </span>
          )}
        </>
      )}
      {d.state === 'cancelled' && (
        <>
          <span className={cx(pill, 'bg-adv-soft text-adv')}>
            <Ban className="size-3.5" /> {L('اتلغى', 'Cancelled')}
          </span>
          {!compact && d.cancelReason && <span className="text-[11.5px] text-mute">{d.cancelReason}</span>}
        </>
      )}
    </div>
  )
}

type Filter = 'all' | 'priority' | 'general' | 'waiting' | 'dry' | 'issues'

export function Telegram({ info, openProduct }: { info?: Meta; openProduct: (id: number) => void }) {
  const q0 = useApi(() => api.posts(200), 15_000)
  const t = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  if (!q0.data) return q0.error ? <ApiDown onRetry={q0.reload} /> : <Loading />

  const visible = q0.data
  const isWaiting = (p: OfferView) => p.deliveries.some((d) => d.state === 'scheduled')
  const hasIssue = (p: OfferView) => p.deliveries.some((d) => d.state === 'retrying' || d.state === 'failed')
  const isCancelled = (p: OfferView) => p.deliveries.some((d) => d.state === 'cancelled')
  const anyDry = (p: OfferView) => p.deliveries.some(isDry)
  const text = q.trim().toLowerCase()
  const list = visible.filter((p) => {
    if (text && !(p.name ?? '').toLowerCase().includes(text)) return false
    if (filter === 'priority') return !!of(p, 'priority')
    if (filter === 'general') return !of(p, 'priority')
    if (filter === 'waiting') return isWaiting(p)
    if (filter === 'dry') return anyDry(p)
    if (filter === 'issues') return hasIssue(p) || isCancelled(p)
    return true
  })
  const sentTo = (ch: Delivery['channel']) =>
    visible
      .filter((p) => reallySent(of(p, ch)))
      .map((p) => ({ p, at: of(p, ch)!.sentAt ?? 0 }))
      .sort((a, b) => b.at - a.at)
  const waiting = visible.filter(isWaiting)
  const issues = visible.filter(hasIssue).length

  return (
    <div className="flex flex-col gap-5">
      {q0.error && <ApiDown compact onRetry={q0.reload} />}
      <div className="flex items-center gap-2 text-[13px] text-body">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-drop opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-drop" />
        </span>
        {L('النشر تلقائي · الساعة', 'Automatic posting ·')} <b className="num text-ink">{clock(t)}</b>
        <span className="hidden text-mute @xl:inline">{L('· الصفحة دي للمتابعة بس، مفيش نشر يدوي', '· this page is for tracking only — no manual posting')}</span>
      </div>

      {/* routing rules */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="text-[14px] font-bold">{L('قواعد النشر التلقائي', 'Automatic posting rules')}</h3>
        <div className="mt-3 grid gap-3 @3xl:grid-cols-[1fr_auto_1.6fr]">
          <div className="rounded-xl bg-canvas p-3 text-[12.5px] leading-5">
            <div className="font-semibold">{L('عرض جديد اتلقى', 'New offer found')}</div>
            <div className="text-body">
              {L('هل الخصم', 'Is the discount')} <span className="num">{PRIORITY_THRESHOLD}%</span> {L('أو أكتر', 'or more')}{' '}
              {L('أو النزول استثنائي؟', 'or the drop exceptional?')}
            </div>
          </div>
          <ArrowLeft className="hidden size-4 self-center text-mute ltr:rotate-180 @3xl:block" />
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pending-line bg-pending-soft/60 p-2.5 text-[12.5px]">
              <span className="rounded bg-white px-1.5 font-semibold text-pending">{L('أيوه', 'Yes')}</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Zap className="size-3.5 text-pending" /> {L('الشات الخاص فورًا', 'Private priority chat immediately')}
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
          const sent = sentTo(ch)
          const last = sent[0]
          const dry = visible.filter((p) => isDry(of(p, ch))).length
          const connected = info?.telegram[ch]
          return (
            <div key={ch} className={cx('rounded-2xl border bg-white p-4', ch === 'priority' ? 'border-pending-line' : 'border-line')}>
              <div className="flex items-center gap-3">
                <div className={cx('grid size-10 place-items-center rounded-xl', ch === 'priority' ? 'bg-pending-soft text-pending' : 'bg-canvas text-ink')}>
                  {ch === 'priority' ? <Zap className="size-5" /> : <Megaphone className="size-5" />}
                </div>
                <div className="min-w-0 flex-1 truncate text-[15px] font-bold">{channels[ch]()}</div>
                {connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-drop-soft px-2 py-0.5 text-[12px] font-semibold text-drop">
                    <span className="size-1.5 rounded-full bg-drop" /> {L('متصل', 'Connected')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[12px] font-semibold text-body">
                    <CircleSlash className="size-3.5" /> {L('مش متصل — تجربة بس', 'Not connected — dry run only')}
                  </span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <ChStat label={L('اتنشر فعلًا', 'Actually posted')} value={String(sent.length)} sub={L(`من آخر ${visible.length} عرض`, `of the last ${visible.length} offers`)} />
                <ChStat label={L('آخر نشر', 'Last post')} value={last ? clock(last.at) : '—'} sub={last ? agoAt(t, last.at) : ''} />
                <ChStat label={L('ما اتبعتش (تجربة)', 'Not sent (dry run)')} value={String(dry)} sub={L('مش محسوبة كنشر', 'Not counted as posted')} />
              </div>
              {last && (
                <div className="mt-3 truncate rounded-lg bg-canvas/70 px-3 py-2 text-[12px] text-body">
                  {L('آخر رسالة:', 'Last message:')} <b className="text-ink">{last.p.name}</b>
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
              ['priority', L('أولوية', 'Priority'), visible.filter((p) => of(p, 'priority')).length],
              ['general', L('العامة بس', 'General only'), visible.filter((p) => !of(p, 'priority')).length],
              ['waiting', L('مستنية', 'Waiting'), waiting.length],
              ['dry', L('تجربة', 'Dry run'), visible.filter(anyDry).length],
              ['issues', L('فشل أو اتلغى', 'Failed or cancelled'), visible.filter((p) => hasIssue(p) || isCancelled(p)).length],
            ] as [Filter, string, number][]
          ).map(([k, l, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cx('flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold', filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white', k === 'issues' && n > 0 && filter !== k && 'text-fail')}
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
            <span className="num font-bold">{issues}</span> {L('رسالة فيها مشكلة في الإرسال.', 'messages have send problems.')}
          </span>
        </div>
      )}

      {/* log */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1.1fr_1.1fr_28px] gap-3 border-b border-line bg-canvas/70 px-4 py-2.5 text-[12px] font-semibold text-body @4xl:grid">
          <span>{L('العرض', 'Offer')}</span>
          <span>{L('سبب التوجيه', 'Routing reason')}</span>
          <span className="flex items-center gap-1">
            <Zap className="size-3.5 text-pending" /> {L('الأولوية', 'Priority')}
          </span>
          <span className="flex items-center gap-1">
            <Megaphone className="size-3.5" /> {L('القناة العامة', 'General channel')}
          </span>
          <span />
        </div>
        {list.map((p) => {
          const open = openId === p.id
          return (
            <div key={p.id} className="border-t border-line first:border-t-0">
              <button
                onClick={() => setOpenId(open ? null : p.id)}
                aria-expanded={open}
                className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-start hover:bg-canvas/40 @4xl:grid-cols-[minmax(0,2.2fr)_1fr_1.1fr_1.1fr_28px] @4xl:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb src={p.image} alt={p.name ?? ''} className="size-11 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-mute">
                      {p.source && <SourceChip id={p.source} />} <Money n={p.price} className="text-[12px] font-semibold text-ink" /> · {L('اتلقى', 'found')} {agoAt(t, p.detectedAt)}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cx('size-4 self-center text-mute transition @4xl:order-last', open && 'rotate-180')} />
                <div className="col-span-2 @4xl:col-span-1">
                  <Reason p={p} />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2 @4xl:contents">
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">{L('الأولوية', 'Priority')}</div>
                    <DeliveryCell d={of(p, 'priority')} t={t} compact />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-mute @4xl:hidden">{L('القناة العامة', 'General channel')}</div>
                    <DeliveryCell d={of(p, 'general')} t={t} compact />
                  </div>
                </div>
              </button>
              {open && <PostDetail p={p} t={t} openProduct={openProduct} />}
            </div>
          )
        })}
        {!list.length && (
          <div className="py-12 text-center text-[13px] text-body">
            {visible.length ? L('مفيش رسايل بالفلتر ده', 'No messages match this filter') : L('لسه مفيش عروض مؤهلة للنشر', 'No offers have qualified for posting yet')}
          </div>
        )}
      </section>
    </div>
  )
}

const basisLabel = (p: OfferView) => (p.basis === 'observed' ? L('مرصود', 'observed') : p.basis === 'below_usual' ? L('أقل من المعتاد', 'below usual') : L('معلن', 'advertised'))

function Reason({ p }: { p: OfferView }) {
  const pct = <span className="num">{Math.round(p.pct)}%</span>
  if (p.labels.includes('exceptional'))
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-pending ring-1 ring-inset ring-pending-line">
        <Zap className="size-3.5" /> {L('استثنائي', 'Exceptional')} {pct}
      </span>
    )
  if (p.priority)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pending-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-pending ring-1 ring-inset ring-pending-line">
        <Zap className="size-3.5" /> {L('خصم', 'Discount')} {basisLabel(p)} {pct}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-adv-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-adv">
      {L('عادي', 'Regular')} · {basisLabel(p)} {pct}
    </span>
  )
}

function PostDetail({ p, t, openProduct }: { p: OfferView; t: number; openProduct: (id: number) => void }) {
  return (
    <div className="anim-fade grid gap-4 border-t border-dashed border-line bg-canvas/40 px-4 py-4 @3xl:grid-cols-2">
      <div>
        <div className="text-[12px] font-semibold text-body">{L('مسار الرسالة', 'Message timeline')}</div>
        <ol className="mt-2 flex flex-col gap-2.5 text-[12.5px] leading-5">
          <li>
            <b>{L('اتلقى العرض', 'Offer found')}</b> <span className="num text-[11.5px] text-mute">{clock(p.detectedAt)}</span>
          </li>
          {p.deliveries.map((d) => (
            <li key={d.channel}>
              <div className="mb-1 font-semibold">{channels[d.channel]()}</div>
              <DeliveryCell d={d} t={t} />
              {d.attempts.filter((a) => !a.ok).map((a, i) => (
                <div key={i} className="mt-1 text-[11.5px] text-mute">
                  <span className="num">{clock(a.at)}</span> · {a.error}
                </div>
              ))}
            </li>
          ))}
        </ol>
        <div className="mt-3 text-[11.5px] text-mute" dir="ltr">{p.reason}</div>
      </div>
      <div>
        <div className="text-[12px] font-semibold text-body">{L('ملخص العرض', 'Offer summary')}</div>
        <div className="mt-2 max-w-sm rounded-2xl rounded-ss-sm bg-white p-3 text-[13px] leading-6 shadow-sm ring-1 ring-line">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-tg">
            <Send className="size-3.5" /> {L('رادار العروض', 'Deal Radar')}
          </div>
          <div className="mt-1 font-bold">{p.name}</div>
          <div>
            {L('السعر:', 'Price:')} <b className="num">{price(p.price)} {L('ج.م', 'EGP')}</b>
          </div>
          <div className="text-body">
            {basisLabel(p)} <span className="num">{Math.round(p.pct)}%</span>
            {p.refPrice !== null && (
              <>
                {' '}
                — {L('المرجع', 'reference')} <span className="num">{price(p.refPrice)}</span> {L('ج.م', 'EGP')}
              </>
            )}
          </div>
          {p.labels.includes('exceptional') && <div className="text-pending">{L('نزول استثنائي — قيد التحقق', 'Exceptional drop — verifying')}</div>}
          {p.source && <div className="text-[12px] text-mute" dir="ltr">{store(p.source).label}</div>}
          <button onClick={() => openProduct(p.productId)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-tg underline underline-offset-2">
            {L('افتح تفاصيل المنتج', 'Open product details')} <ArrowLeft className="size-3.5 ltr:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ChStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-canvas/80 p-2.5">
      <div className="truncate text-[11px] text-body">{label}</div>
      <div className="num mt-0.5 truncate text-[17px] font-bold">
        <bdi>{value}</bdi>
      </div>
      {sub !== undefined && <div className="truncate text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

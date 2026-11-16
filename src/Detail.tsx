import { AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, Clock, ExternalLink, Info, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, useApi, type Obs, type ProductDetail } from './api'
import { EXCEPTIONAL_PCT, MIN_OBS, MIN_SPAN_DAYS, statuses, store, toItem } from './deal'
import { ago, DAY, date, dateTime, days, readings } from './format'
import { isAr, L } from './i18n'
import { PriceChart } from './PriceChart'
import { ApiDown, Loading, Money, Pct, SourceChip, StaleBadge, StatusBadge, Thumb, cx } from './ui'

type Props = { id: number; saved: boolean; onToggleSave: () => void; onClose: () => void }

/** Daily summaries for older days, then every reading from the last 7 days. */
function chartHistory(d: ProductDetail): Obs[] {
  const firstRecent = d.recent[0]?.t ?? Infinity
  return [...d.daily.filter((x) => x.t < firstRecent).map(({ t, price }) => ({ t, price })), ...d.recent]
}

export function Detail({ id, saved, onToggleSave, onClose }: Props) {
  const q = useApi(() => api.product(id), 60_000, id)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <aside
      className="anim-panel fixed inset-0 z-40 flex flex-col bg-white lg:inset-y-0 lg:start-auto lg:end-0 lg:w-[540px] lg:border-s lg:border-line lg:shadow-[0_0_60px_-24px_rgba(0,0,0,0.45)]"
      aria-label={L('تفاصيل العرض', 'Offer details')}
      role="dialog"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 lg:px-5">
        <button onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-canvas" aria-label={L('إغلاق', 'Close')}>
          <X className="hidden size-5 lg:block" />
          <ArrowLeft className="size-5 rotate-180 lg:hidden ltr:rotate-0" />
        </button>
        <div className="text-[13px] font-semibold text-body">{L('تفاصيل العرض', 'Offer details')}</div>
      </header>
      {q.data ? (
        <Body d={q.data} saved={saved} onToggleSave={onToggleSave} />
      ) : (
        <div className="p-4">{q.error ? <ApiDown onRetry={q.reload} /> : <Loading />}</div>
      )}
    </aside>
  )
}

function Body({ d, saved, onToggleSave }: { d: ProductDetail; saved: boolean; onToggleSave: () => void }) {
  const p = useMemo(() => toItem(d), [d])
  const history = useMemo(() => chartHistory(d), [d])
  const a = p.a
  const st = statuses(a)
  const shop = store(p.source)
  const can90 = a.spanDays >= 60
  const can30 = a.spanDays >= 14
  const [range, setRange] = useState<30 | 90 | 0>(can90 ? 90 : can30 ? 30 : 0)
  useEffect(() => setRange(can90 ? 90 : can30 ? 30 : 0), [p.id, can90, can30])

  const first = history[0] ?? a.current
  const fromT = range ? Date.now() - range * DAY : first.t
  const visible = history.filter((o) => o.t >= fromT)
  const single = a.count <= 1 || !visible.length

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-4 p-4 lg:p-5">
          <Thumb src={p.image} alt={p.name} className="size-20 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <h2 className="text-[16px] leading-6 font-bold">{p.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
              <SourceChip id={p.source} />
              {p.brand && <span>{p.brand}</span>}
              {p.seller && (
                <span>
                  {L('البائع:', 'Seller:')} {p.seller}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {st.map((s) => (
                <StatusBadge key={s} s={s} size="md" />
              ))}
              {p.stale && <StaleBadge />}
            </div>
          </div>
        </div>

        {/* hero price + checked time */}
        <section className="mx-4 rounded-2xl bg-canvas p-4 lg:mx-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-body">{L('السعر الحالي على', 'Current price on')} <bdi dir="ltr">{shop.label}</bdi></div>
              <Money n={a.current.price} className="text-[36px] leading-[44px] font-bold tracking-tight" />
            </div>
            <div className="pb-1.5 text-end text-[12px] leading-5">
              <div className="flex items-center justify-end gap-1 text-body">
                <Clock className="size-3.5" /> {L('آخر فحص', 'Last checked')}
              </div>
              <div className={cx('font-semibold', p.stale && 'text-fail')}>{ago(p.checked)}</div>
              <div className="text-mute">{dateTime(p.checked)}</div>
            </div>
          </div>
          {p.notRefreshed && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-body">
              {L('آخر محاولة قراءة للمنتج فشلت — السعر من آخر قراءة ناجحة.', 'The latest attempt to read this product failed — the price is from the last successful reading.')}
              {p.lastFailure && <div className="mt-1 text-mute" dir="ltr">{p.lastFailure}</div>}
            </div>
          )}
          {p.available === false && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-fail">{L('المنتج ظاهر إنه مش متوفر دلوقتي.', 'This product currently shows as unavailable.')}</div>
          )}
          {p.promos.length > 0 && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-body">
              <div className="font-semibold text-ink">{L('شروط السعر', 'Price conditions')}</div>
              {p.promos.map((c) => (
                <div key={c.text}>{c.text}</div>
              ))}
            </div>
          )}
          {p.stale && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-fail">
              {L(
                'السعر ده عمره أكتر من 24 ساعة وممكن يكون اتغير. اتأكد منه على المتجر قبل الشراء.',
                'This price is over 24 hours old and may have changed. Confirm it on the store before buying.',
              )}
            </div>
          )}
        </section>

        {/* four reference metrics */}
        <section className="grid grid-cols-2 gap-px overflow-hidden border-y border-line bg-line mt-4 lg:mx-5 lg:rounded-2xl lg:border">
          <Metric
            label={L('أقل سعر مرصود', 'Lowest observed')}
            value={single ? undefined : a.lowest?.price}
            sub={single || !a.lowest ? L('محتاج أكتر من قراءة', 'Needs more than one reading') : date(a.lowest.t)}
          />
          <Metric
            label={L('السعر المرجعي المرصود', 'Observed reference price')}
            value={a.median}
            sub={
              a.median
                ? L(`وسيط ${a.medianWindowDays} يوم`, `${a.medianWindowDays}-day median`)
                : L('بيانات غير كافية', 'Not enough data')
            }
          />
          <Metric
            label={L(`السعر المرجعي المعلن (${shop.short()})`, `Advertised reference (${shop.short()})`)}
            value={p.listPrice ?? undefined}
            sub={
              p.listPrice
                ? L('السعر المشطوب على صفحة المنتج', 'Crossed-out price on the product page')
                : L('المتجر مش معلن سعر قبل الخصم', 'The store shows no pre-discount price')
            }
            strike
          />
          <div className="bg-white p-4">
            <div className="text-[12px] font-medium text-body">{L('الخصم الحقيقي مقابل الخصم على الموقع', 'Real discount vs. discount on site')}</div>
            <div className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className={cx('rounded px-1.5 font-semibold', a.exceptional ? 'bg-pending-soft text-pending' : 'bg-drop-soft text-drop')}>
                  {L('الخصم الحقيقي', 'Real discount')}
                </span>
                {(a.belowUsual ? a.belowUsualPct : a.observedDropPct) ? (
                  <Pct
                    n={(a.belowUsual ? a.belowUsualPct : a.observedDropPct)!}
                    className={cx('font-bold', a.exceptional ? 'text-pending' : 'text-drop')}
                  />
                ) : (
                  <span className="text-mute">—</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="rounded bg-adv-soft px-1.5 text-adv">{L('الخصم على الموقع', 'Discount on site')}</span>
                {a.advertisedPct ? <Pct n={a.advertisedPct} className="font-bold text-adv" /> : <span className="text-mute">—</span>}
              </div>
            </div>
          </div>
        </section>

        {/* evidence */}
        <section className="flex flex-col gap-3 p-4 lg:px-5">
          <h3 className="text-[14px] font-bold">{L('الدليل ورا العرض', 'Evidence behind the deal')}</h3>

          {a.exceptional && (
            <div className="flex gap-3 rounded-xl border border-pending-line bg-pending-soft p-3.5 text-[13px] leading-6">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-pending" />
              <div>
                <div className="font-bold text-pending">{L('نزول استثنائي — قيد التحقق', 'Exceptional drop — verifying')}</div>
                <div className="text-pending-ink">
                  {L(
                    `السعر نزل أكتر من ${EXCEPTIONAL_PCT}% مرة واحدة. هنعيد قراءة الصفحة في الفحص الجاي قبل ما نأكد الرقم — ممكن يكون عرض محدود جدًا أو خطأ في التسعير.`,
                    `The price fell more than ${EXCEPTIONAL_PCT}% at once. We'll re-read the page on the next scan before confirming — it may be a very limited offer or a pricing error.`,
                  )}
                </div>
              </div>
            </div>
          )}

          {a.prevHigher && (
            <div className="rounded-xl border border-line p-3.5">
              <div className="flex items-center gap-2">
                <StatusBadge s={a.exceptional ? 'exceptional' : 'observed_drop'} />
                <span className="text-[12px] text-body">{L('نفس المنتج اترصد قبل كده بسعر أعلى', 'Same product was seen at a higher price')}</span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div>
                  <div className="text-[11.5px] text-mute">{L('كان', 'Was')}</div>
                  <Money n={a.prevHigher.price} className="text-[18px] font-bold text-body" />
                  <div className="text-[11.5px] text-mute">{dateTime(a.prevHigher.t)}</div>
                </div>
                <ArrowLeft className="size-4 text-mute ltr:rotate-180" />
                <div>
                  <div className="text-[11.5px] text-mute">{L('بقى', 'Now')}</div>
                  <Money n={a.current.price} className={cx('text-[18px] font-bold', a.exceptional ? 'text-pending' : 'text-drop')} />
                  <div className="text-[11.5px] text-mute">
                    {L('من', 'since')} {dateTime(a.detectedAt)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {a.inflatedBeforeDrop && (
            <div className="flex gap-3 rounded-xl border border-pending-line bg-pending-soft p-3.5 text-[13px] leading-6 text-pending-ink">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-pending" />
              {L('السعر الأعلى قبل النزول ده استمر فترة قصيرة، فممكن يكون مرجع منفوخ.', 'The higher price before this drop lasted only briefly, so it may be an inflated reference.')}
            </div>
          )}

          {a.belowUsual && !a.exceptional && (
            <div className="flex gap-3 rounded-xl border border-drop/25 bg-drop-soft/60 p-3.5 text-[13px] leading-6">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-drop" />
              <div>
                <div className="font-bold text-drop">{L('أقل من المعتاد', 'Below usual')}</div>
                <div className="text-body">
                  {isAr() ? (
                    <>
                      السعر الحالي أقل بـ <Pct n={a.belowUsualPct!} className="font-semibold text-ink" /> من الوسيط المرصود (
                      <Money n={a.median!} className="font-semibold text-ink" />) خلال آخر {a.medianWindowDays} يوم — من{' '}
                      {date(Math.max(first.t, a.current.t - a.medianWindowDays! * DAY))} لحد {date(a.current.t)}.
                    </>
                  ) : (
                    <>
                      The current price is <Pct n={a.belowUsualPct!} className="font-semibold text-ink" /> below the observed
                      median (<Money n={a.median!} className="font-semibold text-ink" />) over the last {a.medianWindowDays} days —{' '}
                      {date(Math.max(first.t, a.current.t - a.medianWindowDays! * DAY))} to {date(a.current.t)}.
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {!a.sufficient && !single && (
            <div className="flex gap-3 rounded-xl border border-dashed border-line p-3.5 text-[13px] leading-6">
              <Info className="mt-0.5 size-5 shrink-0 text-body" />
              <div className="text-body">
                {isAr() ? (
                  <>
                    <b className="text-ink">بيانات غير كافية</b> للحكم إذا كان السعر أقل من المعتاد: عندنا {readings(a.count)} على
                    مدار {days(a.spanDays)} بس. بنحتاج {MIN_OBS} قراءات على الأقل خلال {MIN_SPAN_DAYS} يوم.
                  </>
                ) : (
                  <>
                    <b className="text-ink">Not enough data</b> to judge whether the price is below usual: we have{' '}
                    {readings(a.count)} over {days(a.spanDays)}. We need at least {MIN_OBS} readings across {MIN_SPAN_DAYS} days.
                  </>
                )}
              </div>
            </div>
          )}

          {!a.prevHigher && a.sufficient && (
            <div className="flex gap-3 rounded-xl border border-line p-3.5 text-[13px] leading-6">
              <Info className="mt-0.5 size-5 shrink-0 text-body" />
              <div className="text-body">
                <b className="text-ink">{L('مفيش نزول مرصود.', 'No observed drop.')}</b>{' '}
                {L('السعر ثابت تقريبًا عند', 'The price has held at about')}{' '}
                <Money n={a.current.price} className="font-semibold text-ink" /> {L('طول', 'for')} {days(a.spanDays)}
                {a.advertisedPct
                  ? L(' — الخصم الظاهر هو خصم معلن من المتجر بس.', ' — the visible discount is only the store’s advertised one.')
                  : '.'}
              </div>
            </div>
          )}
        </section>

        {/* history */}
        <section className="border-t border-line p-4 lg:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-bold">{L('سجل السعر', 'Price history')}</h3>
            {!single && (
              <div className="flex rounded-lg border border-line bg-canvas/60 p-0.5 text-[12.5px] font-semibold">
                {([30, 90] as const).map((r) => {
                  const ok = r === 30 ? can30 : can90
                  return (
                    <button
                      key={r}
                      disabled={!ok}
                      onClick={() => setRange(r)}
                      title={
                        ok
                          ? undefined
                          : L(`محتاج ${r === 30 ? 14 : 60} يوم رصد على الأقل`, `Needs at least ${r === 30 ? 14 : 60} days of tracking`)
                      }
                      className={cx(
                        'h-8 rounded-md px-3 transition disabled:cursor-not-allowed disabled:text-mute/60',
                        range === r ? 'bg-white shadow-sm ring-1 ring-line' : 'text-body',
                      )}
                    >
                      {r} {L('يوم', 'days')}
                    </button>
                  )
                })}
                {!can30 && (
                  <button className="h-8 rounded-md bg-white px-3 shadow-sm ring-1 ring-line">{L('كل القراءات', 'All readings')}</button>
                )}
              </div>
            )}
          </div>

          {single ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line-strong p-5">
              <div className="flex items-center gap-2 text-[14px] font-bold">
                <span className="size-2.5 rounded-full bg-ink" />
                {L('لسه مفيش سجل سعر كافي', 'Not enough price history yet')}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
                <div>
                  <div className="text-[11.5px] text-mute">{L('القراءة الوحيدة', 'Only reading')}</div>
                  <Money n={a.current.price} className="text-[20px] font-bold" />
                </div>
                <div className="text-end text-[12px]">
                  <div className="font-semibold">{dateTime(a.current.t)}</div>
                  <div className="text-mute">{ago(a.current.t)}</div>
                </div>
              </div>
              <p className="mt-3 text-[12.5px] leading-6 text-body">
                {L(
                  `ابتدينا نتابع المنتج ده ${ago(a.current.t)}. مش هنحكم على العرض من قراءة واحدة — تابعه وهنبلغك لما يبقى عندنا سجل كافي أو السعر يتغير.`,
                  `We started tracking this product ${ago(a.current.t)}. We won't judge a deal from a single reading — track it and we'll tell you once there's enough history or the price changes.`,
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-2 text-[12px] text-body">
                <span className="num font-semibold text-ink">{readings(visible.length)}</span> · {L('من', 'from')}{' '}
                {date(visible[0].t)} {L('لحد', 'to')}{' '}
                {date(a.current.t)} ({days((a.current.t - visible[0].t) / DAY)})
                {range !== 0 && a.spanDays > range && <span className="text-mute">
                    {' '}
                    · {L('السجل الكامل', 'full history')} {days(a.spanDays)}
                  </span>}
              </div>
              <div className="mt-3">
                <PriceChart history={history} fromT={fromT} median={a.median} lowest={a.lowest?.price} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-body">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-drop" /> {L('السعر المرصود', 'Observed price')}
                </span>
                {a.median && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 border-t border-dashed border-body" /> {L('المرجع المرصود', 'Observed reference')}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border-2 border-drop bg-white" /> {L('أقل سعر', 'Lowest')}
                </span>
                <span className="text-mute">{L('مرّر على الرسم لعرض التاريخ والسعر', 'Hover the chart for date and price')}</span>
              </div>
            </>
          )}
        </section>

        <p className="px-4 pb-6 text-[11.5px] leading-5 text-mute lg:px-5">
          {L(
            'الأرقام دي مبنية على القراءات اللي رصدناها بنفسنا من المتجر. مش بنوصف أي عرض بإنه "وهمي" على أساس مدة رصد قصيرة أو قراءة واحدة.',
            'These numbers come from readings we took ourselves from the store. We never call an offer "fake" based on a short tracking window or a single reading.',
          )}
        </p>
      </div>

      <footer className="flex gap-2 border-t border-line bg-white p-3 lg:p-4">
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-[14px] font-semibold text-white hover:bg-ink-hover"
        >
          {shop.view()} <ExternalLink className="size-4" />
        </a>
        <button
          onClick={onToggleSave}
          aria-pressed={saved}
          className={cx(
            'inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[14px] font-semibold',
            saved ? 'border-drop/30 bg-drop-soft text-drop' : 'border-line hover:bg-canvas',
          )}
        >
          {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          {saved ? L('في قائمة المتابعة', 'In watchlist') : L('أضف للمتابعة', 'Add to watchlist')}
        </button>
      </footer>
    </>
  )
}

function Metric({ label, value, sub, strike }: { label: string; value?: number; sub: string; strike?: boolean }) {
  return (
    <div className="bg-white p-4">
      <div className="text-[12px] font-medium text-body">{label}</div>
      {value ? (
        <Money n={value} strike={strike} className={cx('mt-1 text-[20px] font-bold', strike && 'text-adv')} />
      ) : (
        <div className="mt-1 text-[20px] font-bold text-mute/60">—</div>
      )}
      <div className="mt-0.5 text-[11.5px] leading-4 text-mute">{sub}</div>
    </div>
  )
}

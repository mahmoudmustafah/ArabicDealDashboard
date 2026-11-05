import { AlertTriangle, ArrowLeft, Bookmark, BookmarkCheck, Clock, ExternalLink, Info, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DAY, NOW } from './data'
import { amazonUrl, EXCEPTIONAL_PCT, MIN_OBS, MIN_SPAN_DAYS, statuses, type Enriched } from './deal'
import { ago, date, dateTime, days, readings } from './format'
import { PriceChart } from './PriceChart'
import { Money, Pct, SampleTag, StaleBadge, StatusBadge, Thumb, cx } from './ui'

type Props = { p: Enriched; saved: boolean; onToggleSave: () => void; onClose: () => void }

export function Detail({ p, saved, onToggleSave, onClose }: Props) {
  const a = p.a
  const st = statuses(a)
  const can90 = a.spanDays >= 60
  const can30 = a.spanDays >= 14
  const [range, setRange] = useState<30 | 90 | 0>(can90 ? 90 : can30 ? 30 : 0)
  useEffect(() => setRange(can90 ? 90 : can30 ? 30 : 0), [p.id, can90, can30])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const fromT = range ? NOW - range * DAY : a.first.t - DAY * 0.2
  const visible = p.history.filter((o) => o.t >= fromT)
  const single = a.count === 1

  return (
    <aside
      className="anim-panel fixed inset-0 z-40 flex flex-col bg-white lg:inset-y-0 lg:start-auto lg:end-0 lg:w-[540px] lg:border-s lg:border-line lg:shadow-[-24px_0_60px_-30px_rgba(18,22,28,0.35)]"
      aria-label="تفاصيل العرض"
      role="dialog"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 lg:px-5">
        <button onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-canvas" aria-label="إغلاق">
          <X className="hidden size-5 lg:block" />
          <ArrowLeft className="size-5 rotate-180 lg:hidden" />
        </button>
        <div className="text-[13px] font-semibold text-body">تفاصيل العرض</div>
        <div className="ms-auto">
          <SampleTag />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-4 p-4 lg:p-5">
          <Thumb src={p.image} alt={p.name} className="size-20 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <h2 className="text-[16px] leading-6 font-bold">{p.fullName}</h2>
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
              <div className="text-[12px] font-medium text-body">السعر الحالي على أمازون مصر</div>
              <Money n={a.current.price} className="text-[36px] leading-[44px] font-bold tracking-tight" />
            </div>
            <div className="pb-1.5 text-end text-[12px] leading-5">
              <div className="flex items-center justify-end gap-1 text-body">
                <Clock className="size-3.5" /> آخر فحص
              </div>
              <div className={cx('font-semibold', p.stale && 'text-fail')}>{ago(p.checkedAt)}</div>
              <div className="text-mute">{dateTime(p.checkedAt)}</div>
            </div>
          </div>
          {p.skippedLastScan && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-body">
              المنتج ده ما اتقراش في آخر فحص جزئي — السعر من آخر قراءة ناجحة.
            </div>
          )}
          {p.stale && (
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] text-fail">
              السعر ده عمره أكتر من 24 ساعة وممكن يكون اتغير. اتأكد منه على أمازون قبل الشراء.
            </div>
          )}
        </section>

        {/* four reference metrics */}
        <section className="grid grid-cols-2 gap-px overflow-hidden border-y border-line bg-line mt-4 lg:mx-5 lg:rounded-2xl lg:border">
          <Metric label="أقل سعر مرصود" value={single ? undefined : a.lowest.price} sub={single ? 'محتاج أكتر من قراءة' : date(a.lowest.t)} />
          <Metric
            label="السعر المرجعي المرصود"
            value={a.median}
            sub={a.median ? `وسيط ${a.medianWindowDays} يوم · ${readings(a.medianCount!)}` : 'بيانات غير كافية'}
          />
          <Metric
            label="السعر المرجعي المعلن (أمازون)"
            value={p.listPrice}
            sub={p.listPrice ? 'السعر المشطوب على صفحة المنتج' : 'أمازون مش معلن سعر قبل الخصم'}
            strike
          />
          <div className="bg-white p-4">
            <div className="text-[12px] font-medium text-body">الخصم: معلن مقابل مرصود</div>
            <div className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="rounded bg-adv-soft px-1.5 text-adv">خصم معلن</span>
                {a.advertisedPct ? <Pct n={a.advertisedPct} className="font-bold text-adv" /> : <span className="text-mute">—</span>}
              </div>
              <div className="flex items-center justify-between">
                <span className={cx('rounded px-1.5', a.exceptional ? 'bg-pending-soft text-pending' : 'bg-drop-soft text-drop')}>
                  {a.belowUsual ? 'تحت المعتاد' : 'نزول مرصود'}
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
            </div>
          </div>
        </section>

        {/* evidence */}
        <section className="flex flex-col gap-3 p-4 lg:px-5">
          <h3 className="text-[14px] font-bold">الدليل ورا العرض</h3>

          {a.exceptional && (
            <div className="flex gap-3 rounded-xl border border-pending-line bg-pending-soft p-3.5 text-[13px] leading-6">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-pending" />
              <div>
                <div className="font-bold text-pending">نزول استثنائي — قيد التحقق</div>
                <div className="text-[#5c3a00]">
                  السعر نزل أكتر من {EXCEPTIONAL_PCT}% مرة واحدة. هنعيد قراءة الصفحة في الفحص الجاي قبل ما نأكد الرقم — ممكن يكون
                  عرض محدود جدًا أو خطأ في التسعير.
                </div>
              </div>
            </div>
          )}

          {a.prevHigher && (
            <div className="rounded-xl border border-line p-3.5">
              <div className="flex items-center gap-2">
                <StatusBadge s={a.exceptional ? 'exceptional' : 'observed_drop'} />
                <span className="text-[12px] text-body">نفس المنتج اترصد قبل كده بسعر أعلى</span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div>
                  <div className="text-[11.5px] text-mute">كان</div>
                  <Money n={a.prevHigher.price} className="text-[18px] font-bold text-body" />
                  <div className="text-[11.5px] text-mute">{dateTime(a.prevHigher.t)}</div>
                </div>
                <ArrowLeft className="size-4 text-mute" />
                <div>
                  <div className="text-[11.5px] text-mute">بقى</div>
                  <Money n={a.current.price} className={cx('text-[18px] font-bold', a.exceptional ? 'text-pending' : 'text-drop')} />
                  <div className="text-[11.5px] text-mute">من {dateTime(a.detectedAt)}</div>
                </div>
              </div>
            </div>
          )}

          {a.belowUsual && !a.exceptional && (
            <div className="flex gap-3 rounded-xl border border-drop/25 bg-drop-soft/60 p-3.5 text-[13px] leading-6">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-drop" />
              <div>
                <div className="font-bold text-drop">أقل من المعتاد</div>
                <div className="text-body">
                  السعر الحالي أقل بـ <Pct n={a.belowUsualPct!} className="font-semibold text-ink" /> من الوسيط المرصود (
                  <Money n={a.median!} className="font-semibold text-ink" />) خلال آخر {a.medianWindowDays} يوم — من{' '}
                  {date(Math.max(a.first.t, a.current.t - a.medianWindowDays! * DAY))} لحد {date(a.current.t)}.
                </div>
              </div>
            </div>
          )}

          {!a.sufficient && !single && (
            <div className="flex gap-3 rounded-xl border border-dashed border-line p-3.5 text-[13px] leading-6">
              <Info className="mt-0.5 size-5 shrink-0 text-body" />
              <div className="text-body">
                <b className="text-ink">بيانات غير كافية</b> للحكم إذا كان السعر أقل من المعتاد: عندنا {readings(a.count)} على مدار{' '}
                {days(a.spanDays)} بس. بنحتاج {MIN_OBS} قراءات على الأقل خلال {MIN_SPAN_DAYS} يوم.
              </div>
            </div>
          )}

          {!a.prevHigher && a.sufficient && (
            <div className="flex gap-3 rounded-xl border border-line p-3.5 text-[13px] leading-6">
              <Info className="mt-0.5 size-5 shrink-0 text-body" />
              <div className="text-body">
                <b className="text-ink">مفيش نزول مرصود.</b> السعر ثابت تقريبًا عند{' '}
                <Money n={a.current.price} className="font-semibold text-ink" /> طول {days(a.spanDays)}
                {a.advertisedPct ? ' — الخصم الظاهر هو خصم معلن من أمازون بس.' : '.'}
              </div>
            </div>
          )}
        </section>

        {/* history */}
        <section className="border-t border-line p-4 lg:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-bold">سجل السعر</h3>
            {!single && (
              <div className="flex rounded-lg border border-line bg-canvas/60 p-0.5 text-[12.5px] font-semibold">
                {([30, 90] as const).map((r) => {
                  const ok = r === 30 ? can30 : can90
                  return (
                    <button
                      key={r}
                      disabled={!ok}
                      onClick={() => setRange(r)}
                      title={ok ? undefined : `محتاج ${r === 30 ? 14 : 60} يوم رصد على الأقل`}
                      className={cx(
                        'h-8 rounded-md px-3 transition disabled:cursor-not-allowed disabled:text-mute/60',
                        range === r ? 'bg-white shadow-sm ring-1 ring-line' : 'text-body',
                      )}
                    >
                      {r} يوم
                    </button>
                  )
                })}
                {!can30 && (
                  <button className="h-8 rounded-md bg-white px-3 shadow-sm ring-1 ring-line">كل القراءات</button>
                )}
              </div>
            )}
          </div>

          {single ? (
            <div className="mt-3 rounded-2xl border border-dashed border-[#c9ced5] p-5">
              <div className="flex items-center gap-2 text-[14px] font-bold">
                <span className="size-2.5 rounded-full bg-ink" />
                لسه مفيش سجل سعر كافي
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
                <div>
                  <div className="text-[11.5px] text-mute">القراءة الوحيدة</div>
                  <Money n={a.current.price} className="text-[20px] font-bold" />
                </div>
                <div className="text-end text-[12px]">
                  <div className="font-semibold">{dateTime(a.current.t)}</div>
                  <div className="text-mute">{ago(a.current.t)}</div>
                </div>
              </div>
              <p className="mt-3 text-[12.5px] leading-6 text-body">
                ابتدينا نتابع المنتج ده من {ago(a.current.t)}. مش هنحكم على العرض من قراءة واحدة — تابعه وهنبلغك لما يبقى عندنا سجل
                كافي أو السعر يتغير.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-2 text-[12px] text-body">
                <span className="num font-semibold text-ink">{readings(visible.length)}</span> · من {date(visible[0].t)} لحد{' '}
                {date(a.current.t)} ({days((a.current.t - visible[0].t) / DAY)})
                {range !== 0 && a.spanDays > range && <span className="text-mute"> · السجل الكامل {days(a.spanDays)}</span>}
              </div>
              <div className="mt-3">
                <PriceChart history={p.history} fromT={fromT} median={a.median} lowest={a.lowest.price} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-body">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-drop" /> السعر المرصود
                </span>
                {a.median && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 border-t border-dashed border-body" /> المرجع المرصود
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border-2 border-drop bg-white" /> أقل سعر
                </span>
                <span className="text-mute">مرّر على الرسم لعرض التاريخ والسعر</span>
              </div>
            </>
          )}
        </section>

        <p className="px-4 pb-6 text-[11.5px] leading-5 text-mute lg:px-5">
          الأرقام دي مبنية على القراءات اللي رصدناها بنفسنا من صفحة المنتج. مش بنوصف أي عرض بإنه "وهمي" على أساس مدة رصد قصيرة
          أو قراءة واحدة.
        </p>
      </div>

      <footer className="flex gap-2 border-t border-line bg-white p-3 lg:p-4">
        <a
          href={amazonUrl(p)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-[14px] font-semibold text-white hover:bg-[#2a3038]"
        >
          عرض على أمازون <ExternalLink className="size-4" />
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
          {saved ? 'في قائمة المتابعة' : 'أضف للمتابعة'}
        </button>
      </footer>
    </aside>
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

import { AlertOctagon, CheckCircle2, CircleDashed, Clock, Loader2 } from 'lucide-react'
import { TRACKED_TOTAL, type Scan, type ScanStatus } from './data'
import { lastSuccess, type Enriched } from './deal'
import { ago, date, time } from './format'
import { L } from './i18n'
import { SampleTag, StaleBadge, Thumb, cx } from './ui'

const meta = (): Record<ScanStatus, { label: string; cls: string; icon: React.ReactNode }> => ({
  success: { label: L('ناجح', 'Success'), cls: 'bg-drop-soft text-drop', icon: <CheckCircle2 className="size-3.5" /> },
  partial: { label: L('جزئي', 'Partial'), cls: 'bg-adv-soft text-ink', icon: <CircleDashed className="size-3.5" /> },
  failed: { label: L('فشل', 'Failed'), cls: 'bg-fail-soft text-fail', icon: <AlertOctagon className="size-3.5" /> },
  running: { label: L('جاري', 'Running'), cls: 'bg-ink text-white', icon: <Loader2 className="size-3.5 animate-spin" /> },
})

export function ScanBadge({ s }: { s: ScanStatus }) {
  const m = meta()[s]
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold', m.cls)}>
      {m.icon}
      {m.label}
    </span>
  )
}

export function ScanHistory({ scans, items, open }: { scans: Scan[]; items: Enriched[]; open: (id: string) => void }) {
  const ok = lastSuccess(scans)!
  const latest = scans[0]
  const done = scans.filter((s) => s.status !== 'running')
  const rate = Math.round((done.filter((s) => s.status === 'success').length / done.length) * 100)
  const stale = items.filter((i) => i.stale)

  return (
    <div className="flex flex-col gap-5">
      <section
        className={cx(
          'rounded-2xl border p-5',
          latest.status === 'failed' ? 'border-fail/25 bg-fail-soft' : 'border-line bg-white',
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ScanBadge s={latest.status} />
          <div className="text-[15px] font-bold">
            {latest.status === 'running'
              ? L('جاري فحص Amazon Egypt دلوقتي', 'Scanning Amazon Egypt now')
              : latest.status === 'failed'
                ? L('آخر فحص فشل', 'The last scan failed')
                : latest.status === 'partial'
                  ? L('آخر فحص خلص بنتايج جزئية', 'The last scan finished with partial results')
                  : L('آخر فحص تم بنجاح', 'The last scan succeeded')}
          </div>
          <div className="ms-auto">
            <SampleTag />
          </div>
        </div>
        {latest.status === 'running' && (
          <div className="mt-4">
            <div className="flex justify-between text-[12.5px] text-body">
              <span>
                {L('اتقرا', 'Read')} <b className="num text-ink">{latest.read}</b> {L('من', 'of')}{' '}
                <span className="num">{TRACKED_TOTAL}</span> {L('منتج', 'products')}
              </span>
              <span>
                {L('بدأ', 'Started')} {ago(latest.at)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-ink" style={{ width: `${(latest.read / TRACKED_TOTAL) * 100}%` }} />
            </div>
          </div>
        )}
        {latest.note && <div className="mt-3 text-[13px] text-body">{L('السبب:', 'Reason:')} {latest.note}</div>}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label={L('آخر فحص ناجح', 'Last successful scan')} value={time(ok.at)} sub={`${date(ok.at)} · ${ago(ok.at)}`} />
          <Kpi
            label={L('نسبة النجاح (آخر 18 فحص)', 'Success rate (last 18 scans)')}
            value={`${rate}%`}
            sub={L('بنفحص كل ساعة', 'We scan every hour')}
          />
          <Kpi
            label={L('منتجات متتبَّعة', 'Tracked products')}
            value={String(TRACKED_TOTAL)}
            sub={L('Amazon Egypt · شاشات وإلكترونيات', 'Amazon Egypt · monitors & electronics')}
          />
        </div>
        {(latest.status === 'failed' || latest.status === 'partial') && (
          <div className="mt-4 rounded-xl bg-white/80 px-3.5 py-2.5 text-[12.5px] text-body">
            {L(
              'آخر أسعار ناجحة لسه ظاهرة في العروض وقائمة المتابعة، وكل سعر عليه وقت فحصه.',
              'The last successful prices are still shown in Offers and the Watchlist, each with its check time.',
            )}
          </div>
        )}
      </section>

      {stale.length > 0 && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 text-[14px] font-bold">
            <Clock className="size-4" /> {L('أسعار قديمة', 'Stale prices')}
            <span className="text-[12px] font-normal text-mute">{L('— ما اتقراتش من أكتر من 24 ساعة', '— not read for over 24 hours')}</span>
          </div>
          <div className="mt-3 flex flex-col divide-y divide-line">
            {stale.map((p) => (
              <button key={p.id} onClick={() => open(p.id)} className="flex items-center gap-3 py-2.5 text-start">
                <Thumb src={p.image} alt={p.name} className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{p.name}</div>
                  <div className="text-[11.5px] text-mute">
                    {L('صفحة المنتج مش بترجع سعر — ممكن يكون نفد', 'Product page returns no price — may be out of stock')}
                  </div>
                </div>
                <StaleBadge />
                <span className="text-[12px] font-semibold text-fail">{ago(p.checkedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3 text-[14px] font-bold">{L('سجل الفحص', 'Scan history')}</div>
        <table className="w-full text-[13px]">
          <thead className="bg-canvas/70 text-[12px] text-body">
            <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-semibold">
              <th>{L('الوقت', 'Time')}</th>
              <th>{L('الحالة', 'Status')}</th>
              <th>{L('المنتجات المقروءة', 'Products read')}</th>
              <th className="hidden sm:table-cell">{L('المدة', 'Duration')}</th>
              <th className="hidden md:table-cell">{L('ملاحظات', 'Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((s) => (
              <tr
                key={s.id}
                className={cx('border-t border-line [&>td]:px-4 [&>td]:py-2.5', s.status === 'failed' && 'bg-fail-soft/40')}
              >
                <td className="whitespace-nowrap">
                  <div className="font-semibold">{time(s.at)}</div>
                  <div className="text-[11.5px] text-mute">{date(s.at)}</div>
                </td>
                <td>
                  <ScanBadge s={s.status} />
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="num w-[70px] whitespace-nowrap">
                      <b>{s.read}</b> <span className="text-mute">/ {TRACKED_TOTAL}</span>
                    </span>
                    <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-canvas sm:block">
                      <div
                        className={cx(
                          'h-full rounded-full',
                          s.status === 'failed' ? 'bg-fail' : s.status === 'success' ? 'bg-drop' : 'bg-ink',
                        )}
                        style={{ width: `${(s.read / TRACKED_TOTAL) * 100}%` }}
                      />
                    </div>
                  </div>
                  {s.note && <div className="mt-0.5 text-[11.5px] text-mute md:hidden">{s.note}</div>}
                </td>
                <td className="num hidden text-body sm:table-cell">{s.durationMin ? `${s.durationMin} ${L('دقيقة', 'min')}` : '—'}</td>
                <td className="hidden text-[12.5px] text-body md:table-cell">{s.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-canvas/80 p-3.5">
      <div className="text-[12px] text-body">{label}</div>
      <div className="num mt-0.5 text-[20px] font-bold">{value}</div>
      <div className="text-[11.5px] text-mute">{sub}</div>
    </div>
  )
}

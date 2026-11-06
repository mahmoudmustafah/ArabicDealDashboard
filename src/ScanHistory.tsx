import { AlertOctagon, CheckCircle2, CircleDashed, Clock, Loader2 } from 'lucide-react'
import { api, useApi, type Meta, type ScanRun } from './api'
import { lastSuccess, runError, toItem } from './deal'
import { ago, date, time } from './format'
import { L, isAr } from './i18n'
import { ApiDown, Loading, SourceChip, StaleBadge, Thumb, cx } from './ui'

type Status = ScanRun['status']

const meta = (): Record<Status, { label: string; cls: string; icon: React.ReactNode }> => ({
  success: { label: L('ناجح', 'Success'), cls: 'bg-drop-soft text-drop', icon: <CheckCircle2 className="size-3.5" /> },
  partial: { label: L('جزئي', 'Partial'), cls: 'bg-adv-soft text-ink', icon: <CircleDashed className="size-3.5" /> },
  failed: { label: L('فشل', 'Failed'), cls: 'bg-fail-soft text-fail', icon: <AlertOctagon className="size-3.5" /> },
  running: { label: L('جاري', 'Running'), cls: 'bg-ink text-white', icon: <Loader2 className="size-3.5 animate-spin" /> },
})

export function ScanBadge({ s }: { s: Status }) {
  const m = meta()[s]
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap', m.cls)}>
      {m.icon}
      {m.label}
    </span>
  )
}

type Props = { info?: Meta; open: (id: number) => void }

export function ScanHistory({ info, open }: Props) {
  const scansQ = useApi(() => api.scans(100), 30_000)
  const staleQ = useApi(api.stale, 120_000)
  const scans = scansQ.data
  if (!scans) return scansQ.error ? <ApiDown onRetry={scansQ.reload} /> : <Loading />
  if (!scans.length)
    return <div className="rounded-2xl border border-dashed border-line bg-white py-16 text-center text-[13px] text-body">{L('لسه مفيش فحوصات', 'No scans yet')}</div>

  const ok = lastSuccess(scans)
  const done = scans.filter((s) => s.status !== 'running')
  const rate = done.length ? Math.round((done.filter((s) => s.status === 'success').length / done.length) * 100) : 0
  const running = scans.filter((s) => s.status === 'running')
  const stale = staleQ.data ?? []
  const catLabel = (id: string) => {
    const c = info?.categories.find((x) => x.id === id)
    return c ? (isAr() ? c.ar : c.en) : id
  }

  return (
    <div className="flex flex-col gap-5">
      {scansQ.error && <ApiDown compact onRetry={scansQ.reload} />}
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          {running.length > 0 ? <ScanBadge s="running" /> : <ScanBadge s={done[0]?.status ?? 'success'} />}
          <div className="text-[15px] font-bold">
            {running.length > 0
              ? L(`جاري فحص ${running.length} قسم دلوقتي`, `${running.length} categories being scanned now`)
              : L('مفيش فحص شغال دلوقتي', 'No scan running right now')}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label={L('آخر فحص ناجح', 'Last successful scan')} value={ok ? time(ok.started_at) : '—'} sub={ok ? `${date(ok.started_at)} · ${ago(ok.started_at)}` : L('لسه مفيش', 'None yet')} />
          <Kpi label={L(`نسبة النجاح (آخر ${done.length} فحص)`, `Success rate (last ${done.length} scans)`)} value={`${rate}%`} sub={L('نون وإماراتي كل 10 دقائق، وأمازون كل 30', 'Noon and Emarati every 10 minutes, Amazon every 30')} />
          <Kpi label={L('منتجات متتبَّعة', 'Tracked products')} value={info ? info.tracked.toLocaleString('en-US') : '—'} sub={L('أمازون ونون وإماراتي سنتس', 'Amazon, Noon and Emarati Scents')} />
        </div>
      </section>

      {stale.length > 0 && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 text-[14px] font-bold">
            <Clock className="size-4" /> {L('أسعار قديمة', 'Stale prices')}
            <span className="num text-[12px] font-normal text-mute">
              {stale.length} {L('— ما اتقراتش من أكتر من 24 ساعة', '— not read for over 24 hours')}
            </span>
          </div>
          <div className="mt-3 flex flex-col divide-y divide-line">
            {stale.slice(0, 15).map(toItem).map((p) => (
              <button key={p.id} onClick={() => open(p.id)} className="flex items-center gap-3 py-2.5 text-start">
                <Thumb src={p.image} alt={p.name} className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{p.name}</div>
                  <div className="truncate text-[11.5px] text-mute">{p.lastFailure ?? L('مش ظاهر في آخر الفحوصات', 'Not seen in recent scans')}</div>
                </div>
                <StaleBadge />
                <span className="text-[12px] font-semibold whitespace-nowrap text-fail">{p.checkedAt ? ago(p.checkedAt) : L('لسه ما اتقراش', 'Never read')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3 text-[14px] font-bold">{L('سجل الفحص', 'Scan history')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-canvas/70 text-[12px] text-body">
              <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-semibold">
                <th>{L('الوقت', 'Time')}</th>
                <th>{L('القسم', 'Category')}</th>
                <th>{L('الحالة', 'Status')}</th>
                <th>{L('الصفحات', 'Pages')}</th>
                <th>{L('المنتجات المقروءة', 'Products read')}</th>
                <th className="hidden sm:table-cell">{L('المدة', 'Duration')}</th>
                <th className="hidden md:table-cell">{L('ملاحظات', 'Notes')}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id} className={cx('border-t border-line [&>td]:px-4 [&>td]:py-2.5', s.status === 'failed' && 'bg-fail-soft/40')}>
                  <td className="whitespace-nowrap">
                    <div className="font-semibold">{time(s.started_at)}</div>
                    <div className="text-[11.5px] text-mute">{date(s.started_at)}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="me-1.5 font-semibold">{catLabel(s.category)}</span>
                    <SourceChip id={s.source} />
                  </td>
                  <td>
                    <ScanBadge s={s.status} />
                  </td>
                  <td className="num whitespace-nowrap">
                    {s.pages_ok} <span className="text-mute">/ {s.pages_planned}</span>
                  </td>
                  <td className="num font-semibold">
                    {s.products_read}
                    {s.error && <div className="mt-0.5 text-[11.5px] font-normal text-mute md:hidden">{runError(s.error)}</div>}
                  </td>
                  <td className="num hidden whitespace-nowrap text-body sm:table-cell">{s.finished_at ? `${Math.max(1, Math.round((s.finished_at - s.started_at) / 1000))} ${L('ث', 's')}` : '—'}</td>
                  <td className="hidden text-[12.5px] text-body md:table-cell" title={s.error ?? undefined}>{runError(s.error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

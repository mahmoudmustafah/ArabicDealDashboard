import { Bookmark, BookmarkCheck, Clock, ExternalLink } from 'lucide-react'
import { statuses, store, type Item } from './deal'
import { ago, date } from './format'
import { L } from './i18n'
import { Money, Pct, SourceChip, StaleBadge, StatusBadge, Thumb, cx } from './ui'

type Props = { p: Item; category: string; saved: boolean; onToggleSave: () => void; onOpen: () => void; active: boolean }

export function OfferCard({ p, category, saved, onToggleSave, onOpen, active }: Props) {
  const a = p.a
  const st = statuses(a)
  const pending = a.exceptional
  const obsPct = a.belowUsual ? a.belowUsualPct : a.observedDropPct
  return (
    <article
      className={cx(
        'group flex flex-col overflow-hidden rounded-2xl border bg-white transition',
        active ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-line-strong',
      )}
    >
      <button onClick={onOpen} className="flex flex-1 cursor-pointer flex-col text-start">
        <div className="relative">
          <Thumb src={p.image} alt={p.name} className="h-36 w-full" />
          <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
            {st.slice(0, 2).map((s) => (
              <StatusBadge key={s} s={s} />
            ))}
            {p.stale && <StaleBadge />}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-mute">
              <SourceChip id={p.source} />
              {category}
            </div>
            <h3 className="mt-0.5 line-clamp-1 text-[15px] leading-6 font-semibold">{p.name}</h3>
          </div>

          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[11px] text-mute">{L('السعر الحالي', 'Current price')}</div>
              <Money n={a.current.price} className="text-[26px] leading-8 font-bold tracking-tight" />
            </div>
            <div className="pb-1 text-end text-[11.5px] leading-4 text-body">
              <div className="text-mute">{L('المرجع المرصود', 'Observed reference')}</div>
              {a.median ? (
                <Money n={a.median} className="text-[13px] font-semibold text-ink" />
              ) : a.prevHigher ? (
                <Money n={a.prevHigher.price} className="text-[13px] font-semibold text-ink" />
              ) : (
                <span className="text-[12px] text-mute">{L('لسه مش متاح', 'Not available yet')}</span>
              )}
            </div>
          </div>

          {/* two separately labelled discounts — real (observed) discount first, on the right in RTL */}
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line text-[11.5px]">
            <div className={cx('px-3 py-2', pending ? 'bg-pending-soft' : obsPct ? 'bg-drop-soft' : 'bg-white')}>
              <div className={cx('font-semibold', pending ? 'text-pending' : obsPct ? 'text-drop' : 'text-body')}>
                {pending ? L('الخصم الحقيقي · قيد التحقق', 'Real discount · verifying') : L('الخصم الحقيقي', 'Real discount')}
              </div>
              {obsPct ? (
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <Pct n={obsPct} className={cx('text-[17px] font-bold', pending ? 'text-pending' : 'text-drop')} />
                  <span className="truncate text-mute">
                    {a.belowUsual
                      ? L(`عن وسيط ${a.medianWindowDays} يوم`, `vs ${a.medianWindowDays}-day median`)
                      : L(`من ${date(a.prevHigher!.t)}`, `since ${date(a.prevHigher!.t)}`)}
                  </span>
                </div>
              ) : (
                <div className="mt-0.5 text-[13px] text-mute">{a.sufficient ? L('السعر ثابت', 'Price steady') : L('بيانات غير كافية', 'Not enough data')}</div>
              )}
            </div>
            <div className="border-s border-line bg-adv-soft/60 px-3 py-2">
              <div className="font-medium text-adv">{L('الخصم على الموقع', 'Discount on site')}</div>
              {a.advertisedPct ? (
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <Pct n={a.advertisedPct} className="text-[17px] font-bold text-adv" />
                  <span className="text-mute">{L('من', 'from')}</span>
                  <Money n={p.listPrice!} strike className="text-[11.5px] text-mute" />
                </div>
              ) : (
                <div className="mt-0.5 text-[13px] text-mute">{L('مفيش', 'None')}</div>
              )}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-1.5 text-[11.5px] text-body">
            <Clock className="size-3.5 text-mute" />
            <span>
              {L('اتفحص', 'Checked')} <span className={cx('font-semibold', p.stale ? 'text-fail' : 'text-ink')}>{ago(p.checked)}</span>
            </span>
            <span className="text-line">|</span>
            <span className="num text-mute">{a.count} {L('قراءة', 'readings')}</span>
            {p.notRefreshed && <span className="ms-auto text-fail">{L('آخر محاولة فشلت', 'Last read failed')}</span>}
          </div>
        </div>
      </button>

      <div className="flex gap-2 border-t border-line p-3">
        <a
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-[13px] font-semibold text-white transition hover:bg-ink-hover"
        >
          {store(p.source).view()}
          <ExternalLink className="size-3.5" />
        </a>
        <button
          onClick={onToggleSave}
          aria-pressed={saved}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition',
            saved ? 'border-drop/30 bg-drop-soft text-drop' : 'border-line text-ink hover:bg-canvas',
          )}
        >
          {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          {saved ? L('متابَع', 'Tracking') : L('تابِع', 'Track')}
        </button>
      </div>
    </article>
  )
}

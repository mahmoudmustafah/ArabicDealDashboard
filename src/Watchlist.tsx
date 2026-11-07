import { ArrowDown, ArrowUp, BookmarkX, Bookmark, ExternalLink, Minus } from 'lucide-react'
import type { WatchItem } from './api'
import { statuses, store, type Item } from './deal'
import { ago, date, price } from './format'
import { L } from './i18n'
import { Sparkline } from './PriceChart'
import { Money, SourceChip, StaleBadge, StatusBadge, Thumb, cx } from './ui'

type Props = { items: Item<WatchItem>[]; remove: (id: number) => void; open: (id: number) => void; goFeed: () => void }

function Change({ p }: { p: Item<WatchItem> }) {
  const c = p.latestChange
  if (!c)
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] text-mute">
        <Minus className="size-3.5" /> {L('مفيش تغيير مرصود', 'No observed change')}
      </span>
    )
  const delta = c.to - c.from
  const down = delta < 0
  return (
    <div className="text-[12.5px] leading-5">
      <span className={cx('num inline-flex items-center gap-0.5 font-bold', down ? 'text-drop' : 'text-fail')}>
        {down ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
        <bdi>{price(Math.abs(delta))}</bdi> {L('ج.م', 'EGP')}
      </span>
      <div className="text-[11.5px] text-mute">
        {L('من', 'from')} <bdi className="num">{price(c.from)}</bdi> · {date(c.at)}
      </div>
    </div>
  )
}

export function Watchlist({ items, remove, open, goFeed }: Props) {
  const drops = items.filter((i) => i.latestChange && i.latestChange.to < i.latestChange.from).length
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13.5px] text-body">
        <span className="num font-bold text-ink">{items.length}</span> {L('منتج متابَع', 'tracked products')} ·{' '}
        <span className="num font-bold text-drop">{drops}</span> {L('منهم سعره نزل في آخر تغيير', 'dropped in their latest change')}
      </p>

      {!items.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white py-16 text-center">
          <Bookmark className="size-6 text-mute" />
          <div className="font-semibold">{L('قائمة المتابعة فاضية', 'Your watchlist is empty')}</div>
          <p className="max-w-xs text-[13px] text-body">
            {L('اضغط "تابِع" على أي عرض وهنعرض هنا آخر سعر مرصود وأي تغيير فيه.', 'Tap "Track" on any offer to see its latest observed price and any changes here.')}
          </p>
          <button onClick={goFeed} className="h-9 rounded-lg bg-ink px-4 text-[13px] font-semibold text-white">
            {L('تصفح العروض', 'Browse offers')}
          </button>
        </div>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-white lg:block">
            <table className="w-full text-start text-[13px]">
              <thead className="bg-canvas/70 text-[12px] text-body">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start [&>th]:font-semibold">
                  <th>{L('المنتج', 'Product')}</th>
                  <th>{L('آخر سعر مرصود', 'Last observed price')}</th>
                  <th>{L('آخر تغيير', 'Latest change')}</th>
                  <th>{L('أقل سعر مرصود', 'Lowest observed')}</th>
                  <th>{L('30 يوم', '30 days')}</th>
                  <th>{L('آخر فحص', 'Last checked')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-line align-middle hover:bg-canvas/40 [&>td]:px-4 [&>td]:py-3">
                    <td>
                      <button onClick={() => open(p.id)} className="flex items-center gap-3 text-start">
                        <Thumb src={p.image} alt={p.name} className="size-12 shrink-0 rounded-lg" />
                        <div className="min-w-0">
                          <div className="line-clamp-2 max-w-[280px] font-semibold hover:underline">{p.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <SourceChip id={p.source} />
                            {statuses(p.a).slice(0, 1).map((s) => (
                              <StatusBadge key={s} s={s} />
                            ))}
                            {p.stale && <StaleBadge />}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td>{p.price !== null ? <Money n={p.price} className="text-[16px] font-bold" /> : <span className="text-mute">—</span>}</td>
                    <td>
                      <Change p={p} />
                    </td>
                    <td>
                      {p.a.count > 1 && p.a.lowest ? (
                        <>
                          <Money n={p.a.lowest.price} className="font-semibold" />
                          <div className="text-[11.5px] text-mute">{date(p.a.lowest.t)}</div>
                        </>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td>
                      <Sparkline history={p.last30} />
                    </td>
                    <td className={cx('text-[12.5px]', p.stale ? 'font-semibold text-fail' : 'text-body')}>{ago(p.checked)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-semibold whitespace-nowrap hover:bg-canvas"
                        >
                          {store(p.source).short()} <ExternalLink className="size-3.5" />
                        </a>
                        <button
                          onClick={() => remove(p.id)}
                          aria-label={L('شيل من المتابعة', 'Remove from watchlist')}
                          className="grid size-8 place-items-center rounded-lg text-mute hover:bg-fail-soft hover:text-fail"
                        >
                          <BookmarkX className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile list */}
          <div className="flex flex-col gap-3 lg:hidden">
            {items.map((p) => (
              <div key={p.id} className="rounded-2xl border border-line bg-white p-3">
                <button onClick={() => open(p.id)} className="flex w-full gap-3 text-start">
                  <Thumb src={p.image} alt={p.name} className="size-16 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{p.name}</div>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      {p.price !== null && <Money n={p.price} className="text-[19px] font-bold" />}
                      <Sparkline history={p.last30} w={72} h={24} />
                    </div>
                  </div>
                </button>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                  <Change p={p} />
                  <div className={cx('text-[11.5px]', p.stale ? 'font-semibold text-fail' : 'text-mute')}>
                    {L('اتفحص', 'Checked')} {ago(p.checked)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

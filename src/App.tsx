import { Bookmark, History, Radar, Send, Store, Tag, Timer } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildScans, futureSources, products, type Scenario } from './data'
import { enrich, lastSuccess } from './deal'
import { Detail } from './Detail'
import { Feed } from './Feed'
import { Jobs } from './Jobs'
import { Telegram } from './Telegram'
import { ago, date, time } from './format'
import { ScanBadge, ScanHistory } from './ScanHistory'
import { cx } from './ui'
import { Watchlist } from './Watchlist'

type View = 'feed' | 'watch' | 'scans' | 'jobs' | 'telegram'

const titles: Record<View, { t: string; s: string }> = {
  feed: { t: 'العروض', s: 'أقوى نزول مرصود في الأسعار — بالدليل من سجل السعر' },
  watch: { t: 'قائمة المتابعة', s: 'آخر سعر مرصود وأي تغيير حصل في المنتجات اللي بتتابعها' },
  telegram: {
    t: 'النشر في تليجرام',
    s: 'متابعة العروض اللي اتنشرت تلقائيًا في قناة الأولوية والقناة العامة — وإمتى اتنشرت',
  },
  jobs: { t: 'عمليات البحث', s: 'بحث تلقائي عن العروض على أمازون ونون وإماراتي سنتس في كل قسم كل 10 دقائق — إيه اللي شغال دلوقتي وإيه اللي خلص' },
  scans: { t: 'سجل الفحص', s: 'كل فحص لأمازون مصر: وقته، حالته، وعدد المنتجات اللي اتقرت' },
}

const scenarios: [Scenario, string][] = [
  ['normal', 'ناجح'],
  ['running', 'جاري الفحص'],
  ['partial', 'جزئي'],
  ['failed', 'فشل'],
]

// Deep-link support for reviewing states, e.g. ?view=scans&scenario=failed&open=dell-s2721ds
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()

export default function App() {
  const [view, setView] = useState<View>((params.get('view') as View) || 'feed')
  const [scenario, setScenario] = useState<Scenario>((params.get('scenario') as Scenario) || 'normal')
  const [saved, setSaved] = useState(() => new Set(['odyssey-g5', 'dell-s2721ds', 'aoc-27g2sp', 'jbl-tune-520', 'mx-keys-s']))
  const [openId, setOpenId] = useState<string | null>(() =>
    params.has('open')
      ? params.get('open') || null
      : typeof window !== 'undefined' && window.innerWidth >= 1280
        ? 'odyssey-g5'
        : null,
  )

  useEffect(() => {
    document.documentElement.dir = 'rtl'
    document.documentElement.lang = 'ar'
    document.title = 'رادار العروض — Deal Radar'
  }, [])

  const scans = useMemo(() => buildScans(scenario), [scenario])
  const items = useMemo(() => enrich(products, scans), [scans])
  const ok = lastSuccess(scans)!
  const latest = scans[0]
  const toggleSave = useCallback(
    (id: string) =>
      setSaved((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    [],
  )
  const close = useCallback(() => setOpenId(null), [])
  const opened = items.find((i) => i.id === openId)
  const watchItems = items.filter((i) => saved.has(i.id))

  const nav = [
    { id: 'feed' as const, label: 'العروض', short: 'العروض', icon: Tag, count: items.length as number | undefined },
    { id: 'watch' as const, label: 'قائمة المتابعة', short: 'المتابعة', icon: Bookmark, count: saved.size as number | undefined },
    { id: 'jobs' as const, label: 'عمليات البحث', short: 'البحث', icon: Timer, count: undefined },
    { id: 'telegram' as const, label: 'النشر في تليجرام', short: 'تليجرام', icon: Send, count: undefined },
    { id: 'scans' as const, label: 'سجل الفحص', short: 'الفحص', icon: History, count: undefined },
  ]

  return (
    <div dir="rtl" lang="ar" className="min-h-screen bg-canvas text-ink">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[232px] flex-col border-e border-line bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
          <div className="grid size-9 place-items-center rounded-xl bg-ink text-white">
            <Radar className="size-5" />
          </div>
          <div>
            <div className="text-[15px] leading-5 font-bold">رادار العروض</div>
            <div className="text-[11px] font-medium text-mute" dir="ltr">
              Deal Radar
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={cx(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-semibold transition',
                view === n.id ? 'bg-ink text-white' : 'text-body hover:bg-canvas hover:text-ink',
              )}
            >
              <n.icon className="size-4" />
              {n.label}
              {n.count !== undefined && (
                <span className={cx('num ms-auto text-[12px]', view === n.id ? 'text-white/60' : 'text-mute')}>{n.count}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-7 px-5 text-[11px] font-semibold tracking-wide text-mute">المصادر</div>
        <div className="mt-2 flex flex-col gap-0.5 px-3">
          <div className="flex h-10 items-center gap-3 rounded-lg bg-canvas px-3 text-[13px] font-semibold">
            <Store className="size-4" />
            <span dir="ltr">Amazon Egypt</span>
            <span className="ms-auto size-2 rounded-full bg-drop" aria-label="متصل" />
          </div>
          <button
            onClick={() => setView('jobs')}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold hover:bg-canvas"
          >
            <Store className="size-4" />
            <span dir="ltr">Noon Egypt</span>
            <span className="ms-auto rounded bg-[#fff4b8] px-1.5 text-[10px] font-semibold text-[#5a4a00]">جديد</span>
          </button>
          <button
            onClick={() => setView('jobs')}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold hover:bg-canvas"
          >
            <Store className="size-4" />
            <span dir="ltr">Emarati Scents</span>
            <span className="ms-auto rounded bg-[#f3e8da] px-1.5 text-[10px] font-semibold text-[#6b4a1f]">جديد</span>
          </button>
          {futureSources.map((s) => (
            <div key={s} className="flex h-9 items-center gap-3 px-3 text-[13px] text-mute">
              <Store className="size-4 opacity-50" />
              {s}
              <span className="ms-auto text-[10.5px]">قريبًا</span>
            </div>
          ))}
        </div>

        <div className="mt-auto p-3">
          <button
            onClick={() => setView('scans')}
            className={cx(
              'w-full rounded-xl border p-3 text-start',
              latest.status === 'failed' ? 'border-fail/25 bg-fail-soft' : 'border-line bg-canvas/60',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-body">آخر فحص ناجح</span>
              <ScanBadge s={latest.status} />
            </div>
            <div className="num mt-1 text-[18px] font-bold">{time(ok.at)}</div>
            <div className="text-[11.5px] text-mute">
              {date(ok.at)} · {ago(ok.at)}
            </div>
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div className="grid size-8 place-items-center rounded-lg bg-ink text-white">
            <Radar className="size-4" />
          </div>
          <div className="leading-4">
            <div className="text-[14px] font-bold">رادار العروض</div>
            <div className="text-[11px] text-mute" dir="ltr">
              Amazon Egypt
            </div>
          </div>
          <button
            onClick={() => setView('scans')}
            className={cx(
              'ms-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start',
              latest.status === 'failed' ? 'bg-fail-soft' : 'bg-canvas',
            )}
          >
            <div className="leading-4">
              <div className="text-[10.5px] text-body">آخر فحص ناجح</div>
              <div className="num text-[13px] font-bold">{time(ok.at)}</div>
            </div>
            <ScanBadge s={latest.status} />
          </button>
        </div>
      </header>

      <main className={cx('@container min-h-screen pb-24 lg:ms-[232px] lg:pb-10', opened && 'lg:me-[540px]')}>
        <div className="mx-auto max-w-[1200px] px-4 pt-5 lg:px-8 lg:pt-7">
          <div className="mb-5 flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between">
            <div>
              <div className="mb-1 hidden items-center gap-2 text-[12px] font-semibold text-body lg:flex">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-0.5 ring-1 ring-line">
                  <Store className="size-3.5" />
                  المصدر: <span dir="ltr">Amazon Egypt</span>
                </span>
                <span className="text-mute">·</span>
                <span>
                  آخر فحص ناجح <b className="num text-ink">{time(ok.at)}</b> <span className="text-mute">({ago(ok.at)})</span>
                </span>
              </div>
              <h1 className="text-[24px] leading-8 font-bold tracking-tight lg:text-[28px] lg:leading-9">{titles[view].t}</h1>
              <p className="mt-0.5 text-[13.5px] text-body">{titles[view].s}</p>
            </div>
            <div className={cx('flex flex-col gap-1', (view === 'jobs' || view === 'telegram') && 'hidden')}>
              <span className="text-[11px] font-semibold text-mute">معاينة حالة الفحص (للعرض فقط)</span>
              <div className="flex rounded-lg border border-dashed border-[#b8bec7] bg-white p-0.5">
                {scenarios.map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setScenario(k)}
                    aria-pressed={scenario === k}
                    className={cx(
                      'h-8 flex-1 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap transition',
                      scenario === k ? (k === 'failed' ? 'bg-fail text-white' : 'bg-ink text-white') : 'text-body hover:text-ink',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {view === 'feed' && (
            <Feed
              items={items}
              scans={scans}
              saved={saved}
              toggleSave={toggleSave}
              openId={openId}
              open={setOpenId}
              goScans={() => setView('scans')}
            />
          )}
          {view === 'watch' && (
            <Watchlist items={watchItems} remove={toggleSave} open={setOpenId} goFeed={() => setView('feed')} />
          )}
          {view === 'jobs' && <Jobs />}
          {view === 'telegram' && <Telegram />}
          {view === 'scans' && <ScanHistory scans={scans} items={items} open={setOpenId} />}

          <footer className="mt-10 border-t border-line pt-4 text-[11.5px] leading-5 text-mute">
            كل المنتجات والأسعار وسجلات الفحص هنا بيانات تجريبية للتصميم، مش أسعار حقيقية من أمازون. "رادار العروض" مش تابع
            لأمازون.
          </footer>
        </div>
      </main>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {nav.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={cx(
              'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold whitespace-nowrap',
              view === n.id ? 'text-ink' : 'text-mute',
            )}
          >
            {view === n.id && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-ink" />}
            <n.icon className="size-5" strokeWidth={view === n.id ? 2.4 : 2} />
            {n.short}
          </button>
        ))}
      </nav>

      {opened && <Detail p={opened} saved={saved.has(opened.id)} onToggleSave={() => toggleSave(opened.id)} onClose={close} />}
    </div>
  )
}

import { Bookmark, History, Languages, Moon, Radar, Send, Store, Sun, Tag, Timer } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, useApi, type SourceId } from './api'
import { lastSuccess, stores, toItem } from './deal'
import { Detail } from './Detail'
import { Feed } from './Feed'
import { Jobs } from './Jobs'
import { Telegram } from './Telegram'
import { ago, date, time } from './format'
import { ScanBadge, ScanHistory } from './ScanHistory'
import { ApiDown, Loading, cx } from './ui'
import { L, setLang, type Lang } from './i18n'
import { Watchlist } from './Watchlist'

type View = 'feed' | 'watch' | 'scans' | 'jobs' | 'telegram'

const titles = (): Record<View, { t: string; s: string }> => ({
  feed: {
    t: L('العروض', 'Offers'),
    s: L('أقوى العروض الحالية من أمازون ونون وإماراتي سنتس — بالدليل من سجل السعر', 'The strongest current offers from Amazon, Noon and Emarati Scents — with evidence from price history'),
  },
  watch: {
    t: L('قائمة المتابعة', 'Watchlist'),
    s: L('آخر سعر مرصود وأي تغيير حصل في المنتجات اللي بتتابعها', 'Latest observed price and recent changes for products you track'),
  },
  telegram: {
    t: L('النشر في تليجرام', 'Telegram publishing'),
    s: L(
      'متابعة العروض اللي اتنشرت تلقائيًا في قناة الأولوية والقناة العامة — وإمتى اتنشرت',
      'Track which offers were posted automatically to the priority and general channels — and when',
    ),
  },
  jobs: {
    t: L('عمليات البحث', 'Search jobs'),
    s: L(
      'بحث تلقائي عن العروض على أمازون ونون وإماراتي سنتس في كل قسم كل 10 دقائق — إيه اللي شغال دلوقتي وإيه اللي خلص',
      'Automatic deal searches on Amazon, Noon and Emarati Scents every 10 minutes per category — what is running and what has finished',
    ),
  },
  scans: {
    t: L('سجل الفحص', 'Scan history'),
    s: L('كل فحص في المتاجر التلاتة: وقته، حالته، وعدد المنتجات اللي اتقرت', 'Every scan across the three stores: when it ran, its status and how many products were read'),
  },
})

type Theme = 'light' | 'dark'
const stored = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const initialLang = (): Lang => {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('lang')
  return q === 'en' || q === 'ar' ? q : stored('dr-lang') === 'en' ? 'en' : 'ar'
}
const initialTheme = (): Theme => {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('theme')
  if (q === 'dark' || q === 'light') return q
  const s = stored('dr-theme')
  if (s === 'dark' || s === 'light') return s
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Prefs({
  lang,
  setLangState,
  theme,
  setTheme,
  compact,
}: {
  lang: Lang
  setLangState: (l: Lang) => void
  theme: Theme
  setTheme: (t: Theme) => void
  compact?: boolean
}) {
  const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white font-semibold text-ink transition hover:bg-canvas'
  return (
    <div className={cx('flex items-center gap-1.5', !compact && 'w-full')}>
      <button
        onClick={() => setLangState(lang === 'ar' ? 'en' : 'ar')}
        className={cx(btn, compact ? 'h-8 px-2 text-[12px]' : 'h-9 flex-1 text-[12.5px]')}
        aria-label={lang === 'ar' ? 'Switch to English' : 'التحويل للعربي'}
        title={lang === 'ar' ? 'Switch to English' : 'التحويل للعربي'}
      >
        <Languages className="size-4" />
        <span lang={lang === 'ar' ? 'en' : 'ar'}>{lang === 'ar' ? 'English' : 'عربي'}</span>
      </button>
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        role="switch"
        aria-checked={theme === 'dark'}
        aria-label={L('الوضع الداكن', 'Dark mode')}
        title={theme === 'dark' ? L('الوضع الفاتح', 'Light mode') : L('الوضع الداكن', 'Dark mode')}
        className={cx(btn, compact ? 'size-8' : 'h-9 flex-1 text-[12.5px]')}
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {!compact && <span>{theme === 'dark' ? L('فاتح', 'Light') : L('داكن', 'Dark')}</span>}
      </button>
    </div>
  )
}

// Deep links, e.g. ?view=scans or ?open=123
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // Set before children render so every L()/formatter call in this render uses the new language.
  setLang(lang)
  const [view, setView] = useState<View>((params.get('view') as View) || 'feed')
  // The detail panel opens only when asked for, never by default.
  const [openId, setOpenId] = useState<number | null>(() => (Number(params.get('open')) > 0 ? Number(params.get('open')) : null))
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
    document.title = lang === 'ar' ? 'رادار العروض — Deal Radar' : 'Deal Radar — رادار العروض'
    try {
      localStorage.setItem('dr-lang', lang)
    } catch {}
  }, [lang])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    try {
      localStorage.setItem('dr-theme', theme)
    } catch {}
  }, [theme])

  const metaQ = useApi(api.meta, 60_000)
  const offersQ = useApi(api.offers, 60_000)
  const watchQ = useApi(api.watchlist, 60_000)
  const scansQ = useApi(() => api.scans(100), 30_000)
  const info = metaQ.data
  const scans = scansQ.data ?? []
  const items = useMemo(() => (offersQ.data?.offers ?? []).map(toItem), [offersQ.data])
  const watchItems = useMemo(() => (watchQ.data ?? []).map(toItem), [watchQ.data])
  const saved = useMemo(() => new Set(watchItems.map((w) => w.id)), [watchItems])
  const [pending, setPending] = useState<Map<number, boolean>>(new Map())
  const savedNow = useMemo(() => {
    const out = new Set(saved)
    for (const [id, on] of pending) {
      if (on) out.add(id)
      else out.delete(id)
    }
    return out
  }, [saved, pending])
  const reloadWatch = watchQ.reload
  const toggleSave = useCallback(
    (id: number) => {
      const on = !savedNow.has(id)
      setSaveError(false)
      setPending((m) => new Map(m).set(id, on))
      ;(on ? api.watch(id) : api.unwatch(id))
        .catch(() => setSaveError(true))
        .finally(() => {
          reloadWatch()
          // Let the reload land before dropping the optimistic state.
          setTimeout(() => setPending((m) => {
            const n = new Map(m)
            n.delete(id)
            return n
          }), 1500)
        })
    },
    [savedNow, reloadWatch],
  )
  const close = useCallback(() => setOpenId(null), [])
  const ok = lastSuccess(scans)
  const latest = scans[0]
  const apiDown = !!(offersQ.error && scansQ.error)
  const retry = () => {
    metaQ.reload()
    offersQ.reload()
    watchQ.reload()
    scansQ.reload()
  }
  const storeStatus = (id: SourceId) => scans.find((r) => r.source === id && r.status !== 'running')?.status
  const dot = (id: SourceId) => {
    const st = storeStatus(id)
    return st === 'success' ? 'bg-drop' : st === 'partial' ? 'bg-pending' : st === 'failed' ? 'bg-fail' : 'bg-line-strong'
  }

  const nav = [
    { id: 'feed' as const, label: L('العروض', 'Offers'), short: L('العروض', 'Offers'), icon: Tag, count: (offersQ.data?.total) as number | undefined },
    { id: 'watch' as const, label: L('قائمة المتابعة', 'Watchlist'), short: L('المتابعة', 'Watchlist'), icon: Bookmark, count: savedNow.size as number | undefined },
    { id: 'jobs' as const, label: L('عمليات البحث', 'Search jobs'), short: L('البحث', 'Jobs'), icon: Timer, count: undefined },
    { id: 'telegram' as const, label: L('النشر في تليجرام', 'Telegram'), short: L('تليجرام', 'Telegram'), icon: Send, count: undefined },
    { id: 'scans' as const, label: L('سجل الفحص', 'Scan history'), short: L('الفحص', 'Scans'), icon: History, count: undefined },
  ]

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="min-h-screen bg-canvas text-ink">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[232px] flex-col border-e border-line bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
          <div className="grid size-9 place-items-center rounded-xl bg-ink text-white">
            <Radar className="size-5" />
          </div>
          <div>
            <div className="text-[15px] leading-5 font-bold">{L('رادار العروض', 'Deal Radar')}</div>
            <div className="text-[11px] font-medium text-mute">{L('Deal Radar', 'رادار العروض')}</div>
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

        <div className="mt-7 px-5 text-[11px] font-semibold tracking-wide text-mute">{L('المصادر', 'Sources')}</div>
        <div className="mt-2 flex flex-col gap-0.5 px-3">
          {stores.map((st) => (
            <button
              key={st.id}
              onClick={() => setView('jobs')}
              className="flex h-10 items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold hover:bg-canvas"
            >
              <Store className="size-4" />
              <span dir="ltr">{st.label}</span>
              <span className={cx('ms-auto size-2 rounded-full', dot(st.id))} />
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-2 p-3">
          <Prefs lang={lang} setLangState={setLangState} theme={theme} setTheme={setTheme} />
          <button
            onClick={() => setView('scans')}
            className={cx(
              'w-full rounded-xl border p-3 text-start',
              latest?.status === 'failed' ? 'border-fail/25 bg-fail-soft' : 'border-line bg-canvas/60',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-body">{L('آخر فحص ناجح', 'Last successful scan')}</span>
              {latest && <ScanBadge s={latest.status} />}
            </div>
            <div className="num mt-1 text-[18px] font-bold">{ok ? time(ok.started_at) : '—'}</div>
            {ok && (
              <div className="text-[11.5px] text-mute">
                {date(ok.started_at)} · {ago(ok.started_at)}
              </div>
            )}
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
            <div className="text-[14px] font-bold">{L('رادار العروض', 'Deal Radar')}</div>
            <div className="text-[11px] text-mute">{L('3 متاجر', '3 stores')}</div>
          </div>
          <button
            onClick={() => setView('scans')}
            className={cx(
              'ms-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start',
              latest?.status === 'failed' ? 'bg-fail-soft' : 'bg-canvas',
            )}
          >
            <div className="leading-4">
              <div className="hidden text-[10.5px] text-body sm:block">{L('آخر فحص ناجح', 'Last scan')}</div>
              <div className="num text-[13px] font-bold whitespace-nowrap">{ok ? time(ok.started_at) : '—'}</div>
            </div>
            {latest && <ScanBadge s={latest.status} />}
          </button>
          <Prefs lang={lang} setLangState={setLangState} theme={theme} setTheme={setTheme} compact />
        </div>
      </header>

      <main className={cx('@container min-h-screen pb-24 lg:ms-[232px] lg:pb-10', openId !== null && 'lg:me-[540px]')}>
        <div className="mx-auto max-w-[1200px] px-4 pt-5 lg:px-8 lg:pt-7">
          <div className="mb-5 flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between">
            <div>
              {ok && (
                <div className="mb-1 hidden items-center gap-2 text-[12px] font-semibold text-body lg:flex">
                  {L('آخر فحص ناجح', 'Last successful scan')} <b className="num text-ink">{time(ok.started_at)}</b> <span className="text-mute">({ago(ok.started_at)})</span>
                </div>
              )}
              <h1 className="text-[24px] leading-8 font-bold tracking-tight lg:text-[28px] lg:leading-9">{titles()[view].t}</h1>
              <p className="mt-0.5 text-[13.5px] text-body">{titles()[view].s}</p>
            </div>
          </div>

          {apiDown && (
            <div className="mb-5">
              <ApiDown onRetry={retry} />
            </div>
          )}
          {saveError && (
            <div role="alert" className="mb-5 rounded-xl bg-fail-soft px-3.5 py-2.5 text-[12.5px] text-fail">
              {L('ما قدرناش نحفظ التغيير في قائمة المتابعة. جرّب تاني.', 'Could not save that watchlist change. Please try again.')}
            </div>
          )}

          {view === 'feed' &&
            (offersQ.data ? (
              <Feed items={items} scans={scans} info={info} saved={savedNow} toggleSave={toggleSave} openId={openId} open={setOpenId} goScans={() => setView('scans')} />
            ) : offersQ.error ? (
              !apiDown && <ApiDown onRetry={offersQ.reload} />
            ) : (
              <Loading />
            ))}
          {view === 'watch' &&
            (watchQ.data ? (
              <Watchlist items={watchItems} remove={toggleSave} open={setOpenId} goFeed={() => setView('feed')} />
            ) : watchQ.error ? (
              !apiDown && <ApiDown onRetry={watchQ.reload} />
            ) : (
              <Loading />
            ))}
          {view === 'jobs' && <Jobs info={info} />}
          {view === 'telegram' && <Telegram info={info} openProduct={setOpenId} />}
          {view === 'scans' && <ScanHistory info={info} open={setOpenId} />}

          <footer className="mt-10 border-t border-line pt-4 text-[11.5px] leading-5 text-mute">
            {L(
              'الأسعار مأخوذة من صفحات المتاجر وقت آخر فحص، وممكن تكون اتغيرت — اتأكد منها على المتجر قبل الشراء. "رادار العروض" مش تابع لأمازون أو نون أو إماراتي سنتس.',
              'Prices are read from store pages at the last check and may have changed — confirm on the store before buying. Deal Radar is not affiliated with Amazon, Noon or Emarati Scents.',
            )}
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

      {openId !== null && <Detail id={openId} saved={savedNow.has(openId)} onToggleSave={() => toggleSave(openId)} onClose={close} />}
    </div>
  )
}

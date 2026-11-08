import { sourceById, ownChannel, timezone, type SourceId } from './config.ts'
import type { DB } from './db.ts'
import { analyze } from './evaluate.ts'
import { HISTORY_WINDOW_MS } from './pipeline.ts'
import type { ProductRow, Repo } from './repo.ts'
import type { SourceAdapter } from './sources/types.ts'

/**
 * A ready-to-share "top 5 deals" post for Mayar's own chat. It carries no affiliate links, because it is shared
 * outside the channel, only the channel's invite link.
 */
export type TopDeal = { name: string; store: string; price: number; was: number; pct: number; observed: boolean }

const MIN_PCT = 15
const MAX_PER_CATEGORY = 2
const MAX_PER_STORE = 3
const MAX_RECHECKS = 20
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const num = (n: number) => Math.round(n).toLocaleString('en-US')

export async function pickTopDeals(deps: { db: DB; repo: Repo; adapters: Record<SourceId, SourceAdapter>; now: number; gapMs?: number }, count = 5): Promise<TopDeal[]> {
  const { db, repo, adapters, now } = deps
  const rows = db.prepare('SELECT * FROM products WHERE available = 1 AND last_seen_at > ?').all(now - 24 * 3_600_000) as ProductRow[]
  const scored = rows
    .filter((p) => !ownChannel(p.category))
    .map((p) => {
      const a = analyze(repo.history(p.id, now - HISTORY_WINDOW_MS), p.list_price ?? undefined)
      const best = a.inflatedBeforeDrop ? undefined : a.best
      return best && best.pct >= MIN_PCT && best.pct < 90 ? { p, best, observed: best.basis !== 'advertised' } : undefined
    })
    .filter((x) => !!x)
    // Discounts backed by our own price history come first, then the biggest.
    .sort((x, y) => Number(y.observed) - Number(x.observed) || y.best.pct - x.best.pct)

  const out: TopDeal[] = []
  const seen = new Set<string>()
  const perCategory = new Map<string, number>()
  const perStore = new Map<string, number>()
  let rechecks = 0
  for (const { p, best, observed } of scored) {
    if (out.length >= count || rechecks >= MAX_RECHECKS) break
    const key = `${p.source}:${p.store_key}`
    if (seen.has(key) || (perCategory.get(p.category) ?? 0) >= MAX_PER_CATEGORY || (perStore.get(p.source) ?? 0) >= MAX_PER_STORE) continue
    seen.add(key)
    rechecks++
    const fresh = await adapters[p.source].product(p.store_key, p.url).catch(() => null)
    if (deps.gapMs) await new Promise((r) => setTimeout(r, deps.gapMs))
    if (!fresh || fresh.available === false || !fresh.price) continue
    const pct = ((best.refPrice - fresh.price) / best.refPrice) * 100
    if (pct < MIN_PCT) continue
    out.push({ name: p.name, store: sourceById(p.source)?.ar ?? p.source, price: fresh.price, was: best.refPrice, pct, observed })
    perCategory.set(p.category, (perCategory.get(p.category) ?? 0) + 1)
    perStore.set(p.source, (perStore.get(p.source) ?? 0) + 1)
  }
  return out
}

export function renderTopDeals(deals: TopDeal[], inviteLink: string, now: number) {
  const day = new Intl.DateTimeFormat('ar-EG', { timeZone: timezone, day: 'numeric', month: 'long' }).format(now)
  const lines = [`🔥 أقوى ${deals.length} عروض النهارده (${day})`, '']
  deals.forEach((d, i) => {
    lines.push(`${i + 1}. ${clip(d.name, 70)}`)
    lines.push(`💰 ${num(d.price)} جنيه بدل ${num(d.was)} · خصم ${Math.round(d.pct)}%`)
    lines.push(`🏪 ${d.store}${d.observed ? ' · نزول رصدناه بنفسنا' : ' · الخصم حسب الموقع'}`)
    lines.push('')
  })
  lines.push('الأسعار وقت كتابة البوست، وممكن تتغير.', '', `📣 عروض زي دي كل يوم: ${inviteLink}`)
  return lines.join('\n')
}

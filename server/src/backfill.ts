import { ownChannel } from './config.ts'
import type { DB } from './db.ts'
import { analyze } from './evaluate.ts'
import { HISTORY_WINDOW_MS } from './pipeline.ts'
import type { ProductRow, Repo } from './repo.ts'

/**
 * Posts discounts that were already there when posting opened, for categories Mayar chose.
 * The strongest go first, and they are spaced out so new offers still get room under the hourly cap.
 * The publisher rechecks each price before posting, and skips any that fell under the minimum.
 */
export const BACKFILL_REASON = 'backfill: existing store discount'

export type BackfillOptions = { categories: string[]; minPct: number; spacingMs: number; maxAgeMs: number; now: number; dryRun?: boolean }

export function planBackfill(db: DB, repo: Repo, o: BackfillOptions) {
  const marks = o.categories.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM products WHERE category IN (${marks}) AND available = 1 AND list_price > 0 AND last_seen_at > ?`).all(...o.categories, o.now - o.maxAgeMs) as ProductRow[]
  const best = new Map<string, { p: ProductRow; pct: number; price: number; labels: string }>()
  const taken = db.prepare(`SELECT 1 FROM offers f JOIN products q ON q.id = f.product_id WHERE q.source = ? AND q.store_key = ? AND f.decision = 'publish' AND f.status IN ('scheduled', 'published')
    AND EXISTS (SELECT 1 FROM deliveries d WHERE d.offer_id = f.id AND d.dry_run = 0 AND d.state IN ('scheduled', 'retrying', 'sent'))`)
  for (const p of rows) {
    const a = analyze(repo.history(p.id, o.now - HISTORY_WINDOW_MS), p.list_price ?? undefined)
    if (!a.advertisedPct || a.advertisedPct < o.minPct) continue
    if (taken.get(p.source, p.store_key)) continue
    // The same product can be stored twice. Keep it once.
    const key = `${p.source}:${p.store_key}`
    const seen = best.get(key)
    if (!seen || (p.last_seen_at ?? 0) > (seen.p.last_seen_at ?? 0)) best.set(key, { p, pct: a.advertisedPct, price: a.current.price, labels: JSON.stringify(a.labels) })
  }
  return [...best.values()].sort((x, y) => y.pct - x.pct)
}

export function scheduleBackfill(db: DB, repo: Repo, o: BackfillOptions) {
  const plan = planBackfill(db, repo, o)
  if (o.dryRun) return plan
  db.exec('BEGIN')
  try {
    plan.forEach(({ p, pct, price, labels }, i) => {
      const channel = ownChannel(p.category)
      if (!channel) throw new Error(`Backfill is only for categories with their own channel: ${p.category}`)
      const offerId = repo.insertOffer({
        product_id: p.id,
        detected_at: o.now,
        price,
        ref_price: p.list_price,
        basis: 'advertised',
        pct,
        labels,
        priority: 0,
        decision: 'publish',
        reason: `${BACKFILL_REASON} ${Math.round(pct)}%`,
        status: 'scheduled',
      })
      repo.insertDelivery(offerId, channel, o.now + i * o.spacingMs, price)
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return plan
}


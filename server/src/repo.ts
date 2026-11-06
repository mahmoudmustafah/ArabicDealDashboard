import type { CategoryId, Channel, SourceId } from './config.ts'
import { json, type DB } from './db.ts'
import type { Obs } from './evaluate.ts'
import type { LastPost } from './policy.ts'
import type { Listing, Promo } from './sources/types.ts'
import { parsePack } from './units.ts'

export type ProductRow = {
  id: number
  source: SourceId
  store_key: string
  seller: string
  category: CategoryId
  name: string
  brand: string | null
  image: string | null
  url: string
  variant: string | null
  pack_value: number | null
  pack_unit: string | null
  pack_qty: number | null
  list_price: number | null
  available: number | null
  promo: string | null
  discovered_at: number
  last_seen_at: number | null
  last_attempt_at: number | null
  last_failure_at: number | null
  last_failure: string | null
}

export type DeliveryRow = {
  id: number
  offer_id: number
  channel: Channel
  scheduled_at: number
  state: 'scheduled' | 'sending' | 'sent' | 'retrying' | 'failed' | 'cancelled'
  attempts: string
  next_attempt_at: number | null
  sent_at: number | null
  message_id: number | null
  dry_run: number
  cancel_reason: string | null
  posted_price: number | null
}

export type OfferRow = {
  id: number
  product_id: number
  detected_at: number
  price: number
  ref_price: number | null
  basis: string
  pct: number
  labels: string
  priority: number
  decision: 'publish' | 'skip'
  reason: string
  status: 'scheduled' | 'published' | 'cancelled' | 'skipped'
  verified_at: number | null
}

export type Attempt = { at: number; ok: boolean; error?: string; recheck?: boolean }

export function repo(db: DB) {
  const q = {
    findProduct: db.prepare('SELECT * FROM products WHERE source = ? AND store_key = ? AND seller = ?'),
    // Listings give no seller and product pages do, so the same product must not become two rows.
    findSameProduct: db.prepare(`SELECT * FROM products WHERE source = ? AND store_key = ? ORDER BY seller = '' DESC, id LIMIT 1`),
    insertProduct: db.prepare(`INSERT INTO products
      (source, store_key, seller, category, name, brand, image, url, variant, pack_value, pack_unit, pack_qty, list_price, available, promo, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateProduct: db.prepare(`UPDATE products SET name = ?, brand = COALESCE(?, brand), image = COALESCE(?, image), url = ?,
      variant = COALESCE(?, variant), list_price = ?, available = ?, promo = ? WHERE id = ?`),
    insertObs: db.prepare('INSERT INTO observations (product_id, t, price, list_price, available, run_id) VALUES (?, ?, ?, ?, ?, ?)'),
    markSeen: db.prepare('UPDATE products SET last_seen_at = ?, last_attempt_at = ? WHERE id = ?'),
    markAttempt: db.prepare('UPDATE products SET last_attempt_at = ? WHERE id = ?'),
    markFailure: db.prepare('UPDATE products SET last_attempt_at = ?, last_failure_at = ?, last_failure = ? WHERE id = ?'),
    insertFailure: db.prepare('INSERT INTO read_failures (product_id, t, run_id, reason) VALUES (?, ?, ?, ?)'),
    history: db.prepare('SELECT t, price FROM observations WHERE product_id = ? AND t >= ? ORDER BY t'),
    product: db.prepare('SELECT * FROM products WHERE id = ?'),
    lastPublished: db.prepare(`SELECT o.*,
        (SELECT MIN(sent_at) FROM deliveries d WHERE d.offer_id = o.id AND d.state = 'sent') AS sent_at,
        (SELECT posted_price FROM deliveries d WHERE d.offer_id = o.id AND d.state = 'sent' ORDER BY d.sent_at DESC LIMIT 1) AS posted_price
      FROM offers o
      WHERE o.product_id IN (SELECT q.id FROM products q JOIN products p ON q.source = p.source AND q.store_key = p.store_key WHERE p.id = ?)
        AND o.decision = 'publish' AND o.status IN ('scheduled', 'published')
      ORDER BY o.detected_at DESC LIMIT 1`),
    maxSince: db.prepare('SELECT MAX(price) m FROM observations WHERE product_id = ? AND t > ?'),
    lastSkip: db.prepare(`SELECT * FROM offers WHERE product_id = ? AND decision = 'skip' ORDER BY detected_at DESC LIMIT 1`),
    insertOffer: db.prepare(`INSERT INTO offers (product_id, detected_at, price, ref_price, basis, pct, labels, priority, decision, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertDelivery: db.prepare(`INSERT INTO deliveries (offer_id, channel, scheduled_at, state, next_attempt_at, posted_price) VALUES (?, ?, ?, 'scheduled', ?, ?)`),
  }

  return {
    /** Same store + store key + seller → same product. Re-finding it updates details instead of duplicating (brief §6). */
    upsertProduct(l: Listing, category: CategoryId, now: number): { id: number; isNew: boolean } {
      const seller = l.seller ?? ''
      const promo = l.promos?.length ? JSON.stringify(l.promos) : null
      const avail = l.available === undefined ? null : l.available ? 1 : 0
      const existing = (q.findProduct.get(l.source, l.storeKey, seller) ?? q.findSameProduct.get(l.source, l.storeKey)) as ProductRow | undefined
      if (existing) {
        q.updateProduct.run(l.name, l.brand ?? null, l.image ?? null, l.url, l.variant ?? null, l.listPrice ?? null, avail, promo, existing.id)
        return { id: existing.id, isNew: false }
      }
      const pack = parsePack(`${l.name} ${l.variant ?? ''}`)
      const r = q.insertProduct.run(
        l.source, l.storeKey, seller, category, l.name, l.brand ?? null, l.image ?? null, l.url, l.variant ?? null,
        pack.value ?? null, pack.unit ?? null, pack.qty ?? null, l.listPrice ?? null, avail, promo, now,
      )
      return { id: Number(r.lastInsertRowid), isNew: true }
    },

    /** Every successful reading is recorded, even if the price is unchanged (brief §7). */
    recordObservation(productId: number, l: Listing, t: number, runId: number | null) {
      if (l.available === false || !(l.price > 0)) {
        q.markAttempt.run(t, productId)
        return false
      }
      q.insertObs.run(productId, t, l.price, l.listPrice ?? null, l.available === undefined ? null : l.available ? 1 : 0, runId)
      q.markSeen.run(t, t, productId)
      return true
    },

    /** A failed read never touches last_seen_at, so the old price keeps its real timestamp (brief §19). */
    recordFailure(productId: number, t: number, runId: number | null, reason: string) {
      q.insertFailure.run(productId, t, runId, reason)
      q.markFailure.run(t, t, reason, productId)
    },

    history(productId: number, sinceMs = 0): Obs[] {
      return q.history.all(productId, sinceMs) as Obs[]
    },

    product(id: number) {
      return q.product.get(id) as ProductRow | undefined
    },

    lastPost(productId: number): LastPost | undefined {
      const r = q.lastPublished.get(productId) as (OfferRow & { sent_at: number | null; posted_price: number | null }) | undefined
      if (!r) return undefined
      const at = r.sent_at ?? r.detected_at
      const price = r.posted_price ?? r.price
      const max = (q.maxSince.get(productId, at) as { m: number | null }).m
      return { price, at, pending: r.status === 'scheduled', endedSince: max !== null && max > price * 1.02 }
    },

    /** Record a skip only when the reason or price changed, so the operator log stays readable. */
    shouldLogSkip(productId: number, price: number, reason: string) {
      const last = q.lastSkip.get(productId) as OfferRow | undefined
      return !last || last.price !== price || last.reason !== reason
    },

    insertOffer(o: Omit<OfferRow, 'id' | 'verified_at'>) {
      const r = q.insertOffer.run(o.product_id, o.detected_at, o.price, o.ref_price, o.basis, o.pct, o.labels, o.priority, o.decision, o.reason, o.status)
      return Number(r.lastInsertRowid)
    },

    insertDelivery(offerId: number, channel: Channel, at: number, price: number) {
      q.insertDelivery.run(offerId, channel, at, at, price)
    },

    promos: (p: ProductRow) => json<Promo[]>(p.promo, []),
  }
}

export type Repo = ReturnType<typeof repo>

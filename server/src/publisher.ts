import { evidence as E, ownChannel, publication as P, type Channel } from './config.ts'
import { json, type DB } from './db.ts'
import { analyze, type Basis } from './evaluate.ts'
import { HISTORY_WINDOW_MS } from './pipeline.ts'
import { decide, minPctFor } from './policy.ts'
import type { Attempt, DeliveryRow, OfferRow, ProductRow, Repo } from './repo.ts'
import type { SourceAdapter } from './sources/types.ts'
import { BACKFILL_REASON } from './backfill.ts'
import { parsePack } from './units.ts'
import { renderMessage, type Sender } from './telegram.ts'
import type { SourceId } from './config.ts'
import { FetchError } from './sources/types.ts'

/**
 * Delivery worker (brief §15–§17). On each tick it takes due deliveries and:
 *  - for a delayed general post: rechecks the offer first, then publishes, updates or cancels
 *  - sends, retries temporary failures with backoff, and keeps every attempt as history
 */
export type PublisherDeps = {
  db: DB
  repo: Repo
  adapters: Record<SourceId, SourceAdapter>
  send: Sender
  now: () => number
  /** Screenshot of the offer on the store page. Null or a failure falls back to the product image. */
  capture?: (channel: Channel, source: SourceId, url: string, price: number) => Promise<Buffer | null>
}

type Due = DeliveryRow & { offer_priority: number; offer_pct: number }

export function createPublisher(deps: PublisherDeps) {
  const { db, repo } = deps
  const dueQ = db.prepare(`SELECT d.*, o.priority AS offer_priority, o.pct AS offer_pct FROM deliveries d JOIN offers o ON o.id = d.offer_id
    WHERE (d.state = 'scheduled' AND d.scheduled_at <= ?) OR (d.state = 'retrying' AND d.next_attempt_at <= ?)
    ORDER BY d.channel = 'priority' DESC, o.pct DESC, d.scheduled_at`)
  const sentLastHour = db.prepare(`SELECT COUNT(*) n FROM deliveries WHERE channel = ? AND state = 'sent' AND dry_run = 0 AND sent_at > ?`)
  const offerQ = db.prepare('SELECT * FROM offers WHERE id = ?')
  const setState = db.prepare(
    'UPDATE deliveries SET state = ?, attempts = ?, next_attempt_at = ?, sent_at = ?, message_id = ?, dry_run = ?, cancel_reason = ?, posted_price = ? WHERE id = ?',
  )
  const offerDeliveries = db.prepare('SELECT state FROM deliveries WHERE offer_id = ?')
  const setOfferStatus = db.prepare('UPDATE offers SET status = ? WHERE id = ?')
  const verifyOffer = db.prepare('UPDATE offers SET verified_at = ? WHERE id = ? AND verified_at IS NULL')
  let busy = false

  function save(d: DeliveryRow) {
    setState.run(d.state, d.attempts, d.next_attempt_at, d.sent_at, d.message_id, d.dry_run, d.cancel_reason, d.posted_price, d.id)
    const states = (offerDeliveries.all(d.offer_id) as { state: string }[]).map((r) => r.state)
    const status = states.includes('sent')
      ? 'published'
      : states.every((s) => s === 'cancelled' || s === 'failed')
        ? 'cancelled'
        : 'scheduled'
    setOfferStatus.run(status, d.offer_id)
  }

  /** Targeted recheck before a delayed general post (brief §16). Returns the action to take. */
  async function recheck(d: Due, offer: OfferRow, p: ProductRow, now: number): Promise<{ cancel?: string; retry?: boolean; price?: number }> {
    const attempts = json<Attempt[]>(d.attempts, [])
    let fresh
    try {
      fresh = await deps.adapters[p.source].product(p.store_key, p.url)
    } catch (e) {
      const reason = e instanceof FetchError ? e.message : String(e)
      repo.recordFailure(p.id, now, null, `recheck: ${reason}`)
      const failedRechecks = attempts.filter((a) => a.recheck && !a.ok).length + 1
      d.attempts = JSON.stringify([...attempts, { at: now, ok: false, recheck: true, error: `Recheck failed: ${reason}` }])
      if (failedRechecks < 2) return { retry: true }
      return P.onFailedRecheck === 'cancel' ? { cancel: 'Could not recheck the price before publishing' } : {}
    }
    if (!fresh || fresh.available === false) {
      if (fresh) repo.recordObservation(p.id, fresh, now, null)
      return { cancel: 'Product became unavailable before the general slot' }
    }
    repo.recordObservation(p.id, fresh, now, null)
    // A product page can omit the crossed-out price that the listing shows, so fall back to the last one read.
    const a = analyze(repo.history(p.id, now - HISTORY_WINDOW_MS), fresh.listPrice ?? p.list_price ?? undefined)
    // Judge the deal on its own, ignoring this pending post (lastPost undefined).
    const again = decide(a, { now, available: true })
    if (!again.publish) {
      const back = fresh.price >= offer.price * (1 + E.samePriceBandPct / 100)
      return { cancel: back ? `Price went back to EGP ${Math.round(fresh.price).toLocaleString('en-US')} before the general slot` : `No longer qualifies: ${again.reason}` }
    }
    if (offer.labels.includes('exceptional') && Math.abs(fresh.price - offer.price) / offer.price <= E.samePriceBandPct / 100) verifyOffer.run(now, offer.id)
    return { price: fresh.price }
  }

  async function handle(d: Due, now: number) {
    let offer = offerQ.get(d.offer_id) as OfferRow
    const p = repo.product(offer.product_id)!
    const attempts = () => json<Attempt[]>(d.attempts, [])
    let price = d.posted_price ?? offer.price

    // A category with its own channel never posts anywhere else, even if it was queued before the rule.
    const own = ownChannel(p.category)
    if (own && d.channel !== own && d.state === 'scheduled') {
      d.state = 'cancelled'
      d.cancel_reason = `This category posts only to the ${own} channel`
      d.next_attempt_at = null
      save(d)
      return
    }

    if (d.channel !== 'priority' && d.state === 'scheduled') {
      const n = (sentLastHour.get(d.channel, now - 3_600_000) as { n: number }).n
      if (n >= P.generalMaxPerHour) return // stays scheduled; strongest offers go first when a slot frees
    }

    // Recheck after the priority delay, and for any post that waited in the queue behind the hourly cap,
    // because a queued price can be hours old by the time its turn comes.
    const waited = now - offer.detected_at > P.maxAgeAtPublishMs
    const backfill = offer.reason.startsWith(BACKFILL_REASON)
    const delayed = backfill || (d.channel !== 'priority' && (offer.priority === 1 || waited))
    if (delayed && !attempts().some((a) => a.recheck && a.ok)) {
      const r = await recheck(d, offer, p, now)
      if (r.retry) {
        d.state = 'scheduled'
        d.scheduled_at = now + P.recheckRetryMs
        db.prepare('UPDATE deliveries SET scheduled_at = ? WHERE id = ?').run(d.scheduled_at, d.id)
        save(d)
        return
      }
      if (r.cancel) {
        d.state = 'cancelled'
        d.cancel_reason = r.cancel
        d.next_attempt_at = null
        save(d)
        return
      }
      if (r.price) price = r.price
      offer = offerQ.get(d.offer_id) as OfferRow // may now be verified
      d.attempts = JSON.stringify([...attempts(), { at: now, ok: true, recheck: true }])
    }

    // The price may have moved since the decision. Never post a discount under the minimum for its basis.
    const shownPct = offer.ref_price ? ((offer.ref_price - price) / offer.ref_price) * 100 : offer.pct
    const minPct = backfill ? Number(offer.reason.match(/\(min (\d+)%\)/)?.[1] ?? P.backfillMinPct) : minPctFor[offer.basis as Basis]
    if (shownPct < minPct) {
      d.state = 'cancelled'
      d.cancel_reason = `Discount is now ${Math.round(shownPct)}%, under the ${minPct}% minimum`
      d.next_attempt_at = null
      save(d)
      return
    }

    d.state = 'sending'
    save(d)
    const a = analyze(repo.history(p.id, now - HISTORY_WINDOW_MS), p.list_price ?? undefined)
    const msg = renderMessage({
      key: p.id,
      name: p.name,
      category: p.category,
      sufficient: a.sufficient,
      lowestSeen: a.lowest.price >= a.current.price,
      source: p.source,
      price,
      refPrice: offer.ref_price ?? undefined,
      basis: offer.basis as 'observed',
      pct: shownPct,
      promos: repo.promos(p),
      exceptional: offer.labels.includes('exceptional') && !offer.verified_at,
      checkedAt: p.last_seen_at ?? a.current.t,
      url: p.url,
      image: p.image ?? undefined,
      pack: parsePack(`${p.name} ${p.variant ?? ''}`),
    })
    const shot = await deps.capture?.(d.channel, p.source, p.url, price).catch(() => null)
    const res = await deps.send(d.channel, msg.html, shot ?? p.image ?? undefined, msg.button)
    const t = deps.now()
    const sendAttempts = attempts().filter((x) => !x.recheck)
    if (res.ok) {
      Object.assign(d, { state: 'sent', sent_at: t, message_id: res.messageId, dry_run: res.dryRun ? 1 : 0, next_attempt_at: null, posted_price: price })
      d.attempts = JSON.stringify([...attempts(), { at: t, ok: true }])
    } else {
      d.attempts = JSON.stringify([...attempts(), { at: t, ok: false, error: res.error }])
      const tries = sendAttempts.length + 1
      if (res.retryable && tries <= P.retryBackoffMs.length) {
        d.state = 'retrying'
        d.next_attempt_at = t + Math.max(res.retryAfterMs ?? 0, P.retryBackoffMs[tries - 1])
      } else {
        d.state = 'failed'
        d.next_attempt_at = null
      }
    }
    save(d)
  }

  return {
    /** Process everything that is due. Safe to call often; it never overlaps itself. */
    async tick() {
      if (busy) return
      busy = true
      try {
        const now = deps.now()
        const due = dueQ.all(now, now) as Due[]
        for (const d of due) await handle(d, deps.now())
      } finally {
        busy = false
      }
    },
  }
}

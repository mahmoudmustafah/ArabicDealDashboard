import { amazonPostingOff, publication as P, ownChannel } from './config.ts'
import type { DB } from './db.ts'
import { analyze, type Analysis } from './evaluate.ts'
import { decide, EXISTING_OFFER, isNewOffer, type Decision } from './policy.ts'
import type { Repo } from './repo.ts'

export const HISTORY_WINDOW_MS = 120 * 86_400_000

export function analyzeProduct(repo: Repo, productId: number, now: number): Analysis | undefined {
  const p = repo.product(productId)
  if (!p) return undefined
  const h = repo.history(productId, now - HISTORY_WINDOW_MS)
  if (!h.length) return undefined
  return analyze(h, p.list_price ?? undefined)
}

/**
 * Evaluate → dedupe → schedule (brief §1 workflow). Runs after each successful reading.
 * Creates an offer row with the decision and its reason. When publishing, it schedules
 * priority now and general after the delay, or general now.
 */
export function evaluateAndSchedule(db: DB, repo: Repo, productId: number, now: number): { analysis?: Analysis; decision?: Decision } {
  const a = analyzeProduct(repo, productId, now)
  if (!a) return {}
  const p = repo.product(productId)!
  const verdict = decide(a, { now, available: p.available === null ? null : !!p.available, lastPost: repo.lastPost(productId) })

  const fresh = isNewOffer(a, p.discovered_at)
  if (amazonPostingOff && p.source === 'amazon') return { analysis: a, decision: { ...verdict, publish: false, reason: 'Amazon posting is switched off' } }
  const d: Decision = verdict.publish && !fresh && verdict.pct < P.existingMinPct ? { ...verdict, publish: false, reason: `Older offer under ${P.existingMinPct}%` } : verdict

  if (!d.publish) {
    if (a.best && d.reason !== 'Already scheduled for publication' && repo.shouldLogSkip(productId, a.current.price, d.reason)) {
      repo.insertOffer({
        product_id: productId,
        detected_at: now,
        price: a.current.price,
        ref_price: d.refPrice ?? null,
        basis: d.basis ?? 'advertised',
        pct: d.pct ?? 0,
        labels: JSON.stringify(a.labels),
        priority: d.priority ? 1 : 0,
        decision: 'skip',
        reason: d.reason,
        status: 'skipped',
      })
    }
    return { analysis: a, decision: d }
  }

  const own = ownChannel(p.category)
  db.exec('BEGIN')
  try {
    const offerId = repo.insertOffer({
      product_id: productId,
      detected_at: now,
      price: a.current.price,
      ref_price: d.refPrice,
      basis: d.basis,
      pct: d.pct,
      labels: JSON.stringify(a.labels),
      priority: d.priority && !own ? 1 : 0,
      decision: 'publish',
      reason: fresh ? d.reason : `${d.reason} ${EXISTING_OFFER}`,
      status: 'scheduled',
    })
    if (own) repo.insertDelivery(offerId, own, now, a.current.price)
    else if (d.priority) {
      repo.insertDelivery(offerId, 'priority', now, a.current.price)
      // Brief §15: the delay is measured from discovery, not from the priority send.
      repo.insertDelivery(offerId, 'general', now + P.generalDelayMs, a.current.price)
    } else repo.insertDelivery(offerId, 'general', now, a.current.price)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { analysis: a, decision: d }
}

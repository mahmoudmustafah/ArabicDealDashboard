import { publication as P } from './config.ts'
import type { Analysis, Basis } from './evaluate.ts'

/**
 * Publication policy (brief §12–§15). Discovery and publication are separate steps: this
 * module only decides, with a stated reason, and never sends anything.
 * Every DEFAULT(decision) threshold is in config.ts and explained in POLICY.md.
 */

export type LastPost = {
  /** Price in the most recent published (or still scheduled) post for this product. */
  price: number
  at: number
  pending: boolean
  /** True if we observed the price going back up above the posted price since that post. */
  endedSince: boolean
}

export type Decision =
  | { publish: true; priority: boolean; basis: Basis; pct: number; refPrice: number; reason: string }
  | { publish: false; reason: string; basis?: Basis; pct?: number; refPrice?: number; priority?: boolean }

const r1 = (n: number) => Math.round(n * 10) / 10

/** New means the price changed after we first saw the product, or the product itself is new. Never a discount that was already there. */
export function isNewOffer(a: Pick<Analysis, 'detectedAt'>, discoveredAt: number, since = { changedSince: P.changedSince, discoveredSince: P.discoveredSince }) {
  if (discoveredAt >= since.discoveredSince) return true
  return a.detectedAt > discoveredAt && a.detectedAt >= since.changedSince
}

/** The smallest discount a post may show for each basis. */
export const minPctFor: Record<Basis, number> = {
  observed: P.minObservedDropPct,
  below_usual: P.minBelowUsualPct,
  advertised: P.minAdvertisedPct,
}

/**
 * What the post shows: the strongest basis, unless its discount is under that basis's minimum.
 * An offer can qualify on the store's advertised discount while our own observed drop is tiny,
 * and then the post must show the discount it qualified on, not "5% off".
 */
export function shownDeal(a: Analysis): { basis: Basis; pct: number; refPrice: number } | undefined {
  const options: { basis: Basis; pct: number; refPrice: number }[] = []
  // A small drop of our own reads badly next to a much bigger discount on the store's page.
  if (a.best && a.best.basis !== 'advertised' && a.best.pct < P.preferAdvertisedBelowPct && a.advertisedPct && a.listPrice && a.advertisedPct > a.best.pct)
    options.push({ basis: 'advertised', pct: a.advertisedPct, refPrice: a.listPrice })
  if (a.best) options.push(a.best)
  if (a.prevHigher && a.observedDropPct) options.push({ basis: 'observed', pct: a.observedDropPct, refPrice: a.prevHigher.price })
  if (a.belowUsual && a.usual && a.belowUsualPct) options.push({ basis: 'below_usual', pct: a.belowUsualPct, refPrice: a.usual })
  if (a.advertisedPct && a.listPrice) options.push({ basis: 'advertised', pct: a.advertisedPct, refPrice: a.listPrice })
  return options.find((o) => o.pct >= minPctFor[o.basis])
}

export function routingPct(a: Analysis) {
  const parts = [a.observedDropPct ?? 0, a.belowUsual ? (a.belowUsualPct ?? 0) : 0]
  if (P.priorityAllowsAdvertised) parts.push(a.advertisedPct ?? 0)
  return Math.max(...parts)
}

/** Priority is decided by the discount alone. An exceptional drop under the line goes straight to the general channel, with its notice. */
export const isPriority = (a: Analysis) => routingPct(a) >= P.priorityPct

export function decide(a: Analysis, ctx: { now: number; available?: boolean | null; lastPost?: LastPost }): Decision {
  const best = a.best
  if (!best) return { publish: false, reason: 'No discount: no observed drop, not below usual, no advertised discount' }
  const base = { basis: best.basis, pct: best.pct, refPrice: best.refPrice }

  if (ctx.available === false) return { ...base, publish: false, reason: 'Store shows the product as unavailable' }
  if (ctx.now - a.current.t > P.maxAgeAtPublishMs)
    return { ...base, publish: false, reason: `Price not confirmed in the last ${P.maxAgeAtPublishMs / 60_000} min` }

  const priority = isPriority(a)
  const why: string[] = []
  if ((a.observedDropPct ?? 0) >= P.minObservedDropPct) why.push(`observed drop ${r1(a.observedDropPct!)}% ≥ ${P.minObservedDropPct}%`)
  if (a.belowUsual && (a.belowUsualPct ?? 0) >= P.minBelowUsualPct) why.push(`${r1(a.belowUsualPct!)}% below usual ≥ ${P.minBelowUsualPct}%`)
  if ((a.advertisedPct ?? 0) >= P.minAdvertisedPct) why.push(`advertised ${r1(a.advertisedPct!)}% ≥ ${P.minAdvertisedPct}% (retailer claim)`)
  if (a.exceptional) why.push('exceptional drop (verifying)')
  if (!why.length && !priority)
    return { ...base, publish: false, priority, reason: `Below publication minimums (best: ${best.basis} ${r1(best.pct)}%)` }
  if (priority && !a.exceptional) why.push(`routing discount ${r1(routingPct(a))}% ≥ ${P.priorityPct}%`)

  // Duplicate prevention (brief §13).
  const lp = ctx.lastPost
  if (lp) {
    if (lp.pending) return { ...base, publish: false, priority, reason: 'Already scheduled for publication' }
    const furtherDrop = ((lp.price - a.current.price) / lp.price) * 100
    if (furtherDrop >= P.republishFurtherDropPct) why.push(`further ${r1(furtherDrop)}% below last post`)
    else if (lp.endedSince && ctx.now - lp.at >= P.republishReturnCooldownMs) why.push('offer returned after it ended')
    else
      return {
        ...base,
        publish: false,
        priority,
        reason: lp.endedSince ? 'Returned offer still inside the repost cooldown' : 'Already published at this price',
      }
  }

  const shown = shownDeal(a)
  if (!shown) return { ...base, publish: false, priority, reason: `Below publication minimums (best: ${best.basis} ${r1(best.pct)}%)` }
  return { publish: true, priority, ...shown, reason: why.join('; ') }
}

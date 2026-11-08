import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, type Obs } from '../src/evaluate.ts'
import { decide, isNewOffer, isPriority } from '../src/policy.ts'

const NOW = Date.UTC(2026, 10, 5, 12)
const H = 3_600_000
const flat = (hours: number, price: number): Obs[] => Array.from({ length: hours }, (_, i) => ({ t: NOW - (hours - i) * H, price }))

test('40% and above routes to priority; 39% does not', () => {
  assert.equal(isPriority(analyze([{ t: NOW, price: 610 }], 1000)), false)
  assert.equal(isPriority(analyze([{ t: NOW, price: 600 }], 1000)), true)
  assert.equal(isPriority(analyze([...flat(5, 1000), { t: NOW, price: 600 }])), true)
})

test('an exceptional drop under 40% is not priority, and keeps its label', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 620 }])
  assert.equal(a.exceptional, true)
  assert.equal(isPriority(a), false)
  const d = decide(a, { now: NOW })
  assert.equal(d.publish && d.priority, false)
})

test('a drop under 5% is not published; 5% is', () => {
  const low = decide(analyze([...flat(5, 1000), { t: NOW, price: 960 }]), { now: NOW })
  assert.equal(low.publish, false)
  assert.match(low.reason, /minimums/)
  assert.equal(decide(analyze([...flat(5, 1000), { t: NOW, price: 950 }]), { now: NOW }).publish, true)
  assert.equal(decide(analyze([{ t: NOW, price: 950 }], 1000), { now: NOW }).publish, true)
})

test('20% observed drop is published to general only', () => {
  const d = decide(analyze([...flat(5, 1000), { t: NOW, price: 800 }]), { now: NOW })
  assert.equal(d.publish, true)
  assert.equal(d.publish && d.priority, false)
  assert.equal(d.publish && d.basis, 'observed')
})

test('stale or unavailable offers are not published', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 700 }])
  assert.equal(decide(a, { now: NOW + 3 * H }).publish, false)
  assert.equal(decide(a, { now: NOW, available: false }).publish, false)
})

test('an unchanged offer that was already posted is not posted again', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 700 }])
  const d = decide(a, { now: NOW, lastPost: { price: 700, at: NOW - 2 * H, pending: false, endedSince: false } })
  assert.equal(d.publish, false)
  assert.match(d.reason, /Already published/)
})

test('a further 5% reduction justifies a new post', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 650 }])
  const d = decide(a, { now: NOW, lastPost: { price: 700, at: NOW - 2 * H, pending: false, endedSince: false } })
  assert.equal(d.publish, true)
})

test('a returning offer waits for the cooldown', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 700 }])
  const lp = { price: 700, pending: false, endedSince: true }
  assert.equal(decide(a, { now: NOW, lastPost: { ...lp, at: NOW - 3 * H } }).publish, false)
  assert.equal(decide(a, { now: NOW, lastPost: { ...lp, at: NOW - 25 * H } }).publish, true)
})

test('a tiny observed drop with a big advertised discount shows the advertised discount', () => {
  // The furniture cleaner: 80.29 → 75.99 (5%), and the store crosses out 197 (61%).
  const a = analyze([...flat(5, 80.29), { t: NOW, price: 75.99 }], 197)
  const d = decide(a, { now: NOW })
  assert.equal(d.publish, true)
  assert.equal(d.basis, 'advertised')
  assert.equal(d.refPrice, 197)
  assert.equal(Math.round(d.pct!), 61)
})

test('a strong observed drop still shows as observed, even with an advertised discount', () => {
  const d = decide(analyze([...flat(5, 1000), { t: NOW, price: 800 }], 2000), { now: NOW })
  assert.equal(d.publish && d.basis, 'observed')
  assert.equal(d.publish && d.refPrice, 1000)
})

test('only new offers count: a price change or a new product, never an old discount', () => {
  const since = { changedSince: 1000, discoveredSince: 5000 }
  assert.equal(isNewOffer({ detectedAt: 100 }, 100, since), false, 'discount already there when first seen')
  assert.equal(isNewOffer({ detectedAt: 2000 }, 2000, since), false, 'first seen during the first sweep of a new category')
  assert.equal(isNewOffer({ detectedAt: 500 }, 100, since), false, 'price changed before posting opened')
  assert.equal(isNewOffer({ detectedAt: 2000 }, 100, since), true, 'price changed after posting opened')
  assert.equal(isNewOffer({ detectedAt: 6000 }, 6000, since), true, 'a product that first appeared later')
})

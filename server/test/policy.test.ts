import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, type Obs } from '../src/evaluate.ts'
import { decide, isPriority } from '../src/policy.ts'

const NOW = Date.UTC(2026, 10, 5, 12)
const H = 3_600_000
const flat = (hours: number, price: number): Obs[] => Array.from({ length: hours }, (_, i) => ({ t: NOW - (hours - i) * H, price }))

test('50% and above routes to priority; 49% does not', () => {
  assert.equal(isPriority(analyze([...flat(5, 1000), { t: NOW, price: 500 }])), true, '50% observed is also exceptional (≥35%)')
  // Advertised-only: exceptional does not apply
  assert.equal(isPriority(analyze([{ t: NOW, price: 510 }], 1000)), false)
  assert.equal(isPriority(analyze([{ t: NOW, price: 500 }], 1000)), true)
})

test('small observed drops are not published', () => {
  const a = analyze([...flat(5, 1000), { t: NOW, price: 900 }])
  const d = decide(a, { now: NOW })
  assert.equal(d.publish, false)
  assert.match(d.reason, /minimums/)
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

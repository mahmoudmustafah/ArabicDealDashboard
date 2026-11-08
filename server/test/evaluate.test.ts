import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, dailySummaries, type Obs } from '../src/evaluate.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 5, 12)

/** Readings every `everyH` hours at `price` from `fromDays` ago to `toDays` ago. */
function seg(fromDays: number, toDays: number, price: number, everyH = 12): Obs[] {
  const out: Obs[] = []
  for (let t = NOW - fromDays * DAY; t <= NOW - toDays * DAY; t += everyH * 3_600_000) out.push({ t, price })
  return out
}

test('brief §7 example: 1000 → 750 is an observed drop from a real previous price', () => {
  const a = analyze([...seg(2, 0.1, 1000, 1), { t: NOW, price: 750 }])
  assert.equal(a.prevHigher?.price, 1000)
  assert.equal(Math.round(a.observedDropPct!), 25)
  assert.ok(a.labels.includes('observed_drop'))
  assert.ok(a.labels.includes('insufficient'), 'two days of data is not enough history')
  assert.equal(a.best?.basis, 'observed')
})

test('advertised "50% off" with an unchanged observed price is advertised only, not a drop', () => {
  const a = analyze(seg(30, 0, 500), 1000)
  assert.equal(a.prevHigher, undefined)
  assert.equal(a.observedDropPct, undefined)
  assert.equal(Math.round(a.advertisedPct!), 50)
  assert.deepEqual(a.labels, ['advertised_only'])
  assert.equal(a.best?.basis, 'advertised')
})

test('jitter within ±2% is the same price period', () => {
  const a = analyze([...seg(10, 1, 1000), { t: NOW - 0.5 * DAY, price: 990 }, { t: NOW, price: 1005 }])
  assert.equal(a.prevHigher, undefined)
})

test('hundreds of readings in one day do not count as sufficient history', () => {
  const a = analyze(seg(0.9, 0, 800, 0.1))
  assert.ok(a.count > 100)
  assert.equal(a.sufficient, false)
})

test('enough history needs 10 readings over 21 days with 14 covered days', () => {
  assert.equal(analyze(seg(25, 0, 800, 24)).sufficient, true)
  // 30-day span but readings only on 3 days
  const sparse = [...seg(30, 29, 800, 4), ...seg(15, 14.5, 800, 4), ...seg(0.5, 0, 800, 4)]
  assert.ok(sparse.length >= 10)
  assert.equal(analyze(sparse).sufficient, false)
})

test('usual price uses daily summaries, so a busy day does not dominate', () => {
  // 40 days at 1000 (1 reading/day), then one day with 200 readings at 600, now 900.
  const h = [...seg(40, 2, 1000, 24), ...seg(1.5, 1.01, 600, 0.06), { t: NOW, price: 900 }]
  const a = analyze(h)
  assert.equal(a.usual, 1000)
  assert.equal(Math.round(a.belowUsualPct!), 10)
  assert.ok(a.labels.includes('below_usual'))
})

test('35% or more is exceptional', () => {
  const a = analyze([...seg(40, 0.2, 1000, 24), { t: NOW, price: 640 }])
  assert.equal(a.exceptional, true)
  assert.equal(a.labels[0], 'exceptional')
})

test('a short price hike before the "drop" is not counted as the reference', () => {
  // 1000 for a month, raised to 1500 for one day, now "discounted" to 1000 → no real drop.
  const h = [...seg(30, 1.2, 1000, 12), ...seg(1, 0.2, 1500, 6), { t: NOW, price: 1000 }]
  const a = analyze(h)
  assert.ok(a.inflatedBeforeDrop)
  assert.equal(a.observedDropPct, undefined)
  assert.ok(!a.labels.includes('observed_drop'))
})

test('hike then a deeper cut measures the drop from the pre-hike price', () => {
  const h = [...seg(30, 1.2, 1000, 12), ...seg(1, 0.2, 1500, 6), { t: NOW, price: 800 }]
  const a = analyze(h)
  assert.equal(Math.round(a.observedDropPct!), 20)
  assert.equal(a.prevHigher?.price, 1000)
})

test('daily summaries group by Cairo day', () => {
  // 23:30 and 00:30 Cairo (UTC+2) are different days
  const d = dailySummaries([
    { t: Date.UTC(2026, 10, 4, 21, 30), price: 1 },
    { t: Date.UTC(2026, 10, 4, 22, 30), price: 2 },
  ])
  assert.equal(d.length, 2)
})

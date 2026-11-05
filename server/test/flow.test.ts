import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JobDef, SourceId } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { routes } from '../src/api.ts'
import { createPublisher } from '../src/publisher.ts'
import { repo as makeRepo } from '../src/repo.ts'
import { runJob } from '../src/scanner.ts'
import { createScheduler } from '../src/scheduler.ts'
import { FetchError, type Listing, type SourceAdapter } from '../src/sources/types.ts'
import type { Sender } from '../src/telegram.ts'

const MIN = 60_000
const job: JobDef = { id: 'test-mon', source: 'amazon', category: 'monitors', target: '/s?k=x', maxPages: 2, offsetSec: 0 }

/** A fake store whose prices the test controls. */
function world(start = Date.UTC(2026, 10, 5, 10)) {
  let t = start
  const prices = new Map<string, number | 'fail' | 'gone'>()
  let blockListing = false
  const listing = (key: string, price: number, listPrice?: number): Listing => ({
    source: 'amazon', storeKey: key, name: `Monitor ${key}`, url: `https://www.amazon.eg/dp/${key}`, price, listPrice, available: true,
  })
  const store: SourceAdapter = {
    id: 'amazon',
    async listingPage(_j, page) {
      if (blockListing) throw new FetchError('blocked', 'captcha')
      const all = [...prices.entries()].filter(([, p]) => typeof p === 'number') as [string, number][]
      const half = Math.ceil(all.length / 2)
      const slice = page === 1 ? all.slice(0, half) : all.slice(half)
      return { listings: slice.map(([k, p]) => listing(k, p)), hasNext: page === 1 }
    },
    async product(key) {
      const p = prices.get(key)
      if (p === 'fail' || p === undefined) throw new FetchError('timeout', 'timed out')
      if (p === 'gone') return { ...listing(key, 0), available: false }
      return listing(key, p)
    },
  }
  const db = openDb(':memory:')
  const repo = makeRepo(db)
  const adapters = { amazon: store, noon: store, emarati: store } as Record<SourceId, SourceAdapter>
  const sent: { channel: string; html: string }[] = []
  let sendResults: ('ok' | 'rate')[] = []
  const send: Sender = async (channel, html) => {
    const r = sendResults.shift() ?? 'ok'
    if (r === 'rate') return { ok: false, retryable: true, retryAfterMs: 1000, error: 'Telegram rate limit (429)' }
    sent.push({ channel, html })
    return { ok: true, messageId: sent.length, dryRun: false }
  }
  const now = () => t
  const deps = { db, repo, adapters, now, gapMs: 0 }
  const publisher = createPublisher({ ...deps, send })
  return {
    db, repo, deps, publisher, prices, sent,
    advance: (ms: number) => (t += ms),
    get now() { return t },
    block: (b: boolean) => (blockListing = b),
    failSends: (r: ('ok' | 'rate')[]) => (sendResults = r),
    scan: () => runJob(deps, job, t),
    deliveries: () => db.prepare('SELECT d.channel, d.state, d.cancel_reason, d.posted_price FROM deliveries d ORDER BY d.id').all() as { channel: string; state: string; cancel_reason: string | null; posted_price: number }[],
  }
}

/** Build a few hours of stable history at 10-minute scans. */
async function history(w: ReturnType<typeof world>, scans: number) {
  for (let i = 0; i < scans; i++) {
    await w.scan()
    w.advance(10 * MIN)
  }
}

test('discovery records every reading, even unchanged, without duplicating products', async () => {
  const w = world()
  w.prices.set('A', 1000).set('B', 500)
  await history(w, 3)
  assert.equal((w.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 2)
  assert.equal((w.db.prepare('SELECT COUNT(*) n FROM observations').get() as { n: number }).n, 6)
  const run = w.db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get() as Record<string, number | string>
  assert.equal(run.status, 'success')
  assert.equal(run.pages_ok, 2)
})

test('priority flow: >50% drop → priority now, general 5 min after discovery, recheck cancels when price reverts', async () => {
  const w = world()
  w.prices.set('A', 10000)
  await history(w, 6)
  w.prices.set('A', 4000) // 60% observed drop → exceptional + priority
  const r = await w.scan()
  assert.equal(r.scheduled, 1)
  await w.publisher.tick()
  assert.deepEqual(w.deliveries().map((d) => [d.channel, d.state]), [['priority', 'sent'], ['general', 'scheduled']])
  assert.match(w.sent[0].html, /نزول استثنائي — قيد التحقق/)
  assert.match(w.sent[0].html, /نزول مرصود <b>60%<\/b>/)

  w.advance(4 * MIN)
  await w.publisher.tick()
  assert.equal(w.deliveries()[1].state, 'scheduled', 'not before 5 minutes')

  w.prices.set('A', 10000) // deal ended during the delay
  w.advance(1 * MIN)
  await w.publisher.tick()
  const g = w.deliveries()[1]
  assert.equal(g.state, 'cancelled')
  assert.match(g.cancel_reason!, /Price went back to EGP 10,000/)
  assert.equal(w.sent.length, 1)
})

test('general recheck: still a deal → published; repeated scans do not repost', async () => {
  const w = world()
  w.prices.set('A', 10000)
  await history(w, 6)
  w.prices.set('A', 4000)
  await w.scan()
  await w.publisher.tick()
  w.advance(5 * MIN)
  await w.publisher.tick()
  assert.deepEqual(w.deliveries().map((d) => d.state), ['sent', 'sent'])
  const verified = w.db.prepare('SELECT verified_at FROM offers WHERE decision = ?').get('publish') as { verified_at: number | null }
  assert.ok(verified.verified_at, 'exceptional confirmed by the recheck')
  assert.doesNotMatch(w.sent[1].html, /قيد التحقق/, 'verified offers drop the verifying notice')

  await history(w, 3) // same price found again and again
  await w.publisher.tick()
  assert.equal(w.sent.length, 2)
})

test('failed recheck retries once, then cancels', async () => {
  const w = world()
  w.prices.set('A', 10000)
  await history(w, 6)
  w.prices.set('A', 4000)
  await w.scan()
  await w.publisher.tick()
  w.prices.set('A', 'fail')
  w.advance(5 * MIN)
  await w.publisher.tick()
  assert.equal(w.deliveries()[1].state, 'scheduled')
  w.advance(1 * MIN)
  await w.publisher.tick()
  assert.equal(w.deliveries()[1].state, 'cancelled')
  assert.match(w.deliveries()[1].cancel_reason!, /Could not recheck/)
})

test('telegram 429 → retrying → sent, with the attempt history kept', async () => {
  const w = world()
  w.prices.set('A', 1000)
  await history(w, 3)
  w.prices.set('A', 800) // 20% → general only
  await w.scan()
  w.failSends(['rate'])
  await w.publisher.tick()
  assert.equal(w.deliveries()[0].state, 'retrying')
  w.advance(10_000)
  await w.publisher.tick()
  assert.equal(w.deliveries()[0].state, 'sent')
  const attempts = JSON.parse((w.db.prepare('SELECT attempts FROM deliveries').get() as { attempts: string }).attempts)
  assert.deepEqual(attempts.map((a: { ok: boolean }) => a.ok), [false, true])
})

test('a blocked scan never makes old prices look freshly checked', async () => {
  const w = world()
  w.prices.set('A', 1000)
  await history(w, 2)
  const before = (w.db.prepare('SELECT last_seen_at FROM products').get() as { last_seen_at: number }).last_seen_at
  w.block(true)
  w.advance(10 * MIN)
  const r = await w.scan()
  assert.equal(r.status, 'failed')
  const after = (w.db.prepare('SELECT last_seen_at FROM products').get() as { last_seen_at: number }).last_seen_at
  assert.equal(after, before)
})

test('revisits refresh known products missing from listings, and record failures separately', async () => {
  const w = world()
  w.prices.set('A', 1000).set('B', 500)
  await history(w, 1)
  // B disappears from listings, but its product page still works.
  w.prices.delete('B')
  w.deps.adapters.amazon.product = async (key) => {
    if (key === 'B') return { source: 'amazon', storeKey: 'B', name: 'Monitor B', url: 'u', price: 450, available: true }
    throw new FetchError('timeout', 'timed out')
  }
  w.advance(10 * MIN)
  const r = await w.scan()
  assert.equal(r.revisitAttempted, 1)
  assert.equal(r.revisitOk, 1)
  const b = w.db.prepare("SELECT last_seen_at FROM products WHERE store_key = 'B'").get() as { last_seen_at: number }
  assert.equal(b.last_seen_at, w.now)
})

test('scheduler: every job every 10 minutes; a still-running job counts an overlap instead of doubling', async () => {
  let t = Date.UTC(2026, 10, 5, 10, 0, 0)
  let release!: () => void
  let runs = 0
  const db = openDb(':memory:')
  const slow: SourceAdapter = {
    id: 'amazon',
    listingPage: () => {
      runs++
      return new Promise((r) => (release = () => r({ listings: [], hasNext: false })))
    },
    product: async () => null,
  }
  const s = createScheduler(
    { db, repo: makeRepo(db), adapters: { amazon: slow, noon: slow, emarati: slow }, now: () => t, gapMs: 0 },
    [job],
  )
  s.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(runs, 1)
  assert.equal(s.status()[0].state, 'running')
  t += 10 * MIN
  s.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(runs, 1, 'no second concurrent run')
  assert.equal(s.status()[0].overlaps, 1)
  release()
  await new Promise((r) => setTimeout(r, 5))
  t += 10 * MIN
  s.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(runs, 2)
})

test('api: offers carry evidence, last successful check and not-refreshed flag', async () => {
  const w = world()
  w.prices.set('A', 1000).set('B', 700)
  await history(w, 3)
  w.prices.set('A', 750)
  await w.scan()
  const api = routes({ db: w.db, repo: w.repo, now: () => w.now })
  const res = api['GET /api/offers'](new URL('http://x/api/offers')) as { offers: { name: string; price: number; checkedAt: number; evidence: { labels: string[]; best: { basis: string } } }[] }
  assert.equal(res.offers.length, 1, 'B has no discount evidence')
  assert.equal(res.offers[0].price, 750)
  assert.equal(res.offers[0].evidence.best.basis, 'observed')
  assert.deepEqual(res.offers[0].evidence.labels, ['observed_drop', 'insufficient'])
  assert.equal(res.offers[0].checkedAt, w.now)

  const posts = api['GET /api/posts'](new URL('http://x/api/posts')) as { reason: string; deliveries: { channel: string }[] }[]
  assert.match(posts[0].reason, /observed drop 25%/)
  assert.deepEqual(posts[0].deliveries.map((d) => d.channel), ['general'])
})

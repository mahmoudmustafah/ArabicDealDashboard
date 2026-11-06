import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JobDef, SourceId } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { routes } from '../src/api.ts'
import { createPublisher, type PublisherDeps } from '../src/publisher.ts'
import { repo as makeRepo } from '../src/repo.ts'
import { runJob } from '../src/scanner.ts'
import { scheduleBackfill } from '../src/backfill.ts'
import { evaluateAndSchedule } from '../src/pipeline.ts'
import { createScheduler } from '../src/scheduler.ts'
import { FetchError, type Listing, type SourceAdapter } from '../src/sources/types.ts'
import type { Photo, Sender } from '../src/telegram.ts'

const MIN = 60_000
const job: JobDef = { id: 'test-mon', source: 'amazon', category: 'monitors', target: '/s?k=x', maxPages: 2, offsetSec: 0 }

/** A fake store whose prices the test controls. */
function world(start = Date.UTC(2026, 10, 5, 10)) {
  let t = start
  const prices = new Map<string, number | 'fail' | 'gone'>()
  let blockListing = false
  const listing = (key: string, price: number, listPrice?: number): Listing => ({
    source: 'amazon', storeKey: key, name: `Monitor ${key}`, image: `https://img.test/${key}.jpg`, url: `https://www.amazon.eg/dp/${key}`, price, listPrice, available: true,
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
  const sent: { channel: string; html: string; image?: Photo }[] = []
  const shots: { capture?: PublisherDeps['capture'] } = {}
  let sendResults: ('ok' | 'rate')[] = []
  const send: Sender = async (channel, html, image) => {
    const r = sendResults.shift() ?? 'ok'
    if (r === 'rate') return { ok: false, retryable: true, retryAfterMs: 1000, error: 'Telegram rate limit (429)' }
    sent.push({ channel, html, image })
    return { ok: true, messageId: sent.length, dryRun: false }
  }
  const now = () => t
  const deps = { db, repo, adapters, now, gapMs: 0 }
  const publisher = createPublisher({ ...deps, send, capture: (...a) => shots.capture?.(...a) ?? Promise.resolve(null) })
  return {
    db, repo, deps, publisher, prices, sent,
    advance: (ms: number) => (t += ms),
    get now() { return t },
    shots,
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
  assert.match(w.sent[0].html, /لسه بنتأكد منه/)
  assert.match(w.sent[0].html, /<b>4,000 جنيه<\/b> بدل <s><b>10,000<\/b><\/s> · خصم <b>60%<\/b>/)

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
  assert.doesNotMatch(w.sent[1].html, /لسه بنتأكد منه/, 'verified offers drop the verifying notice')

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

async function priorityOffer() {
  const w = world()
  w.prices.set('A', 10000)
  await history(w, 3)
  w.prices.set('A', 4000)
  await w.scan()
  return w
}

test('a post uses the store-page screenshot when there is one', async () => {
  const w = await priorityOffer()
  const shot = Buffer.from('jpeg')
  const asked: unknown[][] = []
  w.shots.capture = async (...a) => (asked.push(a), shot)
  await w.publisher.tick()
  assert.equal(w.sent[0].image, shot)
  assert.deepEqual(asked[0], ['priority', 'amazon', 'https://www.amazon.eg/dp/A', 4000])
})

test('a blocked or failed screenshot falls back to the product image and still publishes', async () => {
  for (const capture of [async () => null, async () => Promise.reject(new Error('browser crashed'))]) {
    const w = await priorityOffer()
    w.shots.capture = capture
    await w.publisher.tick()
    assert.equal(w.sent[0].image, 'https://img.test/A.jpg')
    assert.equal(w.deliveries()[0].state, 'sent')
  }
})

test('a delayed post is cancelled if the price moved and the shown discount fell under the minimum', async () => {
  const w = world()
  w.prices.set('A', 1000)
  await history(w, 3)
  w.prices.set('A', 500) // qualifies as a big observed drop
  await w.scan()
  await w.publisher.tick()
  w.db.prepare("UPDATE offers SET ref_price = 510, basis = 'observed'").run() // shown discount is now about 2%
  w.advance(6 * MIN)
  await w.publisher.tick()
  const general = w.deliveries().find((d) => d.channel === 'general')!
  assert.equal(general.state, 'cancelled')
  assert.match(general.cancel_reason!, /under the 5% minimum/)
  assert.equal(w.sent.filter((s) => s.channel === 'general').length, 0)
})

test('supermarket categories post only to their own channel, with no priority, however big the discount', async () => {
  for (const category of ['supermarket', 'home-care', 'diapers', 'baby-care'] as const) {
    const w = world()
    const own: JobDef = { ...job, category }
    w.prices.set('A', 1000)
    for (let i = 0; i < 3; i++) {
      await runJob(w.deps, own, w.now)
      w.advance(10 * MIN)
    }
    w.prices.set('A', 400)
    await runJob(w.deps, own, w.now)
    await w.publisher.tick()
    assert.deepEqual(w.deliveries().map((d) => [d.channel, d.state]), [['supermarket', 'sent']])
    assert.deepEqual(w.sent.map((m) => m.channel), ['supermarket'])
  }
})

test('the same product read with and without a seller stays one product, and is not posted twice', async () => {
  const w = world()
  const base = { source: 'noon' as const, storeKey: 'N1', name: 'Cleaner', url: 'https://www.noon.com/x', price: 76 }
  const a = w.repo.upsertProduct(base, 'monitors', w.now)
  const b = w.repo.upsertProduct({ ...base, seller: 'noon Grocery' }, 'monitors', w.now)
  assert.equal(b.id, a.id)
})

test('backfill posts existing discounts once, strongest first and spaced out, rechecked, and skips any under the minimum', async () => {
  const w = world()
  w.repo.upsertProduct({ source: 'amazon', storeKey: 'A', name: 'Diapers A', url: 'https://www.amazon.eg/dp/A', price: 500, listPrice: 1000, available: true }, 'diapers', w.now)
  w.repo.upsertProduct({ source: 'amazon', storeKey: 'B', name: 'Diapers B', url: 'https://www.amazon.eg/dp/B', price: 700, listPrice: 1000, available: true }, 'diapers', w.now)
  w.prices.set('A', 500).set('B', 700)
  w.db.prepare('UPDATE products SET list_price = 1000').run()
  for (const key of ['A', 'B']) {
    const p = w.db.prepare('SELECT id FROM products WHERE store_key = ?').get(key) as { id: number }
    w.repo.recordObservation(p.id, { source: 'amazon', storeKey: key, name: key, url: 'x', price: key === 'A' ? 500 : 700, listPrice: 1000, available: true }, w.now, null)
  }
  w.db.prepare('UPDATE products SET list_price = 1000, available = 1').run()
  const opts = { categories: ['diapers'], minPct: 25, spacingMs: 3 * MIN, maxAgeMs: 12 * 60 * MIN, now: w.now }
  const plan = scheduleBackfill(w.db, w.repo, opts)
  assert.deepEqual(plan.map((x) => x.p.store_key), ['A', 'B'])
  assert.deepEqual(scheduleBackfill(w.db, w.repo, opts).length, 0, 'a second run schedules nothing')

  await w.publisher.tick()
  assert.equal(w.sent.length, 1, 'only the strongest is due')
  assert.equal(w.sent[0].channel, 'supermarket')
  assert.match(w.sent[0].html, /الخصم حسب الموقع/)
  w.prices.set('B', 900) // 10% now: under the backfill minimum
  w.advance(3 * MIN)
  await w.publisher.tick()
  assert.equal(w.sent.length, 1)
  assert.equal(w.deliveries()[1].state, 'cancelled')
})

test('a general backfill goes private first, then public after a recheck, and never touches own-channel categories', async () => {
  const w = world()
  const add = (key: string, category: 'monitors' | 'diapers', price: number) => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: `Item ${key}`, url: `https://www.amazon.eg/dp/${key}`, price, listPrice: 1000, available: true }, category, w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: 1000, available: true }, w.now, null)
    w.prices.set(key, price)
  }
  add('M', 'monitors', 500)
  add('D', 'diapers', 400)
  add('L', 'monitors', 700) // 30%: under this backfill's minimum
  w.db.prepare('UPDATE products SET list_price = 1000, available = 1').run()
  const plan = scheduleBackfill(w.db, w.repo, { categories: [], minPct: 40, spacingMs: 5 * MIN, maxAgeMs: 12 * 60 * MIN, now: w.now })
  assert.deepEqual(plan.map((x) => x.p.store_key), ['M'])
  await w.publisher.tick()
  assert.deepEqual(w.sent.map((s) => s.channel), ['priority'])
  assert.match(w.sent[0].html, /الخصم حسب الموقع/)
  w.advance(5 * MIN)
  w.prices.set('M', 800) // 20% now: under this backfill's 40% minimum
  await w.publisher.tick()
  assert.equal(w.sent.length, 1, 'the public post is skipped')
  assert.equal(w.deliveries().find((d) => d.channel === 'general')?.state, 'cancelled')
})

test('a fresh offer goes ahead of the backlog, and backlog offers are rechecked first', async () => {
  const w = world()
  const add = (key: string, price: number, reason: string) => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: `Item ${key}`, url: `https://www.amazon.eg/dp/${key}`, price, available: true }, 'monitors', w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: 1000, available: true }, w.now, null)
    w.prices.set(key, price)
    const offerId = w.repo.insertOffer({ product_id: id, detected_at: w.now, price, ref_price: 1000, basis: 'advertised', pct: 100 - price / 10, labels: '[]', priority: 0, decision: 'publish', reason, status: 'scheduled' })
    w.repo.insertDelivery(offerId, 'general', w.now, price)
  }
  add('OLD', 300, 'advertised 70% (existing offer)')
  add('NEW', 900, 'advertised 10%')
  w.db.prepare('UPDATE products SET list_price = 1000').run()
  await w.publisher.tick()
  assert.deepEqual(w.sent.map((s) => /Item (\w+)/.exec(s.html)?.[1]), ['NEW', 'OLD'])
})

test('a discount that was already there still posts now, marked as backlog', async () => {
  const w = world()
  const own: JobDef = { ...job }
  const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: 'A', name: 'A', url: 'x', price: 700, available: true }, own.category, w.now)
  w.repo.recordObservation(id, { source: 'amazon', storeKey: 'A', name: 'A', url: 'x', price: 700, listPrice: 1000, available: true }, w.now, null)
  w.db.prepare('UPDATE products SET list_price = 1000, available = 1').run()
  const r = evaluateAndSchedule(w.db, w.repo, id, w.now)
  assert.equal(r.decision?.publish, true)
})

test('a Telegram 429 pauses all sending until its retry time', async () => {
  const w = world()
  w.prices.set('A', 1000).set('B', 1000)
  await history(w, 3)
  w.prices.set('A', 500).set('B', 500)
  await w.scan()
  w.failSends(['rate'])
  await w.publisher.tick()
  assert.equal(w.sent.length, 0, 'nothing else goes out during the pause')
  w.advance(11_000)
  await w.publisher.tick()
  assert.ok(w.sent.length > 0)
})

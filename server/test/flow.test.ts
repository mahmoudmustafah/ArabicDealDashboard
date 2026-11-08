import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JobDef, SourceId } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { routes } from '../src/api.ts'
import { createPublisher, type PublisherDeps } from '../src/publisher.ts'
import { repo as makeRepo } from '../src/repo.ts'
import { runJob } from '../src/scanner.ts'
import { scheduleBackfill } from '../src/backfill.ts'
import { publication } from '../src/config.ts'
import { mergeDuplicateProducts } from '../src/db.ts'
import { pickTopDeals, renderTopDeals } from '../src/dailyTop.ts'
import { amazonPaused, amazonRisks, blocksSustained, createRiskWatch, setAmazonPaused } from '../src/riskWatch.ts'
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

/** Treat everything in the test as older than the moment posting opened. */
function postingOpenedLater(t: { after: (fn: () => void) => void }) {
  const { changedSince, discoveredSince } = publication
  publication.changedSince = Number.MAX_SAFE_INTEGER
  publication.discoveredSince = Number.MAX_SAFE_INTEGER
  t.after(() => Object.assign(publication, { changedSince, discoveredSince }))
}

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
  assert.match(general.cancel_reason!, /under the 15% minimum/)
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
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: `Item ${key}`, url: `https://www.amazon.eg/dp/${key}`, price, available: true }, 'diapers', w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: 1000, available: true }, w.now, null)
    w.prices.set(key, price)
    const offerId = w.repo.insertOffer({ product_id: id, detected_at: w.now, price, ref_price: 1000, basis: 'advertised', pct: 100 - price / 10, labels: '[]', priority: 0, decision: 'publish', reason, status: 'scheduled' })
    w.repo.insertDelivery(offerId, 'supermarket', w.now, price)
  }
  add('OLD', 300, 'advertised 70% (existing offer)')
  add('NEW', 900, 'advertised 10%')
  w.db.prepare('UPDATE products SET list_price = 1000').run()
  await w.publisher.tick()
  assert.deepEqual(w.sent.map((s) => /Item (\w+)/.exec(s.html)?.[1]), ['NEW', 'OLD'])
})

test('a discount that was already there still posts now, marked as backlog', async (t) => {
  postingOpenedLater(t)
  const w = world()
  const own: JobDef = { ...job }
  const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: 'A', name: 'A', url: 'x', price: 700, available: true }, own.category, w.now)
  w.repo.recordObservation(id, { source: 'amazon', storeKey: 'A', name: 'A', url: 'x', price: 700, listPrice: 1000, available: true }, w.now, null)
  w.db.prepare('UPDATE products SET list_price = 1000, available = 1').run()
  const r = evaluateAndSchedule(w.db, w.repo, id, w.now)
  assert.equal(r.decision?.publish, true)
  const offer = w.db.prepare("SELECT reason FROM offers WHERE decision = 'publish'").get() as { reason: string }
  assert.match(offer.reason, /existing offer/)
})

test('an older offer needs 15%, while one with a changed price posts from 5%', async (t) => {
  postingOpenedLater(t)
  const w = world()
  const seen = (key: string, price: number) => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: key, url: 'x', price, available: true }, job.category, w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: 1000, available: true }, w.now, null)
    w.db.prepare('UPDATE products SET list_price = 1000, available = 1 WHERE id = ?').run(id)
    return id
  }
  assert.equal(evaluateAndSchedule(w.db, w.repo, seen('OLD', 900), w.now).decision?.publish, false)
  assert.equal(evaluateAndSchedule(w.db, w.repo, seen('OLD2', 840), w.now).decision?.publish, true)
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

test('the block warning fires at 80%, once in 3 hours, not at the usual level', async () => {
  const w = world()
  const run = db_run(w)
  for (let i = 0; i < 10; i++) run(i < 6 ? 'blocked: x' : null)
  assert.deepEqual(amazonRisks(w.db, w.now), [], 'the usual 60%')
  for (let i = 0; i < 20; i++) run('blocked: x')
  const sent: string[] = []
  const check = createRiskWatch({ db: w.db, send: async (t) => sent.push(t), now: () => w.now, dailyHour: 99 })
  await check()
  await check()
  assert.equal(sent.length, 1)
  assert.match(sent[0], /أمازون حجب/)
})

test('the daily summary goes out once, and a dead product page raises a warning', async () => {
  const w = world()
  const sent: string[] = []
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(w.now))
  const check = createRiskWatch({ db: w.db, send: async (t) => sent.push(t), productOk: async () => false, now: () => w.now, dailyHour: hour })
  await check()
  await check()
  assert.equal(sent.filter((t) => t.includes('ملخص')).length, 1)
  assert.equal(sent.filter((t) => t.includes('مش بتفتح')).length, 1)
  setAmazonPaused(false)
})

function db_run(w: ReturnType<typeof world>) {
  return (error: string | null) =>
    w.db
      .prepare(`INSERT INTO scan_runs (job_id, source, category, due_at, started_at, finished_at, status, error) VALUES ('a', 'amazon', 'tvs', ?, ?, ?, 'partial', ?)`)
      .run(w.now, w.now - 60_000, w.now, error)
}

test('the guard pauses on two hours of heavy blocking, holds Amazon posts, and resumes after 6 clear hours', async (t) => {
  t.after(() => setAmazonPaused(false))
  const w = world()
  const start = w.now
  const blockedAt = (at: number) => w.db.prepare(`INSERT INTO scan_runs (job_id, source, category, due_at, started_at, finished_at, status, error) VALUES ('a', 'amazon', 'tvs', ?, ?, ?, 'failed', 'blocked: x')`).run(at, at, at)
  for (let i = 0; i < 10; i++) blockedAt(start - 90 * MIN)
  const sent: string[] = []
  const check = createRiskWatch({ db: w.db, send: async (x) => sent.push(x), now: () => w.now, dailyHour: 99 })
  await check()
  assert.equal(amazonPaused(), false, 'one bad hour is not enough')
  for (let i = 0; i < 10; i++) blockedAt(start - 10 * MIN)
  await check()
  assert.equal(amazonPaused(), true)
  assert.match(sent.at(-1)!, /وقفت أمازون/)

  const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: 'A', name: 'A', url: 'https://www.amazon.eg/dp/A', price: 500, available: true }, 'monitors', w.now)
  const offer = w.repo.insertOffer({ product_id: id, detected_at: w.now, price: 500, ref_price: 1000, basis: 'advertised', pct: 50, labels: '[]', priority: 0, decision: 'publish', reason: 'x', status: 'scheduled' })
  w.repo.insertDelivery(offer, 'general', w.now, 500)
  await w.publisher.tick()
  assert.equal(w.sent.length, 0)
  assert.equal(w.deliveries()[0].state, 'scheduled', 'held, not cancelled')

  w.advance(3 * 60 * MIN)
  await check() // clear from here
  w.advance(5 * 60 * MIN)
  await check()
  assert.equal(amazonPaused(), true, 'only 5 clear hours')
  w.advance(61 * MIN)
  await check()
  assert.equal(amazonPaused(), false)
  assert.match(sent.at(-1)!, /رجع يشتغل/)
})

test('a failed product page pauses Amazon, a blocked check does not', async (t) => {
  t.after(() => setAmazonPaused(false))
  const w = world()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(w.now))
  let result: boolean | null = null
  const check = createRiskWatch({ db: w.db, send: async () => 0, productOk: async () => result, now: () => w.now, dailyHour: hour })
  await check()
  assert.equal(amazonPaused(), false)
  const again = createRiskWatch({ db: w.db, send: async () => 0, productOk: async () => (result = false), now: () => w.now, dailyHour: hour })
  await again()
  assert.equal(amazonPaused(), true)
})

test('the usual level of Amazon blocking does not stop it', () => {
  const w = world()
  const run = db_run(w)
  for (let i = 0; i < 20; i++) run(i < 13 ? 'blocked: x' : null)
  assert.equal(blocksSustained(w.db, w.now), false)
})

test('the public channel keeps its pace: the strongest goes first, and the rest are dropped, not delayed', async () => {
  const w = world()
  const add = (key: string, price: number) => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: `Item ${key}`, url: `https://www.amazon.eg/dp/${key}`, price, available: true }, 'monitors', w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: 1000, available: true }, w.now, null)
    w.prices.set(key, price)
    const offerId = w.repo.insertOffer({ product_id: id, detected_at: w.now, price, ref_price: 1000, basis: 'advertised', pct: 100 - price / 10, labels: '[]', priority: 0, decision: 'publish', reason: 'x', status: 'scheduled' })
    w.repo.insertDelivery(offerId, 'general', w.now, price)
    return id
  }
  add('WEAK', 800)
  add('STRONG', 650)
  const dropped = add('MID', 750)
  const paced = createPublisher({ db: w.db, repo: w.repo, adapters: w.deps.adapters, now: w.deps.now, send: async (ch, html) => (w.sent.push({ channel: ch, html }), { ok: true, messageId: 1, dryRun: false }), generalGapMs: 6 * MIN, generalDropAfterMs: 10 * MIN })
  await paced.tick()
  assert.deepEqual(w.sent.map((s) => /Item (\w+)/.exec(s.html)?.[1]), ['STRONG'])
  w.advance(11 * MIN)
  await paced.tick()
  assert.equal(w.sent.length, 1, 'too late, so dropped')
  assert.equal(w.deliveries().filter((d) => d.state === 'cancelled').length, 2)
  assert.equal(w.repo.lastPost(dropped)?.price, 750, 'a dropped offer does not queue again at the same price')
})

test('a public offer under 15% is skipped, while the supermarket channel still takes 5%', async () => {
  const w = world()
  const add = (key: string, category: 'monitors' | 'diapers') => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: key, url: 'x', price: 900, available: true }, category, w.now)
    w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price: 900, listPrice: 1000, available: true }, w.now, null)
    w.db.prepare('UPDATE products SET list_price = 1000, available = 1 WHERE id = ?').run(id)
    return evaluateAndSchedule(w.db, w.repo, id, w.now).decision?.publish
  }
  assert.equal(add('M', 'monitors'), false)
  assert.equal(add('D', 'diapers'), true)
})

test('the daily top 5 rechecks prices, puts our own evidence first, mixes categories, and has no store links', async () => {
  const w = world()
  const add = (key: string, category: 'monitors' | 'tvs' | 'mobiles' | 'diapers', history: number[], list: number) => {
    const { id } = w.repo.upsertProduct({ source: 'amazon', storeKey: key, name: `Item ${key}`, url: `https://www.amazon.eg/dp/${key}`, price: history.at(-1)!, available: true }, category, w.now)
    history.forEach((price, i) => w.repo.recordObservation(id, { source: 'amazon', storeKey: key, name: key, url: 'x', price, listPrice: list, available: true }, w.now - (history.length - i) * 60 * MIN, null))
    w.prices.set(key, history.at(-1)!)
  }
  add('ADV', 'tvs', [300], 1000)
  add('OBS', 'monitors', [1000, 1000, 800], 800)
  add('GONE', 'mobiles', [500], 1000)
  add('BABY', 'diapers', [100], 1000)
  w.prices.set('GONE', 950) // back up: no longer a deal
  w.db.prepare('UPDATE products SET available = 1, last_seen_at = ?').run(w.now)
  w.db.prepare(`UPDATE products SET list_price = CASE store_key WHEN 'OBS' THEN NULL ELSE 1000 END`).run()
  const deals = await pickTopDeals({ db: w.db, repo: w.repo, adapters: w.deps.adapters, now: w.now })
  assert.deepEqual(deals.map((d) => d.name), ['Item OBS', 'Item ADV'])
  const text = renderTopDeals(deals, 'https://t.me/+abc', w.now)
  assert.match(text, /https:\/\/t\.me\/\+abc/)
  assert.doesNotMatch(text, /amazon\.eg|tag=/)
})

test('duplicate products merge into one, keeping all history, and cannot come back', () => {
  const w = world()
  w.db.exec('DROP INDEX products_one_per_key')
  const insert = w.db.prepare(`INSERT INTO products (source, store_key, seller, category, name, url, discovered_at, last_seen_at, list_price) VALUES ('amazon', 'A', ?, ?, 'A', 'x', ?, ?, ?)`)
  const a = Number(insert.run('', 'monitors', 100, 500, 900).lastInsertRowid)
  const b = Number(insert.run('Amazon.eg', 'diapers', 50, 800, 1000).lastInsertRowid)
  for (const [id, t] of [[a, 500], [b, 800], [a, 300]]) w.db.prepare('INSERT INTO observations (product_id, t, price) VALUES (?, ?, 80)').run(id, t)
  const offer = w.repo.insertOffer({ product_id: b, detected_at: 800, price: 80, ref_price: 100, basis: 'advertised', pct: 20, labels: '[]', priority: 0, decision: 'publish', reason: 'x', status: 'published' })
  w.repo.insertDelivery(offer, 'general', 800, 80)
  w.db.prepare(`UPDATE deliveries SET state = 'sent', dry_run = 0, sent_at = 800, posted_price = 80`).run()
  w.db.prepare('INSERT INTO watchlist (product_id, added_at) VALUES (?, 1)').run(b)

  assert.equal(mergeDuplicateProducts(w.db), 1)
  const rows = w.db.prepare(`SELECT * FROM products WHERE store_key = 'A'`).all() as { id: number; discovered_at: number; last_seen_at: number; list_price: number; category: string }[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, a)
  assert.equal(rows[0].discovered_at, 50)
  assert.equal(rows[0].last_seen_at, 800)
  assert.equal(rows[0].list_price, 1000)
  assert.equal(rows[0].category, 'diapers', 'keeps its own channel')
  assert.equal((w.db.prepare('SELECT COUNT(*) n FROM observations WHERE product_id = ?').get(a) as { n: number }).n, 3)
  assert.equal(w.repo.lastPost(a)?.price, 80, 'the no-repost rule still sees the post')
  assert.equal((w.db.prepare('SELECT product_id p FROM watchlist').get() as { p: number }).p, a)
  assert.equal(mergeDuplicateProducts(w.db), 0)

  w.db.exec('CREATE UNIQUE INDEX products_one_per_key ON products (source, store_key)')
  assert.throws(() => insert.run('Other', 'monitors', 1, 1, 1), /UNIQUE/)
})

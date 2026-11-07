import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { categories, evidence as E, sources, telegram } from './config.ts'
import { json, type DB } from './db.ts'
import { analyze, dailySummaries, type Analysis } from './evaluate.ts'
import { HISTORY_WINDOW_MS } from './pipeline.ts'
import type { DeliveryRow, OfferRow, ProductRow, Repo } from './repo.ts'
import type { createScheduler } from './scheduler.ts'
import { unitPrice } from './units.ts'

/**
 * Read API for the dashboard (brief §18, §20). Every timestamp is UTC ms, and the UI formats it in Cairo time.
 * "checkedAt" is always the last SUCCESSFUL reading. A newer failed attempt shows up as notRefreshed,
 * never as a fresh check.
 */
type Ctx = { db: DB; repo: Repo; scheduler?: ReturnType<typeof createScheduler>; now: () => number }

function productView(ctx: Ctx, p: ProductRow, a?: Analysis) {
  const now = ctx.now()
  const pack = p.pack_unit ? { value: p.pack_value ?? undefined, unit: p.pack_unit as 'g', qty: p.pack_qty ?? undefined } : undefined
  return {
    id: p.id,
    source: p.source,
    category: p.category,
    name: p.name,
    brand: p.brand,
    image: p.image,
    url: p.url,
    variant: p.variant,
    seller: p.seller || null,
    available: p.available === null ? null : !!p.available,
    promos: ctx.repo.promos(p),
    listPrice: p.list_price,
    price: a?.current.price ?? null,
    unitPrice: a && pack ? unitPrice(a.current.price, pack) : undefined,
    checkedAt: p.last_seen_at,
    stale: !p.last_seen_at || now - p.last_seen_at > E.staleAfterMs,
    notRefreshed: !!p.last_failure_at && (!p.last_seen_at || p.last_failure_at > p.last_seen_at),
    lastFailure: p.last_failure,
    discoveredAt: p.discovered_at,
    evidence: a && {
      labels: a.labels,
      best: a.best,
      observedDropPct: a.observedDropPct,
      belowUsualPct: a.belowUsual ? a.belowUsualPct : undefined,
      advertisedPct: a.advertisedPct,
      usual: a.usual,
      usualWindowDays: a.usualWindowDays,
      lowest: a.lowest,
      prevHigher: a.prevHigher,
      inflatedBeforeDrop: a.inflatedBeforeDrop,
      detectedAt: a.detectedAt,
      readings: a.count,
      spanDays: a.spanDays,
      coveredDays: a.coveredDays,
      sufficient: a.sufficient,
    },
  }
}

function analyzed(ctx: Ctx, p: ProductRow) {
  const h = ctx.repo.history(p.id, ctx.now() - HISTORY_WINDOW_MS)
  return h.length ? analyze(h, p.list_price ?? undefined) : undefined
}

function deliveriesFor(ctx: Ctx, offerId: number) {
  return (ctx.db.prepare('SELECT * FROM deliveries WHERE offer_id = ? ORDER BY channel DESC').all(offerId) as DeliveryRow[]).map((d) => ({
    channel: d.channel,
    state: d.state,
    scheduledAt: d.scheduled_at,
    nextAttemptAt: d.next_attempt_at,
    sentAt: d.sent_at,
    messageId: d.message_id,
    dryRun: !!d.dry_run,
    cancelReason: d.cancel_reason,
    postedPrice: d.posted_price,
    attempts: json(d.attempts, []),
  }))
}

const offerView = (ctx: Ctx, o: OfferRow & { name?: string; source?: string; image?: string }) => ({
  id: o.id,
  productId: o.product_id,
  name: o.name,
  source: o.source,
  image: o.image,
  detectedAt: o.detected_at,
  price: o.price,
  refPrice: o.ref_price,
  basis: o.basis,
  pct: o.pct,
  labels: json(o.labels, []),
  priority: !!o.priority,
  decision: o.decision,
  reason: o.reason,
  status: o.status,
  verifiedAt: o.verified_at,
  deliveries: o.decision === 'publish' ? deliveriesFor(ctx, o.id) : [],
})

export function routes(ctx: Ctx) {
  const { db } = ctx
  const all = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as Record<string, unknown>[]

  return {
    'GET /api/health': () => ({ ok: true, now: ctx.now() }),

    'GET /api/meta': () => ({
      sources,
      categories,
      rules: E,
      tracked: (db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n,
      // Whether each destination is configured. Never the chat ids or the token.
      telegram: { priority: !!(telegram.token && telegram.priorityChatId), general: !!(telegram.token && telegram.generalChatId), supermarket: !!(telegram.token && telegram.chatId('supermarket')) },
    }),

    'GET /api/offers': (u: URL) => {
      const where: string[] = ['last_seen_at IS NOT NULL']
      const args: (string | number)[] = []
      for (const k of ['category', 'source'] as const) {
        const v = u.searchParams.get(k)
        if (v) {
          where.push(`${k} = ?`)
          args.push(v)
        }
      }
      const qtext = u.searchParams.get('q')
      if (qtext) {
        where.push('(name LIKE ? OR brand LIKE ?)')
        args.push(`%${qtext}%`, `%${qtext}%`)
      }
      const rows = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')}`).all(...args) as ProductRow[]
      const label = u.searchParams.get('label')
      const minP = Number(u.searchParams.get('minPrice') ?? 0)
      const maxP = Number(u.searchParams.get('maxPrice') ?? Infinity)
      const since = u.searchParams.get('sinceHours') ? ctx.now() - Number(u.searchParams.get('sinceHours')) * 3_600_000 : 0
      let list = rows
        .map((p) => productView(ctx, p, analyzed(ctx, p)))
        .filter((v) => v.evidence?.best)
        .filter((v) => !label || v.evidence!.labels.includes(label as never))
        .filter((v) => v.price! >= minP && v.price! <= maxP)
        .filter((v) => v.evidence!.detectedAt >= since)
      const sort = u.searchParams.get('sort') ?? 'drop'
      list.sort((a, b) =>
        sort === 'newest'
          ? b.evidence!.detectedAt - a.evidence!.detectedAt
          : sort === 'price'
            ? a.price! - b.price!
            : (b.evidence!.observedDropPct ?? 0) - (a.evidence!.observedDropPct ?? 0) || b.evidence!.best!.pct - a.evidence!.best!.pct,
      )
      const total = list.length
      // Stats describe every matching offer, not just the returned page.
      const stats = {
        offers: total,
        observed: list.filter((v) => v.evidence!.labels.includes('observed_drop')).length,
        sufficient: list.filter((v) => v.evidence!.sufficient).length,
        verifying: list.filter((v) => v.evidence!.labels.includes('exceptional')).length,
        stale: list.filter((v) => v.stale).length,
      }
      list = list.slice(0, Number(u.searchParams.get('limit') ?? 200))
      return { total, stats, offers: list }
    },

    'GET /api/products/:id': (_u: URL, id: string) => {
      const p = ctx.repo.product(Number(id))
      if (!p) return null
      const h = ctx.repo.history(p.id, ctx.now() - HISTORY_WINDOW_MS)
      const a = h.length ? analyze(h, p.list_price ?? undefined) : undefined
      return {
        ...productView(ctx, p, a),
        watched: !!db.prepare('SELECT 1 FROM watchlist WHERE product_id = ?').get(p.id),
        daily: dailySummaries(h),
        recent: h.filter((o) => o.t > ctx.now() - 7 * 86_400_000),
        failures: all('SELECT t, reason FROM read_failures WHERE product_id = ? ORDER BY t DESC LIMIT 20', p.id),
        offers: (db.prepare('SELECT * FROM offers WHERE product_id = ? ORDER BY detected_at DESC LIMIT 20').all(p.id) as OfferRow[]).map((o) => offerView(ctx, o)),
      }
    },

    'GET /api/watchlist': () => {
      const rows = db.prepare('SELECT p.*, w.added_at FROM watchlist w JOIN products p ON p.id = w.product_id ORDER BY w.added_at DESC').all() as (ProductRow & { added_at: number })[]
      return rows.map((p) => {
        const h = ctx.repo.history(p.id, ctx.now() - HISTORY_WINDOW_MS)
        const a = h.length ? analyze(h, p.list_price ?? undefined) : undefined
        let change: { from: number; to: number; at: number } | undefined
        for (let i = h.length - 1; i > 0; i--)
          if (h[i].price !== h[i - 1].price) {
            change = { from: h[i - 1].price, to: h[i].price, at: h[i].t }
            break
          }
        return { ...productView(ctx, p, a), addedAt: p.added_at, latestChange: change, last30: dailySummaries(h.filter((o) => o.t > ctx.now() - 30 * 86_400_000)) }
      })
    },
    'POST /api/watchlist/:id': (_u: URL, id: string) => {
      db.prepare('INSERT OR IGNORE INTO watchlist (product_id, added_at) VALUES (?, ?)').run(Number(id), ctx.now())
      return { ok: true }
    },
    'DELETE /api/watchlist/:id': (_u: URL, id: string) => {
      db.prepare('DELETE FROM watchlist WHERE product_id = ?').run(Number(id))
      return { ok: true }
    },

    'GET /api/jobs': () => {
      const status = ctx.scheduler?.status() ?? []
      return status.map((s) => ({
        id: s.job.id,
        source: s.job.source,
        category: s.job.category,
        intervalMin: s.job.intervalMin ?? 10,
        state: s.state,
        dueAt: s.dueAt,
        nextDueAt: s.nextDueAt,
        overdue: s.overdue,
        overlaps: s.overlaps,
        runs: all('SELECT * FROM scan_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 8', s.job.id),
      }))
    },

    'GET /api/scans': (u: URL) => all('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?', Number(u.searchParams.get('limit') ?? 100)),

    'GET /api/stale': () =>
      (db.prepare('SELECT * FROM products WHERE last_seen_at IS NULL OR last_seen_at < ? ORDER BY last_seen_at').all(ctx.now() - E.staleAfterMs) as ProductRow[]).map((p) =>
        productView(ctx, p, analyzed(ctx, p)),
      ),

    'GET /api/posts': (u: URL) =>
      (
        db
          .prepare(`SELECT o.*, p.name, p.source, p.image FROM offers o JOIN products p ON p.id = o.product_id
            WHERE o.decision = 'publish' ORDER BY o.detected_at DESC LIMIT ?`)
          .all(Number(u.searchParams.get('limit') ?? 100)) as (OfferRow & { name: string; source: string; image: string })[]
      ).map((o) => offerView(ctx, o)),

    'GET /api/decisions': (u: URL) =>
      (
        db
          .prepare(`SELECT o.*, p.name, p.source, p.image FROM offers o JOIN products p ON p.id = o.product_id ORDER BY o.detected_at DESC LIMIT ?`)
          .all(Number(u.searchParams.get('limit') ?? 200)) as (OfferRow & { name: string; source: string; image: string })[]
      ).map((o) => offerView(ctx, o)),
  }
}

type Handler = (u: URL, id: string) => unknown

export function startApi(ctx: Ctx, port = Number(process.env.PORT ?? 8787)) {
  const table = routes(ctx) as Record<string, Handler>
  const compiled = Object.entries(table).map(([key, fn]) => {
    const [method, path] = key.split(' ')
    return { method, re: new RegExp('^' + path.replace(':id', '(\\d+)') + '/?$'), fn }
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN ?? '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    const u = new URL(req.url ?? '/', 'http://x')
    for (const r of compiled) {
      const m = req.method === r.method && u.pathname.match(r.re)
      if (!m) continue
      try {
        const body = r.fn(u, m[1])
        if (body === null) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
        return void res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
      } catch (e) {
        console.error(e)
        return void res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"internal"}')
      }
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
  })
  server.listen(port, () => console.log(`[api] listening on :${port}`))
  return server
}

import { startApi } from './api.ts'
import { publication, telegram } from './config.ts'
import { createRiskWatch } from './riskWatch.ts'
import { createScreenshotter } from './screenshot.ts'
import { openDb } from './db.ts'
import { createPublisher } from './publisher.ts'
import { repo as makeRepo } from './repo.ts'
import { createScheduler } from './scheduler.ts'
import { makeAdapters } from './sources/index.ts'
import { CAPTCHA, httpFetch } from './sources/http.ts'
import { telegramSender } from './telegram.ts'

/** Deal Radar service: the scheduler, publisher and API in one process. Jobs run whether or not anyone has the dashboard open. */
const db = openDb()
const repo = makeRepo(db)
const adapters = makeAdapters()
const now = () => Date.now()

// Runs cut off by a restart must not stay "running" forever.
db.prepare(`UPDATE scan_runs SET status = 'failed', finished_at = ?, error = 'Interrupted by service restart' WHERE status = 'running'`).run(now())

const scheduler = createScheduler({ db, repo, adapters, now })
const screenshot = createScreenshotter()
const publisher = createPublisher({
  db,
  repo,
  adapters,
  send: telegramSender,
  now,
  sendGapMs: publication.sendGapMs,
  // Dry runs send nothing, so they must not load store pages.
  capture: (channel, source, url, price) =>
    // Amazon posts use the product image: screenshots add load and blocks there, and Mayar said the image is fine.
    source !== 'amazon' && telegram.token && telegram.chatId(channel) ? screenshot(source, url, price) : Promise.resolve(null),
})

if (telegram.dryRun) console.warn('[telegram] TELEGRAM_BOT_TOKEN not set: deliveries are recorded as dry-run, nothing is sent')

scheduler.start()
setInterval(() => void publisher.tick().catch((e) => console.error('[publish]', e)), 5_000)
if (telegram.token && telegram.alertChatId) {
  const riskWatch = createRiskWatch({
    db,
    send: (text) =>
      fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.alertChatId, text }),
        signal: AbortSignal.timeout(15_000),
      }),
    // Reads the plain product page. A bot must never open the tagged link, because Amazon's terms forbid artificial clicks.
    productOk: async () => {
      const row = db.prepare(`SELECT p.url FROM deliveries d JOIN offers o ON o.id = d.offer_id JOIN products p ON p.id = o.product_id WHERE p.source = 'amazon' AND d.state = 'sent' AND d.dry_run = 0 ORDER BY d.sent_at DESC LIMIT 1`).get() as { url: string } | undefined
      if (!row) return null
      const r = await httpFetch(row.url)
      if (r.status === 503 || r.status === 429 || CAPTCHA.test(r.text.slice(0, 20_000))) return null
      return r.status < 400
    },
  })
  setInterval(() => void riskWatch(), 15 * 60_000)
}
startApi({ db, repo, scheduler, now })

process.on('SIGTERM', () => {
  scheduler.stop()
  void screenshot.close().finally(() => process.exit(0))
})

import { startApi } from './api.ts'
import { publication, telegram } from './config.ts'
import { createScreenshotter } from './screenshot.ts'
import { openDb } from './db.ts'
import { createPublisher } from './publisher.ts'
import { repo as makeRepo } from './repo.ts'
import { createScheduler } from './scheduler.ts'
import { makeAdapters } from './sources/index.ts'
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
startApi({ db, repo, scheduler, now })

process.on('SIGTERM', () => {
  scheduler.stop()
  void screenshot.close().finally(() => process.exit(0))
})

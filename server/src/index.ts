import { startApi } from './api.ts'
import { telegram } from './config.ts'
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
const publisher = createPublisher({ db, repo, adapters, send: telegramSender, now })

if (telegram.dryRun) console.warn('[telegram] TELEGRAM_BOT_TOKEN not set: deliveries are recorded as dry-run, nothing is sent')

scheduler.start()
setInterval(() => void publisher.tick().catch((e) => console.error('[publish]', e)), 5_000)
startApi({ db, repo, scheduler, now })

process.on('SIGTERM', () => {
  scheduler.stop()
  process.exit(0)
})

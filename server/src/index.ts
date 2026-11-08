import { startApi } from './api.ts'
import { amazonScreenshotOff, publication, telegram, timezone } from './config.ts'
import { recordScreenshotRun } from './riskWatch.ts'
import { pickTopDeals, renderTopDeals } from './dailyTop.ts'
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
  generalGapMs: publication.generalGapMs,
  generalDropAfterMs: publication.generalDropAfterMs,
  // Dry runs send nothing, so they must not load store pages.
  capture: (channel, source, url, price) =>
    !telegram.token || !telegram.chatId(channel) || (source === 'amazon' && amazonScreenshotOff)
      ? Promise.resolve(null)
      : screenshot(source, url, price).then((shot) => {
          // Screenshots load Amazon pages too, so the risk guard should count their blocks.
          if (source === 'amazon') recordScreenshotRun(db, now(), screenshot.lastBlocked)
          return shot
        }),
})

if (telegram.dryRun) console.warn('[telegram] TELEGRAM_BOT_TOKEN not set: deliveries are recorded as dry-run, nothing is sent')

scheduler.start()
setInterval(() => void publisher.tick().catch((e) => console.error('[publish]', e)), 5_000)
if (telegram.token && telegram.alertChatId) {
  const tellMayar = (text: string) =>
    fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.alertChatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15_000),
    })
  const riskWatch = createRiskWatch({
    db,
    send: tellMayar,
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

  // The daily "top 5" for Mayar to share, at 8 pm Cairo time.
  let topDate = ''
  setInterval(() => {
    const [date, hour] = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(now()).split(', ')
    if (topDate === date || !hour.startsWith('20:')) return
    topDate = date
    void pickTopDeals({ db, repo, adapters, now: now(), gapMs: 3_000 })
      .then((deals) => (deals.length ? tellMayar(renderTopDeals(deals, process.env.PUBLIC_INVITE_LINK ?? 'https://t.me/orodmano', now())) : undefined))
      .catch((e) => console.error('[top5]', e))
  }, 60_000)
}
startApi({ db, repo, scheduler, now })

process.on('SIGTERM', () => {
  scheduler.stop()
  void screenshot.close().finally(() => process.exit(0))
})

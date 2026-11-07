import type { DB } from './db.ts'
import { timezone } from './config.ts'

/**
 * Warns Mayar about signs that Amazon may be noticing the scanning, while there is still time to react.
 * It can only see what this service sees. Amazon's own warnings arrive by email or in Associates Central.
 */
const HOUR = 3_600_000
const ALERT_EVERY = 3 * HOUR

export type RiskThresholds = { blockedShare: number; minRuns: number }
export const defaultThresholds: RiskThresholds = { blockedShare: 0.8, minRuns: 6 }
const BLOCKED = `(error LIKE '%blocked%' OR error LIKE '%layout_changed%')`

export function blockStats(db: DB, now: number, sinceMs: number) {
  return db
    .prepare(`SELECT COUNT(*) n, COALESCE(SUM(${BLOCKED}), 0) blocked FROM scan_runs WHERE source = 'amazon' AND finished_at IS NOT NULL AND started_at > ?`)
    .get(now - sinceMs) as { n: number; blocked: number }
}

export function amazonRisks(db: DB, now: number, t = defaultThresholds) {
  const hour = blockStats(db, now, HOUR)
  if (hour.n >= t.minRuns && hour.blocked / hour.n > t.blockedShare) {
    const pct = hour.n ? Math.round((hour.blocked / hour.n) * 100) : 0
    return [{ kind: 'blocks', text: `أمازون حجب ${hour.blocked} من ${hour.n} جولة في آخر ساعة (${pct}%).\nالمطلوب: بص على إيميلك وAssociates Central. ولو عايز تقلل الخطر، قولي أوقف أو أقلل فحص أمازون.` }]
  }
  return []
}

export function dailySummary(db: DB, now: number) {
  const posts = db
    .prepare(`SELECT COUNT(*) n FROM deliveries d JOIN offers o ON o.id = d.offer_id JOIN products p ON p.id = o.product_id
      WHERE p.source = 'amazon' AND d.state = 'sent' AND d.dry_run = 0 AND d.sent_at > ?`)
    .get(now - 24 * HOUR) as { n: number }
  const day = blockStats(db, now, 24 * HOUR)
  const pct = day.n ? Math.round((day.blocked / day.n) * 100) : 0
  return `📊 ملخص أمازون لآخر 24 ساعة\nبوستات: ${posts.n}\nالحجب: ${day.blocked} من ${day.n} جولة (${pct}%)\nبص كمان على إيميلك وAssociates Central، لأن تحذيرات أمازون بتوصل هناك.`
}

const cairo = (t: number) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t)
  const v = (k: string) => p.find((x) => x.type === k)!.value
  return { date: `${v('month')}-${v('day')}`, hour: Number(v('hour')) }
}

/**
 * Risk guard, as Mayar asked: on a risk sign, stop Amazon posts and the tag by itself, and bring them back once it clears.
 * Scanning carries on at a lower rate so price history isn't lost. Normal blocking is around 60%, so that doesn't trigger it.
 */
export const GUARD = { blockedShare: 0.85, minRuns: 8, clearForMs: 6 * HOUR, pausedScanEveryMs: HOUR }
let paused = false
export const amazonPaused = () => paused
export const setAmazonPaused = (on: boolean) => {
  paused = on
}

/** Over the line in both of the last two hours. */
export function blocksSustained(db: DB, now: number) {
  const window = (from: number, to: number) =>
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(${BLOCKED}), 0) blocked FROM scan_runs WHERE source = 'amazon' AND finished_at IS NOT NULL AND started_at > ? AND started_at <= ?`).get(from, to) as { n: number; blocked: number }
  const over = (w: { n: number; blocked: number }) => w.n >= GUARD.minRuns && w.blocked / w.n > GUARD.blockedShare
  return over(window(now - HOUR, now)) && over(window(now - 2 * HOUR, now - HOUR))
}

export type RiskDeps = {
  db: DB
  send: (text: string) => Promise<unknown>
  /** Whether a recently posted product page still resolves. Null when the check itself was blocked. */
  productOk?: () => Promise<boolean | null>
  now?: () => number
  dailyHour?: number
}

/** Warns at most once every 3 hours, and sends one summary a day. */
export function createRiskWatch({ db, send, productOk, now = Date.now, dailyHour = 21 }: RiskDeps) {
  const last = new Map<string, number>()
  let summaryDate = ''
  let linkFailing = false
  let lastLinkCheck = 0
  let clearSince = 0
  const say = (text: string) => send(text).catch((e) => console.error('[risk]', e))

  return async function check() {
    const t = now()
    const { date, hour } = cairo(t)
    const summaryDue = hour === dailyHour && summaryDate !== date
    // Daily, or hourly while a failed page is what paused Amazon.
    if (productOk && (summaryDue || (linkFailing && t - lastLinkCheck >= HOUR))) {
      lastLinkCheck = t
      const ok = await productOk().catch(() => null)
      if (ok !== null) linkFailing = !ok // null means the check itself was blocked, which says nothing about the link
    }

    const blocked = blocksSustained(db, t)
    if (blocked || linkFailing) {
      clearSince = 0
      if (!amazonPaused()) {
        setAmazonPaused(true)
        const why = linkFailing ? 'صفحة منتج نزل عليها بوست مش بتفتح.' : `أمازون حجب أكتر من ${Math.round(GUARD.blockedShare * 100)}% من الجولات لمدة ساعتين.`
        await say(`🛑 وقفت أمازون لوحدي\n\n${why}\nوقفت بوستات أمازون وكود الأفيليت، والفحص بقى كل ساعة. هيرجعوا لوحدهم بعد 6 ساعات من غير خطر.\nالمطلوب: بص على إيميلك وAssociates Central.`)
      }
    } else if (amazonPaused()) {
      clearSince ||= t
      if (t - clearSince >= GUARD.clearForMs) {
        setAmazonPaused(false)
        clearSince = 0
        await say('✅ أمازون رجع يشتغل\n\nبقالنا 6 ساعات من غير علامة خطر، فرجعت بوستات أمازون وكود الأفيليت لوحدهم.')
      }
    }

    for (const r of amazonPaused() ? [] : amazonRisks(db, t)) {
      if (t - (last.get(r.kind) ?? 0) < ALERT_EVERY) continue
      last.set(r.kind, t)
      await say(`⚠️ تنبيه أمازون\n\n${r.text}`)
    }
    if (summaryDue) {
      summaryDate = date
      await say(dailySummary(db, t))
    }
  }
}

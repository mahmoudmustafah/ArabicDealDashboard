import type { DB } from './db.ts'
import { timezone } from './config.ts'

/**
 * Warns Mayar about signs that Amazon may be noticing the scanning, while there is still time to react.
 * It can only see what this service sees. Amazon's own warnings arrive by email or in Associates Central.
 */
const HOUR = 3_600_000
const ALERT_EVERY = 3 * HOUR

export type RiskThresholds = { blockedShare: number; minRuns: number; consecutive: number }
export const defaultThresholds: RiskThresholds = { blockedShare: 0.5, minRuns: 6, consecutive: 3 }
const BLOCKED = `(error LIKE '%blocked%' OR error LIKE '%layout_changed%')`

export function blockStats(db: DB, now: number, sinceMs: number) {
  return db
    .prepare(`SELECT COUNT(*) n, COALESCE(SUM(${BLOCKED}), 0) blocked FROM scan_runs WHERE source = 'amazon' AND finished_at IS NOT NULL AND started_at > ?`)
    .get(now - sinceMs) as { n: number; blocked: number }
}

export function amazonRisks(db: DB, now: number, t = defaultThresholds) {
  const hour = blockStats(db, now, HOUR)
  const last = db
    .prepare(`SELECT ${BLOCKED} blocked FROM scan_runs WHERE source = 'amazon' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT ?`)
    .all(t.consecutive) as { blocked: number | null }[]
  const streak = last.length === t.consecutive && last.every((r) => r.blocked)
  if ((hour.n >= t.minRuns && hour.blocked / hour.n > t.blockedShare) || streak) {
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
  const say = (text: string) => send(text).catch((e) => console.error('[risk]', e))
  return async function check() {
    const t = now()
    for (const r of amazonRisks(db, t)) {
      if (t - (last.get(r.kind) ?? 0) < ALERT_EVERY) continue
      last.set(r.kind, t)
      await say(`⚠️ تنبيه أمازون\n\n${r.text}`)
    }
    const { date, hour } = cairo(t)
    if (hour === dailyHour && summaryDate !== date) {
      summaryDate = date
      const ok = productOk ? await productOk().catch(() => null) : null
      if (ok === false) await say('⚠️ تنبيه أمازون\n\nصفحة منتج نزل عليها بوست مش بتفتح. ممكن المنتج اتشال، أو حاجة اتغيرت عند أمازون.\nالمطلوب: جرب لينك من القناة بنفسك.')
      await say(dailySummary(db, t))
    }
  }
}

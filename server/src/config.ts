/**
 * Deal Radar configuration.
 *
 * Every business rule lives here so it can change without code edits. Values marked
 * DEFAULT(decision) are placeholders for business decisions that are still open
 * (brief §22). They are documented in POLICY.md. Change them there and here together.
 */

export type SourceId = 'amazon' | 'noon' | 'emarati'

export type CategoryId =
  | 'mobiles'
  | 'tvs'
  | 'monitors'
  | 'electronics'
  | 'keyboards'
  | 'storage'
  | 'perfumes'
  | 'cosmetics'
  | 'mens-fragrance'
  | 'womens-fragrance'
  | 'oud-bakhoor'
  | 'gift-sets'
  | 'supermarket'

export type Category = { id: CategoryId; ar: string; en: string; supermarket?: boolean }

export const categories: Category[] = [
  { id: 'mobiles', ar: 'موبايلات', en: 'Mobiles' },
  { id: 'tvs', ar: 'تلفزيونات', en: 'Televisions' },
  { id: 'monitors', ar: 'شاشات كمبيوتر', en: 'Computer monitors' },
  { id: 'electronics', ar: 'سماعات وإلكترونيات', en: 'Headphones & electronics' },
  { id: 'keyboards', ar: 'كيبورد وماوس', en: 'Keyboards & mice' },
  { id: 'storage', ar: 'تخزين', en: 'Storage' },
  { id: 'perfumes', ar: 'عطور', en: 'Perfumes' },
  { id: 'cosmetics', ar: 'مستحضرات تجميل', en: 'Cosmetics' },
  { id: 'mens-fragrance', ar: 'عطور رجالي', en: "Men's fragrances" },
  { id: 'womens-fragrance', ar: 'عطور حريمي', en: "Women's fragrances" },
  { id: 'oud-bakhoor', ar: 'عود وبخور', en: 'Oud & bakhoor' },
  { id: 'gift-sets', ar: 'مجموعات هدايا', en: 'Gift sets' },
  { id: 'supermarket', ar: 'سوبرماركت', en: 'Supermarket', supermarket: true },
]

export type Source = { id: SourceId; name: string; ar: string; baseUrl: string; enabled: boolean }

export const sources: Source[] = [
  { id: 'amazon', name: 'Amazon Egypt', ar: 'أمازون مصر', baseUrl: 'https://www.amazon.eg', enabled: true },
  { id: 'noon', name: 'Noon Egypt', ar: 'نون مصر', baseUrl: 'https://www.noon.com', enabled: true },
  { id: 'emarati', name: 'Emarati Scents', ar: 'إماراتي سنتس', baseUrl: 'https://emaratiscents.com', enabled: true },
]

/**
 * A scan job = one store/category pair. `target` is source-specific:
 * - amazon: a search/browse URL path (paged with &page=N)
 * - noon:   a catalog path under /egypt-en/ (paged with ?page=N)
 * - emarati: a Shopify collection handle
 *
 * VERIFY: these entry points were written without live access to the stores and must
 * be checked against the real sites before production (POLICY.md §1).
 */
export type JobDef = {
  id: string
  source: SourceId
  category: CategoryId
  target: string
  maxPages: number
  /** Stagger inside the 10-minute cycle so jobs don't all start together. */
  offsetSec: number
}

export const jobs: JobDef[] = [
  { id: 'amazon-tvs', source: 'amazon', category: 'tvs', target: '/s?k=smart+tv&i=electronics', maxPages: 5, offsetSec: 30 },
  { id: 'amazon-mobiles', source: 'amazon', category: 'mobiles', target: '/s?k=smartphone&i=electronics', maxPages: 5, offsetSec: 120 },
  { id: 'amazon-perfumes', source: 'amazon', category: 'perfumes', target: '/s?k=perfume&i=beauty', maxPages: 4, offsetSec: 360 },
  { id: 'amazon-cosmetics', source: 'amazon', category: 'cosmetics', target: '/s?k=makeup&i=beauty', maxPages: 4, offsetSec: 450 },
  { id: 'amazon-monitors', source: 'amazon', category: 'monitors', target: '/s?k=monitor&i=computers', maxPages: 4, offsetSec: 0 },
  { id: 'amazon-electronics', source: 'amazon', category: 'electronics', target: '/s?k=headphones&i=electronics', maxPages: 4, offsetSec: 270 },
  { id: 'amazon-keyboards', source: 'amazon', category: 'keyboards', target: '/s?k=keyboard+mouse&i=computers', maxPages: 3, offsetSec: 330 },
  { id: 'amazon-storage', source: 'amazon', category: 'storage', target: '/s?k=ssd&i=computers', maxPages: 3, offsetSec: 390 },
  { id: 'amazon-supermarket', source: 'amazon', category: 'supermarket', target: '/s?k=grocery&i=grocery', maxPages: 5, offsetSec: 540 },
  { id: 'noon-mobiles', source: 'noon', category: 'mobiles', target: 'electronics-and-mobiles/mobiles-and-accessories/mobiles-20905', maxPages: 5, offsetSec: 60 },
  { id: 'noon-tvs', source: 'noon', category: 'tvs', target: 'electronics-and-mobiles/television-and-video/televisions', maxPages: 4, offsetSec: 210 },
  { id: 'noon-perfumes', source: 'noon', category: 'perfumes', target: 'beauty/fragrance', maxPages: 4, offsetSec: 420 },
  { id: 'noon-cosmetics', source: 'noon', category: 'cosmetics', target: 'beauty/makeup-16142', maxPages: 4, offsetSec: 510 },
  { id: 'noon-supermarket', source: 'noon', category: 'supermarket', target: 'grocery-store', maxPages: 5, offsetSec: 570 },
  { id: 'emarati-men', source: 'emarati', category: 'mens-fragrance', target: 'men', maxPages: 2, offsetSec: 30 },
  { id: 'emarati-women', source: 'emarati', category: 'womens-fragrance', target: 'women', maxPages: 2, offsetSec: 180 },
  { id: 'emarati-oud', source: 'emarati', category: 'oud-bakhoor', target: 'oud-bakhoor', maxPages: 2, offsetSec: 330 },
  { id: 'emarati-gifts', source: 'emarati', category: 'gift-sets', target: 'gift-sets', maxPages: 2, offsetSec: 480 },
]

export const schedule = {
  /** Brief §5: every store/category combination every 10 minutes. */
  cycleMs: 10 * 60_000,
  /** Product pages revisited per job run for known products missing from listings (oldest-checked first). */
  revisitBudget: 20,
  /** A job that hasn't started within this long after its due time is reported overdue. */
  overdueGraceMs: 2 * 60_000,
  /** Hard ceiling for a single job run. */
  jobTimeoutMs: 9 * 60_000,
  requestTimeoutMs: 20_000,
  /** Polite delay between requests to the same store. */
  requestGapMs: 1_500,
}

export const evidence = {
  /** Brief §10 starting rules (from the prototype). */
  minObservations: 10,
  minSpanDays: 21,
  /** DEFAULT(decision): coverage — distinct Cairo days with ≥1 successful reading inside the span. */
  minCoveredDays: 14,
  /** 90-day window when ≥ this many days of history, else 30-day window. */
  longWindowFromDays: 85,
  belowUsualPct: 3,
  exceptionalPct: 35,
  samePriceBandPct: 2,
  /** DEFAULT(decision): a higher price run shorter than this, right before a drop, is treated as a possible inflated reference. */
  inflatedRunMaxHours: 72,
  staleAfterMs: 24 * 3600_000,
}

export const publication = {
  /** Priority when discount ≥ 50% or exceptional. Mayar's decision (2026-11-05): "50% and above" (the brief had strictly > 50%). */
  priorityPct: 50,
  /** Brief §14: advertised discounts can route to priority. Set false to require observed evidence. */
  priorityAllowsAdvertised: true,
  /** Brief §15: general post for a priority offer, measured from discovery. */
  generalDelayMs: 5 * 60_000,

  /** DEFAULT(decision): minimums for ordinary (general-channel) publication. Any one qualifies. */
  minObservedDropPct: 15,
  minBelowUsualPct: 10,
  minAdvertisedPct: 40,
  /** DEFAULT(decision): offer must have been read successfully this recently to be published. */
  maxAgeAtPublishMs: 20 * 60_000,
  /** DEFAULT(decision): cap to avoid flooding the general channel. Excess offers wait for the next hour, strongest first. */
  generalMaxPerHour: 30,

  /** DEFAULT(decision): republish only if the price fell at least this much below the last posted price… */
  republishFurtherDropPct: 5,
  /** …or the offer ended (price went back up) and came back after this cooldown. */
  republishReturnCooldownMs: 24 * 3600_000,

  /** DEFAULT(decision): what to do when the pre-publication recheck cannot read the product. */
  onFailedRecheck: 'cancel' as 'cancel' | 'publish',
  recheckRetryMs: 60_000,

  /** Telegram delivery retries (temporary failures). */
  retryBackoffMs: [10_000, 60_000, 5 * 60_000],
}

export const telegram = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  priorityChatId: process.env.TELEGRAM_PRIORITY_CHAT_ID ?? '',
  generalChatId: process.env.TELEGRAM_GENERAL_CHAT_ID ?? '',
  /** With no token, deliveries are recorded as dry-run and never shown as really sent. */
  get dryRun() {
    return !this.token
  },
}

export const timezone = 'Africa/Cairo'

export const categoryById = (id: string) => categories.find((c) => c.id === id)
export const sourceById = (id: string) => sources.find((s) => s.id === id)!

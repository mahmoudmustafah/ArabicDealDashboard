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
  | 'home-care'
  | 'diapers'

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
  { id: 'home-care', ar: 'منظفات ومستلزمات البيت', en: 'Home care', supermarket: true },
  { id: 'diapers', ar: 'حفاضات أطفال', en: 'Baby diapers', supermarket: true },
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
 * Entry points were checked against the live stores on 2026-11-06.
 */
export type JobDef = {
  id: string
  source: SourceId
  category: CategoryId
  target: string
  maxPages: number
  /** Stagger inside the job's cycle so jobs don't all start together. */
  offsetSec: number
  /** How often the job runs, in minutes. Default 10. */
  intervalMin?: number
  /** False when a store's rate limit leaves no room for per-product revisits. */
  revisit?: boolean
}

/** Amazon blocks heavy scanning, so its category jobs run less often. Lower this to scan more. */
const AMAZON_MIN = 30

export const jobs: JobDef[] = [
  { id: 'amazon-tvs', source: 'amazon', category: 'tvs', target: '/s?k=smart+tv&i=electronics', maxPages: 5, offsetSec: 150, intervalMin: AMAZON_MIN },
  { id: 'amazon-mobiles', source: 'amazon', category: 'mobiles', target: '/s?k=smartphone&i=electronics', maxPages: 5, offsetSec: 300, intervalMin: AMAZON_MIN },
  { id: 'amazon-perfumes', source: 'amazon', category: 'perfumes', target: '/s?k=perfume&i=beauty', maxPages: 4, offsetSec: 750, intervalMin: AMAZON_MIN },
  { id: 'amazon-cosmetics', source: 'amazon', category: 'cosmetics', target: '/s?k=makeup&i=beauty', maxPages: 4, offsetSec: 1050, intervalMin: AMAZON_MIN },
  { id: 'amazon-monitors', source: 'amazon', category: 'monitors', target: '/s?k=monitor&i=computers', maxPages: 4, offsetSec: 0, intervalMin: AMAZON_MIN },
  { id: 'amazon-electronics', source: 'amazon', category: 'electronics', target: '/s?k=headphones&i=electronics', maxPages: 4, offsetSec: 450, intervalMin: AMAZON_MIN },
  { id: 'amazon-keyboards', source: 'amazon', category: 'keyboards', target: '/s?k=keyboard+mouse&i=computers', maxPages: 3, offsetSec: 600, intervalMin: AMAZON_MIN },
  { id: 'amazon-storage', source: 'amazon', category: 'storage', target: '/s?k=ssd&i=computers', maxPages: 3, offsetSec: 900, intervalMin: AMAZON_MIN },
  { id: 'amazon-supermarket', source: 'amazon', category: 'supermarket', target: '/s?k=grocery&i=grocery', maxPages: 5, offsetSec: 1200, intervalMin: AMAZON_MIN },
  // Amazon's own 11.11 deals filter, one job per department so grocery deals stay on the supermarket channel.
  { id: 'amazon-deals-electronics', source: 'amazon', category: 'electronics', target: '/s?i=electronics&rh=p_n_deal_type%3A26901036031&s=popularity-rank', maxPages: 2, offsetSec: 45 },
  { id: 'amazon-deals-beauty', source: 'amazon', category: 'cosmetics', target: '/s?i=beauty&rh=p_n_deal_type%3A26901036031&s=popularity-rank', maxPages: 2, offsetSec: 240 },
  { id: 'amazon-deals-grocery', source: 'amazon', category: 'supermarket', target: '/s?i=grocery&rh=p_n_deal_type%3A26901036031&s=popularity-rank', maxPages: 2, offsetSec: 435 },
  { id: 'amazon-home-care', source: 'amazon', category: 'home-care', target: '/s?k=detergent&i=grocery', maxPages: 3, offsetSec: 1350, intervalMin: AMAZON_MIN },
  { id: 'amazon-diapers', source: 'amazon', category: 'diapers', target: '/s?k=diapers&i=baby', maxPages: 3, offsetSec: 1500, intervalMin: AMAZON_MIN },
  { id: 'noon-mobiles', source: 'noon', category: 'mobiles', target: 'electronics-and-mobiles/mobiles-and-accessories/mobiles-20905', maxPages: 5, offsetSec: 60 },
  { id: 'noon-tvs', source: 'noon', category: 'tvs', target: 'electronics-and-mobiles/television-and-video/televisions', maxPages: 4, offsetSec: 210 },
  { id: 'noon-perfumes', source: 'noon', category: 'perfumes', target: 'beauty/fragrance', maxPages: 4, offsetSec: 420 },
  { id: 'noon-cosmetics', source: 'noon', category: 'cosmetics', target: 'beauty/makeup-16142', maxPages: 4, offsetSec: 510 },
  { id: 'noon-supermarket', source: 'noon', category: 'supermarket', target: 'grocery-store', maxPages: 5, offsetSec: 570 },
  { id: 'noon-home-care', source: 'noon', category: 'home-care', target: 'grocery-store/home-care-and-cleaning', maxPages: 4, offsetSec: 150 },
  { id: 'noon-diapers', source: 'noon', category: 'diapers', target: 'baby-products/diapering/diapers-noon', maxPages: 4, offsetSec: 330 },
  // Emarati Scents rate-limits hard (HTTP 429), so each run reads one page and the adapter moves on to the next page next run.
  { id: 'emarati-men', source: 'emarati', category: 'mens-fragrance', target: 'men', maxPages: 1, offsetSec: 30, revisit: false },
  { id: 'emarati-women', source: 'emarati', category: 'womens-fragrance', target: 'women', maxPages: 1, offsetSec: 180, revisit: false },
  { id: 'emarati-oud', source: 'emarati', category: 'oud-bakhoor', target: 'incense', maxPages: 1, offsetSec: 330, revisit: false },
  { id: 'emarati-gifts', source: 'emarati', category: 'gift-sets', target: 'lattafa-luxury-gift-sets', maxPages: 1, offsetSec: 480, revisit: false },
]

export const schedule = {
  /** Brief §5: each job every 10 minutes unless it sets its own interval. */
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
  /** The private channel gets offers of 40% or more. Mayar's decision (2026-11-06). */
  priorityPct: 40,
  /** Brief §14: advertised discounts can route to priority. Set false to require observed evidence. */
  priorityAllowsAdvertised: true,
  /** Brief §15: general post for a priority offer, measured from discovery. */
  generalDelayMs: 5 * 60_000,

  /** Minimums for publication, any one qualifies. Mayar's decision (2026-11-06): 5% on every basis. */
  minObservedDropPct: 5,
  minBelowUsualPct: 5,
  minAdvertisedPct: 5,
  /**
   * Only new offers go out, nothing from before posting opened. An offer is new when its price changed after this time
   * (epoch ms, 0 = no limit), or when the product itself first appeared after discoveredSince. Set in server/.env.
   */
  changedSince: Date.parse(process.env.PUBLISH_CHANGED_SINCE ?? '') || 0,
  discoveredSince: Date.parse(process.env.PUBLISH_DISCOVERED_SINCE ?? '') || 0,
  /** A post shows the store's discount instead when our own drop is under this and the store's is bigger. */
  preferAdvertisedBelowPct: 15,
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

export type Channel = 'priority' | 'general' | 'supermarket'

/**
 * Categories with a channel of their own. Their offers go only there, never to priority or general.
 * With no chat id for that channel, deliveries stay dry-run. Add a row here to add another channel.
 */
export const categoryChannel: Partial<Record<CategoryId, Channel>> = {
  supermarket: 'supermarket',
  'home-care': 'supermarket',
  diapers: 'supermarket',
}
export const ownChannel = (category: string) => categoryChannel[category as CategoryId]

export const telegram = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  priorityChatId: process.env.TELEGRAM_PRIORITY_CHAT_ID ?? '',
  generalChatId: process.env.TELEGRAM_GENERAL_CHAT_ID ?? '',
  chatId(channel: Channel) {
    return { priority: this.priorityChatId, general: this.generalChatId, supermarket: process.env.TELEGRAM_SUPERMARKET_CHAT_ID ?? '' }[channel]
  },
  /** With no token, deliveries are recorded as dry-run and never shown as really sent. */
  get dryRun() {
    return !this.token
  },
}

export const timezone = 'Africa/Cairo'

export const categoryById = (id: string) => categories.find((c) => c.id === id)
export const sourceById = (id: string) => sources.find((s) => s.id === id)!

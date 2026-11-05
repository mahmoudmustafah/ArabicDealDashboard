# Deal Radar: business rules and open decisions

The business brief (§10, §12, §13, §16, §22) asks for every rule to be written down rather than invented silently. This file lists each rule the service applies.

- **FROM BRIEF** means the rule comes straight from the brief or the prototype.
- **DEFAULT** means a placeholder for a decision that's still open. It works today, but it needs a business sign-off.

Every value lives in `src/config.ts`.

## 1. Sources and collection (DEFAULT, needs verification)

| Store | Method | Identity |
|---|---|---|
| Amazon Egypt | HTML search pages (`/s?k=…&page=N`) + product pages (`/dp/ASIN`) | ASIN + seller |
| Noon Egypt | Noon's JSON catalog API (`/_svc/catalog/api/v3/u/egypt-en/…`) | SKU + seller |
| Emarati Scents | Shopify JSON (`/collections/<handle>/products.json`) | Shopify variant id, so each size is its own product |

These were written **without live access to the stores** (the build environment can't reach them). Before production, run `pnpm scan-once <jobId>` from a machine that can reach the stores, then fix any selector, path or collection handle that reports `layout_changed`.

**Risks:**
- Amazon often serves CAPTCHAs to automated traffic. Those runs are reported as `blocked`, and the job stops early instead of hammering the store.
- Scraping may conflict with store terms of service. Affiliate or product APIs (Amazon PA-API, Noon affiliate feeds) are the safer long-term route.

## 2. Scanning (FROM BRIEF)

- Every store/category job runs every 10 minutes, staggered inside the cycle.
- A run reads the listing pages (discovery plus a price for everything listed). It then **revisits** up to 20 known products in that category that the listings didn't show, oldest-checked first, so price history keeps growing for products that fall off the first pages. (DEFAULT: the budget of 20.)
- Jobs for the same store run one at a time. A job still running when its next slot comes is recorded as an **overlap** and that slot is skipped. A slot not started within 2 minutes shows as **overdue**.
- Run status:
  - `success`: every page and revisit was read.
  - `partial`: some failed, or the store blocked us.
  - `failed`: nothing was read.
- Every failure reason is stored.

## 3. Price history (FROM BRIEF)

- Every successful reading is stored, even when the price is unchanged. The crossed-out "was" price is stored separately as the *advertised* reference and is never treated as a past price.
- A failed read is stored in `read_failures`. It never changes `last_seen_at`, so an old price keeps its real timestamp. It's also never taken to mean "out of stock".
- A price is **stale** after 24h without a successful reading.

## 4. Evidence (FROM BRIEF, plus two DEFAULT additions)

| Rule | Value | |
|---|---|---|
| Enough history | ≥10 readings, span ≥21 days | FROM BRIEF |
| …and coverage | readings on ≥14 distinct Cairo days | DEFAULT |
| Usual price | median of **daily medians** over 30 days (or 90 days once ≥85 days of history), excluding today | DEFAULT on the aggregation, FROM BRIEF on the windows |
| Below usual | > 3% under usual | FROM BRIEF |
| Exceptional | observed drop or below-usual ≥ 35% | FROM BRIEF |
| Same price | within ±2% | FROM BRIEF |
| Inflated reference | if a higher price lasted < 72h right before the drop, the drop is measured from the price *before* the hike (and may be no drop at all) | DEFAULT |

**Labels:**
- `observed_drop`
- `below_usual`
- `exceptional` (shown as "verifying")
- `insufficient`
- `advertised_only`

**Discount basis when several apply** (DEFAULT): the largest one backed by our own observations (observed or below usual). The advertised discount is used only when we have no observed evidence, and every message names its basis.

## 5. Publication (DEFAULT unless marked)

An offer is published to **General** if it's fresh (read in the last 20 minutes), not marked unavailable, and at least one of these is true:

- an observed drop of 15% or more
- 10% or more below usual
- an advertised discount of 40% or more (the message says it's the store's claim)
- an exceptional drop

There's also a cap of **30 General posts per hour**. Extra offers wait, strongest first.

**Priority** applies when the discount is **50% or more** or the drop is exceptional. This is Mayar's decision from 2026-11-05: the brief said strictly more than 50%. Priority posts go to a private chat with the bot, and General posts go to the public channel @orodmano.

The brief lets advertised discounts count toward priority, so `priorityAllowsAdvertised: true`. **Recommendation:** set this to `false`, so a 55% advertised claim we never verified doesn't go to the premium channel.

**Timing** (FROM BRIEF): Priority posts right away, and General posts 5 minutes after *discovery*. A regular offer goes to General right away.

## 6. Pre-publication recheck (FROM BRIEF, with DEFAULT details)

Before a delayed General post, the service re-reads the product once:

| Recheck result | Action |
|---|---|
| Price back up (not a deal anymore) | cancel, "Price went back to EGP X before the general slot" |
| Changed but still qualifies | publish with the new price |
| Unavailable | cancel |
| Read failed | retry after 1 minute, then **cancel** (DEFAULT, `onFailedRecheck`) |
| Exceptional price confirmed (±2%) | offer marked **verified**, and the "verifying" notice is dropped from the message |

If the **Priority** delivery fails, the General post still goes out on its own schedule (DEFAULT).

## 7. Duplicates and reposting (DEFAULT)

- One product = store + store id + seller. The same product seen on two pages or found again updates the record. It never creates a duplicate.
- An unchanged offer that was already posted is **never reposted**.
- An offer can be reposted in two cases:
  - its price falls at least **5% below the last posted price**
  - it **ended** (we saw the price go back up) and came back, with **24h** or more since the last post

## 8. Telegram delivery (FROM BRIEF)

- **States:** scheduled, sending, sent, retrying, failed, cancelled. Every attempt is kept.
- **Retries:** temporary errors (429, 5xx, timeouts) retry after 10s, 1m and 5m, or after Telegram's `retry_after` when that's longer. After that the delivery shows as failed.
- **No bot token:** everything runs in **dry-run**. Deliveries are stored with `dry_run = 1` and never shown as really sent.

## 9. Still to decide (brief §22)

1. Live verification of each store's collection method (§1 above).
2. Publication minimums and the hourly cap (§5).
3. Whether advertised discounts may route to Priority (§5).
4. The coverage rule and daily-median aggregation (§4).
5. Repost rules (§7).
6. How exceptional offers get verified (currently by the 5-minute recheck) (§6).
7. Failed recheck, cancel vs. publish (§6), and what happens after a failed Priority delivery.
8. Watchlist ownership. It's currently one shared list with no accounts.
9. Whether Priority channel access is paid or free.
10. Supermarket matching. Pack size, multipack and conditions are parsed from titles. Cross-store matching isn't done, since prices are only compared within the same store product.

# Deal Radar service

This is the backend for the dashboard in `../src`. It scans every configured store/category every 10 minutes, builds price history from its own readings, judges how real each discount is, and publishes qualifying deals to two Telegram channels. The business rules and open decisions are in [POLICY.md](POLICY.md).

```
scan (10 min) → discover + record prices → evaluate evidence → dedupe → schedule
publisher (5 s) → priority now / general +5 min → recheck → send · retry · cancel
API (:8787) → dashboard
```

## Run

You need Node 22.13 or later. It uses the built-in `node:sqlite`, so there's no database server to install.

```bash
cd server
pnpm install
pnpm test              # 36 tests: evidence, policy, parsers, end-to-end flow
pnpm start             # scheduler + publisher + API on :8787
pnpm scan-once amazon-monitors   # one job, printed, for checking collectors against live stores
```

| Env | |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token. Unset means dry-run: nothing is sent, and deliveries are marked `dry_run` |
| `TELEGRAM_PRIORITY_CHAT_ID` | Your private chat with the bot (50%+ and exceptional deals). `pnpm telegram-setup` prints it after you press Start in the bot |
| `TELEGRAM_GENERAL_CHAT_ID` | Public channel, e.g. `@orodmano` (the bot must be an admin with "Post messages") |
| `DEAL_RADAR_DB` | SQLite file (default `deal-radar.sqlite`) |
| `PORT` | API port (default 8787) |
| `CORS_ORIGIN` | Allowed dashboard origin (default `*`) |
| `EMARATI_BASE_URL` | Override the Emarati Scents store URL |

## Layout

| File | Purpose |
|---|---|
| `src/config.ts` | Stores, categories, jobs and every business threshold |
| `src/sources/*` | One collector per store (Amazon HTML, Noon JSON, Shopify JSON) behind one interface |
| `src/scanner.ts` | One job run: listing pages, revisits, honest coverage, then evaluation |
| `src/scheduler.ts` | 10-minute cycle, per-store queue, overlap and overdue tracking |
| `src/evaluate.ts` | Evidence: observed drop, below usual (daily medians), exceptional, inflated reference |
| `src/policy.ts` | Publish/skip with a reason, priority routing, repost rules |
| `src/publisher.ts` | Delivery worker: recheck, send, retry, cancel |
| `src/telegram.ts` | Arabic message rendering and the Bot API client |
| `src/units.ts` | Supermarket pack size, unit price and promotion conditions |
| `src/api.ts` | JSON API for the dashboard |

## API

| Endpoint | Returns |
|---|---|
| `GET /api/offers?category=&source=&label=&minPrice=&maxPrice=&sinceHours=&sort=drop\|newest\|price&q=` | Deals with evidence, `checkedAt` (last successful reading), `stale`, `notRefreshed` |
| `GET /api/products/:id` | Product, daily history, last 7 days of raw readings, failures, offers and deliveries |
| `GET/POST/DELETE /api/watchlist[/:id]` | Watchlist |
| `GET /api/jobs` | Each job's state, due and next times, overdue flag, overlaps and recent runs |
| `GET /api/scans` | Scan runs with pages and products read and errors |
| `GET /api/stale` | Products with no successful reading for over 24h |
| `GET /api/posts` | Published offers with their channel deliveries and attempt history |
| `GET /api/decisions` | Every publish/skip decision with its reason |

The dashboard still uses its sample data. Wiring it to this API is the next step.

import { DatabaseSync } from 'node:sqlite'
import { ownChannel } from './config.ts'

/**
 * Storage. Built-in node:sqlite, so there are no native dependencies. All times are UTC epoch ms,
 * and Cairo time is applied only when formatting for people.
 */
export type DB = DatabaseSync

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY,
  source          TEXT NOT NULL,
  store_key       TEXT NOT NULL,          -- ASIN / Noon SKU / Shopify variant id: stable identity per store+variant
  seller          TEXT NOT NULL DEFAULT '',  -- '' when the store has one seller
  category        TEXT NOT NULL,
  name            TEXT NOT NULL,
  brand           TEXT,
  image           TEXT,
  url             TEXT NOT NULL,
  variant         TEXT,                   -- size / capacity / colour as shown by the store
  pack_value      REAL,                   -- e.g. 500 (g), 1.5 (L)
  pack_unit       TEXT,                   -- g | ml | item
  pack_qty        INTEGER,                -- multipack count
  list_price      REAL,                   -- retailer-advertised reference (crossed-out). Never used as history.
  available       INTEGER,                -- 1/0/NULL (unknown)
  promo           TEXT,                   -- JSON: [{kind, text}] purchase conditions
  discovered_at   INTEGER NOT NULL,
  last_seen_at    INTEGER,                -- last SUCCESSFUL observation
  last_attempt_at INTEGER,
  last_failure_at INTEGER,
  last_failure    TEXT,
  UNIQUE (source, store_key, seller)
);
CREATE INDEX IF NOT EXISTS products_cat ON products (source, category, last_seen_at);

CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  t           INTEGER NOT NULL,
  price       REAL NOT NULL,
  list_price  REAL,
  available   INTEGER,
  run_id      INTEGER
);
CREATE INDEX IF NOT EXISTS obs_product_t ON observations (product_id, t);

CREATE TABLE IF NOT EXISTS read_failures (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  t           INTEGER NOT NULL,
  run_id      INTEGER,
  reason      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id                INTEGER PRIMARY KEY,
  job_id            TEXT NOT NULL,
  source            TEXT NOT NULL,
  category          TEXT NOT NULL,
  due_at            INTEGER NOT NULL,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  status            TEXT NOT NULL,        -- running | success | partial | failed
  pages_planned     INTEGER NOT NULL DEFAULT 0,
  pages_ok          INTEGER NOT NULL DEFAULT 0,
  products_read     INTEGER NOT NULL DEFAULT 0,
  products_new      INTEGER NOT NULL DEFAULT 0,
  revisit_attempted INTEGER NOT NULL DEFAULT 0,
  revisit_ok        INTEGER NOT NULL DEFAULT 0,
  offers_found      INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);
CREATE INDEX IF NOT EXISTS runs_job ON scan_runs (job_id, started_at);

CREATE TABLE IF NOT EXISTS offers (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  detected_at   INTEGER NOT NULL,
  price         REAL NOT NULL,
  ref_price     REAL,
  basis         TEXT NOT NULL,          -- observed | below_usual | advertised
  pct           REAL NOT NULL,
  labels        TEXT NOT NULL,          -- JSON DealLabel[]
  priority      INTEGER NOT NULL,
  decision      TEXT NOT NULL,          -- publish | skip
  reason        TEXT NOT NULL,          -- why it qualified / was skipped (shown to operators)
  status        TEXT NOT NULL,          -- scheduled | published | cancelled | skipped
  verified_at   INTEGER                 -- exceptional offers: confirmed by recheck
);
CREATE INDEX IF NOT EXISTS offers_product ON offers (product_id, detected_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id              INTEGER PRIMARY KEY,
  offer_id        INTEGER NOT NULL REFERENCES offers(id),
  channel         TEXT NOT NULL,        -- priority | general | supermarket
  scheduled_at    INTEGER NOT NULL,
  state           TEXT NOT NULL,        -- scheduled | sending | sent | retrying | failed | cancelled
  attempts        TEXT NOT NULL DEFAULT '[]',  -- JSON [{at, ok, error}]
  next_attempt_at INTEGER,
  sent_at         INTEGER,
  message_id      INTEGER,
  dry_run         INTEGER NOT NULL DEFAULT 0,
  cancel_reason   TEXT,
  posted_price    REAL,
  UNIQUE (offer_id, channel)
);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (state, scheduled_at);

CREATE TABLE IF NOT EXISTS watchlist (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  added_at   INTEGER NOT NULL
);
`

export function openDb(path = process.env.DEAL_RADAR_DB ?? 'deal-radar.sqlite'): DB {
  const db = new DatabaseSync(path)
  db.exec(schema)
  mergeDuplicateProducts(db)
  // One row per product. A listing shows no seller and a product page does, and that used to split a product in two.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS products_one_per_key ON products (source, store_key)')
  return db
}

/** Moves every duplicate's history onto one product row. Safe to run again: it does nothing once there are none. */
export function mergeDuplicateProducts(db: DB) {
  const groups = db.prepare('SELECT source, store_key FROM products GROUP BY source, store_key HAVING COUNT(*) > 1').all() as { source: string; store_key: string }[]
  if (!groups.length) return 0
  const rows = db.prepare(`SELECT * FROM products WHERE source = ? AND store_key = ? ORDER BY seller != '', id`)
  const moves = ['observations', 'read_failures', 'offers'].map((t) => db.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`))
  const watch = db.prepare('INSERT OR IGNORE INTO watchlist (product_id, added_at) SELECT ?, added_at FROM watchlist WHERE product_id = ?')
  const unwatch = db.prepare('DELETE FROM watchlist WHERE product_id = ?')
  const remove = db.prepare('DELETE FROM products WHERE id = ?')
  const update = db.prepare('UPDATE products SET discovered_at = ?, last_seen_at = ?, last_attempt_at = ?, last_failure_at = ?, last_failure = ?, list_price = ?, available = ?, promo = ?, category = ? WHERE id = ?')
  const max = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b))
  type Row = { id: number; discovered_at: number; last_seen_at: number | null; last_attempt_at: number | null; last_failure_at: number | null; last_failure: string | null; list_price: number | null; available: number | null; promo: string | null; category: string }
  tx(db, () => {
    for (const g of groups) {
      const [keep, ...others] = rows.all(g.source, g.store_key) as Row[]
      const merged = [keep, ...others]
      const latest = merged.reduce((a, b) => ((b.last_seen_at ?? 0) > (a.last_seen_at ?? 0) ? b : a))
      const failed = merged.reduce((a, b) => ((b.last_failure_at ?? 0) > (a.last_failure_at ?? 0) ? b : a))
      for (const o of others) {
        for (const m of moves) m.run(keep.id, o.id)
        watch.run(keep.id, o.id)
        unwatch.run(o.id)
        remove.run(o.id)
      }
      update.run(
        Math.min(...merged.map((r) => r.discovered_at)),
        latest.last_seen_at,
        merged.reduce((a: number | null, r) => max(a, r.last_attempt_at), null),
        failed.last_failure_at,
        failed.last_failure,
        latest.list_price,
        latest.available,
        latest.promo,
        // A product with its own channel must keep going there.
        (merged.find((r) => ownChannel(r.category)) ?? keep).category,
        keep.id,
      )
    }
  })
  return groups.length
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

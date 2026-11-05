import { schedule as S, type JobDef, type SourceId } from './config.ts'
import type { DB } from './db.ts'
import { evaluateAndSchedule } from './pipeline.ts'
import type { ProductRow, Repo } from './repo.ts'
import { sleep } from './sources/http.ts'
import { FetchError, type SourceAdapter } from './sources/types.ts'

/**
 * One scan run = one store/category job (brief §5). Each run does two things:
 *  1. Discovery: read the category listing pages, add new products and record a price for each one seen.
 *  2. Price history: revisit known products in the category that the listings didn't show (oldest first, within a budget).
 * Coverage is reported honestly: pages planned vs read, products revisited vs read.
 */
export type ScanDeps = {
  db: DB
  repo: Repo
  adapters: Record<SourceId, SourceAdapter>
  now: () => number
  gapMs?: number
}

export type RunSummary = {
  runId: number
  status: 'success' | 'partial' | 'failed'
  pagesPlanned: number
  pagesOk: number
  productsRead: number
  productsNew: number
  revisitAttempted: number
  revisitOk: number
  offersFound: number
  scheduled: number
  error?: string
}

export async function runJob(deps: ScanDeps, job: JobDef, dueAt: number): Promise<RunSummary> {
  const { db, repo } = deps
  const adapter = deps.adapters[job.source]
  const gap = deps.gapMs ?? S.requestGapMs
  const started = deps.now()
  const runId = Number(
    db
      .prepare(`INSERT INTO scan_runs (job_id, source, category, due_at, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')`)
      .run(job.id, job.source, job.category, dueAt, started).lastInsertRowid,
  )
  const progress = db.prepare('UPDATE scan_runs SET pages_planned = ?, pages_ok = ?, products_read = ?, products_new = ? WHERE id = ?')

  const sum: RunSummary = { runId, status: 'success', pagesPlanned: 0, pagesOk: 0, productsRead: 0, productsNew: 0, revisitAttempted: 0, revisitOk: 0, offersFound: 0, scheduled: 0 }
  const errors: string[] = []
  const seen = new Set<number>()
  const touched = new Set<number>()
  let blocked = false
  const deadline = started + S.jobTimeoutMs

  // 1) Discovery from listing pages
  for (let page = 1; page <= job.maxPages; page++) {
    if (deps.now() > deadline) {
      errors.push(`Stopped at page ${page}: job time limit`)
      sum.pagesPlanned++
      break
    }
    sum.pagesPlanned++
    try {
      const res = await adapter.listingPage(job, page)
      sum.pagesOk++
      const t = deps.now()
      for (const l of res.listings) {
        const { id, isNew } = repo.upsertProduct(l, job.category, t)
        if (seen.has(id)) continue // same product on two pages
        seen.add(id)
        if (isNew) sum.productsNew++
        if (repo.recordObservation(id, l, t, runId)) {
          sum.productsRead++
          touched.add(id)
        }
      }
      progress.run(sum.pagesPlanned, sum.pagesOk, sum.productsRead, sum.productsNew, runId)
      if (!res.hasNext) break
    } catch (e) {
      const msg = e instanceof FetchError ? `${e.kind}: ${e.message}` : String(e)
      errors.push(`Page ${page}: ${msg}`)
      if (e instanceof FetchError && e.kind === 'blocked') {
        blocked = true
        break // don't hammer a store that is blocking us
      }
    }
    if (gap) await sleep(gap)
  }

  // 2) Price-history revisits for known products not seen in this run's listings
  if (!blocked) {
    const stale = (
      db
        .prepare(`SELECT * FROM products WHERE source = ? AND category = ? ORDER BY COALESCE(last_seen_at, 0) ASC LIMIT ?`)
        .all(job.source, job.category, S.revisitBudget + seen.size) as ProductRow[]
    )
      .filter((p) => !seen.has(p.id))
      .slice(0, S.revisitBudget)
    for (const p of stale) {
      if (deps.now() > deadline) break
      sum.revisitAttempted++
      const t = deps.now()
      try {
        const l = await adapter.product(p.store_key, p.url)
        if (!l) {
          repo.recordFailure(p.id, t, runId, 'No price on product page')
        } else {
          repo.upsertProduct(l, job.category, t)
          if (repo.recordObservation(p.id, l, t, runId)) {
            sum.revisitOk++
            sum.productsRead++
            touched.add(p.id)
          } else repo.recordFailure(p.id, t, runId, 'Shown as unavailable')
        }
      } catch (e) {
        const msg = e instanceof FetchError ? `${e.kind}: ${e.message}` : String(e)
        repo.recordFailure(p.id, t, runId, msg)
        if (e instanceof FetchError && e.kind === 'blocked') {
          errors.push(`Revisits stopped: ${msg}`)
          break
        }
      }
      if (gap) await sleep(gap)
    }
  }

  // 3) Evaluate evidence and schedule qualifying offers
  for (const id of touched) {
    const r = evaluateAndSchedule(db, repo, id, deps.now())
    if (r.analysis?.best) sum.offersFound++
    if (r.decision?.publish) sum.scheduled++
  }

  const listingIncomplete = sum.pagesOk < sum.pagesPlanned
  const revisitIncomplete = sum.revisitOk < sum.revisitAttempted
  sum.status = sum.pagesOk === 0 && sum.revisitOk === 0 ? 'failed' : listingIncomplete || revisitIncomplete || blocked ? 'partial' : 'success'
  if (errors.length) sum.error = errors.join(' | ')
  db.prepare(
    `UPDATE scan_runs SET finished_at = ?, status = ?, pages_planned = ?, pages_ok = ?, products_read = ?, products_new = ?,
     revisit_attempted = ?, revisit_ok = ?, offers_found = ?, error = ? WHERE id = ?`,
  ).run(deps.now(), sum.status, sum.pagesPlanned, sum.pagesOk, sum.productsRead, sum.productsNew, sum.revisitAttempted, sum.revisitOk, sum.offersFound, sum.error ?? null, runId)
  return sum
}

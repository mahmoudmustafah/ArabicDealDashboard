import { jobs } from './config.ts'
import { openDb } from './db.ts'
import { repo as makeRepo } from './repo.ts'
import { runJob } from './scanner.ts'
import { makeAdapters } from './sources/index.ts'

/** `pnpm scan-once [jobId…]`: run jobs once and print what happened. Use this to verify collectors against live stores. */
const [cmd, ...ids] = process.argv.slice(2)
if (cmd !== 'scan-once') {
  console.log('usage: tsx src/cli.ts scan-once [jobId…]')
  process.exit(1)
}
const db = openDb()
const repo = makeRepo(db)
const adapters = makeAdapters()
const selected = ids.length ? jobs.filter((j) => ids.includes(j.id)) : jobs
for (const job of selected) {
  const r = await runJob({ db, repo, adapters, now: () => Date.now() }, job, Date.now())
  console.log(job.id.padEnd(22), r.status.padEnd(8), `pages ${r.pagesOk}/${r.pagesPlanned}`, `read ${r.productsRead}`, `new ${r.productsNew}`, `offers ${r.offersFound}`, r.error ?? '')
}

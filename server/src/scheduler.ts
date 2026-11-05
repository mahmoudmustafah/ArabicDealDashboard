import { jobs as allJobs, schedule as S, sources, type JobDef, type SourceId } from './config.ts'
import { runJob, type ScanDeps } from './scanner.ts'

/**
 * Runs every store/category job every 10 minutes (brief §5), staggered by offset.
 * Jobs for the same store run one at a time (polite to the store). If a job is still
 * running when its next slot comes, that slot is recorded as overlapping and skipped,
 * never silently doubled. A job waiting behind its store's queue past the grace period
 * shows as overdue.
 */
export type JobStatus = {
  job: JobDef
  state: 'idle' | 'queued' | 'running'
  dueAt: number
  nextDueAt: number
  lastStartedDue?: number
  overdue: boolean
  overlaps: number
}

export function slotFor(job: JobDef, t: number) {
  const off = job.offsetSec * 1000
  return Math.floor((t - off) / S.cycleMs) * S.cycleMs + off
}

export function createScheduler(deps: ScanDeps, jobs: JobDef[] = allJobs) {
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.id))
  const active = jobs.filter((j) => enabled.has(j.source))
  const st = new Map<string, { state: JobStatus['state']; lastStartedDue?: number; queuedDue?: number; lastSlot?: number; overlaps: number }>()
  const queues = new Map<SourceId, Promise<unknown>>()
  for (const j of active) st.set(j.id, { state: 'idle', overlaps: 0 })
  let timer: NodeJS.Timeout | undefined

  function enqueue(job: JobDef, due: number) {
    const s = st.get(job.id)!
    s.state = 'queued'
    s.queuedDue = due
    const prev = queues.get(job.source) ?? Promise.resolve()
    const next = prev.then(async () => {
      s.state = 'running'
      s.lastStartedDue = due
      try {
        await runJob(deps, job, due)
      } catch (e) {
        console.error(`[scan] ${job.id} crashed`, e)
      } finally {
        s.state = 'idle'
        s.queuedDue = undefined
      }
    })
    queues.set(job.source, next)
  }

  function tick() {
    const now = deps.now()
    for (const job of active) {
      const s = st.get(job.id)!
      const due = slotFor(job, now)
      if (s.lastSlot !== undefined && s.lastSlot >= due) continue // slot already handled
      s.lastSlot = due
      if (s.state !== 'idle') {
        s.overlaps++ // previous run still going when this slot arrived: skip, don't double up
        continue
      }
      enqueue(job, due)
    }
  }

  return {
    start(intervalMs = 5_000) {
      tick()
      timer = setInterval(tick, intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
    },
    tick,
    status(): JobStatus[] {
      const now = deps.now()
      return active.map((job) => {
        const s = st.get(job.id)!
        const due = slotFor(job, now)
        const started = s.lastStartedDue !== undefined && s.lastStartedDue >= due
        return {
          job,
          state: s.state,
          dueAt: due,
          nextDueAt: due + S.cycleMs,
          lastStartedDue: s.lastStartedDue,
          overdue: !started && now - due > S.overdueGraceMs,
          overlaps: s.overlaps,
        }
      })
    },
  }
}

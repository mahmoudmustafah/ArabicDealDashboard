import type { SourceId } from '../config.ts'
import { amazonAdapter } from './amazon.ts'
import { emaratiAdapter } from './emarati.ts'
import { noonAdapter } from './noon.ts'
import type { Fetcher, SourceAdapter } from './types.ts'

export function makeAdapters(fetcher?: Fetcher): Record<SourceId, SourceAdapter> {
  return { amazon: amazonAdapter(fetcher), noon: noonAdapter(fetcher), emarati: emaratiAdapter(fetcher) }
}

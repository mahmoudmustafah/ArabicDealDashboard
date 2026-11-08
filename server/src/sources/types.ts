import type { CategoryId, JobDef, SourceId } from '../config.ts'

/** One product as read from a store page. Prices are EGP. */
export type Listing = {
  source: SourceId
  storeKey: string
  seller?: string
  name: string
  brand?: string
  image?: string
  url: string
  variant?: string
  price: number
  /** Crossed-out / "was" price shown by the store. */
  listPrice?: number
  available?: boolean
  /** Purchase conditions (coupon, member price, BOGO, multi-buy, minimum order…). */
  promos?: Promo[]
}

export type PromoKind = 'coupon' | 'member' | 'bogo' | 'multibuy' | 'min_order' | 'other'
export type Promo = { kind: PromoKind; text: string }

export type FailureKind = 'blocked' | 'timeout' | 'http' | 'layout_changed' | 'network'

export class FetchError extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
  ) {
    super(message)
  }
}

export type PageResult = { listings: Listing[]; hasNext: boolean }

/** Each store implements its own collection approach behind this interface (brief §3). */
export interface SourceAdapter {
  id: SourceId
  /** Read listing page N (1-based) of a job. Throws FetchError on failure. */
  listingPage(job: JobDef, page: number): Promise<PageResult>
  /** Re-read one known product (revisits and pre-publication rechecks). */
  product(storeKey: string, url: string): Promise<Listing | null>
}

export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string }>

export type { CategoryId }

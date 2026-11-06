import type { JobDef } from '../config.ts'
import { checkResponse, httpFetch } from './http.ts'
import { FetchError, type Fetcher, type Listing, type PageResult, type SourceAdapter } from './types.ts'

/**
 * Emarati Scents is a Shopify store, so this uses Shopify's public JSON
 * (/collections/<handle>/products.json, /products/<handle>.js).
 * Every variant (size, e.g. 50 ml vs 100 ml) is a separate product, because the prices aren't comparable.
 *
 * The store answers most requests with HTTP 429 (Retry-After: 60), even when they are 30 seconds apart.
 * So a job reads one page per run and the next run continues from the next page. A large collection takes
 * several runs to cover, and a 429 is reported as 'blocked' and read again next run, with no retry here.
 */
const BASE = process.env.EMARATI_BASE_URL ?? 'https://emaratiscents.com'

type ShopifyVariant = { id: number; title: string; price: string | number; compare_at_price?: string | number | null; available?: boolean }
type ShopifyProduct = { id: number; title: string; handle: string; vendor?: string; images?: { src: string }[]; featured_image?: string; variants: ShopifyVariant[] }

/** products.json gives prices as strings ("350.00"); /products/<handle>.js gives integer cents (35000). */
const num = (v: string | number | null | undefined, cents: boolean) => {
  if (v === null || v === undefined || v === '') return undefined
  const n = cents ? Number(v) / 100 : Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function variantListings(p: ShopifyProduct, cents = false): Listing[] {
  return p.variants
    .map((v): Listing | null => {
      const price = num(v.price, cents)
      if (!price) return null
      const compare = num(v.compare_at_price, cents)
      const variant = v.title && v.title !== 'Default Title' ? v.title : undefined
      return {
        source: 'emarati',
        storeKey: String(v.id),
        name: variant ? `${p.title} — ${variant}` : p.title,
        brand: p.vendor,
        variant,
        image: p.images?.[0]?.src ?? p.featured_image,
        url: `${BASE}/products/${p.handle}?variant=${v.id}`,
        price,
        listPrice: compare && compare > price ? compare : undefined,
        available: v.available ?? true,
      }
    })
    .filter((x): x is Listing => !!x)
}

export function parseShopifyCollection(body: string, pageSize: number): PageResult {
  let data: { products?: ShopifyProduct[] }
  try {
    data = JSON.parse(body)
  } catch {
    throw new FetchError('layout_changed', 'Emarati Scents collection was not JSON')
  }
  if (!Array.isArray(data.products)) throw new FetchError('layout_changed', 'Emarati Scents collection had no products')
  return { listings: data.products.flatMap((p) => variantListings(p)), hasNext: data.products.length >= pageSize }
}

export function emaratiAdapter(fetcher: Fetcher = httpFetch): SourceAdapter {
  const PAGE = 250
  /** Next page to read per collection. Kept in memory: after a restart a sweep starts again from page 1. */
  const nextPage = new Map<string, number>()
  return {
    id: 'emarati',
    async listingPage(job: JobDef) {
      const page = nextPage.get(job.target) ?? 1
      const url = `${BASE}/collections/${job.target}/products.json?limit=${PAGE}&page=${page}`
      const r = await fetcher(url, { headers: { accept: 'application/json' } })
      checkResponse(r, url)
      const res = parseShopifyCollection(r.text, PAGE)
      nextPage.set(job.target, res.hasNext ? page + 1 : 1)
      return { listings: res.listings, hasNext: false }
    },
    async product(variantId: string, productUrl: string) {
      const handle = new URL(productUrl).pathname.split('/products/')[1]?.split('/')[0]
      const url = `${BASE}/products/${handle}.js`
      const r = await fetcher(url, { headers: { accept: 'application/json' } })
      checkResponse(r, url)
      let p: ShopifyProduct
      try {
        p = JSON.parse(r.text)
      } catch {
        throw new FetchError('layout_changed', 'Emarati Scents product was not JSON')
      }
      return variantListings(p, true).find((l) => l.storeKey === variantId) ?? null
    },
  }
}

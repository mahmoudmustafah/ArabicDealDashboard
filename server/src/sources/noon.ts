import type { JobDef } from '../config.ts'
import { checkResponse, httpFetch } from './http.ts'
import { FetchError, type Fetcher, type Listing, type PageResult, type SourceAdapter } from './types.ts'

/**
 * Noon Egypt: reads Noon's JSON catalog API (the same data its web app renders).
 * VERIFY: endpoint paths and field names must be confirmed against live noon.com responses.
 */
const SITE = 'https://www.noon.com/egypt-en'
const API = 'https://www.noon.com/_svc/catalog/api/v3/u/egypt-en'
const IMG = 'https://f.nooncdn.com/p/'

type NoonHit = {
  sku: string
  name: string
  brand?: string
  url?: string
  price?: number
  sale_price?: number | null
  image_key?: string
  is_buyable?: boolean
  offer_code?: string
  flags?: string[]
  deal_tag?: { text?: string }
  nudges?: { text?: string }[]
}

const toListing = (h: NoonHit): Listing | null => {
  const sale = h.sale_price ?? undefined
  const price = sale ?? h.price
  if (!h.sku || !h.name || !price) return null
  return {
    source: 'noon',
    storeKey: h.sku,
    name: h.name,
    brand: h.brand,
    image: h.image_key ? `${IMG}${h.image_key}.jpg` : undefined,
    url: `${SITE}/${h.url ?? 'p'}/${h.sku}/p/`,
    price,
    listPrice: sale && h.price && h.price > sale ? h.price : undefined,
    available: h.is_buyable ?? true,
    promos: [
      ...(h.deal_tag?.text ? [{ kind: 'other' as const, text: h.deal_tag.text }] : []),
      ...(h.nudges ?? []).filter((n) => n.text && /coupon|code|buy|كوبون|اشتري/i.test(n.text)).map((n) => ({ kind: (/coupon|code|كوبون/i.test(n.text!) ? 'coupon' : 'multibuy') as 'coupon' | 'multibuy', text: n.text! })),
    ],
  }
}

export function parseNoonCatalog(body: string): PageResult {
  let data: { hits?: NoonHit[]; nbPages?: number; page?: number }
  try {
    data = JSON.parse(body)
  } catch {
    throw new FetchError('layout_changed', 'Noon catalog response was not JSON')
  }
  if (!Array.isArray(data.hits)) throw new FetchError('layout_changed', 'Noon catalog response had no hits')
  return {
    listings: data.hits.map(toListing).filter((x): x is Listing => !!x),
    hasNext: (data.page ?? 1) < (data.nbPages ?? 1),
  }
}

export function parseNoonProduct(body: string): Listing | null {
  let data: { product?: { sku: string; product_title: string; brand?: string; url?: string; image_keys?: string[]; variants?: { offers?: { price: number; sale_price?: number | null; store_name?: string; stock?: number }[] }[] } }
  try {
    data = JSON.parse(body)
  } catch {
    throw new FetchError('layout_changed', 'Noon product response was not JSON')
  }
  const p = data.product
  if (!p) throw new FetchError('layout_changed', 'Noon product response had no product')
  const offer = p.variants?.[0]?.offers?.[0]
  if (!offer) return { source: 'noon', storeKey: p.sku, name: p.product_title, url: `${SITE}/${p.url ?? 'p'}/${p.sku}/p/`, price: 0, available: false }
  const price = offer.sale_price ?? offer.price
  return {
    source: 'noon',
    storeKey: p.sku,
    name: p.product_title,
    brand: p.brand,
    seller: offer.store_name,
    image: p.image_keys?.[0] ? `${IMG}${p.image_keys[0]}.jpg` : undefined,
    url: `${SITE}/${p.url ?? 'p'}/${p.sku}/p/`,
    price,
    listPrice: offer.sale_price && offer.price > offer.sale_price ? offer.price : undefined,
    available: (offer.stock ?? 1) > 0,
  }
}

export function noonAdapter(fetcher: Fetcher = httpFetch): SourceAdapter {
  const headers = { accept: 'application/json', 'x-locale': 'en-eg', 'x-mp': 'noon' }
  return {
    id: 'noon',
    async listingPage(job: JobDef, page: number) {
      const url = `${API}/${job.target}/?page=${page}&limit=50`
      const r = await fetcher(url, { headers })
      checkResponse(r, url)
      return parseNoonCatalog(r.text)
    },
    async product(sku: string, productUrl: string) {
      const slug = productUrl.replace(SITE + '/', '').replace(/\/?$/, '/')
      const url = `${API}/${slug}`
      const r = await fetcher(url, { headers })
      checkResponse(r, url)
      return parseNoonProduct(r.text)
    },
  }
}

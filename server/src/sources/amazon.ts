import { parse, type HTMLElement } from 'node-html-parser'
import type { JobDef } from '../config.ts'
import { classifyPromos } from '../units.ts'
import { checkResponse, httpFetch, parsePrice } from './http.ts'
import { FetchError, type Fetcher, type Listing, type PageResult, type SourceAdapter } from './types.ts'

/**
 * Amazon Egypt: HTML search-result pages and product pages.
 * VERIFY: selectors follow amazon.eg markup as of 2025/26 and must be checked against live pages.
 * Amazon is the store most likely to CAPTCHA automated reads, and those are reported as 'blocked'.
 */
const BASE = 'https://www.amazon.eg'

export function parseAmazonSearch(html: string): PageResult {
  const root = parse(html)
  const cards = root.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')
  const listings: Listing[] = []
  for (const c of cards) {
    const asin = c.getAttribute('data-asin')
    if (!asin) continue
    if (c.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text')) continue // ads repeat organic items
    const name = text(c.querySelector('h2 span')) ?? text(c.querySelector('h2'))
    const price = parsePrice(text(c.querySelector('.a-price:not(.a-text-price) .a-offscreen')))
    if (!name || !price) continue // no buyable price shown (out of stock / see options)
    const listPrice = parsePrice(text(c.querySelector('.a-price.a-text-price .a-offscreen')))
    listings.push({
      source: 'amazon',
      storeKey: asin,
      name,
      image: c.querySelector('img.s-image')?.getAttribute('src'),
      url: `${BASE}/dp/${asin}`,
      price,
      listPrice: listPrice && listPrice > price ? listPrice : undefined,
      available: true,
      promos: classifyPromos([
        text(c.querySelector('.s-coupon-unclipped, .s-coupon-clipped')),
        ...c.querySelectorAll('.a-row .a-color-secondary .a-text-bold').map(text),
      ]).filter((p) => p.kind !== 'other'),
    })
  }
  const hasNext = !!root.querySelector('a.s-pagination-next:not(.s-pagination-disabled)')
  if (!cards.length && !/did not match any products|لم تطابق/i.test(html))
    throw new FetchError('layout_changed', 'Amazon results page had no product cards')
  return { listings, hasNext }
}

export function parseAmazonProduct(html: string, asin: string): Listing | null {
  const root = parse(html)
  const name = text(root.querySelector('#productTitle'))
  if (!name) throw new FetchError('layout_changed', 'Amazon product page had no title')
  // Only this product's price block. A bare '.a-price' also matches the "similar items" carousel,
  // which read other products' prices when a product had no main offer.
  const core = root.querySelector('#corePrice_feature_div') ?? root.querySelector('#corePriceDisplay_desktop_feature_div')
  const price = parsePrice(text(core?.querySelector('.a-price .a-offscreen')))
  const availText = text(root.querySelector('#availability')) ?? ''
  const unavailable = /currently unavailable|غير متوفر|out of stock/i.test(availText)
  if (!price) return unavailable ? { source: 'amazon', storeKey: asin, name, url: `${BASE}/dp/${asin}`, price: 0, available: false } : null
  const listPrice = parsePrice(text(core?.querySelector('.basisPrice .a-offscreen, .a-price.a-text-price .a-offscreen')))
  return {
    source: 'amazon',
    storeKey: asin,
    name,
    seller: text(root.querySelector('#merchantInfoFeature_feature_div .offer-display-feature-text-message, #sellerProfileTriggerId')),
    image: root.querySelector('#landingImage')?.getAttribute('src'),
    url: `${BASE}/dp/${asin}`,
    price,
    listPrice: listPrice && listPrice > price ? listPrice : undefined,
    available: !unavailable,
    promos: classifyPromos([text(root.querySelector('#promoPriceBlockMessage_feature_div')), text(root.querySelector('#couponBadgeRegularVpc'))]),
  }
}

function text(el: HTMLElement | null | undefined) {
  // Amazon puts <style> blocks inside some badges, and their CSS would otherwise read as text.
  el?.querySelectorAll('style, script').forEach((n) => n.remove())
  const t = el?.text.replace(/\s+/g, ' ').trim()
  return t || undefined
}

export function amazonAdapter(fetcher: Fetcher = httpFetch): SourceAdapter {
  return {
    id: 'amazon',
    async listingPage(job: JobDef, page: number) {
      const url = `${BASE}${job.target}${job.target.includes('?') ? '&' : '?'}page=${page}&language=ar_AE`
      const r = await fetcher(url)
      checkResponse(r, url)
      return parseAmazonSearch(r.text)
    },
    async product(asin: string) {
      const url = `${BASE}/dp/${asin}?language=ar_AE`
      const r = await fetcher(url)
      checkResponse(r, url)
      return parseAmazonProduct(r.text, asin)
    },
  }
}

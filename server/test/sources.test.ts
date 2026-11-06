import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { jobs } from '../src/config.ts'
import { amazonAdapter, parseAmazonProduct, parseAmazonSearch } from '../src/sources/amazon.ts'
import { emaratiAdapter, parseShopifyCollection } from '../src/sources/emarati.ts'
import { noonAdapter, parseNoonCatalog } from '../src/sources/noon.ts'
import { priceMatches } from '../src/screenshot.ts'
import { FetchError } from '../src/sources/types.ts'

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

test('amazon search: real listings only, prices, list price, coupon condition', () => {
  const r = parseAmazonSearch(fx('amazon-search.html'))
  assert.deepEqual(r.listings.map((l) => l.storeKey), ['B0AAA11111', 'B0BBB22222'], 'skips sponsored and no-price cards')
  const g5 = r.listings[0]
  assert.equal(g5.price, 11999)
  assert.equal(g5.listPrice, 18999)
  assert.equal(g5.url, 'https://www.amazon.eg/dp/B0AAA11111')
  assert.deepEqual(g5.promos, [{ kind: 'coupon', text: 'Save 5% with coupon' }])
  assert.equal(r.listings[1].price, 1299)
  assert.equal(r.hasNext, true)
})

test('amazon captcha page is reported as blocked', async () => {
  const a = amazonAdapter(async () => ({ status: 200, text: fx('amazon-captcha.html') }))
  await assert.rejects(a.listingPage(jobs[0], 1), (e: unknown) => e instanceof FetchError && e.kind === 'blocked')
})

test('amazon page without product cards is reported as a layout change', () => {
  assert.throws(() => parseAmazonSearch('<html><body>new design</body></html>'), (e: unknown) => e instanceof FetchError && e.kind === 'layout_changed')
})

test('noon catalog: sale vs list price, multibuy nudge, broken hits dropped', () => {
  const r = parseNoonCatalog(fx('noon-catalog.json'))
  assert.equal(r.listings.length, 2)
  assert.equal(r.listings[0].price, 9499)
  assert.equal(r.listings[0].listPrice, 20999)
  assert.equal(r.listings[1].listPrice, undefined)
  assert.equal(r.listings[1].promos?.[0].kind, 'multibuy')
  assert.equal(r.hasNext, true)
})

test('emarati (shopify): each size is its own product', () => {
  const r = parseShopifyCollection(fx('emarati-collection.json'), 250)
  assert.deepEqual(r.listings.map((l) => [l.storeKey, l.variant, l.price, l.listPrice, l.available]), [
    ['11', '50 ml', 900, 1800, true],
    ['12', '100 ml', 1350, 3400, false],
  ])
  assert.equal(r.hasNext, false)
})

// Trimmed from real store responses captured on 2026-11-06.

test('live amazon search card: price, list price, sponsored card skipped', () => {
  const r = parseAmazonSearch(fx('amazon-live-search.html'))
  assert.equal(r.listings.length, 1)
  const l = r.listings[0]
  assert.match(l.url, /^https:\/\/www\.amazon\.eg\/dp\/[A-Z0-9]{10}$/)
  assert.ok(l.price > 0 && l.listPrice! > l.price)
})

test('live noon catalog: sale price, EGP list price, deal tags are not conditions, next page from the caller', () => {
  const body = fx('noon-live-catalog.json')
  const r = parseNoonCatalog(body, 1)
  assert.equal(r.hasNext, true)
  assert.equal(parseNoonCatalog(body, 10).hasNext, false)
  const sale = r.listings[0]
  assert.ok(sale.listPrice! > sale.price)
  assert.deepEqual(sale.promos, [])
})

test('live noon product: read by sku from the catalog API', async () => {
  const urls: string[] = []
  const a = noonAdapter(async (url) => {
    urls.push(url)
    return { status: 200, text: fx('noon-live-product.json') }
  })
  const l = await a.product('N70275701V', 'https://www.noon.com/egypt-en/some-slug/N70275701V/p/')
  assert.equal(urls[0], 'https://www.noon.com/_svc/catalog/api/v3/u/egypt-en/N70275701V/p/')
  assert.equal(l?.storeKey, 'N70275701V')
  assert.equal(l?.price, 9770)
  assert.equal(l?.listPrice, 10500)
})

test('live emarati collection parses real shopify variants', () => {
  const r = parseShopifyCollection(fx('emarati-live-collection.json'), 250)
  assert.ok(r.listings.length >= 1)
  assert.ok(r.listings.every((l) => l.price > 0 && l.url.startsWith('https://emaratiscents.com/products/')))
})

test('emarati reads one page per run, moves on, wraps at the end, and retries the same page after a 429', async () => {
  const product = (id: number) => ({ id, title: `P${id}`, handle: `p${id}`, variants: [{ id, title: 'Default Title', price: '100.00' }] })
  const job = jobs.find((j) => j.id === 'emarati-men')!
  const pages: string[] = []
  let limited = false
  const a = emaratiAdapter(async (url) => {
    pages.push(new URL(url).searchParams.get('page')!)
    if (limited) return { status: 429, text: 'local_rate_limited' }
    const full = pages.length === 1
    return { status: 200, text: JSON.stringify({ products: full ? Array.from({ length: 250 }, (_, i) => product(i + 1)) : [product(999)] }) }
  })
  assert.equal((await a.listingPage(job, 1)).hasNext, false, 'the scanner stops after one page')
  limited = true
  await assert.rejects(a.listingPage(job, 1), (e: unknown) => e instanceof FetchError && e.kind === 'blocked')
  limited = false
  await a.listingPage(job, 1)
  await a.listingPage(job, 1)
  assert.deepEqual(pages, ['1', '2', '2', '1'])
})

test('amazon product: a price in the similar-items carousel is not this product\'s price', () => {
  const carousel = '<div id="similar"><span class="a-price"><span class="a-offscreen">EGP 227.70</span></span></div>'
  const noOffer = `<html><body><span id="productTitle">Lip set</span>${carousel}</body></html>`
  assert.equal(parseAmazonProduct(noOffer, 'B0CY3BYW73'), null)
  const withOffer = `<html><body><span id="productTitle">Lip set</span>${carousel}<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">EGP 410.00</span></span></div></body></html>`
  assert.equal(parseAmazonProduct(withOffer, 'B0CY3BYW73')?.price, 410)
})

test('a screenshot must show the price we are posting', () => {
  assert.ok(priceMatches('جنيه56.00', 56))
  assert.ok(priceMatches('EGP 227.70', 228))
  assert.ok(!priceMatches('EGP 410.00', 228))
  assert.ok(!priceMatches('', 228))
})

test('amazon product: CSS inside a coupon badge is not read as text', () => {
  const html = '<html><body><span id="productTitle">Remote</span><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">EGP 450.00</span></span></div><div id="couponBadgeRegularVpc"><style>.newCouponBadge { color: black; }</style>Save 10% coupon</div></body></html>'
  assert.equal(parseAmazonProduct(html, 'B0GHRV41HB')?.promos?.[0].text, 'Save 10% coupon')
})

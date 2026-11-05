import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { jobs } from '../src/config.ts'
import { amazonAdapter, parseAmazonSearch } from '../src/sources/amazon.ts'
import { parseShopifyCollection } from '../src/sources/emarati.ts'
import { parseNoonCatalog } from '../src/sources/noon.ts'
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

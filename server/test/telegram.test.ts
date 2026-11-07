import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderMessage, type PostContent } from '../src/telegram.ts'

const base: PostContent = {
  key: 7, name: 'Huawei Freebuds 6 - White', source: 'noon', category: 'electronics',
  price: 4999, refPrice: 7899, basis: 'observed', pct: 36.7, promos: [], exceptional: false,
  sufficient: true, checkedAt: Date.UTC(2026, 10, 6, 10), url: 'https://www.noon.com/egypt-en/x/N1/p/',
}

test('channel style: price line, saving, evidence, store, hashtags, button', () => {
  const { html, button } = renderMessage(base)
  assert.match(html, /💰 <b>4,999 جنيه<\/b> بدل <s><b>7,899<\/b><\/s> · خصم <b>37%<\/b>/)
  assert.match(html, /💸 هتوفّر <b>2,900 جنيه<\/b>/)
  assert.match(html, /✅ .*مش السعر المشطوب/)
  assert.match(html, /🏪 نون مصر/)
  assert.match(html, /#سماعات_وإلكترونيات #نون_مصر/)
  assert.deepEqual(button, { text: '🛒 شوف العرض على نون مصر', url: base.url })
})

test('advertised discounts never claim to be real', () => {
  for (let key = 0; key < 50; key++) {
    const { html } = renderMessage({ ...base, key, basis: 'advertised' })
    assert.match(html, /ℹ️ الخصم حسب الموقع، ولسه بنتابع سعره بنفسنا/)
    assert.doesNotMatch(html, /بجد|حقيقي/)
  }
})

test('bank and coupon conditions, exceptional notice, same headline for the same product', () => {
  const { html } = renderMessage({
    ...base, exceptional: true,
    promos: [{ kind: 'other', text: '15% discount with SuezCanal Bank cards' }, { kind: 'coupon', text: 'Save 10%' }],
  })
  assert.match(html, /🏦 كود بنكي: 15% discount with SuezCanal Bank cards \(بكارت البنك فقط\)/)
  assert.match(html, /🎟 كوبون: Save 10%/)
  assert.match(html, /⚠️ نزول كبير، لسه بنتأكد منه/)
  assert.equal(renderMessage(base).html.split('\n')[0], renderMessage({ ...base, price: 4800 }).html.split('\n')[0])
})

test('"real" wording only with enough history; captions stay under Telegram limits', () => {
  for (let key = 0; key < 50; key++) {
    const { html } = renderMessage({ ...base, key, sufficient: false })
    assert.doesNotMatch(html, /بجد|حقيقي|حسبناها من تاريخ/)
  }
  const long = renderMessage({ ...base, name: 'x'.repeat(300), promos: Array.from({ length: 6 }, () => ({ kind: 'coupon' as const, text: '<b>' + 'y'.repeat(500) })) })
  assert.ok(long.html.length < 1024)
  assert.doesNotMatch(long.html, /<b>y/, 'store text is escaped')
})

test('no "save 0" headline when there is no reference price', () => {
  for (let key = 0; key < 50; key++) assert.doesNotMatch(renderMessage({ ...base, key, refPrice: undefined }).html, /وفّر 0/)
})

test('promo text that is really CSS never reaches a post', () => {
  const { html } = renderMessage({ key: 1, name: 'Remote', source: 'amazon', price: 450, refPrice: 1350, basis: 'advertised', pct: 67, promos: [{ kind: 'coupon', text: '.newCouponBadge { color: black; }' }], exceptional: false, checkedAt: 0, url: 'https://www.amazon.eg/dp/A' })
  assert.doesNotMatch(html, /newCouponBadge/)
})

test('the post for a small pack has no per-litre price', () => {
  const { html } = renderMessage({ key: 1, name: 'Serum 4ml', source: 'noon', price: 125, refPrice: 250, basis: 'advertised', pct: 50, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.noon.com/x', pack: { value: 4, unit: 'ml' } })
  assert.doesNotMatch(html, /⚖️/)
})

test('Amazon posts carry the affiliate tag and the disclosure; other stores carry neither', () => {
  const amazon = renderMessage({ key: 1, name: 'A', source: 'amazon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.amazon.eg/dp/B000000001', affiliateTag: 'orodmano-21' })
  assert.equal(amazon.button.url, 'https://www.amazon.eg/dp/B000000001?tag=orodmano-21')
  assert.match(amazon.html, /<i>As an Amazon Associate I earn from qualifying purchases<\/i>$/)
  const noon = renderMessage({ key: 2, name: 'N', source: 'noon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.noon.com/egypt-en/x/N1/p/', affiliateTag: 'orodmano-21' })
  assert.equal(noon.button.url, 'https://www.noon.com/egypt-en/x/N1/p/')
  assert.doesNotMatch(noon.html, /Amazon Associate/)
})

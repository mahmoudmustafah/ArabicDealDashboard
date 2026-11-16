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
    assert.match(html, /ℹ️ الخصم حسب الموقع/)
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

test('only Amazon links carry the affiliate tag', () => {
  const amazon = renderMessage({ key: 1, name: 'A', source: 'amazon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.amazon.eg/dp/B000000001', affiliateTag: 'orodmano-21' })
  assert.equal(amazon.button.url, 'https://www.amazon.eg/dp/B000000001?tag=orodmano-21')
  const noon = renderMessage({ key: 2, name: 'N', source: 'noon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.noon.com/egypt-en/x/N1/p/', affiliateTag: 'orodmano-21' })
  assert.equal(noon.button.url, 'https://www.noon.com/egypt-en/x/N1/p/')
})

test('the caption shows the same link as the button, as a plain URL', () => {
  const amazon = renderMessage({ key: 1, name: 'A', source: 'amazon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.amazon.eg/dp/B000000001', affiliateTag: 'orodmano-21' })
  assert.match(amazon.html, /🔗 لينك العرض: https:\/\/www\.amazon\.eg\/dp\/B000000001\?tag=orodmano-21\n\n#/)
  assert.equal(amazon.button.url, 'https://www.amazon.eg/dp/B000000001?tag=orodmano-21')
  const noon = renderMessage({ key: 2, name: 'N', source: 'noon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.noon.com/egypt-en/x/N1/p/?a=1&b=2', affiliateTag: 'orodmano-21' })
  assert.match(noon.html, /لينك العرض: https:\/\/www\.noon\.com\/egypt-en\/x\/N1\/p\/\?a=1&amp;b=2\n/)
})

test('a long post with a long link still fits a Telegram caption', () => {
  const { html } = renderMessage({ key: 3, name: 'ن'.repeat(900), source: 'noon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [{ kind: 'coupon', text: 'ك'.repeat(900) }, { kind: 'member', text: 'م'.repeat(900) }, { kind: 'other', text: 'ع'.repeat(900) }], exceptional: true, checkedAt: 0, url: `https://www.noon.com/egypt-en/${'a'.repeat(250)}/N1/p/`, category: 'electronics' })
  assert.ok(html.replace(/<[^>]+>/g, '').length <= 1024, `length ${html.length}`)
})

test('the line under a store discount says what we actually know', () => {
  const line = (tracked: PostContent['tracked']) => renderMessage({ key: 1, name: 'A', source: 'noon', price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.noon.com/x', tracked }).html
  assert.match(line({ readings: 1, days: 0, stable: true, atLowest: true, lowest: 80 }), /الخصم حسب الموقع، ولسه أول مرة نشوفه/)
  assert.match(line({ readings: 300, days: 3.4, stable: true, atLowest: true, lowest: 80 }), /الخصم حسب الموقع، وسعره ثابت عندنا من 3 أيام/)
  assert.match(line({ readings: 5, days: 0.2, stable: true, atLowest: true, lowest: 80 }), /ثابت عندنا من النهارده/)
  assert.match(line({ readings: 40, days: 2.1, stable: false, atLowest: true, lowest: 80 }), /وده أقل سعر شفناه من يومين/)
  assert.match(line({ readings: 40, days: 12, stable: false, atLowest: false, lowest: 70 }), /وشفناه قبل كده بأقل \(70 جنيه\)/)
  assert.doesNotMatch(line({ readings: 300, days: 3, stable: true, atLowest: true, lowest: 80 }), /حقيقي|بجد|لسه بنتابع/)
})

test('an Amazon post opens with Amazon in bold; other stores keep their first line', () => {
  const post = (source: string) => renderMessage({ key: 1, name: 'A', source, price: 80, refPrice: 100, basis: 'advertised', pct: 20, promos: [], exceptional: false, checkedAt: 0, url: 'https://www.amazon.eg/dp/B000000001' }).html
  assert.ok(post('amazon').startsWith('<b>أمازون</b> 🛒 📦 🇪🇬\n\n<b>'))
  assert.doesNotMatch(post('noon'), /أمازون/)
})

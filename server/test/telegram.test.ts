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
  assert.match(html, /💰 <b>4,999 جنيه<\/b> بدل <s>7,899<\/s> · خصم 37%/)
  assert.match(html, /💸 هتوفّر 2,900 جنيه/)
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

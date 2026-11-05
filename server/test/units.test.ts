import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePrice } from '../src/sources/http.ts'
import { classifyPromos, parsePack, samePack, unitPrice } from '../src/units.ts'

test('prices in several formats', () => {
  assert.equal(parsePrice('EGP 1,299.00'), 1299)
  assert.equal(parsePrice('١٬٢٩٩ ج.م'), 1299)
  assert.equal(parsePrice('جنيه 11,999'), 11999)
  assert.equal(parsePrice('1.299,50'), 1299.5)
  assert.equal(parsePrice('—'), undefined)
})

test('pack sizes', () => {
  assert.deepEqual(parsePack('Juhayna Milk 1 L'), { value: 1000, unit: 'ml' })
  assert.deepEqual(parsePack('Pepsi 6 x 330ml'), { value: 330, unit: 'ml', qty: 6 })
  assert.deepEqual(parsePack('أرز الضحى 5 كيلو'), { value: 5000, unit: 'g' })
  assert.deepEqual(parsePack('Nescafe Classic 200g'), { value: 200, unit: 'g' })
  assert.deepEqual(parsePack('Fine tissues pack of 10'), { qty: 10, unit: 'item' })
})

test('a smaller pack is not the same product', () => {
  assert.equal(samePack(parsePack('Oil 1.5 L'), parsePack('Oil 750 ml')), false)
  assert.equal(samePack(parsePack('Oil 1.5 L'), parsePack('Oil 1.5 لتر')), true)
})

test('unit prices', () => {
  assert.deepEqual(unitPrice(60, { value: 500, unit: 'g' }), { value: 120, per: 'kg' })
  assert.deepEqual(unitPrice(90, { value: 330, unit: 'ml', qty: 6 })?.per, 'L')
})

test('promotion conditions are classified', () => {
  const p = classifyPromos(['Buy 1 Get 1 Free', 'Save 10% with coupon', 'Prime member price', 'Get 15% off on orders over EGP 500'])
  assert.deepEqual(p.map((x) => x.kind), ['bogo', 'coupon', 'member', 'min_order'])
})

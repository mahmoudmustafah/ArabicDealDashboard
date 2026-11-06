import type { Promo } from './sources/types.ts'

/**
 * Supermarket support (brief §11). It pulls pack size, multipack count and purchase
 * conditions out of product titles, so a smaller pack is never mistaken for a price drop
 * and unit prices can be shown.
 */
export type Pack = { value?: number; unit?: 'g' | 'ml' | 'item'; qty?: number }

const num = (s: string) => Number(s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.'))

const UNITS: [RegExp, 'g' | 'ml', number][] = [
  [/(kg|كيلو(?:جرام)?|كجم)/i, 'g', 1000],
  [/(g|gm|gr|grams?|جرام|جم)/i, 'g', 1],
  [/(l|ltr|liters?|litres?|لتر)/i, 'ml', 1000],
  [/(ml|مل|مللي)/i, 'ml', 1],
]

const D = '[\\d٠-٩]+(?:[.,][\\d٠-٩]+)?'

export function parsePack(rawTitle: string): Pack {
  const out: Pack = {}
  // "(11-18 KG)" on diapers is the baby's weight, not the pack's.
  const title = rawTitle.replace(new RegExp(`\\(?${D}\\s*[-–]\\s*${D}\\s*(?:kg|كجم|كيلو)\\)?`, 'gi'), ' ')
  // "6 x 330ml", "330ml x 6", "12×"
  const multi =
    title.match(new RegExp(`(${D})\\s*[x×*]\\s*(${D})\\s*([a-zA-Z\\u0600-\\u06FF]+)`)) ??
    null
  const multiRev = title.match(new RegExp(`(${D})\\s*([a-zA-Z\\u0600-\\u06FF]+)\\s*[x×*]\\s*(${D})`))
  const packOf = title.match(new RegExp(`(?:pack of|عبوة من|عدد|pcs|pieces|قطع(?:ة)?)\\s*(${D})|(${D})[\\s-]*(?:pcs|pieces?|pack|قطعة|قطع|حبة)\\b|(${D})\\s+(?:baby\\s+)?(?:diapers?|حفاضة)\\b`, 'i'))
  // "8+2 KG" is 10 kg with a free part, not 2 kg.
  const bonus = title.match(new RegExp(`(${D})\\s*\\+\\s*(${D})\\s*([a-zA-Z\\u0600-\\u06FF]+)`))

  const sized = (n: string, u: string) => {
    for (const [re, unit, f] of UNITS) {
      if (new RegExp(`^${re.source}$`, 'i').test(u)) return { value: num(n) * f, unit }
    }
    return undefined
  }

  if (multi) {
    const s = sized(multi[2], multi[3])
    if (s) {
      out.qty = num(multi[1])
      Object.assign(out, s)
      return out
    }
  }
  if (multiRev) {
    const s = sized(multiRev[1], multiRev[2])
    if (s) {
      out.qty = num(multiRev[3])
      Object.assign(out, s)
      return out
    }
  }
  const bonusSize = bonus && sized(bonus[2], bonus[3])
  if (bonusSize) {
    Object.assign(out, { ...bonusSize, value: bonusSize.value + sized(bonus[1], bonus[3])!.value })
    return out
  }
  const single = [...title.matchAll(new RegExp(`(${D})\\s*([a-zA-Z\\u0600-\\u06FF]+)`, 'g'))]
  for (const m of single) {
    const s = sized(m[1], m[2])
    if (s) {
      Object.assign(out, s)
      break
    }
  }
  if (packOf) out.qty = num(packOf[1] ?? packOf[2] ?? packOf[3])
  // Diapers are compared per piece, whatever else the title says.
  if (out.qty && /diaper|حفاض/i.test(title)) {
    delete out.value
    out.unit = 'item'
  }
  if (!out.value && out.qty) out.unit = 'item'
  return out
}

/** Unit price: per kg, per litre, or per item. */
export function unitPrice(price: number, pack: Pack): { value: number; per: 'kg' | 'L' | 'item' } | undefined {
  const qty = pack.qty ?? 1
  if (pack.unit === 'g' && pack.value) return { value: (price / (pack.value * qty)) * 1000, per: 'kg' }
  if (pack.unit === 'ml' && pack.value) return { value: (price / (pack.value * qty)) * 1000, per: 'L' }
  if (pack.qty) return { value: price / pack.qty, per: 'item' }
  return undefined
}

const SMALL_PACK = 100 // g or ml
const ABSURD_PER_KG_OR_L = 5000 // EGP

/** The unit price worth showing in a post. "31,250 EGP per litre" for a 4 ml serum helps nobody. */
export function postUnitPrice(price: number, pack: Pack) {
  const unit = unitPrice(price, pack)
  if (!unit || unit.per === 'item') return unit
  if ((pack.value ?? 0) * (pack.qty ?? 1) < SMALL_PACK || unit.value > ABSURD_PER_KG_OR_L) return undefined
  return unit
}

const PROMO_RULES: [RegExp, Promo['kind']][] = [
  [/buy\s*1\s*get\s*1|buy one get one|bogo|1\s*\+\s*1|اشتر[يى]\s*1\s*واحصل|واحد\s*\+\s*واحد/i, 'bogo'],
  [/buy\s*\d+\s*(?:for|save)|any\s*\d+\s*for|اشتر[يى]\s*\d+\s*(?:ب|ووفر)/i, 'multibuy'],
  [/coupon|promo code|voucher|كوبون|كود خصم/i, 'coupon'],
  [/prime|member|vip|أعضاء|برايم/i, 'member'],
  [/min(?:imum)?\.? (?:order|spend)|orders? (?:over|above)|عند (?:الشراء|طلب) ب/i, 'min_order'],
]

/** Classify promotion text shown by a store into purchase conditions. */
export function classifyPromos(texts: (string | undefined)[]): Promo[] {
  const out: Promo[] = []
  for (const t of texts) {
    if (!t) continue
    const text = t.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const kind = PROMO_RULES.find(([re]) => re.test(text))?.[1] ?? 'other'
    if (!out.some((p) => p.text === text)) out.push({ kind, text })
  }
  return out
}

/** Two packs are comparable only if size, unit and count match. */
export const samePack = (a: Pack, b: Pack) => a.value === b.value && a.unit === b.unit && (a.qty ?? 1) === (b.qty ?? 1)

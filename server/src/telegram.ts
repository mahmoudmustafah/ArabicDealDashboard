import { categoryById, sourceById, telegram as T, timezone } from './config.ts'
import type { Basis } from './evaluate.ts'
import type { Promo } from './sources/types.ts'
import { unitPrice, type Pack } from './units.ts'

/**
 * Telegram message rendering (brief §17) and delivery through the Bot API.
 * Arabic-first, with EGP prices and Cairo times.
 */

export type PostContent = {
  /** Stable key (product id) so the same deal always gets the same headline. */
  key: number | string
  name: string
  source: string
  category?: string
  price: number
  refPrice?: number
  basis: Basis
  pct: number
  promos: Promo[]
  exceptional: boolean
  /** Enough history for a usual-price comparison. */
  sufficient?: boolean
  /** Current price is the lowest we have ever seen. */
  lowestSeen?: boolean
  checkedAt: number
  url: string
  image?: string
  pack?: Pack
}

export type Rendered = { html: string; button: { text: string; url: string } }

const num = (n: number) => Math.round(n).toLocaleString('en-US')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tag = (s: string) => '#' + s.trim().replace(/[\s&،,/]+/g, '_').replace(/_+/g, '_')
const cairoTime = (t: number) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(t)

/**
 * Headlines in the channel's voice. Only deals backed by enough of our own price history
 * (the ~21-day rule) may say "real" ("بجد", "حقيقي"). Newer or store-advertised deals use neutral ones.
 */
const HOOKS: Record<'verified' | 'neutral', ((p: number, save: number) => string)[]> = {
  verified: [
    (p) => `💥 نزل ${p}% بجد مش كلام!`,
    () => '👌 خصم حقيقي مش وهمي',
    () => '🔥 عرض جامد!',
    () => '⚡ فرصة حلوة أوي!',
    (_, s) => `🤑 وفّر ${num(s)} جنيه!`,
    () => '💡 فرصة حلوة لو بتدور عليه',
    () => '✨ لقطة لو محتاجه',
    () => '🛍 سعر حلو النهاردة',
  ],
  neutral: [
    (p) => `🆕 نزل جديد وعليه خصم ${p}%!`,
    () => '🔥 عرض جامد!',
    () => '⚡ فرصة حلوة أوي!',
    () => '🆕 لسه نازل بخصم كبير',
    () => '✨ لقطة لو محتاجه',
    () => '💡 فرصة حلوة لو بتدور عليه',
    () => '🛍 سعر حلو النهاردة',
    (_, s) => `🤑 وفّر ${num(s)} جنيه!`,
  ],
}

function pick<T>(list: T[], key: number | string): T {
  let h = 2166136261
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return list[(h >>> 0) % list.length]
}

function evidenceLine(c: PostContent) {
  if (c.basis === 'advertised') return 'ℹ️ الخصم حسب الموقع، ولسه بنتابع سعره بنفسنا'
  if (c.basis === 'below_usual') return '✅ قارناه بسعره المعتاد، مش باللي الموقع كاتبه'
  if (!c.sufficient)
    return c.lowestSeen ? 'ℹ️ لسه بنتابعه من قريب، بس ده أقل من كل اللي شفناه' : 'ℹ️ شفناه بسعر أعلى قبل كده، ولسه بنتابع سعره'
  return pick(['✅ حسبناها من تاريخ سعره عندنا، مش السعر المشطوب', '✅ مقارنة بسعره الحقيقي من متابعتنا، مش السعر المشطوب'], c.key)
}

const BANK = /bank|card|بنك|كارت|بطاق/i

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

function promoLine(p: Promo) {
  // Clip before escaping so a caption can never be cut inside an HTML tag (Telegram limit: 1024 chars).
  const t = esc(clip(p.text.replace(/\s+/g, ' ').trim(), 120))
  if (BANK.test(p.text)) return `🏦 كود بنكي: ${t} (بكارت البنك فقط)`
  switch (p.kind) {
    case 'coupon': return `🎟 كوبون: ${t}`
    case 'member': return `👤 سعر للأعضاء: ${t}`
    case 'bogo': return `🎁 ${t}`
    case 'multibuy': return `🛒 عرض كمية: ${t}`
    case 'min_order': return `📦 حد أدنى للطلب: ${t}`
    default: return `📌 ${t}`
  }
}

/** Renders a deal in the style of the channel's posts (photo caption plus a "see the offer" button). */
export function renderMessage(c: PostContent): Rendered {
  const store = sourceById(c.source)?.ar ?? c.source
  const pct = Math.round(c.pct)
  const save = c.refPrice ? c.refPrice - c.price : 0
  const verified = c.basis !== 'advertised' && !!c.sufficient
  const hook = pick(HOOKS[verified ? 'verified' : 'neutral'], c.key)(pct, save)
  const name = c.name.length > 90 ? c.name.slice(0, 88).trimEnd() + '…' : c.name

  const lines = [
    `<b>${hook}</b>`,
    '',
    `<b>${esc(name)}</b>`,
    '',
    c.refPrice
      ? `💰 <b>${num(c.price)} جنيه</b> بدل <s><b>${num(c.refPrice)}</b></s> · خصم <b>${pct}%</b>`
      : `💰 <b>${num(c.price)} جنيه</b> · خصم <b>${pct}%</b>`,
  ]
  if (save > 0) lines.push('', `💸 هتوفّر <b>${num(save)} جنيه</b>`)
  const unit = c.pack ? unitPrice(c.price, c.pack) : undefined
  if (unit) lines.push('', `⚖️ <b>${num(unit.value)} جنيه</b> / ${{ kg: 'كيلو', L: 'لتر', item: 'قطعة' }[unit.per]}`)
  lines.push('', evidenceLine(c))
  if (c.exceptional) lines.push('', '⚠️ نزول كبير، لسه بنتأكد منه')
  const promos = c.promos.slice(0, 3)
  if (promos.length) lines.push('', ...promos.map(promoLine))
  lines.push('', `🏪 ${esc(store)}`, `🕒 اتأكدنا من السعر ${cairoTime(c.checkedAt)}`)
  lines.push('', [c.category ? tag(categoryById(c.category)?.ar ?? c.category) : '', tag(store)].filter(Boolean).join(' '))

  return { html: lines.join('\n'), button: { text: `🛒 شوف العرض على ${store}`, url: c.url } }
}

export type SendResult = { ok: true; messageId: number | null; dryRun: boolean } | { ok: false; retryable: boolean; retryAfterMs?: number; error: string }

export type Sender = (channel: 'priority' | 'general', html: string, image?: string, button?: Rendered['button']) => Promise<SendResult>

export const telegramSender: Sender = async (channel, html, image, button) => {
  const chatId = channel === 'priority' ? T.priorityChatId : T.generalChatId
  if (T.dryRun || !chatId) return { ok: true, messageId: null, dryRun: true }
  const method = image ? 'sendPhoto' : 'sendMessage'
  const reply_markup = button ? { inline_keyboard: [[{ text: button.text, url: button.url }]] } : undefined
  const body = image
    ? { chat_id: chatId, photo: image, caption: html, parse_mode: 'HTML', reply_markup }
    : { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup }
  try {
    const res = await fetch(`https://api.telegram.org/bot${T.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string; parameters?: { retry_after?: number } }
    if (data.ok) return { ok: true, messageId: data.result?.message_id ?? null, dryRun: false }
    if (res.status === 429)
      return { ok: false, retryable: true, retryAfterMs: (data.parameters?.retry_after ?? 5) * 1000, error: 'Telegram rate limit (429)' }
    return { ok: false, retryable: res.status >= 500, error: `Telegram ${res.status}: ${data.description ?? 'error'}` }
  } catch (e) {
    return { ok: false, retryable: true, error: (e as Error).name === 'TimeoutError' ? 'Telegram connection timed out' : `Network: ${(e as Error).message}` }
  }
}

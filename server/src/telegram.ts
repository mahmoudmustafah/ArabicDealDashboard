import { sourceById, telegram as T, timezone } from './config.ts'
import type { Basis } from './evaluate.ts'
import type { Promo } from './sources/types.ts'
import { unitPrice, type Pack } from './units.ts'

/**
 * Telegram message rendering (brief §17) and delivery through the Bot API.
 * Arabic-first, with EGP prices and Cairo times.
 */

export type PostContent = {
  name: string
  source: string
  price: number
  refPrice?: number
  basis: Basis
  pct: number
  promos: Promo[]
  exceptional: boolean
  checkedAt: number
  url: string
  image?: string
  pack?: Pack
}

const egp = (n: number) => `${Math.round(n).toLocaleString('en-US')} ج.م`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cairoTime = (t: number) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: timezone, hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(t)

const basisLine: Record<Basis, (pct: number, ref?: number) => string> = {
  observed: (p, ref) => `📉 نزول مرصود <b>${Math.round(p)}%</b>${ref ? ` — رصدناه قبل كده بـ ${egp(ref)}` : ''}`,
  below_usual: (p, ref) => `📊 أقل من المعتاد بـ <b>${Math.round(p)}%</b>${ref ? ` — السعر المعتاد ${egp(ref)}` : ''}`,
  advertised: (p, ref) => `🏷️ خصم معلن من المتجر <b>${Math.round(p)}%</b>${ref ? ` (السعر المشطوب ${egp(ref)})` : ''} — مش متأكدين منه من سجل الأسعار`,
}

const promoAr: Record<Promo['kind'], string> = {
  coupon: 'محتاج كوبون',
  member: 'سعر للأعضاء فقط',
  bogo: 'اشتري واحد وخد واحد',
  multibuy: 'عرض على كمية',
  min_order: 'حد أدنى للطلب',
  other: 'شرط',
}

export function renderMessage(c: PostContent): string {
  const lines = [
    c.exceptional ? '⚠️ <b>نزول استثنائي — قيد التحقق</b>' : '',
    `<b>${esc(c.name)}</b>`,
    `🏬 ${esc(sourceById(c.source)?.ar ?? c.source)}`,
    `💰 <b>${egp(c.price)}</b>`,
    basisLine[c.basis](c.pct, c.refPrice),
  ]
  const unit = c.pack ? unitPrice(c.price, c.pack) : undefined
  if (unit) lines.push(`⚖️ ${egp(unit.value)} / ${{ kg: 'كيلو', L: 'لتر', item: 'قطعة' }[unit.per]}`)
  for (const p of c.promos) lines.push(`📌 ${promoAr[p.kind]}: ${esc(p.text)}`)
  lines.push(`🕒 آخر فحص: ${cairoTime(c.checkedAt)}`)
  lines.push(`🔗 <a href="${esc(c.url)}">افتح العرض</a>`)
  return lines.filter(Boolean).join('\n')
}

export type SendResult = { ok: true; messageId: number | null; dryRun: boolean } | { ok: false; retryable: boolean; retryAfterMs?: number; error: string }

export type Sender = (channel: 'priority' | 'general', html: string, image?: string) => Promise<SendResult>

export const telegramSender: Sender = async (channel, html, image) => {
  const chatId = channel === 'priority' ? T.priorityChatId : T.generalChatId
  if (T.dryRun || !chatId) return { ok: true, messageId: null, dryRun: true }
  const method = image ? 'sendPhoto' : 'sendMessage'
  const body = image
    ? { chat_id: chatId, photo: image, caption: html.slice(0, 1024), parse_mode: 'HTML' }
    : { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: false }
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

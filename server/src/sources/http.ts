import { schedule } from '../config.ts'
import { FetchError, type Fetcher } from './types.ts'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export const CAPTCHA = /captcha|robot check|validateCaptcha|automated access|are you a human|access denied/i

/** Default fetcher. It classifies failures so scan runs can report why coverage was incomplete. */
export const httpFetch: Fetcher = async (url, init) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), schedule.requestTimeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.8', ...init?.headers },
      redirect: 'follow',
    })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new FetchError('timeout', `Timed out: ${url}`)
    throw new FetchError('network', `Network error: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

export function checkResponse(r: { status: number; text: string }, url: string) {
  if (r.status === 503 || r.status === 429 || CAPTCHA.test(r.text.slice(0, 20_000)))
    throw new FetchError('blocked', `Store blocked the request (CAPTCHA/rate limit) at ${url}`)
  if (r.status >= 400) throw new FetchError('http', `HTTP ${r.status} at ${url}`)
}

/** "EGP 1,299.00", "١٬٢٩٩ ج.م", "1.299,50" → number. Returns undefined when nothing numeric. */
export function parsePrice(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined
  const ascii = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٬،]/g, ',').replace(/٫/g, '.')
  const m = ascii.match(/\d[\d,.\s]*/)
  if (!m) return undefined
  let s = m[0].replace(/\s/g, '')
  // European style "1.299,50"
  if (/\.\d{3},\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

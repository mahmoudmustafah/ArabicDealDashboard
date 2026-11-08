import type { Browser, Page } from 'playwright-core'
import { existsSync, readFileSync } from 'node:fs'
import { schedule, type SourceId } from './config.ts'
import { CAPTCHA, parsePrice } from './sources/http.ts'

/**
 * Desktop-sized screenshots of the offer on the store's own page, for Telegram posts.
 * This is best effort: any block, timeout or surprise returns null and the post uses the product image.
 * A screenshot is also a claim, so it is rejected unless the page shows the price we are about to post.
 * Blocks are not worked around.
 */
export type Screenshotter = (source: SourceId, url: string, expectedPrice: number) => Promise<Buffer | null>
/** Whether the last attempt failed because the page was blocked or never showed a price, not because the price differed. */
export type ScreenshotResult = { lastBlocked: boolean }

type StoreView = {
  /** Store page in Arabic where the store has one. */
  localize: (url: string) => string
  /** The price of this product only. Never a bare price selector, which also matches suggested products. */
  price: string
  /** Top of the captured area. Omit to start at the top of the page. */
  start?: string
  /** Popups to close, without accepting anything. */
  close?: string
  /** Boxes to mark in red, so the deal stands out. */
  highlight?: string[]
  /** Parts of the page the logo must not cover. */
  keepClear?: string[]
}

const stores: Record<SourceId, StoreView> = {
  amazon: {
    localize: (u) => `${u}${u.includes('?') ? '&' : '?'}language=ar_AE`,
    price: '#corePriceDisplay_desktop_feature_div .a-price, #corePrice_feature_div .a-price',
    start: '#ppd',
    highlight: ['#corePriceDisplay_desktop_feature_div', '#offerDisplayFeatures_desktop'],
    keepClear: ['#desktop_buybox', '#buybox'],
  },
  noon: {
    localize: (u) => u.replace('/egypt-en/', '/egypt-ar/'),
    price: '[class*="priceNowCtr"]',
    highlight: ['[class*="priceOfferCtr"]'],
  },
  emarati: {
    localize: (u) => u,
    price: '.product-detail__price .price, .product-detail__price',
    close: '[aria-label*="close" i]',
    highlight: ['.product-detail__price'],
  },
}

const VIEW = { width: 1280, height: 800 }
const MAX_HEIGHT = 1000
const MIN_HEIGHT = 800
const PRICE_TOLERANCE = 0.02

/** The price on the page must match the price we post. */
export function priceMatches(text: string | null | undefined, expected: number) {
  const seen = parsePrice(text)
  return seen !== undefined && Math.abs(seen - expected) / expected <= PRICE_TOLERANCE
}

const LOGOS = [process.env.CHANNEL_LOGO, '../assets/logo.png', '../assets/logo.jpg'].filter((x): x is string => !!x)
function logoDataUrl() {
  const file = LOGOS.find((f) => existsSync(f))
  return file ? `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(file).toString('base64')}` : null
}

const LOGO_SHARE = 0.13
const LOGO_MARGIN = 24
type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Bottom left like a stamp, unless that covers the price, a red box or the buy box. Then bottom right, or nowhere. */
export function logoSpot(frame: { top: number; width: number; height: number }, avoid: Box[]) {
  const size = frame.width * LOGO_SHARE
  const y = frame.top + frame.height - size - LOGO_MARGIN
  const spots = [LOGO_MARGIN, frame.width - size - LOGO_MARGIN].map((x) => ({ x, y, width: size, height: size }))
  return spots.find((spot) => !avoid.some((b) => overlaps(spot, b)))
}

function overlayScript(o: { boxes: Box[]; frame: { top: number; width: number; height: number }; logo: string | null; spot?: Box }) {
  return `(() => {
    const o = ${JSON.stringify(o)}
    const add = (css, el = document.createElement('div')) => { el.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;' + css; document.body.appendChild(el); return el }
    for (const b of o.boxes) add('left:' + (b.x - 6) + 'px;top:' + (b.y + scrollY - 6) + 'px;width:' + (b.width + 12) + 'px;height:' + (b.height + 12) + 'px;border:4px solid #e3242b;border-radius:6px')
    add('left:0;top:' + o.frame.top + 'px;width:' + o.frame.width + 'px;height:' + o.frame.height + 'px;border:8px solid transparent;border-image:linear-gradient(90deg,#3cc5f4,#8d7bf6,#f26cae) 1')
    if (o.logo && o.spot) { const img = document.createElement('img'); img.src = o.logo; add('left:' + o.spot.x + 'px;top:' + o.spot.y + 'px;width:' + o.spot.width + 'px;height:' + o.spot.height + 'px;border:3px solid #fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.35)', img) }
  })()`
}

async function capture(page: Page, source: SourceId, url: string, expected: number, timeoutMs: number): Promise<Buffer | null> {
  const s = stores[source]
  const res = await page.goto(s.localize(url), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  if (!res || res.status() >= 400) return null
  const price = page.locator(s.price).first()
  await price.waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 12_000) })
  if (CAPTCHA.test((await page.title()) ?? '')) throw new Error('blocked: robot check')
  if (!priceMatches(await price.textContent(), expected)) return null

  if (s.close) await page.locator(s.close).first().click({ timeout: 1500 }).catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  // Sticky bars and leftover popups would cover the offer. A string because this runs in the page.
  await page.evaluate(`(() => {
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position
      if (pos === 'fixed') el.style.setProperty('display', 'none', 'important')
      // Some stores make the product photo sticky, so keep these in the page.
      if (pos === 'sticky') el.style.setProperty('position', 'static', 'important')
    }
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow = 'auto'
    document.body.style.filter = 'none'
  })()`)

  const priceBox = await price.boundingBox()
  if (!priceBox) return null
  const startBox = s.start ? await page.locator(s.start).first().boundingBox().catch(() => null) : null
  const top = Math.max(0, (startBox?.y ?? 0) - 8)
  const height = Math.min(MAX_HEIGHT, Math.max(priceBox.y + priceBox.height + 90 - top, MIN_HEIGHT))
  // Red boxes on the deal, a coloured frame, and the logo. All drawn on the page, so they are captured with it.
  // An element that isn't there gets no box, rather than a guess.
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  for (const sel of s.highlight ?? []) {
    const box = await page.locator(sel).first().boundingBox({ timeout: 1000 }).catch(() => null)
    if (box && box.width > 0 && box.height > 0 && box.y < top + height) boxes.push(box)
  }
  const frame = { top, width: VIEW.width, height }
  const keepClear = [...boxes, priceBox]
  for (const sel of s.keepClear ?? []) {
    const box = await page.locator(sel).first().boundingBox({ timeout: 1000 }).catch(() => null)
    if (box) keepClear.push(box)
  }
  await page.evaluate(overlayScript({ boxes, frame, logo: logoDataUrl(), spot: logoSpot(frame, keepClear) }))
  return page.screenshot({ type: 'jpeg', quality: 80, fullPage: true, clip: { x: 0, y: top, width: VIEW.width, height } })
}

export function createScreenshotter(timeoutMs = 20_000): Screenshotter & ScreenshotResult & { close: () => Promise<void> } {
  let browser: Promise<Browser> | undefined
  const open = () =>
    (browser ??= import('playwright-core').then(async ({ chromium }) => {
      const b = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? 'chrome', headless: true })
      b.on('disconnected', () => (browser = undefined))
      return b
    }))

  const shoot = async (source: SourceId, url: string, expected: number) => {
    let ctx
    result.lastBlocked = false
    try {
      const { devices } = await import('playwright-core')
      const b = await open()
      ctx = await b.newContext({
        ...devices['Desktop Chrome'],
        viewport: VIEW,
        screen: VIEW,
        deviceScaleFactor: 1.5,
        locale: 'ar-EG',
        timezoneId: 'Africa/Cairo',
      })
      const page = await ctx.newPage()
      page.setDefaultTimeout(timeoutMs)
      const shot = await Promise.race([
        capture(page, source, url, expected, timeoutMs),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs + schedule.requestGapMs)),
      ])
      return shot ?? null
    } catch (e) {
      result.lastBlocked = true
      console.warn(`[screenshot] ${source}: ${(e as Error).message.split('\n')[0]}`)
      if (!ctx) browser = undefined
      return null
    } finally {
      await ctx?.close().catch(() => {})
    }
  }
  const result = Object.assign(shoot, { lastBlocked: false, close: async () => void (await (await browser?.catch(() => undefined))?.close()) })
  return result
}

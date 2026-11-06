import type { Browser, Page } from 'playwright-core'
import { schedule, type SourceId } from './config.ts'
import { CAPTCHA, parsePrice } from './sources/http.ts'

/**
 * Screenshots of the offer on the store's own page, for Telegram posts.
 * This is best effort: any block, timeout or surprise returns null and the post uses the product image.
 * A screenshot is also a claim, so it is rejected unless the page shows the price we are about to post.
 * Blocks are not worked around.
 */
export type Screenshotter = (source: SourceId, url: string, expectedPrice: number) => Promise<Buffer | null>

type StoreView = {
  /** Store page in Arabic where the store has one. */
  localize: (url: string) => string
  /** The price of this product only. Never a bare price selector, which also matches suggested products. */
  price: string
  /** Top of the captured area. Omit to start at the top of the page. */
  start?: string
  /** Popups to close, without accepting anything. */
  close?: string
}

const stores: Record<SourceId, StoreView> = {
  amazon: {
    localize: (u) => `${u}${u.includes('?') ? '&' : '?'}language=ar_AE`,
    price: '#corePrice_mobile_feature_div .a-price, #corePriceDisplay_mobile_feature_div .a-price, #apex_mobile_feature_div .a-price',
    start: '#bylineInfo, #title',
  },
  noon: {
    localize: (u) => u.replace('/egypt-en/', '/egypt-ar/'),
    price: '[class*="priceNowCtr"]',
  },
  emarati: {
    localize: (u) => u,
    price: '.product-detail__price .price, .product-detail__price',
    close: '[aria-label*="close" i]',
  },
}

const VIEW = { width: 430, height: 932 }
const MAX_HEIGHT = 1300
const PRICE_TOLERANCE = 0.02

/** The price on the page must match the price we post. */
export function priceMatches(text: string | null | undefined, expected: number) {
  const seen = parsePrice(text)
  return seen !== undefined && Math.abs(seen - expected) / expected <= PRICE_TOLERANCE
}

async function capture(page: Page, source: SourceId, url: string, expected: number, timeoutMs: number): Promise<Buffer | null> {
  const s = stores[source]
  const res = await page.goto(s.localize(url), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  if (!res || res.status() >= 400) return null
  const price = page.locator(s.price).first()
  await price.waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 12_000) })
  if (CAPTCHA.test((await page.title()) ?? '')) return null
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
  const height = Math.min(MAX_HEIGHT, Math.max(priceBox.y + priceBox.height + 90 - top, 400))
  return page.screenshot({ type: 'jpeg', quality: 80, fullPage: true, clip: { x: 0, y: top, width: VIEW.width, height } })
}

export function createScreenshotter(timeoutMs = 20_000): Screenshotter & { close: () => Promise<void> } {
  let browser: Promise<Browser> | undefined
  const open = () =>
    (browser ??= import('playwright-core').then(async ({ chromium }) => {
      const b = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? 'chrome', headless: true })
      b.on('disconnected', () => (browser = undefined))
      return b
    }))

  const shoot = async (source: SourceId, url: string, expected: number) => {
    let ctx
    try {
      const { devices } = await import('playwright-core')
      const b = await open()
      ctx = await b.newContext({
        ...devices['iPhone 14 Pro Max'],
        viewport: VIEW,
        screen: VIEW,
        deviceScaleFactor: 2,
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
      console.warn(`[screenshot] ${source}: ${(e as Error).message.split('\n')[0]}`)
      if (!ctx) browser = undefined
      return null
    } finally {
      await ctx?.close().catch(() => {})
    }
  }
  return Object.assign(shoot, { close: async () => void (await (await browser?.catch(() => undefined))?.close()) })
}

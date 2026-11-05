// SAMPLE DATA — every product, price and scan below is illustrative, not live Amazon data.

export const NOW = new Date('2026-05-14T14:20:00+03:00').getTime()
export const HOUR = 3600e3
export const DAY = 24 * HOUR
export const TRACKED_TOTAL = 186

import { L, type T } from './i18n'

export type CategoryId = 'monitors' | 'headphones' | 'keyboards' | 'storage'

export const categories: { id: CategoryId; label: T }[] = [
  { id: 'monitors', label: { ar: 'شاشات كمبيوتر', en: 'Monitors' } },
  { id: 'headphones', label: { ar: 'سماعات', en: 'Headphones' } },
  { id: 'keyboards', label: { ar: 'كيبورد وماوس', en: 'Keyboards & mice' } },
  { id: 'storage', label: { ar: 'تخزين', en: 'Storage' } },
]

export const futureSources = ['B.TECH', '2B Egypt']

export type Obs = { t: number; price: number }

export type Product = {
  id: string
  name: string
  fullName: string
  nameEn: string
  fullNameEn: string
  category: CategoryId
  image?: string
  /** Price Amazon shows as crossed-out / "was" price. */
  listPrice?: number
  history: Obs[]
  /** Product was not read for a long time (stale). */
  staleAt?: number
}

const img = {
  monitorDesk:
    'https://images.unsplash.com/photo-1691480195680-144318cfa695?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  monitorFlat:
    'https://images.unsplash.com/photo-1552320640-6e01a5f1c1e9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  imac: 'https://images.unsplash.com/photo-1517059224940-d4af9eec41b7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  workspace:
    'https://images.unsplash.com/photo-1704299059700-268345bcb6bd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  headphonesFlat:
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  headphonesBlack:
    'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  keyboardOrange:
    'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
  keyboardRed:
    'https://images.unsplash.com/photo-1635987391914-cb84b567e68f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=600',
}

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Builds deterministic readings. Segments: [fromDaysAgo, toDaysAgo, price]. */
function build(seed: number, segs: [number, number, number][], stepH = 22): Obs[] {
  const r = rng(seed)
  const out: Obs[] = []
  segs.forEach(([from, to, price], i) => {
    let t = NOW - from * DAY
    const end = NOW - to * DAY
    while (t < end) {
      const noise = r() < 0.3 ? (r() - 0.5) * 0.024 : 0
      out.push({ t, price: Math.round((price * (1 + noise)) / 50) * 50 - 1 })
      t += stepH * HOUR * (0.7 + r() * 0.6)
    }
    if (i === segs.length - 1) out.push({ t: end, price })
  })
  return out
}

export const products: Product[] = [
  {
    id: 'odyssey-g5',
    name: 'سامسونج أوديسي G5 مقاس 27″',
    fullName: 'شاشة ألعاب سامسونج أوديسي G5 مقاس 27 بوصة، QHD، ‏165 هرتز، منحنية',
    nameEn: 'Samsung Odyssey G5 27″',
    fullNameEn: 'Samsung Odyssey G5 27-inch curved gaming monitor, QHD, 165Hz',
    category: 'monitors',
    image: img.monitorDesk,
    listPrice: 18999,
    history: build(11, [
      [95, 40, 15999],
      [40, 12, 15499],
      [12, 3, 14999],
      [3, 0.12, 11999],
    ]),
  },
  {
    id: 'dell-s2721ds',
    name: 'ديل S2721DS مقاس 27″ QHD',
    fullName: 'شاشة ديل S2721DS مقاس 27 بوصة، QHD ‏IPS، سماعات مدمجة',
    nameEn: 'Dell S2721DS 27″ QHD',
    fullNameEn: 'Dell S2721DS 27-inch QHD IPS monitor with built-in speakers',
    category: 'monitors',
    listPrice: 11499,
    history: [{ t: NOW - 2.4 * HOUR, price: 8999 }],
  },
  {
    id: 'xiaomi-a27i',
    name: 'شاومي A27i مقاس 27″ ‏100Hz',
    fullName: 'شاشة شاومي A27i مقاس 27 بوصة، Full HD، ‏100 هرتز',
    nameEn: 'Xiaomi A27i 27″ 100Hz',
    fullNameEn: 'Xiaomi A27i 27-inch Full HD monitor, 100Hz',
    category: 'monitors',
    image: img.monitorFlat,
    listPrice: 6499,
    history: build(23, [
      [60, 1.6, 5999],
      [1.6, 0.15, 2999],
    ]),
  },
  {
    id: 'lg-24gn60r',
    name: 'إل جي ألترا جير 24″ ‏144Hz',
    fullName: 'شاشة إل جي ألترا جير 24GN60R مقاس 24 بوصة، IPS، ‏144 هرتز',
    nameEn: 'LG UltraGear 24″ 144Hz',
    fullNameEn: 'LG UltraGear 24GN60R 24-inch IPS monitor, 144Hz',
    category: 'monitors',
    image: img.imac,
    listPrice: 7999,
    history: build(37, [
      [92, 20, 6499],
      [20, 1, 6299],
      [1, 0.2, 5299],
    ]),
  },
  {
    id: 'anker-q30',
    name: 'سماعة أنكر ساوندكور Q30',
    fullName: 'سماعة رأس لاسلكية أنكر ساوندكور Life Q30 بعزل ضوضاء',
    nameEn: 'Anker Soundcore Q30',
    fullNameEn: 'Anker Soundcore Life Q30 noise-cancelling wireless headphones',
    category: 'headphones',
    image: img.headphonesFlat,
    listPrice: 4999,
    history: build(41, [[88, 0.15, 3299]]),
  },
  {
    id: 'mx-keys-s',
    name: 'كيبورد لوجيتك MX Keys S',
    fullName: 'كيبورد لاسلكي لوجيتك MX Keys S بإضاءة خلفية — عربي/إنجليزي',
    nameEn: 'Logitech MX Keys S',
    fullNameEn: 'Logitech MX Keys S wireless backlit keyboard, Arabic/English',
    category: 'keyboards',
    image: img.keyboardOrange,
    listPrice: 5999,
    history: build(53, [
      [75, 30, 5499],
      [30, 10, 5299],
      [10, 0.3, 4799],
    ]),
  },
  {
    id: 'aoc-27g2sp',
    name: 'AOC ‏27G2SP مقاس 27″ ‏165Hz',
    fullName: 'شاشة AOC ‏27G2SP مقاس 27 بوصة، IPS، ‏165 هرتز',
    nameEn: 'AOC 27G2SP 27″ 165Hz',
    fullNameEn: 'AOC 27G2SP 27-inch IPS monitor, 165Hz',
    category: 'monitors',
    image: img.workspace,
    listPrice: 9999,
    history: build(61, [
      [80, 10, 8799],
      [10, 3.2, 7999],
    ]),
    staleAt: NOW - 3.2 * DAY,
  },
  {
    id: 'samsung-t7',
    name: 'هارد سامسونج T7 ‏1 تيرا',
    fullName: 'هارد SSD خارجي سامسونج T7 سعة 1 تيرابايت USB 3.2',
    nameEn: 'Samsung T7 SSD 1TB',
    fullNameEn: 'Samsung T7 1TB portable SSD, USB 3.2',
    category: 'storage',
    history: build(
      71,
      [
        [5, 2, 4999],
        [2, 0.2, 4599],
      ],
      34,
    ),
  },
  {
    id: 'huawei-mateview-se',
    name: 'هواوي MateView SE ‏23.8″',
    fullName: 'شاشة هواوي MateView SE مقاس 23.8 بوصة، IPS، ‏75 هرتز',
    nameEn: 'Huawei MateView SE 23.8″',
    fullNameEn: 'Huawei MateView SE 23.8-inch IPS monitor, 75Hz',
    category: 'monitors',
    image: img.monitorFlat,
    listPrice: 5999,
    history: build(83, [
      [44, 6, 5499],
      [6, 0.2, 5199],
    ]),
  },
  {
    id: 'jbl-tune-520',
    name: 'سماعة JBL Tune 520BT',
    fullName: 'سماعة رأس لاسلكية JBL Tune 520BT — أسود',
    nameEn: 'JBL Tune 520BT',
    fullNameEn: 'JBL Tune 520BT wireless headphones, black',
    category: 'headphones',
    image: img.headphonesBlack,
    listPrice: 2499,
    history: build(97, [
      [70, 8, 2199],
      [8, 0.25, 1899],
    ]),
  },
  {
    id: 'redragon-k552',
    name: 'كيبورد ريدراجون K552',
    fullName: 'كيبورد ميكانيكي ريدراجون K552 Kumara بإضاءة حمراء',
    nameEn: 'Redragon K552 keyboard',
    fullNameEn: 'Redragon K552 Kumara mechanical keyboard, red backlight',
    category: 'keyboards',
    image: img.keyboardRed,
    listPrice: 1599,
    history: build(103, [[50, 0.2, 1299]]),
  },
]

export type ScanStatus = 'success' | 'partial' | 'failed' | 'running'
export type Scan = {
  id: string
  at: number
  status: ScanStatus
  read: number
  durationMin?: number
  note?: string
}

export type Scenario = 'normal' | 'running' | 'partial' | 'failed'

export function buildScans(scenario: Scenario): Scan[] {
  const list: Scan[] = []
  // hourly scans at :05, latest at 14:05
  for (let i = 0; i < 18; i++) {
    const at = NOW - 15 * 60e3 - i * HOUR
    let s: Scan = { id: `s${i}`, at, status: 'success', read: 186 - (i % 3), durationMin: 6 + (i % 4) }
    if (i === 5) s = { ...s, status: 'partial', read: 142, durationMin: 11, note: L('انتهت مهلة 44 صفحة منتج', '44 product pages timed out') }
    if (i === 11) s = { ...s, status: 'failed', read: 0, durationMin: 2, note: L('أمازون رجّع صفحة تحقق (CAPTCHA)', 'Amazon returned a CAPTCHA page') }
    list.push(s)
  }
  if (scenario === 'partial') {
    list[0] = { ...list[0], status: 'partial', read: 121, durationMin: 12, note: L('65 منتج ما اتقراش — ظاهر آخر سعر ناجح', '65 products not read — showing last successful price') }
  }
  if (scenario === 'failed') {
    list[0] = { ...list[0], status: 'failed', read: 0, durationMin: 1, note: L('تعذّر الاتصال بـ amazon.eg (مهلة الشبكة)', 'Could not reach amazon.eg (network timeout)') }
  }
  if (scenario === 'running') {
    list.unshift({ id: 'live', at: NOW - 2 * 60e3, status: 'running', read: 97 })
  }
  return list
}

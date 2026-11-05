import { AlertTriangle, ArrowDown, Clock, HelpCircle, ImageOff, Tag, TrendingDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { DealStatus } from './deal'
import { statusLabel } from './deal'
import { L } from './i18n'
import { price } from './format'

export function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}

const statusStyle: Record<DealStatus, { cls: string; icon: ReactNode }> = {
  exceptional: {
    cls: 'bg-pending-soft text-pending ring-1 ring-inset ring-pending-line',
    icon: <AlertTriangle className="size-3.5" strokeWidth={2.4} />,
  },
  below_usual: {
    cls: 'bg-drop text-white',
    icon: <TrendingDown className="size-3.5" strokeWidth={2.4} />,
  },
  observed_drop: {
    cls: 'bg-drop-soft text-drop ring-1 ring-inset ring-drop/20',
    icon: <ArrowDown className="size-3.5" strokeWidth={2.4} />,
  },
  insufficient: {
    cls: 'bg-white text-body ring-1 ring-inset ring-line border-dashed',
    icon: <HelpCircle className="size-3.5" strokeWidth={2.2} />,
  },
  advertised_only: {
    cls: 'bg-adv-soft text-adv',
    icon: <Tag className="size-3.5" strokeWidth={2.2} />,
  },
}

export function StatusBadge({ s, size = 'sm' }: { s: DealStatus; size?: 'sm' | 'md' }) {
  const st = statusStyle[s]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-xs',
        st.cls,
      )}
    >
      {st.icon}
      {statusLabel(s)}
    </span>
  )
}

export function StaleBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-white">
      <Clock className="size-3.5" strokeWidth={2.4} />
      {L('سعر قديم', 'Stale price')}
    </span>
  )
}

export function Money({ n, className, unit, strike }: { n: number; className?: string; unit?: string; strike?: boolean }) {
  return (
    <span className={cx('num inline-flex items-baseline gap-1 whitespace-nowrap', className)}>
      <bdi className={cx(strike && 'line-through decoration-1')}>{price(n)}</bdi>
      <span className="text-[0.62em] font-medium opacity-70">{unit ?? L('ج.م', 'EGP')}</span>
    </span>
  )
}

export function Pct({ n, className }: { n: number; className?: string }) {
  return (
    <bdi className={cx('num whitespace-nowrap', className)} dir="ltr">
      {Math.round(n)}%
    </bdi>
  )
}

export function Thumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={cx('@container relative overflow-hidden bg-thumb', className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-mute">
          <ImageOff className="size-5" strokeWidth={1.6} />
          <span className="hidden text-[10.5px] @min-[64px]:block">{L('مفيش صورة', 'No image')}</span>
        </div>
      )}
    </div>
  )
}

export function SampleTag({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-line-strong bg-white px-2 py-0.5 text-[11px] font-semibold text-body',
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-line-strong" />
      {L('بيانات تجريبية', 'Sample data')}
    </span>
  )
}

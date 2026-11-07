import { AlertOctagon, AlertTriangle, ArrowDown, Clock, HelpCircle, ImageOff, Loader2, RotateCw, Tag, TrendingDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { DealStatus } from './deal'
import { statusLabel } from './deal'
import { L } from './i18n'
import { store } from './deal'
import type { SourceId } from './api'
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

export function Thumb({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={cx('@container relative overflow-hidden bg-thumb', className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-full bg-white object-contain" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-mute">
          <ImageOff className="size-5" strokeWidth={1.6} />
          <span className="hidden text-[10.5px] @min-[64px]:block">{L('مفيش صورة', 'No image')}</span>
        </div>
      )}
    </div>
  )
}

export function SourceChip({ id }: { id: SourceId }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10.5px] font-semibold',
        id === 'noon' ? 'bg-noon-soft text-noon-ink' : id === 'emarati' ? 'bg-emarati-soft text-emarati-ink' : 'bg-adv-soft text-adv',
      )}
    >
      {store(id).short()}
    </span>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-white py-16 text-[13.5px] text-body">
      <Loader2 className="size-5 animate-spin" />
      {label ?? L('جاري تحميل البيانات…', 'Loading data…')}
    </div>
  )
}

/** Shown in both languages on purpose: it is the one message that must always be understood. */
export function ApiDown({ onRetry, compact }: { onRetry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={cx('flex flex-col gap-3 rounded-2xl border border-fail/25 bg-fail-soft sm:flex-row sm:items-center', compact ? 'p-3' : 'p-5')}>
      <AlertOctagon className="size-5 shrink-0 text-fail" />
      <div className="flex-1 text-[13.5px] leading-6">
        <div lang="ar" dir="rtl" className="font-bold text-fail">مش قادرين نوصل لخدمة رادار العروض — الأسعار مش بتتحدث دلوقتي.</div>
        <div lang="en" dir="ltr" className="font-bold text-fail">Can't reach the Deal Radar service — prices are not updating right now.</div>
        {!compact && (
          <div className="mt-1 text-body">
            <span lang="ar" dir="rtl" className="block">مفيش بيانات تجريبية بديلة هنا. اتأكد إن الخدمة شغالة وجرّب تاني.</span>
            <span lang="en" dir="ltr" className="block">No sample data is shown instead. Check that the service is running, then try again.</span>
          </div>
        )}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-fail/30 bg-white px-3 text-[13px] font-semibold text-fail">
          <RotateCw className="size-3.5" /> {L('حاول تاني', 'Try again')}
        </button>
      )}
    </div>
  )
}

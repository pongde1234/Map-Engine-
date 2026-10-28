/**
 * Metric tiles, the panel's KPI pattern: a grid of tiles sharing hairlines (no card per tile),
 * running to the section's edges. Each tile: its label with an icon in a circle tinted by the
 * tile's state, the figure large (FDS Metric) with its unit or "of N" small and quiet after it, and one line
 * beneath — a small icon and a figure in the state's colour, then a quiet note. A figure is 24px
 * here (Metric Heading Large); a strip tile on the Target Board is narrower and uses 18px.
 */
import type { ComponentType, ReactNode } from 'react';
import { Metric } from '@faclon-labs/fds';

export type KpiTone = 'neutral' | 'notice' | 'negative' | 'positive' | 'brand';
type Icon = ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>;

const METRIC_COLOR = { neutral: 'Neutral', notice: 'Notice', negative: 'Negative', positive: 'Positive', brand: 'Brand' } as const;

export function KpiGrid({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `bs-kpis ${className}` : 'bs-kpis'} role="list" aria-label={label}>
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  icon: IconCmp,
  tone = 'neutral',
  value,
  unit,
  of,
  valueTone,
  foot,
}: {
  label: string;
  icon: Icon;
  /** The state: tints the icon circle. */
  tone?: KpiTone;
  value: number;
  /** Drawn after the figure, quieter ("tracks"). */
  unit?: string;
  /** Instead of a unit: the figure against its whole ("of 14 channels"). */
  of?: string;
  /** The figure's own colour, when the figure itself is the alarm. */
  valueTone?: KpiTone;
  foot?: { icon?: Icon; text: string; tone?: KpiTone; note?: string };
}) {
  return (
    <div className="bs-kpi" role="listitem" aria-label={`${label}: ${value}${unit ? ` ${unit}` : ''}${of ? ` ${of}` : ''}${foot ? `, ${foot.text}` : ''}`}>
      <div className="bs-kpi__head">
        <span className="BodySmallRegular bs-muted bs-ellipsis">{label}</span>
        <span className={`bs-kpi__icon bs-kpi__icon--${tone}`} aria-hidden>
          <IconCmp size={14} aria-hidden />
        </span>
      </div>
      <span className="bs-kpi__value">
        <Metric type="Heading" size="Large" weight="Semibold" value={value} suffix="none" {...(valueTone ? { color: METRIC_COLOR[valueTone] } : {})} />
        {unit || of ? <span className="BodySmallRegular bs-muted bs-num">{of ?? unit}</span> : null}
      </span>
      {foot ? (
        <span className="bs-kpi__foot">
          <span className={`bs-kpi__trend bs-kpi__trend--${foot.tone ?? 'neutral'} BodySmallSemibold bs-num`}>
            {foot.icon ? <foot.icon size={12} aria-hidden /> : null}
            {foot.text}
          </span>
          {foot.note ? <span className="BodySmallRegular bs-muted bs-kpi__note">{foot.note}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

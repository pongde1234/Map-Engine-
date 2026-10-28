/**
 * Hostile tracks per ring, outer to inner, as metric tiles (Kpi.tsx): the ring and its name, the
 * count large, and beneath it how many of those tracks are closing on the defended point, with
 * the ring's span. R3 is read against its fire channels (the saturation rule's own figure): its
 * count shows "of N channels" and turns red when it passes them. The icon's tint is the ring's
 * state: quiet when clear, amber when occupied, red when R3 is over its channels.
 */
import { Crosshair, Radar, ShieldAlert, Target, TrendingDown } from 'lucide-react';
import type { Derived } from './derived.ts';
import { KpiGrid, KpiTile, type KpiTone } from './Kpi.tsx';
import { Section } from './Section.tsx';

type RingId = keyof Derived['rings'];

/** Rings, outer to inner: name, span and icon. */
const RINGS: Array<{ id: RingId; name: string; span: string; icon: typeof Radar }> = [
  { id: 'R4', name: 'Outer', span: '150–60 km', icon: Radar },
  { id: 'R3', name: 'Middle', span: '60–20 km', icon: Crosshair },
  { id: 'R2', name: 'Keep-out', span: '20–5 km', icon: ShieldAlert },
  { id: 'R1', name: 'Terminal', span: '5–0 km', icon: Target },
];

export function Rings({ rings, closing, channels }: { rings: Derived['rings']; closing: Derived['closing']; channels: number }) {
  const total = RINGS.reduce((a, r) => a + rings[r.id], 0);
  return (
    <Section title="Rings · hostile tracks" count={total}>
      <KpiGrid label="Hostile tracks per ring">
        {RINGS.map((r) => {
          const n = rings[r.id];
          const c = closing[r.id];
          // R3 against its fire channels; the others are counted on their own.
          const limit = r.id === 'R3' && channels > 0 ? channels : 0;
          const over = limit > 0 && n > limit;
          const tone: KpiTone = over ? 'negative' : n > 0 ? 'notice' : 'neutral';
          return (
            <KpiTile
              key={r.id}
              label={`${r.id} · ${r.name}`}
              icon={r.icon}
              tone={tone}
              value={n}
              {...(limit ? { of: `of ${limit} channels` } : { unit: n === 1 ? 'track' : 'tracks' })}
              {...(over ? { valueTone: 'negative' as const } : {})}
              foot={{ icon: c ? TrendingDown : undefined, text: c ? `${c} closing` : 'none closing', tone: c ? 'negative' : 'neutral', note: r.span }}
            />
          );
        })}
      </KpiGrid>
    </Section>
  );
}

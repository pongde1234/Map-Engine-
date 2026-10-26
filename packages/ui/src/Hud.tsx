/**
 * Map HUD from FDS components: status as a row of Badges, the data-age legend in a Card, and
 * the cursor position as Code (an MGRS reference is read literally).
 */
import { Badge, Card, Code } from '@faclon-labs/fds';
import { DEFAULT_AGE_PROFILES, formatIst, formatZulu } from '@me/schema';
import { formatMgrs, formatRangeBearing, inverse } from '@me/geo';
import { useClient, useEngineTime, useView } from '@me/map-react';
import type { Derived } from './derived.ts';
import { ageLabel } from './age.ts';
import { raidLabel } from './format.ts';

export function StatusBadges({ derived }: { derived: Derived }) {
  const client = useClient();
  const t = useEngineTime(250);
  const s = client.scenario;
  const c = client.clock;
  const down = client.conn !== 'open';
  return (
    <div className="bs-badges" role="status" aria-label="Picture status">
      <Badge size="Small" color="Notice" emphasis="Intense" label="SYNTHETIC" />
      <Badge size="Small" color={down ? 'Negative' : c.mode === 'live' ? 'Positive' : 'Information'} emphasis="Intense" label={down ? 'RECONNECTING' : c.mode === 'live' ? 'LIVE' : 'REPLAY'} />
      <Badge size="Small" color="Neutral" emphasis="Intense" label={`${s ? raidLabel(t, s.clock) : '—'} · ${formatZulu(t)} · ${formatIst(t)}`} />
      <Badge size="Small" color="Neutral" emphasis="Intense" label={`${derived.tracks} TRACKS`} />
      {derived.hostile ? <Badge size="Small" color="Negative" emphasis="Intense" label={`${derived.hostile} HOSTILE`} /> : null}
      {derived.contested ? <Badge size="Small" color="Notice" emphasis="Intense" label={`${derived.contested} CONTESTED`} /> : null}
      {c.playing && c.mode === 'replay' ? <Badge size="Small" color="Information" emphasis="Subtle" label={`${c.rate}×`} /> : null}
    </div>
  );
}

const fmt = (ms: number) => ageLabel(ms).toLowerCase();

/** Data-age legend with the thresholds actually applied (air tracks age faster). */
export function AgeLegend() {
  const air = DEFAULT_AGE_PROFILES.air;
  const other = DEFAULT_AGE_PROFILES.intel;
  const rows: Array<[string, 'Positive' | 'Notice' | 'Negative' | 'Neutral', string]> = [
    ['CURRENT', 'Positive', `under ${fmt(other.current)} · air ${fmt(air.current)}`],
    ['AGING', 'Notice', `to ${fmt(other.aging)} · air ${fmt(air.aging)}`],
    ['STALE', 'Negative', `over ${fmt(other.aging)}`],
    ['DISC', 'Neutral', 'no link'],
  ];
  return (
    <Card padding={12} size="Medium" accessibilityLabel="Data age legend">
      <div className="bs-legend">
        <span className="BodyXSmallMedium bs-muted">DATA AGE</span>
        {rows.map(([word, color, text]) => (
          <div key={word} className="bs-legend__row">
            <Badge size="Small" color={color} emphasis="Subtle" label={word} />
            <span className="BodyXSmallRegular bs-muted">{text}</span>
          </div>
        ))}
        <span className="BodyXSmallRegular bs-muted">Thresholds: default profile</span>
      </div>
    </Card>
  );
}

export function CursorReadout({ center }: { center: [number, number] }) {
  const cursor = useView((s) => s.cursor);
  if (!cursor) return null;
  const rb = inverse(center, cursor);
  return (
    <div className="bs-badges" aria-label="Cursor position">
      <Code size="Small">{`${formatMgrs(cursor, 4)} · MGRS`}</Code>
      <Code size="Small">{`VP ${formatRangeBearing(rb.distance_m, rb.azimuth_deg)}`}</Code>
    </div>
  );
}

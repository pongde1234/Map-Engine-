/**
 * Map HUD from FDS components: status as a row of Badges and the cursor position as Code (an
 * MGRS reference is read literally).
 */
import { Badge, Code } from '@faclon-labs/fds';
import { formatMgrs, formatRangeBearing, inverse } from '@me/geo';
import { useClient, useClientTick, useEngineTime, useView } from '@me/map-react';
import { raidLabel } from './format.ts';

/**
 * The console's standing tags, at the right of its tab strip so every view shows them in the same place: the picture
 * time every view is drawn at, and that the material is synthetic. A dropped link is the only other tag, and only
 * while it lasts. Replay or live and the play rate are on the Battlespace time bar.
 */
export function StatusBadges() {
  const client = useClient();
  useClientTick(1000);
  const t = useEngineTime(1000);
  const clock = client.scenario?.clock;
  const down = client.conn !== 'open';
  return (
    <div className="bs-badges" role="status" aria-label="Picture status">
      <Badge size="Small" color="Information" emphasis="Subtle" label={`Picture ${clock ? raidLabel(t, clock) : raidLabel(t, undefined).slice(0, 5)}`} />
      <Badge size="Small" color="Neutral" emphasis="Intense" label="Synthetic" />
      {down ? <Badge size="Small" color="Negative" emphasis="Intense" label="Reconnecting" /> : null}
    </div>
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

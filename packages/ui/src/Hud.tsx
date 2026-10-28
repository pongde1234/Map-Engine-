/**
 * Map HUD from FDS components: status as a row of Badges and the cursor position as Code (an
 * MGRS reference is read literally).
 */
import { Badge, Code } from '@faclon-labs/fds';
import { formatMgrs, formatRangeBearing, inverse } from '@me/geo';
import { useClient, useClientTick, useView } from '@me/map-react';

/**
 * The map's one standing tag: the material is synthetic. Time, replay or live and the play rate
 * are on the timeline; track, hostile and contested counts are in the right panel. A dropped
 * link is the only other tag, and only while it lasts.
 */
export function StatusBadges() {
  const client = useClient();
  useClientTick(1000);
  const down = client.conn !== 'open';
  return (
    <div className="bs-badges" role="status" aria-label="Picture status">
      <Badge size="Medium" color="Neutral" emphasis="Intense" label="SYNTHETIC" />
      {down ? <Badge size="Medium" color="Negative" emphasis="Intense" label="RECONNECTING" /> : null}
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

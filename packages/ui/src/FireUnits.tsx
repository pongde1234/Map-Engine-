/**
 * Fire units by defence layer, outer to inner (the order a raid meets them). A composite of FDS
 * parts laid out as a compact grid with its column headings written once:
 * Built on FDS ActionList (rows with no rules between them):
 *   - each layer is one row, the whole row its toggle: a chevron, its name with "N units · to X km"
 *     (its reach, the longest engagement zone among its units) beneath, then two meters with their
 *     figures — channels in use and rounds ready. The meters' colours carry the state (amber when
 *     every channel is busy, amber or red as the magazine nears or reaches its floor), and a tick
 *     on the rounds meter marks the reserve floor (set in DP-0); a tag appears only for what no
 *     meter shows: units DOWN;
 *   - opening a layer lists its units in the same columns, most depleted first, each with its own
 *     small meters and floor tick, tagged only when DOWN; selecting one selects it on the map.
 *     Each layer is its own ActionList in a group; an open layer's units end with an FDS Divider,
 *     so the next layer reads as a new block.
 * A layer with a unit near or under its floor opens by itself; the reader's own choice wins.
 * Above the layers, two metric tiles (Kpi.tsx) total the channels in use (with the units
 * engaging) and the rounds ready (tinted by the worst magazine, with the units at their floor).
 */
import { useState, type ComponentProps } from 'react';
import { ActionList, ActionListItem, ActionListItemBadge, ActionListItemIcon, Divider, ProgressBar } from '@faclon-labs/fds';
import { Activity, ChevronDown, ChevronRight, Package, TriangleAlert } from 'lucide-react';
import type { Effector, Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { MAG_COLOR, magState, type MagState } from './magazine.ts';
import { KpiGrid, KpiTile, type KpiTone } from './Kpi.tsx';
import { Section } from './Section.tsx';

const RANK: Record<MagState, number> = { ok: 0, low: 1, floor: 2 };
const MAG_TONE: Record<MagState, KpiTone> = { ok: 'positive', low: 'notice', floor: 'negative' };

/** Defence layers, outermost first. */
const LAYERS: Array<{ id: string; label: string; types: Array<Effector['type']> }> = [
  { id: 'layer:int', label: 'Interceptors', types: ['interceptor_drone'] },
  { id: 'layer:mr', label: 'MR SAM', types: ['sam_mr'] },
  { id: 'layer:sr', label: 'SR SAM', types: ['sam_sr'] },
  { id: 'layer:vsh', label: 'VSHORADS', types: ['vshorads'] },
  { id: 'layer:cin', label: 'Close-in', types: ['gun', 'laser_dew', 'cuas'] },
];

type BadgeColor = ComponentProps<typeof ActionListItemBadge>['color'];

interface Unit {
  id: string;
  name: string;
  busy: number;
  total: number;
  ready: number;
  floor: number;
  capacity: number;
  state: MagState;
  status: Effector['status'];
  /** The far edge of its engagement zone, metres (none when the record gives no zone). */
  reach_m?: number;
}

interface Layer {
  id: string;
  label: string;
  units: Unit[];
  busy: number;
  total: number;
  ready: number;
  capacity: number;
  /** Worst magazine state among the units. */
  state: MagState;
  down: number;
  /** The units' reserve floors, summed: the layer's floor tick against its capacity. */
  floor: number;
  /** The longest reach among its units, metres. */
  reach_m?: number;
}

function unitOf(e: Entity, eff: Effector): Unit {
  const m = eff.magazine;
  const capacity = Math.max(m.capacity ?? m.ready + m.reserve, m.ready, 1);
  return {
    id: e.entity_id,
    name: e.aliases?.callsign ?? e.aliases?.name ?? e.entity_id,
    busy: eff.channels.busy,
    total: eff.channels.total,
    ready: m.ready,
    floor: m.floor,
    capacity,
    state: magState(m.ready, m.floor, capacity),
    status: eff.status,
    ...(eff.wez ? { reach_m: eff.wez.max_m } : {}),
  };
}

function layersOf(effectors: Entity[]): Layer[] {
  const out: Layer[] = [];
  for (const def of LAYERS) {
    const units = effectors
      .filter((e) => e.effector && def.types.includes(e.effector.type))
      .map((e) => unitOf(e, e.effector!))
      .sort((a, b) => RANK[b.state] - RANK[a.state] || (a.ready - a.floor) / a.capacity - (b.ready - b.floor) / b.capacity);
    if (!units.length) continue;
    const sum = (k: 'busy' | 'total' | 'ready' | 'capacity' | 'floor') => units.reduce((a, u) => a + u[k], 0);
    const reach = Math.max(0, ...units.map((u) => u.reach_m ?? 0));
    out.push({
      id: def.id,
      label: def.label,
      units,
      busy: sum('busy'),
      total: sum('total'),
      ready: sum('ready'),
      capacity: sum('capacity'),
      state: units.reduce<MagState>((w, u) => (RANK[u.state] > RANK[w] ? u.state : w), 'ok'),
      down: units.filter((u) => u.status === 'down').length,
      floor: sum('floor'),
      ...(reach > 0 ? { reach_m: reach } : {}),
    });
  }
  return out;
}

/** A unit's tag, only for what its meters do not say: down (at its floor shows on the rounds meter). */
function unitTag(u: Unit): { color: BadgeColor; label: string } | null {
  if (u.status === 'down') return { color: 'Negative', label: 'DOWN' };
  return null;
}

/** A figure over its meter ("11 / 14"); on rounds, a tick at the reserve floor. */
function Gauge({ label, value, max, color, floor = 0, size }: { label: string; value: number; max: number; color: ComponentProps<typeof ProgressBar>['color']; floor?: number; size: 'Small' | 'Large' }) {
  return (
    <span className="bs-fu__meter">
      <span className="BodySmallMedium bs-num">
        {value}
        <span className="BodySmallRegular bs-muted"> / {max}</span>
      </span>
      <span className="bs-meter">
        <ProgressBar type="meter" size={size} accessibilityLabel={`${label} ${value} of ${max}${floor ? `, floor ${floor}` : ''}`} value={value} max={max || 1} color={color} />
        {floor > 0 && max > 0 ? <span className="bs-meter__floor" style={{ left: `${Math.min(100, (floor / max) * 100)}%` }} aria-hidden /> : null}
      </span>
    </span>
  );
}

const km = (m: number) => `${m >= 10_000 ? Math.round(m / 1000) : Math.round(m / 100) / 10} km`;
/** Load: blue while there is headroom, amber when every channel is busy. */
const loadColor = (busy: number, total: number) => (total > 0 && busy >= total ? 'Notice' : 'Information');

export function FireUnits({ effectors }: { effectors: Entity[] }) {
  const view = useViewStore();
  const layers = layersOf(effectors);
  const [mine, setMine] = useState<{ open: Set<string>; closed: Set<string> }>({ open: new Set(), closed: new Set() });
  const isOpen = (l: Layer) => !mine.closed.has(l.id) && (mine.open.has(l.id) || l.state !== 'ok');
  const toggle = (l: Layer) => {
    const open = new Set(mine.open);
    const closed = new Set(mine.closed);
    if (isOpen(l)) {
      closed.add(l.id);
      open.delete(l.id);
    } else {
      open.add(l.id);
      closed.delete(l.id);
    }
    setMine({ open, closed });
  };
  const units = layers.reduce((a, l) => a + l.units.length, 0);
  const sum = (k: 'busy' | 'total' | 'ready' | 'capacity') => layers.reduce((a, l) => a + l[k], 0);
  const worst = layers.reduce<MagState>((w, l) => (RANK[l.state] > RANK[w] ? l.state : w), 'ok');
  const all = layers.flatMap((l) => l.units);
  const engaging = all.filter((u) => u.busy > 0).length;
  const atFloor = all.filter((u) => u.state === 'floor').length;
  const busy = sum('busy');
  const total = sum('total');
  if (!layers.length) return null;

  return (
    <Section title="Fire units" count={units}>
      {/* The totals, as the panel's metric tiles (Kpi.tsx). */}
      <KpiGrid label="Fire unit totals" className="bs-fu__tiles">
        <KpiTile
          label="Channels busy"
          icon={Activity}
          tone={total > 0 && busy >= total ? 'notice' : busy > 0 ? 'brand' : 'neutral'}
          value={busy}
          of={`of ${total}`}
          foot={{ text: engaging ? `${engaging} engaging` : 'none engaging', tone: engaging ? 'brand' : 'neutral', note: 'units' }}
        />
        <KpiTile
          label="Rounds ready"
          icon={Package}
          tone={MAG_TONE[worst]}
          value={sum('ready')}
          of={`of ${sum('capacity')}`}
          foot={{ ...(atFloor ? { icon: TriangleAlert } : {}), text: atFloor ? `${atFloor} at floor` : 'none at floor', tone: atFloor ? 'negative' : 'neutral', note: 'units' }}
        />
      </KpiGrid>
      <div className="bs-fu bs-fu--head" aria-hidden>
        <span className="BodySmallRegular bs-muted">Layer</span>
        <span className="BodySmallRegular bs-muted">Channels</span>
        <span className="BodySmallRegular bs-muted">Rounds</span>
      </div>
      <div className="bs-fu__groups" role="group" aria-label="Fire units by defence layer">
        {layers.map((l) => {
          const open = isOpen(l);
          return (
          <div key={l.id} className="bs-fu__group">
          <ActionList accessibilityLabel={`${l.label}${open ? ' and its units' : ''}`}>
            <ActionListItem
              key={l.id}
              value={l.id}
              className="bs-fu__item"
              aria-expanded={open}
              title={l.label}
              description={`${l.units.length} unit${l.units.length === 1 ? '' : 's'}${l.reach_m ? ` · to ${km(l.reach_m)}` : ''}`}
              leading={<ActionListItemIcon icon={open ? ChevronDown : ChevronRight} />}
              {...(l.down ? { titleSuffix: <ActionListItemBadge className="bs-tag" size="Small" color="Negative" emphasis="Subtle" label={`${l.down} DOWN`} /> } : {})}
              trailing={
                <span className="bs-fu__cells">
                  <Gauge label={`${l.label} channels`} value={l.busy} max={l.total} color={loadColor(l.busy, l.total)} size="Large" />
                  <Gauge label={`${l.label} rounds`} value={l.ready} max={l.capacity} color={MAG_COLOR[l.state]} floor={l.floor} size="Large" />
                </span>
              }
              onClick={() => toggle(l)}
            />
            {open
              ? l.units.map((u) => {
                  const tag = unitTag(u);
                  return (
                    <ActionListItem
                      key={u.id}
                      value={u.id}
                      className="bs-fu__item bs-fu__item--unit"
                      title={u.name}
                      leading={<span className="bs-fu__indent" aria-hidden />}
                      {...(tag ? { titleSuffix: <ActionListItemBadge className="bs-tag" size="Small" color={tag.color} emphasis="Subtle" label={tag.label} /> } : {})}
                      trailing={
                        <span className="bs-fu__cells">
                          <Gauge label={`${u.name} channels`} value={u.busy} max={u.total} color={loadColor(u.busy, u.total)} size="Small" />
                          <Gauge label={`${u.name} rounds`} value={u.ready} max={u.capacity} color={MAG_COLOR[u.state]} floor={u.floor} size="Small" />
                        </span>
                      }
                      onClick={() => view.set({ selected: u.id, locate: u.id })}
                    />
                  );
                })
              : null}
          </ActionList>
          {open ? (
            <div className="bs-fu__rule">
              <Divider />
            </div>
          ) : null}
          </div>
          );
        })}
      </div>
    </Section>
  );
}

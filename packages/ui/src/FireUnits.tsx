/**
 * Fire units by defence layer, outer to inner (the order a raid meets them). A composite of FDS
 * parts, in the same labelled-meter language as the ring occupancy above it:
 *   - each layer: a disclosure Button, name and unit count, tags only for exceptions
 *     (SATURATED, LOW, AT FLOOR, DOWN), then two meters — channels in use and rounds ready;
 *   - opening a layer lists its units (ActionList: selecting one selects it on the map), most
 *     depleted first, each with its worst state as a tag.
 * A layer with a unit near or under its floor opens by itself; the reader's own choice wins.
 */
import { useState, type ComponentProps } from 'react';
import { ActionList, ActionListItem, ActionListItemBadge, Badge, Button, Counter, ProgressBar } from '@faclon-labs/fds';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Effector, Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { MAG_COLOR, magState, type MagState } from './magazine.ts';

const RANK: Record<MagState, number> = { ok: 0, low: 1, floor: 2 };

/** Defence layers, outermost first. */
const LAYERS: Array<{ id: string; label: string; types: Array<Effector['type']> }> = [
  { id: 'layer:int', label: 'Interceptors', types: ['interceptor_drone'] },
  { id: 'layer:mr', label: 'MR SAM', types: ['sam_mr'] },
  { id: 'layer:sr', label: 'SR SAM', types: ['sam_sr'] },
  { id: 'layer:vsh', label: 'VSHORADS', types: ['vshorads'] },
  { id: 'layer:cin', label: 'Close-in', types: ['gun', 'laser_dew', 'cuas'] },
];

type BadgeColor = ComponentProps<typeof Badge>['color'];

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
    const sum = (k: 'busy' | 'total' | 'ready' | 'capacity') => units.reduce((a, u) => a + u[k], 0);
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
    });
  }
  return out;
}

/** A unit's worst state as one tag; none when it is simply ready. */
function unitTag(u: Unit): { color: BadgeColor; label: string } | null {
  if (u.status === 'down') return { color: 'Negative', label: 'DOWN' };
  if (u.state === 'floor') return { color: 'Negative', label: 'AT FLOOR' };
  if (u.state === 'low') return { color: 'Notice', label: 'LOW' };
  if (u.status === 'reloading') return { color: 'Notice', label: 'RELOADING' };
  if (u.total > 0 && u.busy >= u.total) return { color: 'Notice', label: 'SATURATED' };
  if (u.busy > 0) return { color: 'Information', label: 'ENGAGING' };
  return null;
}

/** A layer's exceptions as tags, most severe first; healthy layers carry none. */
function layerTags(l: Layer): Array<{ color: BadgeColor; label: string }> {
  const tags: Array<{ color: BadgeColor; label: string }> = [];
  if (l.down) tags.push({ color: 'Negative', label: `${l.down} DOWN` });
  if (l.state === 'floor') tags.push({ color: 'Negative', label: 'AT FLOOR' });
  else if (l.state === 'low') tags.push({ color: 'Notice', label: 'LOW' });
  if (l.total > 0 && l.busy >= l.total) tags.push({ color: 'Notice', label: 'SATURATED' });
  return tags.slice(0, 2);
}

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
  const engaging = layers.reduce((a, l) => a + l.units.filter((u) => u.busy > 0).length, 0);

  return (
    <section className="bs-stack bs-pad" aria-label="Fire units by defence layer">
      <div className="bs-insp__sechead">
        <span className="BodySmallSemibold">Fire units · {units}</span>
        <span className="BodyXSmallRegular bs-muted bs-num">{engaging ? `${engaging} engaging` : 'none engaging'}</span>
      </div>
      {layers.map((l) => {
        const open = isOpen(l);
        return (
          <div key={l.id} className="bs-fl">
            <div className="bs-fl__head">
              <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label={`${open ? 'Hide' : 'Show'} ${l.label} units`} aria-expanded={open} onClick={() => toggle(l)}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </Button>
              <span className="BodySmallSemibold bs-ellipsis">{l.label}</span>
              <Counter value={l.units.length} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${l.units.length} units`} />
              <span className="bs-fl__tags">
                {layerTags(l).map((t) => (
                  <Badge key={t.label} size="Small" color={t.color} emphasis="Subtle" label={t.label} />
                ))}
              </span>
            </div>
            <div className="bs-fl__meters">
              <ProgressBar
                type="meter"
                label={`Channels ${l.busy} / ${l.total}`}
                value={l.busy}
                max={l.total || 1}
                // Load, like ring occupancy: blue while there is headroom, amber when every channel is busy.
                color={l.total > 0 && l.busy >= l.total ? 'Notice' : 'Information'}
              />
              <ProgressBar type="meter" label={`Rounds ${l.ready} / ${l.capacity}`} value={l.ready} max={l.capacity || 1} color={MAG_COLOR[l.state]} />
            </div>
            {open ? (
              <ActionList accessibilityLabel={`${l.label} units`}>
                {l.units.map((u) => {
                  const tag = unitTag(u);
                  return (
                    <ActionListItem
                      key={u.id}
                      value={u.id}
                      title={u.name}
                      description={`${u.busy} / ${u.total} ch · ${u.ready} / ${u.capacity} rds · floor ${u.floor}`}
                      {...(tag ? { titleSuffix: <ActionListItemBadge className="bs-tag" size="Small" color={tag.color} emphasis="Subtle" label={tag.label} /> } : {})}
                      onClick={() => view.set({ selected: u.id })}
                    />
                  );
                })}
              </ActionList>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

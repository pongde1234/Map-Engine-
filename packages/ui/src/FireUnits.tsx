/**
 * Fire units by defence layer, outer to inner (the order a raid meets them), as one FDS Table:
 *   - each layer is a row: its name with "N units · to X km" (its reach, the longest engagement
 *     zone among its units, and how many are down) beneath, then two meters — channels in use and
 *     rounds ready — each labelled "n / max". The meters' colours carry the state: amber when
 *     every channel is busy; amber or red as the magazine nears or reaches its floor;
 *   - a layer's units are its sub-rows, most depleted first, each with its state word beneath its
 *     name when it is not idle; selecting one selects it on the map;
 * A layer with a unit near or under its floor opens by itself; the reader's own choice wins.
 * FDS Table and ProgressBar only: no markup of our own (one CSS rule aligns the second line; see
 * .bs-fu-table in styles.css).
 */
import { useState } from 'react';
import { ProgressBar, Table, type TableColumn } from '@faclon-labs/fds';
import type { Effector, Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { MAG_COLOR, magState, type MagState } from './magazine.ts';
import { Section } from './Section.tsx';

const RANK: Record<MagState, number> = { ok: 0, low: 1, floor: 2 };

/** Defence layers, outermost first. */
const LAYERS: Array<{ id: string; label: string; types: Array<Effector['type']> }> = [
  { id: 'layer:int', label: 'Interceptors', types: ['interceptor_drone'] },
  { id: 'layer:mr', label: 'MR SAM', types: ['sam_mr'] },
  { id: 'layer:sr', label: 'SR SAM', types: ['sam_sr'] },
  { id: 'layer:vsh', label: 'VSHORADS', types: ['vshorads'] },
  { id: 'layer:cin', label: 'Close-in', types: ['gun', 'laser_dew', 'cuas'] },
];

/** A table row: a layer, or one of its units. */
interface Row {
  id: string;
  name: string;
  /** The line beneath the name: a layer's units and reach, a unit's state when not idle. */
  note?: string;
  busy: number;
  total: number;
  ready: number;
  capacity: number;
  /** Worst magazine state (a layer: among its units). */
  state: MagState;
  /** A layer's units. */
  units?: Row[];
}

const km = (m: number) => `${m >= 10_000 ? Math.round(m / 1000) : Math.round(m / 100) / 10} km`;

/** A unit's state, when it is not idle: down, at its floor, low, or engaging. */
function unitNote(eff: Effector, state: MagState): string | undefined {
  if (eff.status === 'down') return 'Down';
  if (state === 'floor') return 'At floor';
  if (state === 'low') return 'Low';
  if (eff.channels.busy > 0) return 'Engaging';
  return undefined;
}

function unitOf(e: Entity, eff: Effector): Row & { down: boolean } {
  const m = eff.magazine;
  const capacity = Math.max(m.capacity ?? m.ready + m.reserve, m.ready, 1);
  const state = magState(m.ready, m.floor, capacity);
  const note = unitNote(eff, state);
  return {
    id: e.entity_id,
    name: e.aliases?.callsign ?? e.aliases?.name ?? e.entity_id,
    ...(note ? { note } : {}),
    busy: eff.channels.busy,
    total: eff.channels.total,
    ready: m.ready,
    capacity,
    state,
    down: eff.status === 'down',
  };
}

function layersOf(effectors: Entity[]): Row[] {
  const out: Row[] = [];
  for (const def of LAYERS) {
    const found = effectors.filter((e) => e.effector && def.types.includes(e.effector.type)).map((e) => ({ unit: unitOf(e, e.effector!), eff: e.effector! }));
    if (!found.length) continue;
    found.sort((a, b) => RANK[b.unit.state] - RANK[a.unit.state] || headroom(a.eff) - headroom(b.eff));
    const units = found.map((f) => f.unit);
    const sum = (k: 'busy' | 'total' | 'ready' | 'capacity') => units.reduce((a, u) => a + u[k], 0);
    const reach = Math.max(0, ...found.map((f) => f.eff.wez?.max_m ?? 0));
    const down = units.filter((u) => u.down).length;
    out.push({
      id: def.id,
      name: def.label,
      note: `${units.length} unit${units.length === 1 ? '' : 's'}${reach > 0 ? ` · to ${km(reach)}` : ''}${down ? ` · ${down} down` : ''}`,
      busy: sum('busy'),
      total: sum('total'),
      ready: sum('ready'),
      capacity: sum('capacity'),
      state: units.reduce<MagState>((w, u) => (RANK[u.state] > RANK[w] ? u.state : w), 'ok'),
      units,
    });
  }
  return out;
}

/** Rounds over the reserve floor, as a share of capacity: the most depleted unit sorts first. */
function headroom(eff: Effector): number {
  const m = eff.magazine;
  return (m.ready - m.floor) / Math.max(m.capacity ?? m.ready + m.reserve, m.ready, 1);
}

/** Load: blue while there is headroom, amber when every channel is busy. */
const loadColor = (busy: number, total: number) => (total > 0 && busy >= total ? 'Notice' : 'Information');

/** A meter labelled "n / max" (a standing value: FDS meter, Large in a table row). */
const meter = (name: string, value: number, max: number, color: 'Information' | 'Notice' | 'Positive' | 'Negative') => (
  <ProgressBar type="meter" label={`${value} / ${max}`} accessibilityLabel={`${name} ${value} of ${max}`} value={value} max={max || 1} color={color} />
);

export function FireUnits({ effectors }: { effectors: Entity[] }) {
  const view = useViewStore();
  const layers = layersOf(effectors);
  const [mine, setMine] = useState<{ open: Set<string>; closed: Set<string> }>({ open: new Set(), closed: new Set() });
  const isOpen = (l: Row) => !mine.closed.has(l.id) && (mine.open.has(l.id) || l.state !== 'ok');
  // Record only the layers whose open state the reader changed, so the rest still open by themselves.
  const setOpen = (ids: string[]) => {
    const want = new Set(ids);
    const open = new Set(mine.open);
    const closed = new Set(mine.closed);
    for (const l of layers) {
      if (want.has(l.id) === isOpen(l)) continue;
      if (want.has(l.id)) {
        open.add(l.id);
        closed.delete(l.id);
      } else {
        closed.add(l.id);
        open.delete(l.id);
      }
    }
    setMine({ open, closed });
  };
  if (!layers.length) return null;

  const units = layers.reduce((a, l) => a + (l.units?.length ?? 0), 0);
  const expanded = layers.filter(isOpen).map((l) => l.id);

  const columns: TableColumn<Row>[] = [
    { key: 'name', header: 'Layer', isRowHeader: true, emphasis: 'normal', cell: (r) => r.name, description: (r) => r.note ?? null },
    { key: 'channels', header: 'Channels', width: 88, cell: (r) => meter(`${r.name} channels`, r.busy, r.total, loadColor(r.busy, r.total)) },
    { key: 'rounds', header: 'Rounds', width: 88, cell: (r) => meter(`${r.name} rounds`, r.ready, r.capacity, MAG_COLOR[r.state]) },
  ];

  return (
    <Section title="Fire units" count={units}>
      <Table<Row>
        className="bs-fu-table"
        accessibilityLabel="Fire units by defence layer"
        data={layers}
        columns={columns}
        getRowId={(r) => r.id}
        getSubRows={(r) => r.units}
        expandedIds={expanded}
        onExpandedChange={({ expandedIds }) => setOpen(expandedIds)}
        rowDensity="expanded"
        onRowClick={({ row }) => (row.units ? setOpen(isOpen(row) ? expanded.filter((id) => id !== row.id) : [...expanded, row.id]) : view.set({ selected: row.id, locate: row.id }))}
      />
    </Section>
  );
}

/**
 * Fire units by defence layer, outer to inner (the order a raid meets them). A composite of FDS
 * parts laid out as a compact grid with its column headings written once:
 *   - each layer is one row: a disclosure Button and its name, then two small meters with their
 *     figures — channels in use and rounds ready. The meters' colours carry the state (amber when
 *     every channel is busy, amber or red as the magazine nears or reaches its floor); a tag
 *     appears only for what no meter shows: units DOWN;
 *   - opening a layer lists its units (ActionList: selecting one selects it on the map), most
 *     depleted first, tagged only when DOWN or AT FLOOR.
 * A layer with a unit near or under its floor opens by itself; the reader's own choice wins.
 * Above the layers, two Cards total the channels in use and the rounds ready.
 */
import { useState, type ComponentProps } from 'react';
import { ActionList, ActionListItem, ActionListItemBadge, Badge, Button, Card, CardBody, Metric, ProgressBar, Tooltip } from '@faclon-labs/fds';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

/** A unit's tag, only for what its figures do not say: down, or at its reserve floor. */
function unitTag(u: Unit): { color: BadgeColor; label: string } | null {
  if (u.status === 'down') return { color: 'Negative', label: 'DOWN' };
  if (u.state === 'floor') return { color: 'Negative', label: 'AT FLOOR' };
  return null;
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
  const sum = (k: 'busy' | 'total' | 'ready' | 'capacity') => layers.reduce((a, l) => a + l[k], 0);
  const worst = layers.reduce<MagState>((w, l) => (RANK[l.state] > RANK[w] ? l.state : w), 'ok');
  const totals: Array<{ label: string; value: number; of: number; color: ComponentProps<typeof ProgressBar>['color'] }> = [
    { label: 'Channels busy', value: sum('busy'), of: sum('total'), color: sum('total') > 0 && sum('busy') >= sum('total') ? 'Notice' : 'Information' },
    { label: 'Rounds ready', value: sum('ready'), of: sum('capacity'), color: MAG_COLOR[worst] },
  ];
  if (!layers.length) return null;

  return (
    <Section title="Fire units" count={units}>
      <div className="bs-fu__total">
        {totals.map((t) => (
          <Card key={t.label} padding={0} size="Medium" accessibilityLabel={`${t.label} ${t.value} of ${t.of}`}>
            <CardBody>
              <div className="bs-fu__tcell">
                <span className="BodyXSmallRegular bs-muted">{t.label}</span>
                <span className="bs-rings__value">
                  <Metric type="Heading" size="Small" weight="Semibold" value={t.value} suffix="none" />
                  <span className="BodyXSmallRegular bs-muted bs-num">/{t.of}</span>
                </span>
                <ProgressBar type="meter" size="Large" accessibilityLabel={`${t.label} ${t.value} of ${t.of}`} value={t.value} max={t.of || 1} color={t.color} />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="bs-fu bs-fu--head" aria-hidden>
        <span />
        <span />
        <span className="BodyXSmallRegular bs-muted">Channels</span>
        <span className="BodyXSmallRegular bs-muted">Rounds</span>
      </div>
      {layers.map((l) => {
        const open = isOpen(l);
        return (
          <div key={l.id} className="bs-fl">
            <div className="bs-fu">
              <Tooltip content={`${open ? 'Hide' : 'Show'} ${l.label} units`}>
                <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label={`${open ? 'Hide' : 'Show'} ${l.label} units`} aria-expanded={open} onClick={() => toggle(l)}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </Button>
              </Tooltip>
              <span className="bs-fu__name">
                <span className="BodySmallMedium bs-ellipsis">{l.label}</span>
                {l.down ? <Badge size="Small" color="Negative" emphasis="Subtle" label={`${l.down} DOWN`} /> : null}
              </span>
              <span className="bs-fu__meter">
                <span className="BodySmallMedium bs-num">
                  {l.busy}
                  <span className="BodyXSmallRegular bs-muted"> / {l.total}</span>
                </span>
                <ProgressBar
                  type="meter"
                  size="Large"
                  accessibilityLabel={`${l.label} channels ${l.busy} of ${l.total}`}
                  value={l.busy}
                  max={l.total || 1}
                  // Load: blue while there is headroom, amber when every channel is busy.
                  color={l.total > 0 && l.busy >= l.total ? 'Notice' : 'Information'}
                />
              </span>
              <span className="bs-fu__meter">
                <span className="BodySmallMedium bs-num">
                  {l.ready}
                  <span className="BodyXSmallRegular bs-muted"> / {l.capacity}</span>
                </span>
                <ProgressBar type="meter" size="Large" accessibilityLabel={`${l.label} rounds ${l.ready} of ${l.capacity}`} value={l.ready} max={l.capacity || 1} color={MAG_COLOR[l.state]} />
              </span>
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
    </Section>
  );
}

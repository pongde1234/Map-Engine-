/**
 * Annotate tools, from FDS components. One toolbar menu lists the shapes each tool draws
 * (ToolMenu); while drawing, the map itself says what finishes the sketch. A finished
 * measurement opens a popover at the shape with its result (MeasurePopover); a finished drawing
 * or geofence opens the dialog that promotes it to a command object (PromoteModal). Promotion
 * journals it on the operator chain with the session's identity at the picture time on screen;
 * a geofence then fires on watched tracks entering or leaving it.
 */
import { useEffect, useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemIcon,
  ActionListItemText,
  ActionListSection,
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverInteractiveWrapper,
  TextInput,
  useToast,
} from '@faclon-labs/fds';
import { RotateCcw, X } from 'lucide-react';
import { defaultTone, toneColor, type DrawState, type ToolKind } from '@me/map';
import type { EntityComponents, GeoType, GeofenceWatch, LonLat, OperatorColor } from '@me/schema';
import { destination, formatArea, formatBearing, formatDistance, formatMgrs } from '@me/geo';
import { useClient, useDrawState, useEngine, useEngineTime, useViewStore } from '@me/map-react';
import { ColorPicker } from './ColorPicker.tsx';
import { Facts } from './Facts.tsx';
import { Pick } from './AlertRules.tsx';
import { operatorLayers } from './OperatorLayers.tsx';
import { raidLabel } from './format.ts';
import { DEFAULT_SHAPE, SHAPES, SHAPE_ICON, TOOL_WORD, TYPE_WORD, WATCH, sketchReadout, typesFor } from './sketch.ts';
import { typeClass } from './type.ts';

const SHORTCUT: Record<ToolKind, string> = { draw: 'D', measure: 'M', geofence: 'G' };
const TOOLS: ToolKind[] = ['draw', 'measure', 'geofence'];

/** A ToolMenu row's value: the tool and the shape it draws. */
export const toolValue = (tool: ToolKind, shape: string): string => `${tool}:${shape}`;

/**
 * Every annotate tool's shapes in one toolbar menu, a section per tool (inside a
 * DropdownMenuOverlay whose DropdownMenu owns the selection; rows are valued with toolValue).
 * The row with the shortcut is the tool's keyboard default; while drawing, the shape in use is
 * the selected row and a last row stops drawing.
 */
export function ToolMenu() {
  const { state: s, tools } = useDrawState();
  return (
    <ActionList accessibilityLabel="Annotate tools">
      {TOOLS.map((tool) => (
        <ActionListSection key={tool} title={TOOL_WORD[tool]}>
          {SHAPES[tool].map((x) => {
            const Icon = SHAPE_ICON[tool][x.id];
            return (
              <ActionListItem
                key={x.id}
                value={toolValue(tool, x.id)}
                title={x.label}
                {...(Icon ? { leading: <ActionListItemIcon icon={Icon} /> } : {})}
                {...(x.id === DEFAULT_SHAPE[tool] ? { trailing: <ActionListItemText>{SHORTCUT[tool]}</ActionListItemText> } : {})}
              />
            );
          })}
        </ActionListSection>
      ))}
      {s.tool ? (
        <ActionListSection>
          <ActionListItem value="stop" title="Stop drawing" isAction intent="negative" leading={<ActionListItemIcon icon={X} />} trailing={<ActionListItemText>Esc</ActionListItemText>} onClick={() => tools?.cancel()} />
        </ActionListSection>
      ) : null}
    </ActionList>
  );
}

/** Where a finished sketch's popover points: the top of the shape, so it opens above it. */
function anchorOf(s: DrawState): LonLat | null {
  const pts = s.points;
  if (!pts.length) return null;
  if (s.shape === 'circle') return s.radius_m > 0 ? destination(pts[0]!, 0, s.radius_m) : pts[0]!;
  // The northernmost point, so a popover opening upward never covers the shape it describes.
  return pts.reduce((top, p) => (p[1] > top[1] ? p : top), pts[0]!);
}

/**
 * A finished measurement, in a popover at the shape: the result, then measure again or keep it
 * on the map. Closing it (✕, Esc, a click elsewhere) ends the measurement.
 */
export function MeasurePopover({ hidden, onKeep }: { hidden?: boolean; onKeep: () => void }) {
  const engine = useEngine();
  const { state: s, measure, tools } = useDrawState();
  const open = !!tools && !hidden && s.tool === 'measure' && s.done;
  const anchor = open ? anchorOf(s) : null;
  const [xy, setXy] = useState<{ x: number; y: number } | null>(null);
  const ax = anchor?.[0];
  const ay = anchor?.[1];
  useEffect(() => {
    if (!engine || ax === undefined || ay === undefined) {
      setXy(null);
      return;
    }
    const place = () => {
      const p = engine.map.project([ax, ay]);
      setXy({ x: p.x, y: p.y });
    };
    place();
    engine.map.on('move', place);
    return () => {
      engine.map.off('move', place);
    };
  }, [engine, ax, ay]);
  if (!open || !xy || !measure || !tools) return null;

  const shape = SHAPES.measure.find((x) => x.id === s.shape)?.label ?? 'Measurement';
  const last = measure.segments[measure.segments.length - 1];
  const pts = s.points;
  const facts =
    s.shape === 'circle'
      ? [
          ['Radius', formatDistance(s.radius_m)] as [string, string],
          ['Area', formatArea(measure.area_m2 ?? 0)] as [string, string],
          ['Centre', formatMgrs(pts[0]!), 'wide'] as [string, string, 'wide'],
        ]
      : s.shape === 'polygon'
        ? [
            ['Area', formatArea(measure.area_m2 ?? 0)] as [string, string],
            ['Perimeter', formatDistance(measure.perimeter_m ?? 0)] as [string, string],
            ['Corners', String(pts.length)] as [string, string],
          ]
        : [
            ['Length', formatDistance(measure.length_m)] as [string, string],
            ['Legs', String(measure.segments.length)] as [string, string],
            last ? (['Last bearing', formatBearing(last.bearing_deg)] as [string, string]) : null,
            ['From', formatMgrs(pts[0]!), 'wide'] as [string, string, 'wide'],
            ['To', formatMgrs(pts[pts.length - 1]!), 'wide'] as [string, string, 'wide'],
          ];
  return (
    <div className="bs-sketch-anchor" style={{ left: xy.x, top: xy.y }}>
      <Popover
        isOpen
        onOpenChange={({ isOpen }) => {
          if (!isOpen) tools.cancel();
        }}
        title={`Measure · ${shape}`}
        content={<Facts flush items={facts} />}
        footer={
          <>
            <Button size="md" variant="primary" tone="neutral" leadingIcon={<RotateCcw size={14} />} onClick={() => tools.restart()}>
              Measure again
            </Button>
            <Button size="md" variant="primary" tone="brand" onClick={onKeep}>
              Keep on map
            </Button>
          </>
        }
      >
        <PopoverInteractiveWrapper className="bs-sketch-anchor__target" aria-label="Measurement result">
          <span />
        </PopoverInteractiveWrapper>
      </Popover>
    </div>
  );
}

/**
 * Promote a finished sketch: name, type (or what a geofence watches), then journal it.
 * Redraw starts the same shape again; dismissing the dialog discards the sketch.
 */
export function PromoteModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const client = useClient();
  const view = useViewStore();
  const toast = useToast();
  const t = useEngineTime(1000);
  const { state: s, measure, tools } = useDrawState();
  const [name, setName] = useState('');
  const [type, setType] = useState<GeoType>('annotation');
  const [watch, setWatch] = useState<GeofenceWatch>('hostile');
  const [note, setNote] = useState('');
  // The operator layer it goes in; 'none' keeps it in "Operator objects".
  const [layer, setLayer] = useState('none');
  // The colour the operator chose on the map; none leaves it to the console.
  const [color, setColor] = useState<OperatorColor | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opLayers = operatorLayers(client.entities.values());

  const tool = s.tool;
  const types = tool ? typesFor(tool, s.shape) : ['annotation' as GeoType];
  useEffect(() => {
    if (!isOpen || !tool) return;
    setName(tool === 'measure' ? sketchReadout(s, measure) : '');
    setType(types[0]!);
    setWatch('hostile');
    setNote('');
    setLayer('none');
    setColor(undefined);
    setBusy(false);
    setAsking(false);
    setError(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const shape = tools?.geometry() ?? null;
  // The colour it will take on the map: its layer's, or its type's.
  const inLayer = layer !== 'none' && client.entities.has(layer);
  const defaultColor = toneColor(defaultTone({ type, ...(inLayer ? { layer } : {}) }, inLayer));
  const who = client.identity;
  const clock = client.scenario?.clock;
  const discard = () => {
    tools?.cancel();
    setAsking(false);
    onClose();
  };
  // Leaving by Esc, the backdrop or Cancel throws the drawing away; once the operator has named or
  // noted it, that is asked first, so a stray click does not lose their work.
  const [asking, setAsking] = useState(false);
  const leave = () => (name.trim() || note.trim() ? setAsking(true) : discard());
  const redraw = () => {
    tools?.restart();
    onClose();
  };
  const promote = async () => {
    if (!shape || !name.trim()) {
      setError(name.trim() ? 'The sketch has no shape yet.' : 'Give it a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: EntityComponents = {
      aliases: { name: name.trim() },
      geo_shape: shape,
      geo_details: {
        type,
        label: name.trim().toUpperCase(),
        status: 'active',
        ...(type === 'geofence' ? { watch } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(layer !== 'none' && client.entities.has(layer) ? { layer } : {}),
        // Only a colour the operator chose is recorded; otherwise the console picks.
        ...(color ? { color } : {}),
      },
    };
    try {
      const rec = await client.publish({ payload });
      // Say what happened to the operator's object, by its name. The record id and hash are
      // in the inspector's Provenance tab for whoever needs them.
      const named = `“${name.trim()}”`;
      toast.show({
        color: 'Positive',
        content: type === 'geofence' ? `Geofence ${named} armed. Alerts start at ${raidLabel(rec.ingest_time, clock)}.` : `${TYPE_WORD[type] ?? 'Object'} ${named} added to the map.`,
      });
      tools?.cancel();
      onClose();
      view.set({ selected: rec.entity_id ?? null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal isOpen={isOpen && !!tool && !asking} onDismiss={leave} size="md" accessibilityLabel="Promote to command object">
      <ModalHeader title="Promote to command object" subtitle={`Recorded as ${who?.display ?? 'you'} at ${raidLabel(t, clock)}`} />
      <ModalBody>
        <div className="bs-form">
          <div className="bs-form__wide">
          <TextInput label="Name" value={name} onChange={({ value }) => setName(value ?? '')} placeholder={type === 'geofence' ? 'Coastal watch box' : 'Name on the map'} isRequired necessityIndicator="required" maxCharacters={40} autoFocus {...(error ? { validationState: 'error' as const, errorText: error } : {})} />
          </div>
          {types.length > 1 ? <Pick label="Type" value={type} options={types.map((x) => ({ id: x, label: TYPE_WORD[x] ?? x }))} onChange={setType} /> : null}
          {type === 'geofence' ? <Pick label="Alert on" value={watch} options={WATCH} onChange={setWatch} /> : null}
          {/* Only once the operator has made a layer: otherwise everything is in "Operator objects". */}
          {opLayers.length ? <Pick label="Layer" value={layer} options={[{ id: 'none', label: 'Operator objects' }, ...opLayers.map((l) => ({ id: l.entity_id, label: l.aliases?.name ?? l.entity_id }))]} onChange={setLayer} /> : null}
          <div className="bs-form__wide">
          <TextInput label="Note" value={note} onChange={({ value }) => setNote(value ?? '')} placeholder="Optional" maxCharacters={120} />
          </div>
          <div className="bs-form__wide">
          <Facts flush items={[['Shape', sketchReadout(s, measure)]]} />
          </div>
          <div className="bs-form__wide bs-stack bs-stack--tight">
            <span className="BodySmallRegular bs-muted">Colour on the map</span>
            <ColorPicker value={color ?? defaultColor} isDefault={!color} onChange={setColor} onReset={() => setColor(undefined)} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="ghost" tone="neutral" onClick={leave}>
          Cancel
        </Button>
        <Button size="sm" variant="secondary" tone="neutral" leadingIcon={<RotateCcw size={14} />} onClick={redraw}>
          Redraw
        </Button>
        <Button size="sm" variant="primary" tone="brand" isLoading={busy} onClick={() => void promote()}>
          {type === 'geofence' ? 'Promote and arm' : 'Promote'}
        </Button>
      </ModalFooter>
    </Modal>
    <Modal isOpen={isOpen && !!tool && asking} onDismiss={() => setAsking(false)} size="sm" accessibilityLabel="Discard the drawing">
      <ModalHeader title="Discard the drawing?" />
      <ModalBody>
        <p className={typeClass('body')}>The shape and what you typed are not kept.</p>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="secondary" tone="neutral" onClick={() => setAsking(false)}>
          Keep editing
        </Button>
        <Button size="sm" variant="primary" tone="negative" onClick={discard}>
          Discard
        </Button>
      </ModalFooter>
    </Modal>
    </>
  );
}

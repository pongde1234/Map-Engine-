/**
 * Annotate tools, from FDS components: the bar on the map that drives the active sketch (the
 * tools start from the map toolbar), and the dialog that promotes a finished sketch to a
 * command object. Promotion journals it on the operator chain with the session's
 * identity at the picture time on screen; a geofence then fires on watched tracks entering
 * or leaving it.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Chip, ChipGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextInput, Tooltip, useToast } from '@faclon-labs/fds';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import type { SketchShape, ToolKind } from '@me/map';
import type { EntityComponents, GeoType, GeofenceWatch } from '@me/schema';
import { useClient, useDrawState, useEngineTime, useViewStore } from '@me/map-react';
import { Facts } from './Facts.tsx';
import { raidLabel } from './format.ts';
import { HINT, SHAPES, TOOL_WORD, TYPE_WORD, WATCH, sketchReadout, typesFor } from './sketch.ts';

/**
 * The active tool, on the map where the eye already is: tool, shape, one hint (or the live
 * measurement once there is something to measure), and the next action. One row; it wraps on
 * a narrow map.
 */
export function DrawBar({ onPromote }: { onPromote: () => void }) {
  const { state: s, measure, tools } = useDrawState();
  if (!s.tool || !tools) return null;
  const shapes = SHAPES[s.tool];
  const started = s.points.length > 0;
  const keep = s.tool === 'measure';
  return (
    <Card padding={12} size="Medium" width="fit-content" maxWidth="100%" accessibilityLabel={`${TOOL_WORD[s.tool]} tool`}>
      <div className="bs-drawbar">
        <span className="BodyXSmallSemibold">{TOOL_WORD[s.tool].toUpperCase()}</span>
        {shapes.length > 1 && !s.done ? (
          <ChipGroup selectionType="single" size="Small" accessibilityLabel="Shape" value={s.shape} onChange={({ values }) => values[0] && tools.setShape(values[0] as SketchShape)}>
            {shapes.map((x) => (
              <Chip key={x.id} value={x.id}>
                {x.label}
              </Chip>
            ))}
          </ChipGroup>
        ) : null}
        {started ? <span className="BodySmallSemibold bs-num">{sketchReadout(s, measure)}</span> : <span className="BodySmallRegular bs-muted">{HINT[s.shape]}</span>}
        <span className="bs-drawbar__actions">
          {s.done ? (
            <>
              <Button size="xs" variant="primary" tone="brand" leadingIcon={<Check size={14} />} onClick={onPromote}>
                {keep ? 'Keep' : 'Promote'}
              </Button>
              <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<RotateCcw size={14} />} onClick={() => tools.restart()}>
                {keep ? 'Clear' : 'Redraw'}
              </Button>
            </>
          ) : (
            <>
              {started ? (
                <Tooltip content="Remove the last point (Backspace)">
                  <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label="Undo last point" onClick={() => tools.undo()}>
                    <Undo2 size={14} />
                  </Button>
                </Tooltip>
              ) : null}
              <Button size="xs" variant="primary" tone="brand" leadingIcon={<Check size={14} />} isDisabled={!tools.canFinish()} onClick={() => tools.finish()}>
                Finish
              </Button>
            </>
          )}
          <Tooltip content="Cancel (Esc)">
            <Button size="xs" variant="ghost" tone="neutral" leadingIcon={<X size={14} />} onClick={() => tools.cancel()}>
              Cancel
            </Button>
          </Tooltip>
        </span>
      </div>
    </Card>
  );
}

/** Promote a finished sketch: name, type (or what a geofence watches), then journal it. */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tool = s.tool;
  const types = tool ? typesFor(tool, s.shape) : ['annotation' as GeoType];
  useEffect(() => {
    if (!isOpen || !tool) return;
    setName(tool === 'measure' ? sketchReadout(s, measure) : '');
    setType(types[0]!);
    setWatch('hostile');
    setNote('');
    setError(null);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const shape = tools?.geometry() ?? null;
  const who = client.identity;
  const clock = client.scenario?.clock;
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
      geo_details: { type, label: name.trim().toUpperCase(), status: 'active', ...(type === 'geofence' ? { watch } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
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
    <Modal isOpen={isOpen && !!tool} onDismiss={onClose} size="sm" accessibilityLabel="Promote to command object">
      <ModalHeader title="Promote to command object" subtitle={`Recorded as ${who?.display ?? 'you'} at ${raidLabel(t, clock)}`} />
      <ModalBody>
        <div className="bs-stack">
          <TextInput label="Name" value={name} onChange={({ value }) => setName(value ?? '')} placeholder={type === 'geofence' ? 'Coastal watch box' : 'Name on the map'} isRequired necessityIndicator="required" maxCharacters={40} autoFocus {...(error ? { validationState: 'error' as const, errorText: error } : {})} />
          {types.length > 1 ? (
            <ChipGroup label="Type" selectionType="single" size="Small" value={type} onChange={({ values }) => values[0] && setType(values[0] as GeoType)}>
              {types.map((x) => (
                <Chip key={x} value={x}>
                  {TYPE_WORD[x] ?? x}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
          {type === 'geofence' ? (
            <ChipGroup label="Alert on" selectionType="single" size="Small" value={watch} onChange={({ values }) => values[0] && setWatch(values[0] as GeofenceWatch)}>
              {WATCH.map((x) => (
                <Chip key={x.id} value={x.id}>
                  {x.label}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
          <TextInput label="Note" value={note} onChange={({ value }) => setNote(value ?? '')} placeholder="Optional" maxCharacters={120} />
          <Facts
            title="Record"
            items={[
              ['Type', TYPE_WORD[type] ?? type],
              ['Shape', sketchReadout(s, measure)],
              ['Author', who ? `${who.display} (${who.role.toUpperCase()})` : '—', 'wide'],
              ['Releasable to', who?.releasability.join(' · ') ?? '—', 'wide'],
              ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label="SYNTHETIC//DEMO" />],
            ]}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" tone="brand" isLoading={busy} onClick={() => void promote()}>
          {type === 'geofence' ? 'Promote and arm' : 'Promote'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

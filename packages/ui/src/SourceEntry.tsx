/**
 * Registered sources, added from the Sources panel. A registered source is an operator object on the
 * record: its name, whether it is a sensor or a feed and what kind, stamped with the operator's
 * identity at the picture time. It carries no data: it is listed as planned beside the live sources
 * until it is withdrawn. Its range is the operator's own; the console supplies none.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Modal, ModalBody, ModalFooter, ModalHeader, TextInput, useToast } from '@faclon-labs/fds';
import type { Entity, EntityComponents, Sensor, SourceEntry } from '@me/schema';
import { useClient, useEngineTime } from '@me/map-react';
import { Review } from './Review.tsx';
import { Pick } from './AlertRules.tsx';
import { raidLabel } from './format.ts';

type SensorType = Sensor['type'];
type Carries = NonNullable<SourceEntry['carries']>;

const KINDS: Array<{ id: SourceEntry['kind']; label: string }> = [
  { id: 'sensor', label: 'Sensor' },
  { id: 'feed', label: 'Feed' },
];
export const SENSOR_TYPES: Array<{ id: SensorType; label: string }> = [
  { id: 'surface_radar', label: 'Surface radar' },
  { id: 'low_level_radar', label: 'Low-level radar' },
  { id: 'coastal_radar', label: 'Coastal radar' },
  { id: 'aew', label: 'AEW' },
  { id: 'aerostat', label: 'Aerostat' },
  { id: 'esm', label: 'ESM' },
  { id: 'eo_ir', label: 'EO/IR' },
  { id: 'space_isr', label: 'Space ISR' },
  { id: 'ais_receiver', label: 'AIS receiver' },
  { id: 'humint', label: 'HUMINT' },
];
const CARRIES: Array<{ id: Carries; label: string }> = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'intel', label: 'Intelligence' },
  { id: 'status', label: 'Unit status' },
];

/** The registered source in one line: "Surface radar · 40 km", "Feed · Tracks". */
export function sourceSummary(src: SourceEntry): string {
  if (src.kind === 'feed') return `Feed · ${CARRIES.find((c) => c.id === src.carries)?.label ?? '—'}`;
  const type = SENSOR_TYPES.find((s) => s.id === src.sensor_type)?.label ?? 'Sensor';
  return src.range_m ? `${type} · ${src.range_m / 1000} km` : type;
}

/** The operator's registered sources in the picture, sensors and feeds. */
export function registeredSources(entities: Iterable<Entity>): Array<{ e: Entity; src: SourceEntry }> {
  const out: Array<{ e: Entity; src: SourceEntry }> = [];
  for (const e of entities) if (e.is_live && e.geo_details?.type === 'source' && e.source_entry) out.push({ e, src: e.source_entry });
  return out.sort((a, b) => (a.e.aliases?.name ?? a.e.entity_id).localeCompare(b.e.aliases?.name ?? b.e.entity_id));
}

/**
 * Register a new source, or (with `sourceId`) review one and withdraw it. Recorded as the session's
 * identity at the picture time on screen.
 */
export function SourceEntryModal({ isOpen, sourceId, onClose }: { isOpen: boolean; sourceId: string | null; onClose: () => void }) {
  const client = useClient();
  const toast = useToast();
  const t = useEngineTime(1000);
  const clock = client.scenario?.clock;
  const who = client.identity;
  const existing = sourceId ? client.entities.get(sourceId) : undefined;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SourceEntry['kind']>('sensor');
  const [sensorType, setSensorType] = useState<SensorType>('surface_radar');
  const [km, setKm] = useState('');
  const [carries, setCarries] = useState<Carries>('tracks');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setKind('sensor');
    setSensorType('surface_radar');
    setKm('');
    setCarries('tracks');
    setNote('');
    setBusy(false);
    setError(null);
  }, [isOpen]);

  // The source as entered; a reason instead when something it needs is missing.
  const built = (): { src: SourceEntry } | { error: string } => {
    if (!name.trim()) return { error: 'Give the source a name.' };
    if (kind === 'feed') return { src: { kind, carries } };
    if (!km.trim()) return { src: { kind, sensor_type: sensorType } };
    const d = Number(km);
    return d > 0 ? { src: { kind, sensor_type: sensorType, range_m: Math.round(d * 1000) } } : { error: 'Enter the range in km, or leave it empty.' };
  };

  const register = async () => {
    const b = built();
    if ('error' in b) {
      setError(b.error);
      return;
    }
    setBusy(true);
    setError(null);
    const payload: EntityComponents = {
      aliases: { name: name.trim() },
      geo_details: { type: 'source', label: name.trim().toUpperCase(), status: 'active', ...(note.trim() ? { note: note.trim() } : {}) },
      source_entry: b.src,
    };
    try {
      await client.publish({ payload });
      toast.show({ color: 'Positive', content: `Source “${name.trim()}” registered. It is listed as planned until it carries data.` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await client.publish({ entity_id: existing.entity_id, payload: { is_live: false } });
      toast.show({ color: 'Neutral', content: `Source “${existing.aliases?.name ?? existing.entity_id}” withdrawn.` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (existing?.source_entry) {
    const src = existing.source_entry;
    return (
      <Modal isOpen={isOpen} onDismiss={onClose} size="sm" accessibilityLabel="Registered source">
        <ModalHeader title={existing.aliases?.name ?? existing.entity_id} subtitle="Registered source" />
        <ModalBody>
          <Review
            lead={sourceSummary(src)}
            state={<Badge size="Small" color="Neutral" emphasis="Subtle" label="PLANNED" />}
            facts={[
              ['Set by', existing.geo_details?.author ?? '—'],
              ['Set at', raidLabel(existing.ingest_time, clock)],
              ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label={existing.label} />],
              !!existing.geo_details?.note && ['Note', existing.geo_details.note, 'wide'],
              ['Permission', existing.releasability?.join(' · ') ?? '—', 'wide'],
            ]}
            note="Withdrawing takes it off the sources list from now on; the record keeps it."
          />
          {error ? <p role="alert" className="BodySmallRegular bs-ink-negative">{error}</p> : null}
        </ModalBody>
        {/* The header's ✕ closes it; the footer holds the one action. */}
        <ModalFooter>
          <Button size="sm" variant="primary" tone="negative" isLoading={busy} onClick={() => void withdraw()}>
            Withdraw source
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onDismiss={onClose} size="md" accessibilityLabel="New source">
      <ModalHeader title="New source"subtitle={`Recorded as ${who?.display ?? 'you'} at ${raidLabel(t, clock)} · listed as planned`} />
      <ModalBody>
        <div className="bs-form">
          <div className="bs-form__wide">
            <TextInput label="Name" value={name} onChange={({ value }) => setName(value ?? '')} placeholder="North coastal radar" isRequired necessityIndicator="required" maxCharacters={40} autoFocus {...(error && !name.trim() ? { validationState: 'error' as const, errorText: error } : {})} />
          </div>
          <Pick label="Kind" value={kind} options={KINDS} onChange={setKind} />
          {kind === 'sensor' ? (
            <>
              <Pick label="Sensor type" value={sensorType} options={SENSOR_TYPES} onChange={setSensorType} />
              <TextInput label="Range (km)" value={km} onChange={({ value }) => setKm(value ?? '')} placeholder="As stated by its owner" />
            </>
          ) : (
            <Pick label="Carries" value={carries} options={CARRIES} onChange={setCarries} />
          )}
          <div className="bs-form__wide">
            <TextInput label="Note" value={note} onChange={({ value }) => setNote(value ?? '')} placeholder="Owner, link or when it is expected" maxCharacters={80} />
          </div>
          {error && name.trim() ? <p role="alert" className="BodySmallRegular bs-ink-negative bs-form__wide">{error}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" tone="brand" isLoading={busy} onClick={() => void register()}>
          Register source
        </Button>
      </ModalFooter>
    </Modal>
  );
}

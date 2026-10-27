/**
 * Operator layers, made from the Layers panel. A layer is an operator object on the record: a name
 * that drawn objects sit in, stamped with the operator's identity at the picture time. It gets its
 * own row and toggle under Command; objects are put in it when they are promoted. Withdrawing a
 * layer leaves its objects on the map, back in "Operator objects".
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Modal, ModalBody, ModalFooter, ModalHeader, TextInput, useToast } from '@faclon-labs/fds';
import type { Entity, EntityComponents } from '@me/schema';
import type { MapClient } from '@me/client';
import { useClient, useEngineTime } from '@me/map-react';
import { Facts } from './Facts.tsx';
import { raidLabel } from './format.ts';

/** The operator's layers in the picture, by name. */
export function operatorLayers(entities: Iterable<Entity>): Entity[] {
  const out: Entity[] = [];
  for (const e of entities) if (e.is_live && e.geo_details?.type === 'layer') out.push(e);
  return out.sort((a, b) => (a.aliases?.name ?? a.entity_id).localeCompare(b.aliases?.name ?? b.entity_id));
}

/**
 * Drawn objects per operator layer; objects in no layer, or in one since withdrawn, count under
 * `null` ("Operator objects").
 */
export function operatorObjectCounts(client: MapClient): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const e of client.entities.values()) {
    if (e.provenance?.integration !== 'console' || !e.geo_shape) continue;
    const layer = e.geo_details?.layer && client.entities.has(e.geo_details.layer) ? e.geo_details.layer : null;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  return counts;
}

/**
 * Make a new operator layer, or (with `layerId`) review one and withdraw it. Recorded as the
 * session's identity at the picture time on screen.
 */
export function LayerEntryModal({ isOpen, layerId, onClose }: { isOpen: boolean; layerId: string | null; onClose: () => void }) {
  const client = useClient();
  const toast = useToast();
  const t = useEngineTime(1000);
  const clock = client.scenario?.clock;
  const who = client.identity;
  const existing = layerId ? client.entities.get(layerId) : undefined;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setNote('');
    setError(null);
  }, [isOpen]);

  const create = async () => {
    if (!name.trim()) {
      setError('Give the layer a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: EntityComponents = {
      aliases: { name: name.trim() },
      geo_details: { type: 'layer', label: name.trim().toUpperCase(), status: 'active', ...(note.trim() ? { note: note.trim() } : {}) },
    };
    try {
      await client.publish({ payload });
      toast.show({ color: 'Positive', content: `Layer “${name.trim()}” made. Put objects in it when you promote them.` });
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
      toast.show({ color: 'Neutral', content: `Layer “${existing.aliases?.name ?? existing.entity_id}” withdrawn. Its objects are back in Operator objects.` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (existing?.geo_details?.type === 'layer') {
    const count = operatorObjectCounts(client).get(existing.entity_id) ?? 0;
    return (
      <Modal isOpen={isOpen} onDismiss={onClose} size="sm" accessibilityLabel="Operator layer">
        <ModalHeader title={existing.aliases?.name ?? existing.entity_id} subtitle={`Operator layer · set by ${existing.geo_details.author ?? '—'} at ${raidLabel(existing.ingest_time, clock)}`} />
        <ModalBody>
          <Facts
            items={[
              ['Objects', count ? `${count} drawn object${count === 1 ? '' : 's'}` : 'None yet', 'wide'],
              ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label={existing.label} />],
              !!existing.geo_details.note && ['Note', existing.geo_details.note, 'wide'],
              ['Permission', existing.releasability?.join(' · ') ?? '—', 'wide'],
            ]}
          />
          {error ? <p className="BodySmallRegular bs-muted">{error}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" tone="negative" isLoading={busy} onClick={() => void withdraw()}>
            Withdraw layer
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onDismiss={onClose} size="md" accessibilityLabel="New layer">
      <ModalHeader title="New layer" subtitle={`Recorded as ${who?.display ?? 'you'} at ${raidLabel(t, clock)} · objects join it when promoted`} />
      <ModalBody>
        <div className="bs-form">
          <div className="bs-form__wide">
            <TextInput label="Name" value={name} onChange={({ value }) => setName(value ?? '')} placeholder="North sector plan" isRequired necessityIndicator="required" maxCharacters={40} autoFocus {...(error && !name.trim() ? { validationState: 'error' as const, errorText: error } : {})} />
          </div>
          <div className="bs-form__wide">
            <TextInput label="Note" value={note} onChange={({ value }) => setNote(value ?? '')} placeholder="What it is for" maxCharacters={80} />
          </div>
          {error && name.trim() ? <p className="BodySmallRegular bs-muted bs-form__wide">{error}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" tone="brand" isLoading={busy} onClick={() => void create()}>
          Create layer
        </Button>
      </ModalFooter>
    </Modal>
  );
}

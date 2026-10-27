/**
 * Search (Modal + SearchInput + ActionList), opened with Ctrl/Cmd+K. The top bar carries no
 * search or profile icon; the view profile is set with ?role= in the URL.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActionList, ActionListItem, ActionListItemIcon, Modal, ModalBody, ModalHeader, SearchInput } from '@faclon-labs/fds';
import { Crosshair, LocateFixed } from 'lucide-react';
import { CLASSES, type Entity } from '@me/schema';
import { formatMgrs, parseMgrs } from '@me/geo';
import { useClient, useEngine, useViewStore } from '@me/map-react';

interface Hit {
  value: string;
  title: string;
  description: string;
  entity?: Entity;
  at?: [number, number];
}

export function ShellActions() {
  const client = useClient();
  const engine = useEngine();
  const view = useViewStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const out: Hit[] = [];
    const at = parseMgrs(q);
    if (at) out.push({ value: 'mgrs', title: `Go to ${formatMgrs(at)}`, description: 'MGRS grid reference', at });
    for (const e of client.entities.values()) {
      if (!e.location) continue;
      const cls = CLASSES[e.ontology?.class ?? ''];
      const hay = [e.entity_id, e.aliases?.track_number, e.aliases?.name, e.aliases?.callsign, cls?.label, cls?.abbr].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(query)) continue;
      out.push({ value: e.entity_id, title: e.aliases?.track_number ?? e.aliases?.name ?? e.entity_id, description: `${cls?.label ?? e.ontology?.class ?? ''} · ${e.layer}`, entity: e });
      if (out.length >= 12) break;
    }
    return out;
    // Recomputed on each keystroke; entities are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    const center = h.at ?? (h.entity?.location ? ([h.entity.location.lon, h.entity.location.lat] as [number, number]) : undefined);
    if (h.entity) view.set({ selected: h.entity.entity_id });
    if (center && engine) engine.flyTo({ center, zoom: Math.max(engine.getCamera().zoom, 9) }, 900);
    setOpen(false);
    setQ('');
  };

  return (
    <>
      <Modal isOpen={open} onDismiss={() => setOpen(false)} size="md" accessibilityLabel="Search">
        <ModalHeader title="Search" subtitle="Objects, units or an MGRS reference" />
        <ModalBody>
          <div className="bs-stack">
            <SearchInput
              accessibilityLabel="Search objects, units, MGRS"
              placeholder="Track number, name, class or MGRS"
              value={q}
              autoFocus
              onChange={({ value }) => setQ(value ?? '')}
              onSubmit={() => go(hits[0])}
              onClearButtonClick={() => setQ('')}
            />
            {hits.length ? (
              <ActionList accessibilityLabel="Search results">
                {hits.map((h) => (
                  <ActionListItem key={h.value} value={h.value} title={h.title} description={h.description} leading={<ActionListItemIcon icon={h.at ? LocateFixed : Crosshair} />} onClick={() => go(h)} />
                ))}
              </ActionList>
            ) : null}
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}

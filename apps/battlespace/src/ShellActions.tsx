/**
 * Search (Modal + SearchInput + ActionList): Ctrl/Cmd+K, with no button in the top bar. A result is
 * brought into view on the map from any page. The view profile is set with ?role= in the URL.
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

/** Results shown at most; the dialog says when there may be more. */
const MAX_HITS = 12;

export function ShellActions({ onOpenOnMap }: { onOpenOnMap: (id: string | null) => void }) {
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
      if (out.length >= MAX_HITS) break;
    }
    return out;
    // Recomputed on each keystroke; entities are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    if (h.entity) onOpenOnMap(h.entity.entity_id);
    else if (h.at) {
      // A grid reference: the map goes there, on whichever page the search was opened from.
      if (engine) engine.flyTo({ center: h.at, zoom: Math.max(engine.getCamera().zoom, 9) }, 900);
      else {
        view.set({ camera: { center: h.at, zoom: 9, pitch: 0, bearing: 0 } });
        onOpenOnMap(null);
      }
    }
    setOpen(false);
    setQ('');
  };
  const query = q.trim();

  return (
    <>
      <Modal isOpen={open} onDismiss={() => setOpen(false)} size="md" accessibilityLabel="Search">
        <ModalHeader title="Search" subtitle="Objects, units or an MGRS reference" />
        <ModalBody>
          <div className="bs-stack">
            <SearchInput
              accessibilityLabel="Search objects, units, MGRS"
              placeholder="Search…"
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
            {/* Nothing is silent: a short query, no match, and a list that may be cut all say so. */}
            {query.length > 0 && query.length < 2 ? <span className="BodySmallRegular bs-muted">Type at least 2 characters.</span> : null}
            {query.length >= 2 && !hits.length ? <span className="BodySmallRegular bs-muted">{`Nothing matches “${query}”. Try a track number, a name or an MGRS reference.`}</span> : null}
            {hits.length >= MAX_HITS ? <span className="BodySmallRegular bs-muted">{`Showing the first ${MAX_HITS}. Type more to narrow them.`}</span> : null}
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}

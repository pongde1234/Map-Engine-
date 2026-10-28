/**
 * Ontology Explorer (storyboard A2): "Each assessment keeps the reports that produced it."
 *   - Theater State Model: the five layers (reference, observation, fused, command, event) at the
 *     replay position, each with its groups.
 *   - Lineage graph for A1's source record and the phase-0 preparation records, linked only by what
 *     the records carry (thread, derived from, protects, member of); nodes coloured by permission
 *     for the identity viewed as.
 *   - Rehearsal inset: the separately labelled rehearsal track, both conflicting radar reports and
 *     the assessment made from both, read by its thread without changing the raid clock.
 *   - Ontology inspector (envelope: provenance, time, label, version, signature; artifacts beside)
 *     and history.
 * Decision out: none. Words on screen come from the documents (permission, never releasability).
 * FDS components only; the graph's edges are an SVG overlay measured from the node cards.
 */
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListItemText,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuOverlay,
  DropdownMenuTrigger,
  EmptyState,
  ScrollArea,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
} from '@faclon-labs/fds';
import { ChevronDown, MapPinned } from 'lucide-react';
import { Handle, MarkerType, PanOnScrollMode, Position, ReactFlow, ViewportPortal, getBezierPath, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ROLES, formatZulu, type Entity, type JournalRecord, type RaidClock } from '@me/schema';
import { useClient, useClientTick, useEngineTime, useLineage, useView, useViewStore } from '@me/map-react';
import {
  Facts,
  LAYER_WORD,
  envelopeOf,
  eventSummary,
  ontologyGraph,
  raidLabel,
  rehearsalOf,
  shortHash,
  stamp,
  theaterState,
  useChainCheck,
  type GraphNode,
  type OntologyGraph,
  type OntologyLayer,
  type Permission,
} from '@me/ui';
import type { Presenter } from './presenter.ts';

type BadgeColor = 'Positive' | 'Notice' | 'Negative' | 'Neutral' | 'Information';

const PERMISSION: Record<Permission, { label: string; color: BadgeColor }> = {
  all: { label: 'PERMITTED', color: 'Positive' },
  some: { label: 'PARTLY PERMITTED', color: 'Notice' },
  none: { label: 'NOT PERMITTED', color: 'Neutral' },
};
const EDGE_WORDS = ['derived from', 'thread', 'protects', 'member of'] as const;
const slug = (s: string) => s.replace(/\s+/g, '-');

/** Records derived from each decision in the lineage, as this identity may read them at t. */
function useConsequences(recordIds: string[], t: number, role: string): JournalRecord[] {
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const minute = Math.floor(t / 60_000);
  const key = recordIds.join(',');
  useEffect(() => {
    if (!recordIds.length) {
      setRecords([]);
      return;
    }
    const ctl = new AbortController();
    Promise.all(
      recordIds.map((id) =>
        fetch(`/api/consequences/${encodeURIComponent(id)}?t=${(minute + 1) * 60_000}&role=${role}`, { signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ),
    ).then((all: JournalRecord[][]) => !ctl.signal.aborted && setRecords(all.flat().filter((r) => r.ingest_time <= t)));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, minute, role]);
  return records;
}

/** An object's records up to the position (its history), newest first. */
function useHistory(e: Entity | undefined): JournalRecord[] {
  const client = useClient();
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const key = e ? `${e.entity_id}:${e.version}` : '';
  useEffect(() => {
    if (!e?.history.length) {
      setRecords([]);
      return;
    }
    let live = true;
    client
      .records(e.history)
      .then((rs) => live && setRecords([...rs].sort((a, b) => b.ingest_time - a.ingest_time)))
      .catch(() => live && setRecords([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return records;
}

export function OntologyPage({ presenter, onOpenOnMap }: { presenter: Presenter; onOpenOnMap: (id: string | null, highlight?: string[]) => void }) {
  const client = useClient();
  const view = useViewStore();
  const tick = useClientTick(500);
  const t = useEngineTime(1000);
  const selected = useView((v) => v.selected);
  const role = client.identity?.role ?? 'l3';
  const clock = client.scenario?.clock;
  // The focus: the selection when it is an object in the picture, else the A2 frame's subject, else
  // (later in the raid, once that fragment has gone) the first intel fragment or fused track in the
  // picture, so the graph always has a record to show.
  const frameSubject = presenter.bookmarks.find((b) => b.page === 'ontology')?.select ?? null;
  const fallback = useMemo(() => {
    let track: string | null = null;
    for (const e of [...client.entities.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id))) {
      if (e.ontology?.template === 'fragment') return e.entity_id;
      if (!track && e.layer === 'fused' && e.ontology?.template === 'track') track = e.entity_id;
    }
    return track;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick]);
  const focusId = selected && client.entities.has(selected) ? selected : frameSubject && client.entities.has(frameSubject) ? frameSubject : fallback;
  const [viewAs, setViewAs] = useState(role);
  const seat = ROLES[viewAs]?.releasability ?? [];
  // The focus's own records and ancestry, then its thread (an object's trace does not expand it).
  const own = useLineage(focusId);
  const threadId = own.records.find((r) => r.entity_id === focusId && r.thread_id)?.thread_id ?? null;
  const thread = useLineage(threadId);
  const lineage = useMemo(() => [...new Map([...own.records, ...thread.records].map((r) => [r.record_id, r])).values()], [own.records, thread.records]);
  const loading = own.loading || thread.loading;
  const decisions = useMemo(() => lineage.filter((r) => r.kind === 'decision').map((r) => r.record_id), [lineage]);
  const prepared = useConsequences(decisions, t, role);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(() => adjacentLinks(ontologyGraph(client, focusId, lineage, prepared, seat)), [client, tick, focusId, lineage, prepared, viewAs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layers = useMemo(() => theaterState(client), [client, tick]);
  const reh = useLineage(client.scenario?.threads?.rehearsal ?? 'TH-REH-0001');
  const rehearsal = useMemo(() => rehearsalOf(reh.records), [reh.records]);
  const { check } = useChainCheck(t);
  const [pick, setPick] = useState<string | null>(null);
  const node = g.nodes.find((n) => n.id === pick) ?? g.nodes.find((n) => n.focus) ?? null;
  const [tab, setTab] = useState('inspector');
  // "Open on map" opens the node the operator picked when it is an object on the map, else the graph's root.
  const openId = node && client.entities.has(node.id) ? node.id : focusId;
  const frame = presenter.current?.page === 'ontology' ? presenter.current : undefined;
  const focusOn = (id: string) => {
    view.set({ selected: id });
    setPick(null);
  };

  return (
    <div className="sv on">
      {/* Controls on the left, tags at the right: the Targets bar's order. */}
      <div className="sv__bar">
        <DropdownMenu selectionType="single" value={[viewAs]} onChange={({ values }) => values[0] && setViewAs(values[0])}>
          <DropdownMenuTrigger>
            <Button size="xs" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label="View as identity">
              {`View as identity · ${ROLES[viewAs]?.display ?? viewAs}`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="bottom-start">
            <ActionList accessibilityLabel="Identities">
              {Object.values(ROLES).map((r) => (
                <ActionListItem key={r.role} value={r.role} title={r.display} description="Nodes coloured by permission" />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<MapPinned size={14} />} isDisabled={!openId} onClick={() => openId && onOpenOnMap(openId, [openId])}>
          Open on map
        </Button>
        <span className="bs-fill" />
        {frame ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={frame.id} /> : null}
        <Badge size="Small" color="Information" emphasis="Subtle" label={`PICTURE ${clock ? raidLabel(t, clock) : formatZulu(t).slice(0, 5)}`} />
        <Badge size="Medium" color="Neutral" emphasis="Intense" label="SYNTHETIC" />
      </div>

      <aside className="sv__rail" aria-label="Theater State Model">
        <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
          <div className="sv__railbody">
            <span className="BodySmallSemibold">Theater state model · five layers</span>
            {layers.map((l) => (
              <section key={l.layer} className="sv__level" aria-label={l.label}>
                <div className="tb-check__head">
                  <span className="BodyMediumSemibold">{l.label}</span>
                  <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label={String(l.count)} />
                </div>
                <span className="BodySmallRegular bs-muted">{l.groups.length ? l.groups.map((g) => `${g.label} ${g.count}`).join(' · ') : 'None at this position'}</span>
                {l.layer === 'fused' ? <span className="BodySmallRegular bs-muted">Truth + noise · not recomputed from the log in this build</span> : null}
              </section>
            ))}
            <span className="BodySmallRegular bs-muted">{`Replay at a position: ${clock ? stamp(t, clock) : formatZulu(t)}`}</span>
          </div>
        </ScrollArea>
      </aside>

      <ScrollArea className="sv__main" viewportClassName="bs-scroll__viewport">
        <div className="sv__content">
          <Card padding={12} size="Medium" accessibilityLabel="Lineage graph">
            <div className="tb-check">
              <div className="tb-check__head">
                <span className="BodySmallSemibold">{`Lineage graph · ${focusId ?? 'no source record'}`}</span>
                <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label={loading ? 'READING' : `${g.nodes.length} NODES · ${g.edges.length} LINKS`} />
              </div>
              {focusId ? <Graph g={g} active={node?.id ?? null} onPick={(id) => (setPick(id), setTab('inspector'))} /> : <EmptyState title="No source record" description="Select a fragment on the map to see where it came from." />}
              <div className="on-legend">
                {EDGE_WORDS.map((w) => (
                  <span key={w} className="on-legend__item BodySmallRegular bs-muted">
                    <svg width="30" height="10" aria-hidden="true">
                      <line x1="2" y1="5" x2="28" y2="5" className={`on-edge on-edge--${slug(w)}`} />
                    </svg>
                    {w}
                  </span>
                ))}
                <span className="bs-fill" />
                <span className="BodySmallRegular bs-muted">{`Coloured by permission for ${ROLES[viewAs]?.display ?? viewAs}`}</span>
              </div>
            </div>
          </Card>

          <Card padding={12} size="Medium" accessibilityLabel="Rehearsal inset">
            <div className="tb-check">
              <div className="tb-check__head">
                <span className="BodySmallSemibold">Rehearsal inset · conflicting radar reports</span>
                <Badge className="bs-tag" size="Medium" color="Neutral" emphasis="Intense" label="REHEARSAL" />
              </div>
              {rehearsal.reports.length ? (
                <>
                  <div className="on-inset">
                    {rehearsal.reports.map((r) => (
                      <Facts
                        key={r.id}
                        title={`Radar report · ${r.sensor}`}
                        items={[
                          ['Report', r.report, 'wide'],
                          ['Height', r.heightM !== null ? `${Math.round(r.heightM)} m` : '—'],
                          ['Time', stamp(r.at, clock)],
                          ['Provenance', r.feed, 'wide'],
                          ['Record', shortHash(r.hash)],
                        ]}
                      />
                    ))}
                    {rehearsal.assessment ? (
                      <Facts
                        title="Assessment · from both reports"
                        items={[
                          ['Hypotheses', rehearsal.assessment.hypotheses.map((h) => `${h.label} ${Math.round(h.p * 100)}%`).join(' · '), 'wide'],
                          ['State', <Badge className="bs-tag" size="Medium" color={rehearsal.assessment.contested ? 'Notice' : 'Positive'} emphasis="Subtle" label={rehearsal.assessment.contested ? 'CONTESTED' : 'RESOLVED'} />, 'wide'],
                          ['Derived from', `${rehearsal.assessment.derivedFrom.length} radar reports`, 'wide'],
                          ['Record', shortHash(rehearsal.assessment.hash)],
                        ]}
                      />
                    ) : null}
                  </div>
                  <span className="BodySmallRegular bs-muted">
                    {`The reports put the track ${rehearsal.apartM !== null ? `${(rehearsal.apartM / 1000).toFixed(1)} km apart` : 'apart'}; the assessment keeps both. Label ${rehearsal.label ?? '—'} · read by its thread; the raid clock is unchanged.`}
                  </span>
                </>
              ) : (
                <span className="BodySmallRegular bs-muted">{reh.loading ? 'Reading the rehearsal track…' : 'No rehearsal track permitted to this identity.'}</span>
              )}
            </div>
          </Card>
        </div>
      </ScrollArea>

      <aside className="sv__record" aria-label="Ontology inspector">
        <Tabs className="bs-tabs-fill" value={tab} onChange={setTab} size="Small" variant="filled">
          <div className="bs-tabbar bs-tabbar--insp">
            <TabList>
              <TabItem value="inspector">Inspector</TabItem>
              <TabItem value="history">History</TabItem>
            </TabList>
          </div>
          <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
            <TabPanel value="inspector">
              <section className="bs-stack bs-pad" aria-label="Inspector">
                {node ? <Inspector node={node} lineage={lineage} clock={clock} root={check?.head?.hash ?? null} onFocus={focusOn} /> : <EmptyState title="Nothing selected" description="Pick a node in the lineage graph." />}
              </section>
            </TabPanel>
            <TabPanel value="history">
              <section className="bs-stack bs-pad" aria-label="History">
                {node && node.kind !== 'group' ? <History node={node} lineage={lineage} clock={clock} /> : <EmptyState title="Pick one object" description="A group has no history of its own; pick one of its members." />}
              </section>
            </TabPanel>
          </ScrollArea>
        </Tabs>
        <div className="bs-insp__foot">
          <span className="BodySmallRegular bs-muted">Each assessment keeps the reports that produced it. Decision out: none.</span>
        </div>
      </aside>
    </div>
  );
}

/** The graph's three columns: what comes in, what is fused from it, what is decided and recorded. */
const GRAPH_COLUMNS: Array<{ id: string; layers: OntologyLayer[] }> = [
  { id: 'sources', layers: ['reference', 'observation'] },
  { id: 'fused', layers: ['fused'] },
  { id: 'decisions', layers: ['command', 'event'] },
];
/**
 * The graph reads left to right and links only neighbouring columns: the first column connects to
 * the second, the second to the third, never the first to the third. A link between the first and
 * third column is the record's own lineage reaching past the fused picture; it is left to the
 * inspector's History and the Fused node it passes through.
 */
function adjacentLinks(g: OntologyGraph): OntologyGraph {
  const col = new Map(g.nodes.map((n) => [n.id, GRAPH_COLUMNS.findIndex((c) => c.layers.includes(n.layer))]));
  return { ...g, edges: g.edges.filter((e) => Math.abs((col.get(e.from) ?? 0) - (col.get(e.to) ?? 0)) < 2) };
}
/** A column's card width, as laid out. */
const layoutWidth = (l: { w: number }) => l.w;
/** Node card height and the spacing of the columns; the card width fills the graph. */
const NODE_H = 66;
const NODE_H_PLAIN = 48;
const ROW_GAP = 20; // between cards in a column: room for the links to read between them
/** The gap between columns: 8% of the graph's width, between 32 and 96 px, so three columns always fit. */
const colGap = (width: number) => Math.round(Math.min(96, Math.max(32, width * 0.08)));
const HEAD_H = 32;
/** Room kept round the cards, so the 2px ring of the selected one is not cut by the graph's edge. */
const INSET = 4;

/** Each link type's look: colour from the FDS tokens, a pattern of its own. */
const EDGE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  'derived from': { stroke: 'var(--text-brand-normal)' },
  thread: { stroke: 'var(--text-notice-normal)', dash: '6 4' },
  protects: { stroke: 'var(--text-positive-normal)', dash: '1 5' },
  'member of': { stroke: 'var(--text-neutral-normal)', dash: '1 5' },
};

interface CardData extends Record<string, unknown> {
  w: number;
  n: GraphNode;
}
/** The selected node and how to pick one, shared with the cards so their data stays unchanged on a selection. */
const GraphContext = createContext<{ active: string | null; pick: (id: string) => void }>({ active: null, pick: () => {} });
/** The graph shows at most this tall (more on a tall screen, where there is room); a longer one scrolls inside it. */
const graphMaxH = () => Math.max(520, Math.round(window.innerHeight * 0.62));
/** Up to this many links each draw as their own link; beyond it the selected node's draw that way (at most HOT_LINKS_MAX) and the rest are drawn together, faint, in one layer. */
const ALL_LINKS_MAX = 60;
const HOT_LINKS_MAX = 30;
/** Which links stay when there are too many: what the node is derived from first, the thread last. */
const LINK_RANK: Record<string, number> = { 'derived from': 0, protects: 1, 'member of': 2, thread: 3 };
interface HeadData extends Record<string, unknown> {
  w: number;
  title: string;
}

/** A node card on the graph: its FDS Card, with an invisible handle for each side a link uses. */
const CardNode = memo(function CardNode({ data }: NodeProps<Node<CardData, 'card'>>) {
  const { active, pick } = useContext(GraphContext);
  const hidden = { opacity: 0, pointerEvents: 'none' as const };
  return (
    <div className="nodrag nopan" style={{ width: data.w }}>
      <Handle id="l" type="target" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle id="r" type="source" position={Position.Right} style={hidden} isConnectable={false} />
      <Handle id="rt" type="target" position={Position.Right} style={hidden} isConnectable={false} />
      <NodeCard n={data.n} isActive={data.n.id === active} onPick={() => pick(data.n.id)} />
    </div>
  );
});
function HeadNode({ data }: NodeProps<Node<HeadData, 'head'>>) {
  return (
    <div style={{ width: data.w }}>
      <span className="BodySmallSemibold">{data.title}</span>
    </div>
  );
}
const NODE_TYPES = { card: CardNode, head: HeadNode };

/**
 * The lineage graph, drawn by React Flow: three columns of node cards, left to right, each link a
 * smooth curve from the right edge of one card to the left edge of the next. A link inside one
 * column leaves and returns on the right. "Derived from" points at the record derived. The links
 * of the selected node are drawn stronger and the rest recede. The graph is fixed (no dragging,
 * panning or zooming): it is read, not edited.
 */
function Graph({ g, active, onPick }: { g: OntologyGraph; active: string | null; onPick: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState(graphMaxH);
  useEffect(() => {
    const onResize = () => setMaxH(graphMaxH());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Measured before the graph is drawn: React Flow fixes its bounds when it mounts, so a guessed
  // width would leave the graph shifted inside a wider box.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The layout depends on the data and the width only; a selection touches just the links.
  const layout = useMemo(() => {
    const W = width ?? 720;
    const gap = colGap(W);
    const w = Math.max(110, Math.floor((W - 2 * INSET - 2 * gap) / 3));
    const col = new Map<string, number>();
    const pos = new Map<string, { x: number; y: number; h: number }>();
    const flow: Array<Node<CardData, 'card'> | Node<HeadData, 'head'>> = [];
    let tallest = 0;
    GRAPH_COLUMNS.forEach((c, ci) => {
      const x = INSET + ci * (w + gap);
      flow.push({ id: `head:${c.id}`, type: 'head', position: { x, y: 0 }, data: { w, title: c.layers.map((l) => LAYER_WORD[l]).join(' · ') }, draggable: false, selectable: false, focusable: false });
      const mine = g.nodes.filter((n) => c.layers.includes(n.layer)).sort((a, b) => c.layers.indexOf(a.layer) - c.layers.indexOf(b.layer));
      let y = HEAD_H;
      mine.forEach((n) => {
        col.set(n.id, ci);
        pos.set(n.id, { x, y, h: n.permitted === 'all' ? NODE_H_PLAIN : NODE_H });
        flow.push({ id: n.id, type: 'card', position: { x, y }, data: { w, n }, draggable: false, selectable: false, focusable: false });
        y += (n.permitted === 'all' ? NODE_H_PLAIN : NODE_H) + ROW_GAP;
      });
      tallest = Math.max(tallest, y - HEAD_H);
    });
    return { nodes: flow, col, pos, contentH: HEAD_H + Math.max(NODE_H, tallest) + 8, w };
  }, [g, width]);
  const { edges, rest } = useMemo(() => {
    const everything = g.edges.length <= ALL_LINKS_MAX;
    const keep = everything
      ? null
      : new Set(
          g.edges
            .map((e, k) => ({ e, k }))
            .filter(({ e }) => !!active && (e.from === active || e.to === active))
            .sort((x, y) => (LINK_RANK[x.e.type] ?? 9) - (LINK_RANK[y.e.type] ?? 9))
            .slice(0, HOT_LINKS_MAX)
            .map(({ k }) => k),
        );
    const links = g.edges.flatMap((e, k): Edge[] => {
      const hot = !!active && (e.from === active || e.to === active);
      if (keep && !keep.has(k)) return [];
      const a = layout.col.get(e.from);
      const b = layout.col.get(e.to);
      if (a === undefined || b === undefined) return [];
      const look = EDGE_STYLE[e.type] ?? { stroke: 'var(--text-neutral-normal)' };
      // Left to right; the arrow sits at whichever end is the record derived.
      const [from, to] = a <= b ? [e.from, e.to] : [e.to, e.from];
      const arrow = e.type === 'derived from' ? { type: MarkerType.ArrowClosed, color: look.stroke, width: 14, height: 14 } : undefined;
      const flipped = a > b;
      return [
        {
          id: `${k}:${e.from}>${e.to}`,
          source: from,
          target: to,
          sourceHandle: 'r',
          targetHandle: a === b ? 'rt' : 'l',
          type: 'default',
          selectable: false,
          focusable: false,
          style: { stroke: look.stroke, strokeWidth: hot ? 2.25 : 1.5, opacity: hot || !active ? 1 : 0.35, ...(look.dash ? { strokeDasharray: look.dash, strokeLinecap: 'round' as const } : {}) },
          ...(arrow ? (flipped ? { markerStart: arrow } : { markerEnd: arrow }) : {}),
        },
      ];
    });
    // Every link not drawn on its own goes into one faint layer, a single path per link type.
    const faint = new Map<string, string>();
    if (keep) {
      g.edges.forEach((e, k) => {
        if (keep.has(k)) return;
        const a = layout.pos.get(e.from);
        const b = layout.pos.get(e.to);
        const ca = layout.col.get(e.from);
        const cb = layout.col.get(e.to);
        if (!a || !b || ca === undefined || cb === undefined) return;
        const [s0, t0, sc, tc] = ca <= cb ? [a, b, ca, cb] : [b, a, cb, ca];
        const [d] = getBezierPath({ sourceX: s0.x + layoutWidth(layout), sourceY: s0.y + s0.h / 2, sourcePosition: Position.Right, targetX: sc === tc ? t0.x + layoutWidth(layout) : t0.x, targetY: t0.y + t0.h / 2, targetPosition: sc === tc ? Position.Right : Position.Left });
        faint.set(e.type, (faint.get(e.type) ?? '') + d);
      });
    }
    return { edges: links, rest: [...faint] };
  }, [g, layout, active]);
  const scrolls = layout.contentH > maxH;
  const ctx = useMemo(() => ({ active, pick: onPick }), [active, onPick]);
  return (
    <div className="on-graph" ref={box} style={{ height: Math.min(layout.contentH, maxH) }}>
      <GraphContext.Provider value={ctx}>
      {width !== null ? (
      <ReactFlow
        // A new width re-mounts the graph so its bounds and view start again at the left edge.
        key={width}
        nodes={layout.nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={1}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        // A tall graph scrolls inside its box (only the cards in view are drawn); a short one leaves the wheel to the page.
        panOnScroll={scrolls}
        panOnScrollMode={PanOnScrollMode.Vertical}
        preventScrolling={scrolls}
        translateExtent={[[0, 0], [Math.max(width, 1), layout.contentH]]}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        aria-label="Lineage graph"
      >
        {rest.length ? (
          <ViewportPortal>
            <svg className="on-faint" aria-hidden="true">
              {rest.map(([type, d]) => (
                <path key={type} d={d} className={`on-edge on-edge--${slug(type)}`} />
              ))}
            </svg>
          </ViewportPortal>
        ) : null}
      </ReactFlow>
      ) : null}
      </GraphContext.Provider>
    </div>
  );
}

function NodeCard({ n, isActive, onPick }: { n: GraphNode; isActive: boolean; onPick: () => void }) {
  const p = PERMISSION[n.permitted];
  return (
    <Card data-node={n.id} padding={0} size="Medium" isSelected={isActive} opacity={n.permitted === 'none' ? 0.55 : 1} accessibilityLabel={`${n.label}, ${p.label.toLowerCase()}`} onClick={onPick}>
      <div className="on-node">
        <span className="BodySmallSemibold bs-ellipsis">{n.label}</span>
        <span className="BodySmallRegular bs-muted bs-ellipsis">{n.focus ? `Source record · ${n.detail}` : `${LAYER_WORD[n.layer]} · ${n.detail}`}</span>
        {/* Permission is stated only when it is not complete: a fully permitted node is the usual. */}
        {n.permitted !== 'all' ? <Badge className="bs-tag" size="Medium" color={p.color} emphasis="Subtle" label={p.label} /> : null}
      </div>
    </Card>
  );
}

function Inspector({ node, lineage, clock, root, onFocus }: { node: GraphNode; lineage: JournalRecord[]; clock: RaidClock | undefined; root: string | null; onFocus: (id: string) => void }) {
  const client = useClient();
  const entity = node.kind === 'object' ? client.entities.get(node.id) : undefined;
  const record = node.kind === 'record' ? lineage.find((r) => r.record_id === node.id) : undefined;
  const x = entity ?? record;
  if (node.kind === 'group') {
    const members = node.members.map((id) => client.entities.get(id)).filter((e): e is Entity => !!e);
    return (
      <div role="group" aria-label={node.label}>
        <div className="tb-check">
          <div className="tb-check__head">
            <span className="BodySmallSemibold">{node.label}</span>
            {node.permitted !== 'all' ? <Badge className="bs-tag" size="Medium" color={PERMISSION[node.permitted].color} emphasis="Subtle" label={PERMISSION[node.permitted].label} /> : null}
          </div>
          <span className="BodySmallRegular bs-muted">{`${LAYER_WORD[node.layer]} layer · ${node.detail} · prepared before the raid`}</span>
          <ActionList accessibilityLabel={`${node.label} members`}>
            {members.map((m) => (
              <ActionListItem
                key={m.entity_id}
                value={m.entity_id}
                title={m.aliases?.name ?? m.entity_id}
                description={[m.entity_id, m.effector?.magazine ? `magazine ${m.effector.magazine.ready} / ${m.effector.magazine.capacity ?? m.effector.magazine.ready + m.effector.magazine.reserve} · floor ${m.effector.magazine.floor}` : null, m.effector?.status ? `readiness ${m.effector.status}` : null, m.sensor?.status ? `sensor ${m.sensor.status}` : null, m.plant ? `${m.plant.state.replaceAll('_', ' ')}` : null].filter(Boolean).join(' · ')}
                trailing={<ActionListItemText>{`v${m.version}`}</ActionListItemText>}
                onClick={() => onFocus(m.entity_id)}
              />
            ))}
          </ActionList>
        </div>
      </div>
    );
  }
  if (!x) return <EmptyState title="Not in this view" description="The record is not permitted to this identity at this position." />;
  const env = envelopeOf(x);
  const run = client.scenario;
  const model = entity?.track?.fusion_version;
  return (
    <div role="group" aria-label={`${node.label} envelope`}>
      <div className="tb-check">
        <div className="tb-check__head">
          <span className="BodySmallSemibold bs-ellipsis">{node.label}</span>
          {node.permitted !== 'all' ? <Badge className="bs-tag" size="Medium" color={PERMISSION[node.permitted].color} emphasis="Subtle" label={PERMISSION[node.permitted].label} /> : null}
        </div>
        <span className="BodySmallRegular bs-muted">{`${LAYER_WORD[node.layer]} layer · ${node.detail}`}</span>
        <Facts
          title="Envelope"
          flush
          items={[
            ['Provenance', [env.feed, env.agency, env.sensor].filter(Boolean).join(' · '), 'wide'],
            ['Time · source', stamp(env.source, clock)],
            ['Time · receipt', stamp(env.receipt, clock)],
            ['Label', env.label],
            ['Version', env.version !== null ? `v${env.version}` : 'Single record'],
            ['Signature', env.signature ? shortHash(env.signature) : `Not signed · hash chain verified · ${shortHash(env.hash)}`, 'wide'],
            ['Permission', env.permitted.join(' · ') || 'None', 'wide'],
          ]}
        />
        {entity?.relationships?.length ? <Facts title="Relationships" flush items={entity.relationships.map((r): [string, string] => [r.type.replaceAll('_', ' '), r.target])} /> : null}
        <Facts
          title="Artifacts"
          flush
          items={[
            ['Models', model ?? 'None for this record', 'wide'],
            ['Twins', 'None in this build', 'wide'],
            ['Datasets', run ? `Run ${run.id} · seed ${run.seed} · synthetic` : '—', 'wide'],
            ['Builds', root ? `Journal ${shortHash(root)} at the position` : '—', 'wide'],
          ]}
        />
      </div>
    </div>
  );
}

function History({ node, lineage, clock }: { node: GraphNode; lineage: JournalRecord[]; clock: RaidClock | undefined }) {
  const client = useClient();
  const entity = node.kind === 'object' ? client.entities.get(node.id) : undefined;
  const records = useHistory(entity);
  const rows = entity ? records : lineage.filter((r) => r.record_id === node.id);
  return (
    <div role="group" aria-label={`${node.label} history`}>
      <div className="tb-check">
        <div className="tb-check__head">
          <span className="BodySmallSemibold bs-ellipsis">{`History · ${node.label}`}</span>
          <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label={`${rows.length} RECORD${rows.length === 1 ? '' : 'S'}`} />
        </div>
        <ActionList accessibilityLabel="Records">
          {rows.map((r) => (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={r.kind === 'decision' || r.kind === 'engagement' || r.kind === 'bda' ? eventSummary(r).title : `${LAYER_WORD[r.layer as keyof typeof LAYER_WORD] ?? r.layer} record`}
              description={`${stamp(r.ingest_time, clock)} · ${r.provenance.source_feed}${r.derived_from?.length ? ` · derived from ${r.derived_from.length}` : ''} · ${shortHash(r.hash)}`}
              titleSuffix={<ActionListItemBadge className="bs-tag" size="Medium" color="Neutral" emphasis="Subtle" label={r.label} />}
            />
          ))}
        </ActionList>
      </div>
    </div>
  );
}

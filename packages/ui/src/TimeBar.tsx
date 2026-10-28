/**
 * Timeline: two parts.
 *   - Controls: previous frame, Play, next frame, the picture time (the current frame is named to
 *     screen readers and in the frame ticks' hover cards); at the
 *     right a Show menu (which kinds of event are drawn, with their counts), the playback rate
 *     (with Replay last 30 min) and Live.
 *   - Track: one blue bar (the raid window a stronger blue inside it) holding the storyboard
 *     frames as short ticks from its top edge (click to go; dragging snaps to one, Shift turns
 *     that off; [ and ] step them) and intel, decisions and rule firings on one baseline, merged
 *     where they would touch (a mixed marker takes the shape of its most important kind). Outside
 *     the bar: tick marks under its lower edge and one label row (day names outside the raid
 *     window, hour labels inside it), and the playhead, whose line runs through the bar with its
 *     handle above. A key beside Show names each shape. Only events received by the picture time
 *     are drawn (bitemporal).
 *
 * The lanes are the one custom visual besides map symbols: FDS has no timeline component. They
 * use FDS tokens and type classes only; hovers are FDS Cards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionList, ActionListItem, ActionListItemIcon, ActionListItemText, ActionListSection, Badge, Button, Card, DropdownMenu, DropdownMenuOverlay, DropdownMenuTrigger, Tooltip } from '@faclon-labs/fds';
import { ChevronDown, History, ListFilter, Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { DAY, HOUR, MINUTE, type DecisionPayload, type JournalRecord, type RaidClock } from '@me/schema';
import type { Bookmark } from '@me/client';
import { useClient, useClientTick, useEngineTime, useEvents } from '@me/map-react';
import { eventSummary, raidLabel } from './format.ts';
import { KIND_PRIORITY, adaptiveTicks, bucketEvents, nearestBucket, snapToFrame, type Bucket, type EventKind } from './timeline.ts';

interface Segment {
  t0: number;
  t1: number;
  w: number;
  /** The raid window, shaded. */
  dense?: boolean;
}

/** Axis segments: journal start → H-6h → H-90 min → H+60 min → journal end. */
export function buildSegments(t0: number, t1: number, clock: RaidClock): Segment[] {
  const h = clock.h;
  const raw: Segment[] = [
    { t0, t1: h - 6 * HOUR, w: 0.2 },
    { t0: h - 6 * HOUR, t1: h - 90 * MINUTE, w: 0.13 },
    { t0: h - 90 * MINUTE, t1: h + 60 * MINUTE, w: 0.52, dense: true },
    { t0: h + 60 * MINUTE, t1, w: 0.15 },
  ];
  return raw.filter((s) => s.t1 > s.t0);
}

/** Map time ↔ x over [x0, x1]. */
export function makeScale(segs: Segment[], x0: number, x1: number) {
  const total = segs.reduce((a, s) => a + s.w, 0) || 1;
  let acc = 0;
  const px = segs.map((s) => {
    const a = x0 + (acc / total) * (x1 - x0);
    acc += s.w;
    return { ...s, x0: a, x1: x0 + (acc / total) * (x1 - x0) };
  });
  const x = (t: number) => {
    const s = px.find((p) => t <= p.t1) ?? px[px.length - 1]!;
    const f = Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)));
    return s.x0 + f * (s.x1 - s.x0);
  };
  const t = (xx: number) => {
    const s = px.find((p) => xx <= p.x1) ?? px[px.length - 1]!;
    const f = Math.max(0, Math.min(1, (xx - s.x0) / (s.x1 - s.x0)));
    return s.t0 + f * (s.t1 - s.t0);
  };
  return { x, t, px };
}

interface Tick {
  t: number;
  label: string;
  major: boolean;
}

/** Labels that fit: major ticks first, then the rest where they do not touch a placed one. */
function placeTicks(ticks: Tick[], x: (t: number) => number): Tick[] {
  const CHAR = 7; // about one 12px character
  const placed: Array<[number, number]> = [];
  const out: Tick[] = [];
  for (const k of [...ticks].sort((a, b) => Number(b.major) - Number(a.major))) {
    const a = x(k.t) - (k.label.length * CHAR) / 2;
    const b = a + k.label.length * CHAR;
    if (placed.some(([p, q]) => a < q + 6 && b > p - 6)) continue;
    placed.push([a, b]);
    out.push(k);
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** A tick's label. Day starts are named in tier A, and long steps are just marks: neither carries one here. */
function tickLabel(t: number, step: number, clock: RaidClock): { label: string; major: boolean } {
  if ((t - clock.d0) % DAY === 0) return { label: '', major: true };
  if (t === clock.h) return { label: 'H', major: true };
  if (step >= 6 * HOUR) return { label: '', major: false };
  const dt = t - clock.h;
  const sign = dt < 0 ? '-' : '+';
  const m = Math.round(Math.abs(dt) / MINUTE);
  if (step >= HOUR) return { label: m % 60 === 0 ? `H${sign}${m / 60}h` : `H${sign}${Math.floor(m / 60)}h${pad2(m % 60)}`, major: false };
  return { label: `H${sign}${m}`, major: false };
}

/** Playback rates, each with what it means in picture time. */
const RATES: Array<[number, string]> = [
  [1, 'Real time'],
  [10, '10 s per second'],
  [60, '1 min per second'],
  [300, '5 min per second'],
  [1800, '30 min per second'],
];

/* ---- geometry (SVG units = CSS px) ---- */
const PAD = 8; // room at both ends of the axis
const HANDLE_Y = 5; // the playhead's handle, above the bar
const BAR_Y = 12; // the blue bar: the frames and the events live inside it
const BAR_H = 28;
const FRAMES_H = 5; // frame ticks hang from the bar's top edge
const EVENTS_Y = BAR_Y + BAR_H / 2 + 1; // the events' baseline
const AXIS_Y = BAR_Y + BAR_H; // the bar's lower edge is the axis; tick marks hang below it
const LABEL_Y = AXIS_Y + 20; // the one label row, outside the bar: day names, hour labels
const HEIGHT = LABEL_Y + 6;
const MERGE_PX = 12;
const NARROW = 760; // below this the key shows the shapes only

const LEGEND: Array<{ id: EventKind; label: string; color: string }> = [
  { id: 'frag', label: 'Intel', color: 'var(--background-notice-default)' },
  { id: 'dec', label: 'Decisions', color: 'var(--background-brand-default)' },
  { id: 'rule', label: 'Rules', color: 'var(--background-negative-default)' },
];
const KIND_WORD: Record<EventKind, [string, string]> = { frag: ['intel', 'intel'], dec: ['decision', 'decisions'], rule: ['rule', 'rules'] };

/** A kind's shape, centred on (cx, cy): intel a dot, a decision a diamond, a rule a triangle. */
function shapePath(kind: EventKind, cx: number, cy: number, r = 4): string {
  if (kind === 'dec') return `M ${cx} ${cy - r - 0.5} L ${cx + r + 0.5} ${cy} L ${cx} ${cy + r + 0.5} L ${cx - r - 0.5} ${cy} Z`;
  if (kind === 'rule') return `M ${cx} ${cy - r - 0.5} L ${cx + r + 0.5} ${cy + r - 0.5} L ${cx - r - 0.5} ${cy + r - 0.5} Z`;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}
function Glyph({ kind, color }: { kind: EventKind; color: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}>
      <path d={shapePath(kind, 6, 6, 4)} style={{ fill: color }} />
    </svg>
  );
}

const titleOf = (r: JournalRecord): string => {
  if (r.kind === 'decision') {
    const p = r.payload as DecisionPayload;
    return `${p.dp} · ${p.title}`;
  }
  return eventSummary(r).title;
};

/** What the hover card shows: what it is, its name, and when. */
interface Hover {
  x: number;
  y: number;
  kind: string;
  title: string;
  at?: number;
}

export function TimeBar({ bookmarks = [], onBookmark, current }: { bookmarks?: Bookmark[]; onBookmark?: (b: Bookmark) => void; current?: string | undefined }) {
  const client = useClient();
  useClientTick(250);
  const t = useEngineTime(100);
  const events = useEvents(500);
  const [rate, setRate] = useState(60);
  // The rate menu is controlled so its action row (replay) can close it too.
  const [rateOpen, setRateOpen] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverFrame, setHoverFrame] = useState<string | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<EventKind>>(new Set());
  const [width, setWidth] = useState(600);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastSeek = useRef(0);
  // The lanes mount only once the scenario has arrived, so observe through a callback ref.
  const [lanesEl, setLanesEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lanesEl) return;
    const ro = new ResizeObserver((es) => setWidth(Math.max(200, Math.floor(es[0]!.contentRect.width))));
    ro.observe(lanesEl);
    return () => ro.disconnect();
  }, [lanesEl]);

  const s = client.scenario;
  const clock = client.clock;
  const segs = useMemo(() => (s ? buildSegments(s.t0, s.t1, s.clock) : []), [s]);
  const scale = useMemo(() => makeScale(segs, PAD, width - PAD), [segs, width]);
  const ticks = useMemo(() => (s ? adaptiveTicks(scale.px, s.clock.h, s.clock.d0).map((k) => ({ ...k, ...tickLabel(k.t, k.step, s.clock) })) : []), [scale, s]);
  // The one label row: day names at day starts outside the raid window, hour labels inside it,
  // placed together so they never touch (days and H first, as major).
  const labelled = useMemo(() => {
    if (!s) return [];
    const breaks = scale.px.slice(1).map((p) => p.x0);
    const dense = scale.px.find((p) => p.dense);
    const days = [-3, -2, -1, 0]
      .map((d) => ({ t: s.clock.d0 + d * DAY, label: d === 0 ? 'D' : `D${d}`, major: true }))
      .filter((d) => d.t >= s.t0 && d.t <= s.t1 && !(dense && d.t >= dense.t0 && d.t <= dense.t1));
    const hours = ticks.filter((k) => k.label && !breaks.some((b) => Math.abs(scale.x(k.t) - b) < 14)).map((k) => ({ t: k.t, label: k.label, major: k.major }));
    return placeTicks([...days, ...hours], scale.x);
  }, [ticks, scale, s]);

  // Everything received by the picture time, counted for the Show menu; the row draws what is not hidden.
  const lanes = useMemo(() => {
    const items: Array<{ kind: EventKind; x: number; rec: JournalRecord }> = [];
    const counts: Record<EventKind, number> = { frag: 0, dec: 0, rule: 0 };
    for (const r of events) {
      const kind: EventKind | null = r.kind === 'fragment' ? 'frag' : r.kind === 'decision' ? 'dec' : r.kind === 'rule_fire' ? 'rule' : null;
      if (!kind) continue;
      counts[kind] += 1;
      items.push({ kind, x: scale.x(r.ingest_time), rec: r });
    }
    return { items, counts };
  }, [events, scale]);
  const buckets = useMemo(() => bucketEvents(lanes.items.filter((i) => !hidden.has(i.kind)), MERGE_PX).sort((a, b) => KIND_PRIORITY[a.top] - KIND_PRIORITY[b.top]), [lanes, hidden]);
  const frameXs = useMemo(() => bookmarks.map((b) => ({ id: b.id, x: scale.x(b.t), t: b.t })), [bookmarks, scale]);

  if (!s) return null;
  const shownT = drag !== null ? drag : t;
  const playX = scale.x(shownT);
  const rel = (e: { clientX: number; clientY: number }) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const timeAt = (clientX: number) => scale.t(clientX - ref.current!.getBoundingClientRect().left);
  /** The time under the pointer, snapped to a frame tick when one is close (Shift: never). */
  const dragTime = (e: { clientX: number; shiftKey: boolean }) => {
    const id = snapToFrame(e.clientX - ref.current!.getBoundingClientRect().left, frameXs, 6, e.shiftKey);
    setSnap(id);
    return id ? frameXs.find((f) => f.id === id)!.t : timeAt(e.clientX);
  };
  const seek = (tt: number, final: boolean) => {
    const now = performance.now();
    if (final || now - lastSeek.current > 150) {
      lastSeek.current = now;
      client.seek(tt);
    }
  };
  // The current frame, while the picture is still at it (scrubbing away leaves it behind).
  const frame = current ? bookmarks.find((b) => b.id === current && Math.abs(b.t - shownT) < MINUTE) : undefined;
  // The step buttons stay on this map: they walk only the frames that open here (a frame for
  // another view, such as A2 on Ontology or B3–B5 on Targets, is skipped; [ and ] still walk the
  // whole storyboard). From one of those frames, or between frames, they take the nearest one by time.
  const mapFrames = bookmarks.filter((b) => !b.page || b.page === 'battlespace');
  const at = frame ? mapFrames.indexOf(frame) : -1;
  const prevFrame = at >= 0 ? mapFrames[at - 1] : mapFrames.filter((b) => b.t < shownT - 1000).sort((a, b) => b.t - a.t)[0];
  const nextFrame = at >= 0 ? mapFrames[at + 1] : mapFrames.filter((b) => b.t > shownT + 1000).sort((a, b) => a.t - b.t)[0];
  // A step button with its tooltip; without a frame to go to it is disabled, and its tooltip
  // says so.
  const stepButton = (to: Bookmark | undefined, label: string, keyHint: string, Icon: typeof SkipBack) => {
    const btn = (
      <Button iconOnly size="sm" variant="ghost" tone="neutral" aria-label={to ? `${label}: ${to.id}` : label} isDisabled={!to} onClick={() => to && onBookmark?.(to)}>
        <Icon size={14} />
      </Button>
    );
    // A disabled button gets no pointer events, so its tooltip sits on a span around it.
    return to ? (
      <Tooltip content={`${label} · ${to.id} ${to.label} (${keyHint})`}>{btn}</Tooltip>
    ) : (
      <Tooltip content={`${label} (${keyHint}): none this way`}>
        <span className="bs-tip-wrap">{btn}</span>
      </Tooltip>
    );
  };
  const dense = scale.px.find((p) => p.dense);
  const readoutLabel = raidLabel(shownT, s.clock);
  const shownKinds = LEGEND.filter((l) => !hidden.has(l.id));
  // A label is centred on its tick but kept inside the track at both ends.
  const labelX = (x: number, label: string) => Math.min(width - label.length * 3.2 - 2, Math.max(label.length * 3.2 + 2, x));

  const bucketCard = (e: { clientX: number; clientY: number }, b: Bucket<JournalRecord>) => {
    const parts = (Object.keys(KIND_PRIORITY) as EventKind[])
      .sort((x, y) => KIND_PRIORITY[y] - KIND_PRIORITY[x])
      .filter((k) => b.tally[k])
      .map((k) => `${b.tally[k]} ${KIND_WORD[k][b.tally[k] === 1 ? 0 : 1]}`);
    const first = [...b.items].sort((x, y) => KIND_PRIORITY[y.kind] - KIND_PRIORITY[x.kind])[0]!;
    const more = b.items.length - 1;
    setHover({ ...rel(e), kind: parts.join(' · '), title: `${titleOf(first.rec)}${more ? ` · +${more} more` : ''}`, at: first.rec.ingest_time });
  };

  return (
    <div className="bs-tl">
      <div className="bs-tl__bar">
        <span className="bs-tl__transport" role="group" aria-label="Playback">
        {stepButton(prevFrame, 'Previous frame', '[', SkipBack)}
        <Tooltip content={clock.playing ? 'Pause (Space)' : 'Play (Space)'}>
          <Button iconOnly size="sm" variant="primary" tone="brand" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => (clock.playing ? client.pause() : client.play(rate))}>
            {clock.playing ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tooltip>
        {stepButton(nextFrame, 'Next frame', ']', SkipForward)}
        </span>
        <span className="bs-tl__readout" aria-label={`Picture time ${readoutLabel}${frame ? `, frame ${frame.id} · ${frame.label}` : ''}`}>
          <span className="BodyMediumSemibold bs-num">{readoutLabel}</span>
        </span>
        <span className="bs-fill" />
        {/* The key: what each marker's shape means; a kind hidden in Show is dimmed. */}
        <span className="bs-tl__key" aria-label="Key">
          {LEGEND.map((l) => (
            <span key={l.id} className={hidden.has(l.id) ? 'bs-tl__keyitem bs-tl__keyitem--off' : 'bs-tl__keyitem'} {...(width < NARROW ? { role: 'img', 'aria-label': l.label } : {})}>
              <Glyph kind={l.id} color={l.color} />
              {width < NARROW ? null : <span className="BodySmallRegular bs-muted">{l.label}</span>}
            </span>
          ))}
        </span>
        <DropdownMenu
          selectionType="multiple"
          value={shownKinds.map((l) => l.id)}
          onChange={({ values }) => setHidden(new Set(LEGEND.filter((l) => !values.includes(l.id)).map((l) => l.id)))}
        >
          <DropdownMenuTrigger>
            <Button size="sm" variant="secondary" tone="neutral" leadingIcon={<ListFilter size={14} />} trailingIcon={<ChevronDown size={14} />} aria-label={`Events shown: ${shownKinds.map((l) => l.label).join(', ') || 'none'}`}>
              {shownKinds.length === LEGEND.length ? 'Show' : `Show · ${shownKinds.length} of ${LEGEND.length}`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="top-end">
            <ActionList accessibilityLabel="Events shown on the timeline">
              {LEGEND.map((l) => (
                <ActionListItem key={l.id} value={l.id} title={l.label} leading={<Glyph kind={l.id} color={l.color} />} trailing={<ActionListItemText>{String(lanes.counts[l.id])}</ActionListItemText>} />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        <DropdownMenu
          isOpen={rateOpen}
          onOpenChange={({ isOpen }) => setRateOpen(isOpen)}
          selectionType="single"
          value={[String(clock.playing ? clock.rate : rate)]}
          onChange={({ values }) => {
            const r = Number(values[0]);
            if (!r) return;
            setRate(r);
            if (clock.playing) client.play(r);
          }}
        >
          <DropdownMenuTrigger>
            <Button size="sm" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label={`Playback rate ${clock.playing ? clock.rate : rate}×`}>
              {`${clock.playing ? clock.rate : rate}×`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="top-end">
            <ActionList accessibilityLabel="Playback rate">
              <ActionListSection>
                {RATES.map(([r, hint]) => (
                  <ActionListItem key={r} value={String(r)} title={`${r}×`} description={hint} />
                ))}
              </ActionListSection>
              <ActionListSection>
                <ActionListItem
                  value="replay"
                  title="Replay last 30 min"
                  isAction
                  leading={<ActionListItemIcon icon={History} />}
                  onClick={() => {
                    client.seek(t - 30 * MINUTE);
                    client.play(60);
                    setRateOpen(false);
                  }}
                />
              </ActionListSection>
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        {clock.mode === 'live' ? (
          <Badge size="Small" color="Positive" emphasis="Subtle" label="LIVE" />
        ) : (
          <Tooltip content="Follow the live head">
            <Button size="sm" variant="ghost" tone="neutral" leadingIcon={<Radio size={14} />} aria-label="Live" onClick={() => client.live()}>
              Live
            </Button>
          </Tooltip>
        )}
      </div>
      {/* The track, in its own bordered box. */}
      <div className="bs-tl__body">
      <div className="bs-tl__track">
      <div
        ref={(el) => {
          ref.current = el;
          setLanesEl(el);
        }}
        className="bs-tl__lanes"
        role="slider"
        aria-label="Picture time"
        aria-valuemin={s.t0}
        aria-valuemax={s.t1}
        aria-valuenow={Math.round(t)}
        aria-valuetext={raidLabel(t, s.clock)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = (e.shiftKey ? 10 : 1) * MINUTE;
          if (e.key === 'ArrowRight') client.seek(t + step);
          else if (e.key === 'ArrowLeft') client.seek(t - step);
          else if (e.key === 'Home') client.seek(s.t0);
          else if (e.key === 'End') client.seek(s.t1);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          const tt = dragTime(e);
          setDrag(tt);
          seek(tt, false);
        }}
        onPointerMove={(e) => {
          const { x, y } = rel(e);
          setHoverX(x);
          if (drag !== null) {
            const tt = dragTime(e);
            setDrag(tt);
            seek(tt, false);
          }
          if ((e.target as Element).closest?.('[data-tip]')) return;
          const tt = timeAt(e.clientX);
          if (y > BAR_Y + FRAMES_H && y < AXIS_Y) {
            // On the events: the marker nearest the pointer, within 7 px.
            const b = nearestBucket(buckets, x, 7);
            if (b) return bucketCard(e, b);
          }
          setHover({ x, y, kind: 'Time', title: raidLabel(tt, s.clock), at: tt });
        }}
        onPointerUp={() => {
          if (drag === null) return;
          seek(drag, true);
          setDrag(null);
          setSnap(null);
        }}
        onPointerLeave={() => {
          setHover(null);
          setHoverX(null);
        }}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden>
          {/* The bar: one blue span holding the frames and the events, the raid window a stronger blue inside it. */}
          <rect x={PAD} y={BAR_Y} width={width - 2 * PAD} height={BAR_H} rx={4} style={{ fill: 'var(--bs-tl-track)', opacity: 'var(--bs-tl-track-o)' }} />
          {dense ? <rect x={dense.x0} y={BAR_Y} width={dense.x1 - dense.x0} height={BAR_H} style={{ fill: 'var(--bs-tl-window)', opacity: 'var(--bs-tl-window-o)' }} /> : null}
          {/* Tick marks hang from the bar's lower edge; the labels sit under them, outside the bar. */}
          {ticks.map((k) => (
            <line key={k.t} x1={scale.x(k.t)} x2={scale.x(k.t)} y1={AXIS_Y} y2={AXIS_Y + (k.major ? 5 : 3)} style={{ stroke: 'var(--border-neutral-highlighted)' }} />
          ))}
          {/* The one label row: day names and hour labels, kept inside the track at both ends. */}
          {labelled.map((k) => (
            <text key={k.t} x={labelX(scale.x(k.t), k.label)} y={LABEL_Y} textAnchor="middle" className={k.major ? 'BodySmallMedium' : 'BodySmallRegular'} style={{ fill: k.major ? 'var(--text-neutral-normal)' : 'var(--text-neutral-muted)' }}>
              {k.label}
            </text>
          ))}
          {/* Storyboard frames: short ticks from the bar's top edge; the current, hovered or snapped one lit. Named in the hover card and beside the time. */}
          {bookmarks.map((b) => {
            const x = scale.x(b.t);
            const isCurrent = b.id === frame?.id;
            const lit = isCurrent || b.id === hoverFrame || b.id === snap;
            return (
              <g
                key={b.id}
                className="bs-tl__frame"
                data-tip
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onBookmark?.(b);
                }}
                onPointerEnter={(e) => {
                  setHover({ ...rel(e), kind: `Frame ${b.id}`, title: b.label, at: b.t });
                  setHoverFrame(b.id);
                }}
                onPointerLeave={() => {
                  setHoverFrame(null);
                  setHover(null);
                }}
              >
                <rect x={x - 5} y={BAR_Y} width={10} height={FRAMES_H + 4} style={{ fill: 'transparent' }} />
                <line x1={x} x2={x} y1={BAR_Y} y2={BAR_Y + (lit ? FRAMES_H + 3 : FRAMES_H)} style={{ stroke: lit ? 'var(--text-neutral-normal)' : 'var(--border-neutral-highlighted)' }} strokeWidth={lit ? 2 : 1} />
              </g>
            );
          })}
          <g pointerEvents="none">
            {/* Events: one baseline; a rule over a decision over intel; the hover card says how many a marker holds. */}
            {buckets.map((b, i) => {
              const cy = EVENTS_Y;
              const color = b.top === 'rule' ? 'var(--background-negative-default)' : b.top === 'dec' ? 'var(--background-brand-default)' : 'var(--background-notice-default)';
              const near = Math.abs(b.x - playX) <= 6;
              return (
                <path key={i} d={shapePath(b.top, b.x, cy, b.items.length > 1 ? 5 : 4)} strokeLinejoin="round" strokeWidth={1.5} style={{ fill: color, stroke: 'var(--background-surface-intense)', opacity: near ? 0.5 : 1 }} />
              );
            })}
          </g>
          {/* The hover guide. */}
          {hoverX !== null ? <line x1={hoverX} x2={hoverX} y1={BAR_Y} y2={AXIS_Y} pointerEvents="none" style={{ stroke: 'var(--border-neutral-highlighted)' }} strokeDasharray="2 3" /> : null}
          {/* The playhead: a 2 px line through the bar, out above and below it, with its handle above; its time is the readout above. */}
          <line x1={playX} x2={playX} y1={HANDLE_Y} y2={AXIS_Y + 6} pointerEvents="none" style={{ stroke: 'var(--text-neutral-normal)' }} strokeWidth={2} />
          <circle cx={playX} cy={HANDLE_Y} r={5} pointerEvents="none" style={{ fill: 'var(--text-neutral-normal)', stroke: 'var(--background-surface-intense)' }} strokeWidth={2} />
        </svg>
        {hover ? <HoverCard hover={hover} width={width} clock={s.clock} /> : null}
      </div>
      </div>
      </div>
    </div>
  );
}

/** What is under the pointer: a small FDS Card above it (a frame, or a marker's events). */
function HoverCard({ hover, width, clock }: { hover: Hover; width: number; clock: RaidClock }) {
  const flip = hover.x > width - 280;
  return (
    <div className="bs-tl__card" style={{ left: hover.x + (flip ? -14 : 14), top: Math.max(4, hover.y - 12), transform: `translate(${flip ? '-100%' : '0'}, -100%)` }}>
      <Card padding={12} size="Medium" accessibilityLabel={`${hover.kind}: ${hover.title}`}>
        <div className="bs-tl__cardbody">
          {/* Over the bare track: just the time a click would go to (the axis is compressed, so it is not guessable). */}
          {hover.kind === 'Time' ? (
            <span className="BodySmallSemibold bs-num">{hover.title}</span>
          ) : (
            <>
              <span className="BodySmallRegular bs-muted">{hover.kind}</span>
              <span className="BodySmallSemibold">{hover.title}</span>
              {hover.at !== undefined ? <span className="BodySmallRegular bs-muted bs-num">{raidLabel(hover.at, clock)}</span> : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

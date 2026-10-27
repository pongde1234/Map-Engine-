/**
 * Timeline. One control strip (transport, frames, Live, a quiet legend that also filters, the
 * picture time read out) over one ruler and one row of events.
 *   - Ruler, tier A: the day names at each day's left edge, the raid window as a tinted band with
 *     its edges named, and the storyboard frames as ticks on its lower edge (the current and the
 *     hovered one named).
 *   - Ruler, tier B: tick labels at the step each axis segment can carry (see timeline.ts).
 *   - Event row: intel, decisions and rule firings on one baseline, merged where they would touch
 *     (a mixed marker takes the shape of its most important kind, with a count), over a thin
 *     density of kills. Only events received by the picture time are drawn (bitemporal).
 *   - Playhead: a line with a handle; dragging snaps to a frame tick (Shift turns that off). Its
 *     time is the readout in the strip.
 *
 * The lanes are the one custom visual besides map symbols: FDS has no timeline component. They
 * use FDS tokens and type classes only; hovers are FDS Cards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionList, ActionListItem, ActionListItemIcon, ActionListSection, Badge, Button, Card, DropdownMenu, DropdownMenuOverlay, DropdownMenuTrigger, Tooltip } from '@faclon-labs/fds';
import { Bookmark as BookmarkIcon, ChevronDown, History, Pause, Play, Radio } from 'lucide-react';
import { DAY, HOUR, MINUTE, type DecisionPayload, type EngagementPayload, type JournalRecord, type RaidClock } from '@me/schema';
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
  const CHAR = 6;
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
const DAYS_H = 14; // the day names, in a row of their own above everything else
const A0 = DAYS_H; // tier A's top: the raid window, frame ticks, the playhead handle
const TIER_A = A0 + 18; // tier A's bottom
const RULER = TIER_A + 20; // tier B (tick labels) sits on the ruler's baseline
const EVENTS_H = 32; // the event row
const HEIGHT_OPEN = RULER + EVENTS_H;
const MERGE_PX = 12;
const KILL_MAX_H = 8;
const NARROW = 720; // below this the legend is shapes only

type LegendKind = EventKind | 'eng';
const LEGEND: Array<{ id: LegendKind; label: string; color: string }> = [
  { id: 'frag', label: 'Intel', color: 'var(--background-notice-default)' },
  { id: 'dec', label: 'Decisions', color: 'var(--background-brand-default)' },
  { id: 'rule', label: 'Rules', color: 'var(--background-negative-default)' },
  { id: 'eng', label: 'Kills', color: 'var(--text-negative-normal)' },
];
const KIND_WORD: Record<EventKind, [string, string]> = { frag: ['intel', 'intel'], dec: ['decision', 'decisions'], rule: ['rule', 'rules'] };

/** A kind's shape, centred on (cx, cy): intel a dot, a decision a diamond, a rule a triangle, kills a small area. */
function shapePath(kind: LegendKind, cx: number, cy: number, r = 4): string {
  if (kind === 'dec') return `M ${cx} ${cy - r - 0.5} L ${cx + r + 0.5} ${cy} L ${cx} ${cy + r + 0.5} L ${cx - r - 0.5} ${cy} Z`;
  if (kind === 'rule') return `M ${cx} ${cy - r - 0.5} L ${cx + r + 0.5} ${cy + r - 0.5} L ${cx - r - 0.5} ${cy + r - 0.5} Z`;
  if (kind === 'eng') return `M ${cx - r - 1} ${cy + r} L ${cx - 2} ${cy - r + 1} L ${cx + 1} ${cy + 1} L ${cx + r + 1} ${cy - r} L ${cx + r + 1} ${cy + r} Z`;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}
function Glyph({ kind, color }: { kind: LegendKind; color: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}>
      <path d={shapePath(kind, 6, 6, 4)} style={{ fill: color, opacity: kind === 'eng' ? 0.75 : 1 }} />
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

/** A smooth area over the per-column counts: the engagements' density, at most `tall` high. */
function densityPath(cols: Array<[number, number]>, base: number, tall: number, max: number): { area: string; line: string } | null {
  if (!cols.length) return null;
  const pts = cols.map(([b, n]) => [b * 3 + 1, base - Math.max(2, (n / max) * tall)] as const);
  let line = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    line += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  const first = pts[0]![0];
  const last = pts[pts.length - 1]![0];
  return { line, area: `M ${first} ${base} L ${first} ${pts[0]![1]} ${line.replace(/^M [^C]*/, '')} L ${last} ${base} Z` };
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
  const [hidden, setHidden] = useState<ReadonlySet<LegendKind>>(new Set());
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
  const labelled = useMemo(() => {
    const breaks = scale.px.slice(1).map((p) => p.x0);
    return placeTicks(
      ticks.filter((k) => k.label && !breaks.some((b) => Math.abs(scale.x(k.t) - b) < 14)).map((k) => ({ t: k.t, label: k.label, major: k.major })),
      scale.x,
    );
  }, [ticks, scale]);

  // Everything received by the picture time, counted for the legend; the row draws what is not hidden.
  const lanes = useMemo(() => {
    const items: Array<{ kind: EventKind; x: number; rec: JournalRecord }> = [];
    const counts: Record<LegendKind, number> = { frag: 0, dec: 0, rule: 0, eng: 0 };
    const kills = new Map<number, number>();
    for (const r of events) {
      let kind: EventKind | null = null;
      if (r.kind === 'fragment') kind = 'frag';
      else if (r.kind === 'decision') kind = 'dec';
      else if (r.kind === 'rule_fire') kind = 'rule';
      else if (r.kind === 'engagement' && (r.payload as EngagementPayload).result === 'kill') {
        counts.eng += 1;
        const b = Math.floor(scale.x(r.ingest_time) / 3);
        kills.set(b, (kills.get(b) ?? 0) + 1);
      }
      if (kind) {
        counts[kind] += 1;
        items.push({ kind, x: scale.x(r.ingest_time), rec: r });
      }
    }
    return { items, counts, kills, killCols: [...kills].sort((a, b) => a[0] - b[0]), maxKill: Math.max(1, ...kills.values()) };
  }, [events, scale]);
  const buckets = useMemo(() => bucketEvents(lanes.items.filter((i) => !hidden.has(i.kind)), MERGE_PX).sort((a, b) => KIND_PRIORITY[a.top] - KIND_PRIORITY[b.top]), [lanes, hidden]);
  const density = useMemo(() => (hidden.has('eng') ? null : densityPath(lanes.killCols, HEIGHT_OPEN - 1, KILL_MAX_H, lanes.maxKill)), [lanes, hidden]);
  const frameXs = useMemo(() => bookmarks.map((b) => ({ id: b.id, x: scale.x(b.t), t: b.t })), [bookmarks, scale]);

  if (!s) return null;
  const HEIGHT = HEIGHT_OPEN;
  const shownT = drag !== null ? drag : t;
  const playX = scale.x(shownT);
  const compact = width < NARROW;
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
  const idx = current ? bookmarks.findIndex((b) => b.id === current) : -1;
  const dense = scale.px.find((p) => p.dense);
  const lo = segs[0]?.t0 ?? 0;
  const hi = segs[segs.length - 1]?.t1 ?? 0;
  const days = [-3, -2, -1, 0, 1].map((d) => ({ t: s.clock.d0 + d * DAY, label: d === 0 ? 'D' : `D${d > 0 ? '+' : ''}${d}` })).filter((d) => d.t >= lo && d.t <= hi);
  const readoutLabel = raidLabel(shownT, s.clock);

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
        <Tooltip content={clock.playing ? 'Pause (Space)' : 'Play (Space)'}>
          <Button iconOnly size="sm" variant="primary" tone="brand" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => (clock.playing ? client.pause() : client.play(rate))}>
            {clock.playing ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tooltip>
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
          <DropdownMenuOverlay placement="top-start">
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
        {bookmarks.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button size="sm" variant="secondary" tone="neutral" leadingIcon={<BookmarkIcon size={14} />} trailingIcon={<ChevronDown size={14} />} aria-label="Storyboard frames">
                {current ? (compact ? current : `${current} · ${bookmarks[idx]?.label ?? ''}`) : 'Frames'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuOverlay placement="top-start">
              <ActionList accessibilityLabel="Storyboard frames">
                {bookmarks.map((b) => (
                  <ActionListItem key={b.id} value={b.id} title={`${b.id} · ${b.label}`} description={raidLabel(b.t, s.clock)} isSelected={b.id === current} onClick={() => onBookmark?.(b)} />
                ))}
              </ActionList>
            </DropdownMenuOverlay>
          </DropdownMenu>
        ) : null}
        {clock.mode === 'live' ? (
          <Badge size="Small" color="Positive" emphasis="Subtle" label="LIVE" />
        ) : (
          <Tooltip content="Follow the live head">
            <Button size="sm" variant="ghost" tone="neutral" leadingIcon={<Radio size={14} />} aria-label="Live" onClick={() => client.live()}>
              Live
            </Button>
          </Tooltip>
        )}
        <span className="bs-tl__legend" role="group" aria-label="Event kinds shown on the timeline">
          {LEGEND.map((l) => {
            const on = !hidden.has(l.id);
            return (
              <Tooltip key={l.id} content={`${l.label}: ${on ? 'shown' : 'hidden'}`}>
                <Button
                  size="xs"
                  variant="ghost"
                  tone="neutral"
                  aria-pressed={on}
                  aria-label={`${l.label} ${lanes.counts[l.id]}`}
                  leadingIcon={<Glyph kind={l.id} color={l.color} />}
                  onClick={() => setHidden(new Set(on ? [...hidden, l.id] : [...hidden].filter((k) => k !== l.id)))}
                >
                  {compact ? undefined : lanes.counts[l.id]}
                </Button>
              </Tooltip>
            );
          })}
        </span>
        <span className="bs-fill" />
        <span className="bs-tl__readout" aria-label="Picture time">
          <span className="BodyMediumSemibold bs-num">{readoutLabel}</span>
        </span>
      </div>
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
          if (y >= RULER) {
            // On the event row: the marker nearest the pointer, within 7 px.
            const b = nearestBucket(buckets, x, 7);
            if (b) return bucketCard(e, b);
            const k = (lanes.kills.get(Math.floor(x / 3) - 1) ?? 0) + (lanes.kills.get(Math.floor(x / 3)) ?? 0) + (lanes.kills.get(Math.floor(x / 3) + 1) ?? 0);
            if (k > 0 && !hidden.has('eng')) return setHover({ x, y, kind: 'Kills', title: `${k} here`, at: tt });
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
          {/* The raid window: a band on tier A with a faint tint under it. */}
          {dense ? (
            <g>
              <rect x={dense.x0} y={A0} width={dense.x1 - dense.x0} height={TIER_A - A0} rx={3} style={{ fill: 'var(--background-brand-faded)', opacity: 0.9 }} />
              <rect x={dense.x0} y={RULER} width={dense.x1 - dense.x0} height={EVENTS_H} style={{ fill: 'var(--background-brand-faded)', opacity: 0.35 }} />
            </g>
          ) : null}
          {/* The day names, above tier A, so the playhead handle and the frame ticks never cover them. */}
          {days.map((d) => (
            <text key={d.label} x={scale.x(d.t) + 4} y={10} className="BodyXSmallMedium" style={{ fill: 'var(--text-neutral-normal)' }}>
              {d.label}
            </text>
          ))}
          {/* The ruler's baseline, with short tick marks on it. */}
          <line x1={PAD} x2={width - PAD} y1={RULER} y2={RULER} style={{ stroke: 'var(--border-neutral-highlighted)' }} />
          {ticks.map((k) => (
            <line key={k.t} x1={scale.x(k.t)} x2={scale.x(k.t)} y1={RULER - (k.major ? 5 : 3)} y2={RULER} style={{ stroke: 'var(--border-neutral-highlighted)' }} />
          ))}
          {/* Tier B: tick labels. */}
          {labelled.map((k) => (
            <text key={k.t} x={scale.x(k.t)} y={RULER - 9} textAnchor="middle" className={k.major ? 'BodyXSmallMedium' : 'BodyXSmallRegular'} style={{ fill: k.major ? 'var(--text-neutral-normal)' : 'var(--text-neutral-muted)' }}>
              {k.label}
            </text>
          ))}
          {/* Storyboard frames: ticks on tier A's lower edge; the current, hovered and snapped one named. */}
          {bookmarks.map((b) => {
            const x = scale.x(b.t);
            const isCurrent = b.id === current;
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
                <rect x={x - 5} y={A0} width={10} height={TIER_A - A0 + 2} style={{ fill: 'transparent' }} />
                <line x1={x} x2={x} y1={A0 + (lit ? 4 : 10)} y2={TIER_A} style={{ stroke: lit ? 'var(--border-focused)' : 'var(--border-neutral-highlighted)' }} strokeWidth={lit ? 2 : 1} />
                {lit ? (
                  <text x={x + 5} y={A0 + 13} className="BodyXSmallMedium" style={{ fill: 'var(--text-neutral-normal)', paintOrder: 'stroke', stroke: 'var(--background-surface-intense)', strokeWidth: 3 }}>
                    {b.id}
                  </text>
                ) : null}
              </g>
            );
          })}
          <g pointerEvents="none">
            {/* Kills: a thin density under everything. */}
            {density ? (
              <g>
                <path d={density.area} style={{ fill: 'var(--text-negative-normal)', opacity: 0.25 }} />
                <path d={density.line} fill="none" style={{ stroke: 'var(--text-negative-normal)' }} strokeWidth={1.25} strokeLinejoin="round" />
              </g>
            ) : null}
            {/* Events: one baseline; a rule over a decision over intel; the hover card says how many a marker holds. */}
            {buckets.map((b, i) => {
              const cy = RULER + 15;
              const color = b.top === 'rule' ? 'var(--background-negative-default)' : b.top === 'dec' ? 'var(--background-brand-default)' : 'var(--background-notice-default)';
              const near = Math.abs(b.x - playX) <= 6;
              return (
                <path key={i} d={shapePath(b.top, b.x, cy, b.items.length > 1 ? 5 : 4)} strokeLinejoin="round" strokeWidth={1.5} style={{ fill: color, stroke: 'var(--background-surface-intense)', opacity: near ? 0.5 : 1 }} />
              );
            })}
          </g>
          {/* The hover guide. */}
          {hoverX !== null ? <line x1={hoverX} x2={hoverX} y1={TIER_A} y2={HEIGHT} pointerEvents="none" style={{ stroke: 'var(--border-neutral-highlighted)' }} strokeDasharray="2 3" /> : null}
          {/* The playhead: a 2 px line with a round handle; its time is the readout above. */}
          <line x1={playX} x2={playX} y1={A0 + 4} y2={HEIGHT} pointerEvents="none" style={{ stroke: 'var(--border-focused)' }} strokeWidth={2} />
          <circle cx={playX} cy={A0 + 5} r={5} pointerEvents="none" style={{ fill: 'var(--border-focused)', stroke: 'var(--background-surface-intense)' }} strokeWidth={2} />
        </svg>
        {hover && hover.kind !== 'Time' ? <HoverCard hover={hover} width={width} clock={s.clock} /> : null}
      </div>
    </div>
  );
}

/** What is under the pointer: a small FDS Card above it (a frame, a marker's events, the kills). */
function HoverCard({ hover, width, clock }: { hover: Hover; width: number; clock: RaidClock }) {
  const flip = hover.x > width - 280;
  return (
    <div className="bs-tl__card" style={{ left: hover.x + (flip ? -14 : 14), top: Math.max(4, hover.y - 12), transform: `translate(${flip ? '-100%' : '0'}, -100%)` }}>
      <Card padding={12} size="Medium" accessibilityLabel={`${hover.kind}: ${hover.title}`}>
        <div className="bs-tl__cardbody">
          <span className="BodyXSmallRegular bs-muted">{hover.kind}</span>
          <span className="BodySmallSemibold">{hover.title}</span>
          {hover.at !== undefined ? <span className="BodyXSmallRegular bs-muted bs-num">{raidLabel(hover.at, clock)}</span> : null}
        </div>
      </Card>
    </div>
  );
}

/**
 * Timeline: transport (FDS Buttons, rate DropdownMenu) and the event lanes on a segmented time
 * axis that compresses the days and expands the raid window. Lanes: intel fragments,
 * decisions, rule firings, engagement density; storyboard frames tick above them. Only events
 * received by the picture time are drawn (bitemporal); frames span the whole journal.
 *
 * The lanes are the one custom visual besides map symbols: FDS has no timeline-lane
 * component. They use FDS tokens and type classes only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionList, ActionListItem, Button, Divider, DropdownMenu, DropdownMenuOverlay, DropdownMenuTrigger, Indicator, Tooltip } from '@faclon-labs/fds';
import { ChevronDown, Pause, Play, Radio, SkipBack, StepBack, StepForward } from 'lucide-react';
import { DAY, HOUR, MINUTE, formatZulu, type DecisionPayload, type EngagementPayload, type JournalRecord, type RaidClock } from '@me/schema';
import type { Bookmark } from '@me/client';
import { useClient, useClientTick, useEngineTime, useEvents } from '@me/map-react';
import { eventSummary, raidLabel } from './format.ts';

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

/** Day marks, hours before H, quarter-hours in the raid window, hours after. */
function ticksFor(segs: Segment[], clock: RaidClock): Tick[] {
  const out: Tick[] = [];
  const h = clock.h;
  for (let d = -3; d <= 1; d++) out.push({ t: clock.d0 + d * DAY, label: d === 0 ? 'D' : `D${d > 0 ? '+' : ''}${d}`, major: true });
  for (const m of [-6, -4, -2]) out.push({ t: h + m * HOUR, label: `H${m}h`, major: false });
  for (let m = -90; m <= 60; m += 15) out.push({ t: h + m * MINUTE, label: m === 0 ? 'H' : `H${m > 0 ? '+' : ''}${m}`, major: m === 0 || m === -60 || m === -30 });
  for (const hh of [2, 4, 8, 16]) out.push({ t: h + hh * HOUR, label: `H+${hh}h`, major: false });
  const lo = segs[0]?.t0 ?? 0;
  const hi = segs[segs.length - 1]?.t1 ?? 0;
  return out.filter((k) => k.t >= lo && k.t <= hi);
}

/** Labels that fit: major ticks first, then the rest where they do not touch a placed one. */
function placeTicks(ticks: Tick[], x: (t: number) => number): Tick[] {
  const CHAR = 6;
  const placed: Array<[number, number]> = [];
  const out: Tick[] = [];
  for (const k of [...ticks].sort((a, b) => Number(b.major) - Number(a.major))) {
    const a = x(k.t) + 2;
    const b = a + k.label.length * CHAR;
    if (placed.some(([p, q]) => a < q + 4 && b > p - 4)) continue;
    placed.push([a, b]);
    out.push(k);
  }
  return out;
}

/** Playback rates, each with what it means in picture time. */
const RATES: Array<[number, string]> = [
  [1, 'Real time'],
  [10, '10 s per second'],
  [60, '1 min per second'],
  [300, '5 min per second'],
  [1800, '30 min per second'],
];
/** Room on the left for the lane glyphs. */
const GUTTER = 16;
const ROW = { marks: 10, frag: 23, dec: 35, rule: 47, eng: 59, axis: 64 };
const HEIGHT = 80;
const LANE_GLYPHS = [
  ['◆', ROW.frag, 'var(--background-notice-default)', 'Intel fragments'],
  ['◇', ROW.dec, 'var(--background-brand-default)', 'Decisions'],
  ['▲', ROW.rule, 'var(--background-negative-default)', 'Rule firings'],
  ['✕', ROW.eng, 'var(--text-negative-normal)', 'Engagements (kills)'],
] as const;

export function TimeBar({ bookmarks = [], onBookmark }: { bookmarks?: Bookmark[]; onBookmark?: (b: Bookmark) => void }) {
  const client = useClient();
  useClientTick(250);
  const t = useEngineTime(100);
  const events = useEvents(500);
  const [rate, setRate] = useState(60);
  const [hover, setHover] = useState('');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
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
  const scale = useMemo(() => makeScale(segs, GUTTER, width - 2), [segs, width]);
  const ticks = useMemo(() => (s ? placeTicks(ticksFor(segs, s.clock), scale.x) : []), [segs, s, scale]);

  const lanes = useMemo(() => {
    const frags: JournalRecord[] = [];
    const decisions: JournalRecord[] = [];
    const rules: JournalRecord[] = [];
    // Kills per 3 px column.
    const kills = new Map<number, number>();
    for (const r of events) {
      if (r.kind === 'fragment') frags.push(r);
      else if (r.kind === 'decision') decisions.push(r);
      else if (r.kind === 'rule_fire') rules.push(r);
      else if (r.kind === 'engagement' && (r.payload as EngagementPayload).result === 'kill') {
        const b = Math.floor(scale.x(r.ingest_time) / 3);
        kills.set(b, (kills.get(b) ?? 0) + 1);
      }
    }
    return { frags, decisions, rules, kills, maxKill: Math.max(1, ...kills.values()) };
  }, [events, scale]);

  if (!s) return null;
  const playX = scale.x(drag ?? t);
  const timeAt = (clientX: number) => scale.t(clientX - ref.current!.getBoundingClientRect().left);
  const seek = (tt: number, final: boolean) => {
    const now = performance.now();
    if (final || now - lastSeek.current > 150) {
      lastSeek.current = now;
      client.seek(tt);
    }
  };

  return (
    <div className="bs-tl">
      <div className="bs-tl__transport">
        <Tooltip content={clock.playing ? 'Pause (Space)' : 'Play (Space)'}>
          <Button iconOnly size="sm" variant="primary" tone="brand" aria-label={clock.playing ? 'Pause' : 'Play'} onClick={() => (clock.playing ? client.pause() : client.play(rate))}>
            {clock.playing ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tooltip>
        <Indicator color={clock.mode === 'live' ? 'Positive' : 'Information'} size="Small" accessibilityLabel={clock.mode} />
        <Divider orientation="Vertical" height="var(--spacing-20)" />
        <Tooltip content="Start of journal">
          <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label="Start" onClick={() => client.seek(s.t0)}>
            <SkipBack size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Back 1 minute">
          <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label="Back one minute" onClick={() => client.seek(t - MINUTE)}>
            <StepBack size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Forward 1 minute">
          <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label="Forward one minute" onClick={() => client.seek(t + MINUTE)}>
            <StepForward size={14} />
          </Button>
        </Tooltip>
        <DropdownMenu
          selectionType="single"
          value={[String(clock.playing ? clock.rate : rate)]}
          onChange={({ values }) => {
            const r = Number(values[0] ?? rate);
            setRate(r);
            if (clock.playing) client.play(r);
          }}
        >
          <DropdownMenuTrigger>
            <Button size="xs" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label={`Playback rate ${clock.playing ? clock.rate : rate}×`}>
              {`${clock.playing ? clock.rate : rate}×`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="top-start">
            <ActionList accessibilityLabel="Playback rate">
              {RATES.map(([r, hint]) => (
                <ActionListItem key={r} value={String(r)} title={`${r}×`} description={hint} />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        <Button
          size="xs"
          variant="secondary"
          tone="neutral"
          onClick={() => {
            client.seek(t - 30 * MINUTE);
            client.play(60);
          }}
        >
          Replay last 30 min
        </Button>
        <Tooltip content="Follow the live head">
          <Button iconOnly size="xs" variant="ghost" tone="neutral" aria-label="Live" onClick={() => client.live()}>
            <Radio size={14} />
          </Button>
        </Tooltip>
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
          const tt = timeAt(e.clientX);
          setDrag(tt);
          seek(tt, false);
        }}
        onPointerMove={(e) => {
          const tt = timeAt(e.clientX);
          setHoverX(e.clientX - ref.current!.getBoundingClientRect().left);
          if (drag !== null) {
            setDrag(tt);
            seek(tt, false);
          }
          if (!(e.target as Element).closest?.('[data-tip]')) setHover(raidLabel(tt, s.clock));
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          seek(timeAt(e.clientX), true);
          setDrag(null);
        }}
        onPointerLeave={() => {
          setHover('');
          setHoverX(null);
        }}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden>
          {scale.px.map((p, i) => (p.dense ? <rect key={i} x={p.x0} y={0} width={p.x1 - p.x0} height={ROW.axis} style={{ fill: 'var(--background-surface-subtle)' }} /> : null))}
          {scale.px.slice(1).map((p, i) => (
            <line key={i} x1={p.x0} x2={p.x0} y1={0} y2={ROW.axis} style={{ stroke: 'var(--border-neutral-default)' }} strokeDasharray="2 3" />
          ))}
          <line x1={GUTTER} x2={width} y1={ROW.axis} y2={ROW.axis} style={{ stroke: 'var(--border-neutral-default)' }} />
          {ticks.map((k) => (
            <g key={k.label}>
              <line x1={scale.x(k.t)} x2={scale.x(k.t)} y1={ROW.axis} y2={ROW.axis + 3} style={{ stroke: 'var(--border-neutral-highlighted)' }} />
              <text x={scale.x(k.t) + 2} y={HEIGHT - 2} className={k.major ? 'BodyXSmallMedium' : 'BodyXSmallRegular'} style={{ fill: k.major ? 'var(--text-neutral-normal)' : 'var(--text-neutral-muted)' }}>
                {k.label}
              </text>
            </g>
          ))}
          {LANE_GLYPHS.map(([g, y, fill, name]) => (
            <text key={g} x={2} y={y + 4} className="BodyXSmallRegular" style={{ fill }} data-tip onPointerEnter={() => setHover(name)}>
              {g}
            </text>
          ))}
          {bookmarks.map((b, i) => {
            // Frame labels stagger onto a second row where they crowd.
            const x = scale.x(b.t);
            const prev = i > 0 ? scale.x(bookmarks[i - 1]!.t) : -Infinity;
            const row = x - prev < 20 && i % 2 === 1 ? 1 : 0;
            return (
              <g
                key={b.id}
                className="bs-tl__frame"
                data-tip
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onBookmark?.(b);
                }}
                onPointerEnter={() => setHover(`${b.id} · ${b.label}`)}
              >
                <line x1={x} x2={x} y1={ROW.marks + 2} y2={ROW.axis} style={{ stroke: 'var(--border-neutral-highlighted)' }} />
                <text x={x + 2} y={ROW.marks - 1 + row * 8} className="BodyXSmallMedium" style={{ fill: 'var(--text-neutral-subtle)' }}>
                  {b.id}
                </text>
              </g>
            );
          })}
          {lanes.frags.map((r) => (
            <text key={r.record_id} x={scale.x(r.ingest_time) - 4} y={ROW.frag + 4} className="BodyXSmallRegular" style={{ fill: 'var(--background-notice-default)' }} data-tip onPointerEnter={() => setHover(eventSummary(r).title)}>
              ◆
            </text>
          ))}
          {lanes.decisions.map((r) => {
            const p = r.payload as DecisionPayload;
            return (
              <text key={r.record_id} x={scale.x(r.ingest_time) - 4} y={ROW.dec + 4} className="BodyXSmallRegular" style={{ fill: p.status === 'option' ? 'var(--text-neutral-muted)' : 'var(--background-brand-default)' }} data-tip onPointerEnter={() => setHover(`${p.dp} · ${p.title}`)}>
                ◇
              </text>
            );
          })}
          {lanes.rules.map((r) => (
            <text key={r.record_id} x={scale.x(r.ingest_time) - 4} y={ROW.rule + 4} className="BodyXSmallRegular" style={{ fill: 'var(--background-negative-default)' }} data-tip onPointerEnter={() => setHover(eventSummary(r).title)}>
              ▲
            </text>
          ))}
          {[...lanes.kills].map(([b, n]) => {
            const h = Math.max(2, (n / lanes.maxKill) * 10);
            return <rect key={b} x={b * 3} y={ROW.eng + 4 - h} width={2} height={h} style={{ fill: 'var(--text-negative-normal)' }} />;
          })}
          {hoverX !== null && hover ? <HoverReadout x={hoverX} width={width} text={hover} /> : null}
          <line x1={playX} x2={playX} y1={0} y2={ROW.axis} style={{ stroke: 'var(--border-focused)' }} strokeWidth={2} />
          <path d={`M ${playX - 4} 0 L ${playX + 4} 0 L ${playX} 5 Z`} style={{ fill: 'var(--border-focused)' }} />
          <PlayheadTag x={playX} width={width} text={`${raidLabel(drag !== null ? scale.t(drag) : t, s.clock)} · ${formatZulu(drag !== null ? scale.t(drag) : t).slice(0, 5)}Z`} />
        </svg>
      </div>
    </div>
  );
}

/** The picture time, on the playhead's foot over the axis: it moves with the time it names. */
function PlayheadTag({ x, width, text }: { x: number; width: number; text: string }) {
  const w = text.length * 6 + 10;
  const left = Math.max(GUTTER, Math.min(width - w - 1, x - w / 2));
  return (
    <g pointerEvents="none">
      {/* Solid brand fill: it must cover the tick labels it sits on. */}
      <rect x={left} y={ROW.axis + 1} width={w} height={13} rx={2} style={{ fill: 'var(--background-brand-default)' }} />
      <text x={left + 5} y={ROW.axis + 11} className="BodyXSmallMedium" style={{ fill: 'var(--text-static-white-normal)' }}>
        {text}
      </text>
    </g>
  );
}

/** What is under the pointer (a time, a frame, an event), beside it and inside the lanes. */
function HoverReadout({ x, width, text }: { x: number; width: number; text: string }) {
  const w = text.length * 6 + 8;
  const left = x + 8 + w > width ? x - 8 - w : x + 8;
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={0} y2={ROW.axis} style={{ stroke: 'var(--border-neutral-highlighted)' }} strokeDasharray="2 2" />
      <rect x={left} y={ROW.rule - 9} width={w} height={14} rx={2} style={{ fill: 'var(--background-surface-intense)', stroke: 'var(--border-neutral-default)' }} />
      <text x={left + 4} y={ROW.rule + 2} className="BodyXSmallMedium" style={{ fill: 'var(--text-neutral-normal)' }}>
        {text}
      </text>
    </g>
  );
}

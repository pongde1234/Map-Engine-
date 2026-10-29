/**
 * Map hover card: what is under the pointer, without selecting it. An FDS Card beside the
 * pointer with the object's kind and name, then at most four facts for its kind (a track's range
 * from the defended point and speed, a fire unit's channels and rounds, a zone's type and size).
 * The Inspector keeps the full record; the card is a glance. Placed inside the map container.
 */
import { useEffect, useRef, useState } from 'react';
import { Card } from '@faclon-labs/fds';
import type { Entity } from '@me/schema';
import { formatRangeBearing, headingSpeed, inverse } from '@me/geo';
import type { MapClient } from '@me/client';
import { useClient, useEngineTime, useView } from '@me/map-react';
import { Facts, type Fact } from './Facts.tsx';
import { GEO_WORD, entityTitle, kindWord, shapeSummary } from './Inspector.tsx';
import { raidLabel } from './format.ts';
import { typeClass } from './type.ts';

/** Facts shown at most: a glance, not the record. */
const MAX_FACTS = 4;
/** Card width the flip is judged against (the card's max width). */
const CARD_W = 256;
const GAP = 14;

export function MapHover() {
  const client = useClient();
  const t = useEngineTime();
  const id = useView((s) => s.hovered);
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // The pointer within the map container, once per frame.
  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = host.getBoundingClientRect();
        setAt({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      setAt(null);
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);

  const e = id ? client.entities.get(id) : undefined;
  const show = e && at;
  const flipX = show ? at.x > at.w - CARD_W - GAP * 2 : false;
  const flipY = show ? at.y > at.h / 2 : false;
  const ref = e?.aliases?.track_number;

  return (
    <>
      <span ref={anchor} hidden />
      {show ? (
        <div
          className="bs-hovercard"
          style={{ left: at.x + (flipX ? -GAP : GAP), top: at.y + (flipY ? -GAP : GAP), transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` }}
        >
          <Card padding={12} size="Medium" accessibilityLabel={entityTitle(e)}>
            <div className="bs-hovercard__body">
              <div className="bs-hovercard__head">
                <span className={typeClass('caption', 'muted')}>{ref ? `${kindWord(e)} · ${ref}` : kindWord(e)}</span>
                <span className={typeClass('section')}>{entityTitle(e)}</span>
              </div>
              <Facts flush items={hoverFacts(e, client, t).filter(Boolean).slice(0, MAX_FACTS)} />
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

/** A record's word as text: first letter up, underscores as spaces ("down" → "Down"). */
const sentence = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replaceAll('_', ' ');

/** The facts that say most about this kind of object at a glance, most useful first. */
function hoverFacts(e: Entity, client: MapClient, t: number): Fact[] {
  const center = (client.scenario?.center ?? null) as [number, number] | null;
  const loc = e.location ? ([e.location.lon, e.location.lat] as [number, number]) : null;
  const rb = loc && center && !e.geo_shape ? inverse(center, loc) : null;
  const vel = e.location?.vel;
  const moving = !!vel && (vel.e !== 0 || vel.n !== 0);
  const gd = e.geo_details;
  const mag = e.effector?.magazine;
  const cap = mag ? (mag.capacity ?? mag.ready + mag.reserve) : 0;
  return [
    // Tracks and raid groups.
    rb && (e.ontology?.template === 'track' || e.group) && ['From VP', formatRangeBearing(rb.distance_m, rb.azimuth_deg)],
    moving && ['Speed', `${Math.round(Math.hypot(vel.e, vel.n) * 3.6)} km/h`],
    e.location?.hae !== undefined && e.ontology?.template === 'track' && ['Altitude', `${Math.round(e.location.hae)} m`],
    moving && e.ontology?.template === 'track' && ['Heading', `${String(Math.round(headingSpeed(vel).heading) % 360).padStart(3, '0')}°`],
    e.group && ['Members', String(e.group.members.length)],
    (e.track?.axis ?? e.group?.axis) && ['Axis · wave', `${e.track?.axis ?? e.group?.axis} · ${e.track?.wave ?? e.group?.wave ?? '—'}`],
    // Fire units.
    e.effector && ['Status', sentence(e.effector.status)],
    e.effector && ['Channels', `${e.effector.channels.busy} / ${e.effector.channels.total}`],
    mag && ['Rounds ready', `${mag.ready} / ${cap} · floor ${mag.floor}`],
    e.effector?.wez && ['Range', `${Math.round(e.effector.wez.max_m / 1000)} km`],
    // Sensors and plant.
    e.sensor && ['Sensor', e.sensor.type.replaceAll('_', ' ')],
    e.sensor && ['Range', `${Math.round((e.sensor.range_m ?? 0) / 1000)} km`],
    e.sensor && ['Status', sentence(e.health?.link ?? e.sensor.status)],
    e.plant && ['Tier', `Tier ${e.plant.tier}`],
    e.plant && ['State', e.plant.state.replaceAll('_', ' ')],
    // Intel fragments.
    e.fragment && ['Source', e.fragment.source_kind.replaceAll('_', ' ')],
    e.fragment && ['Confidence', sentence(e.fragment.confidence)],
    // Command and drawn objects.
    gd && e.geo_shape && ['Type', GEO_WORD[gd.type] ?? gd.type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())],
    gd?.ring && ['Ring', gd.ring],
    gd?.wcs && ['Weapons control', sentence(gd.wcs)],
    gd?.tot !== undefined && ['Time on target', `${raidLabel(gd.tot, client.scenario?.clock)} · ${gd.tot > t ? `in ${Math.ceil((gd.tot - t) / 60_000)} min` : 'passed'}`, 'wide'],
    e.geo_shape && ['Size', shapeSummary(e.geo_shape), 'wide'],
  ];
}

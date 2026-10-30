/**
 * Decision System Assistant (adapter stub). Until Bruce is connected through the Faclon
 * adapter, questions are answered from the live picture with a fixed set of read-only tools;
 * every call is returned so the console shows it. The assistant describes the picture and its
 * freshness; it never proposes targets or courses of action.
 *
 * Decision questions (J1–J8) are standing questions with a live answerability: each names the
 * picture layers it reads, and is answerable while the worst of them is current or aging.
 */
import { CLASSES, formatRaidClock, type AgeState, type Entity, type JournalRecord, type RuleFirePayload } from '@me/schema';
import { formatDistance, inverse } from '@me/geo';
import type { MapClient } from '@me/client';
import type { LayerKey } from '@me/map';
import type { Derived } from './derived.ts';
import { ageLabel } from './age.ts';
import { magState } from './magazine.ts';

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface Answer {
  tools: ToolCall[];
  /** Markdown. */
  text: string;
  /** Entities the answer cites. */
  cites: string[];
  /** Picture time the tools read (stamped on every answer). */
  asOf: number;
}

export type Answerability = 'answerable' | 'partial' | 'unanswerable';

export interface DecisionQuestion {
  id: string;
  title: string;
  /** The live headline figure. */
  metric: string;
  answerability: Answerability;
  /** Age of the stalest input layer. */
  worst: string;
  inputs: LayerKey[];
}

const STATE_RANK: Record<AgeState, number> = { current: 0, aging: 1, stale: 2, disc: 3 };

function worstInput(derived: Derived, inputs: LayerKey[]): { state: AgeState; age: number } {
  let state: AgeState = 'current';
  let age = 0;
  let any = false;
  for (const k of inputs) {
    // Planned command objects do not age; only live layers make an answer stale.
    if (k.startsWith('command.')) continue;
    const st = derived.byKey[k];
    if (!st || !st.count) continue;
    any = true;
    if (STATE_RANK[st.newestState] > STATE_RANK[state] || (st.newestState === state && st.newestAge > age)) {
      state = st.newestState;
      age = st.newestAge;
    }
  }
  // No objects on any input layer is an answer (none present), not a stale input.
  return any ? { state, age } : { state: 'current', age: -1 };
}

const answerabilityOf = (s: AgeState): Answerability => (s === 'current' || s === 'aging' ? 'answerable' : s === 'stale' ? 'partial' : 'unanswerable');

/** The standing decision questions, evaluated on the picture now. */
export function decisionQuestions(client: MapClient, derived: Derived): DecisionQuestion[] {
  const threat = derived.hostile;
  const channels = derived.effectors.filter((e) => e.effector?.type === 'interceptor_drone').reduce((a, e) => a + (e.effector?.channels.total ?? 0), 0);
  const low = derived.effectors.filter((e) => {
    const m = e.effector?.magazine;
    return m && m.ready < 900 && magState(m.ready, m.floor, m.capacity ?? m.ready + m.reserve) !== 'ok';
  }).length;
  let civilIn = 0;
  let sensorsDown = 0;
  let sensors = 0;
  let plantNotRunning = 0;
  for (const e of client.entities.values()) {
    if (e.ontology?.class === 'civil_air' && e.location && inverse(derived.center, [e.location.lon, e.location.lat]).distance_m < 60_000) civilIn++;
    if (e.ontology?.template === 'sensor') {
      sensors++;
      if ((e.health?.link ?? e.sensor?.status) !== 'up') sensorsDown++;
    }
    if (e.plant && e.plant.state !== 'running') plantNotRunning++;
  }
  const defs: Array<Omit<DecisionQuestion, 'answerability' | 'worst'>> = [
    { id: 'J1', title: 'Common operating picture', metric: `Tracks in picture: ${derived.tracks}`, inputs: ['fused.threats', 'fused.blue', 'fused.civil', 'fused.maritime'] },
    { id: 'J2', title: 'Air-picture integrity', metric: `Contested tracks: ${derived.contested}`, inputs: ['fused.threats', 'observation.plots'] },
    { id: 'J3', title: 'Raid composition and axes', metric: `Raid groups: ${derived.groups.length} · hostile: ${threat}`, inputs: ['fused.threats', 'fused.groups'] },
    { id: 'J4', title: 'Saturation of the inner rings', metric: `Hostile in R3: ${derived.rings.R3} / ${channels} channels`, inputs: ['fused.threats', 'fused.blue'] },
    { id: 'J5', title: 'Readiness against threat', metric: `Fire units low or at floor: ${low}`, inputs: ['fused.blue'] },
    { id: 'J6', title: 'Civil deconfliction', metric: `Civil tracks within R3: ${civilIn}`, inputs: ['fused.civil', 'command.restrictions'] },
    { id: 'J7', title: 'Defended point and plant', metric: `Plant units not running: ${plantNotRunning}`, inputs: ['reference.vp'] },
    { id: 'J8', title: 'Sensor coverage and health', metric: `Sensors degraded or down: ${sensorsDown} / ${sensors}`, inputs: ['fused.blue', 'observation.plots'] },
  ];
  return defs.map((d) => {
    const w = worstInput(derived, d.inputs);
    return { ...d, answerability: answerabilityOf(w.state), worst: w.age < 0 ? 'none present' : ageLabel(w.age, w.state).toLowerCase() };
  });
}

// ------------------------------------------------------------------ tools (read-only)

function picture_summary(derived: Derived): ToolCall {
  return {
    name: 'picture_summary',
    input: {},
    output: { tracks: derived.tracks, hostile: derived.hostile, contested: derived.contested, stale: derived.stale, rings: derived.rings, raid_groups: derived.groups.length, rules_active: derived.activeRules.length },
  };
}

function list_feeds(derived: Derived, filter?: string): ToolCall {
  const feeds = derived.sources
    .filter((f) => !filter || f.feed.toLowerCase().includes(filter))
    .map((f) => ({ feed: f.feed, objects: f.count, per_min: f.perMin, newest: f.planned ? 'planned' : ageLabel(f.newestAge, f.newestState).toLowerCase(), state: f.planned ? 'static' : f.newestState }));
  return { name: 'list_feeds', input: filter ? { filter } : {}, output: feeds };
}

function query_tracks(client: MapClient, derived: Derived, identities: string[]): ToolCall {
  const rows: Array<{ id: string; class: string; identity: string; range_km: number; bearing: number }> = [];
  for (const e of client.entities.values()) {
    if (e.layer !== 'fused' || e.ontology?.template !== 'track' || !e.location) continue;
    if (!identities.includes(e.mil_view?.identity ?? '')) continue;
    if (e.track?.state === 'destroyed') continue;
    const inv = inverse(derived.center, [e.location.lon, e.location.lat]);
    rows.push({ id: e.aliases?.track_number ?? e.entity_id, class: CLASSES[e.ontology?.class ?? '']?.label ?? e.ontology?.class ?? '', identity: e.mil_view?.identity ?? '', range_km: Math.round(inv.distance_m / 100) / 10, bearing: Math.round(inv.azimuth_deg) });
  }
  rows.sort((a, b) => a.range_km - b.range_km);
  return { name: 'query_tracks', input: { identity: identities }, output: { count: rows.length, nearest: rows.slice(0, 8) } };
}

function fire_units(derived: Derived): ToolCall {
  return {
    name: 'fire_units',
    input: {},
    output: derived.effectors
      .filter((e) => e.effector && e.effector.magazine.ready < 900)
      .map((e) => {
        const m = e.effector!.magazine;
        const cap = m.capacity ?? m.ready + m.reserve;
        return { unit: e.aliases?.callsign ?? e.aliases?.name ?? e.entity_id, channels: `${e.effector!.channels.busy}/${e.effector!.channels.total}`, ready: m.ready, capacity: cap, floor: m.floor, state: magState(m.ready, m.floor, cap), status: e.effector!.status };
      }),
  };
}

function active_rules(derived: Derived): ToolCall {
  return {
    name: 'active_rules',
    input: {},
    output: derived.activeRules.map((r: JournalRecord<RuleFirePayload>) => ({ rule: r.payload.rule, value: r.payload.value, threshold: r.payload.threshold, note: r.payload.note, record: r.record_id })),
  };
}

function get_entity(client: MapClient, id: string): ToolCall {
  const e = client.entities.get(id) ?? [...client.entities.values()].find((x) => x.aliases?.track_number === id || x.aliases?.callsign?.toLowerCase() === id.toLowerCase());
  return { name: 'get_entity', input: { id }, output: e ? summarize(e) : { error: 'not in the picture at this time' } };
}

function summarize(e: Entity): Record<string, unknown> {
  return {
    id: e.entity_id,
    name: e.aliases?.name ?? e.aliases?.track_number,
    class: CLASSES[e.ontology?.class ?? '']?.label ?? e.ontology?.class,
    identity: e.mil_view?.identity,
    contested: e.classification?.contested,
    hypotheses: e.classification?.hypotheses.map((h) => `${h.label} ${h.p.toFixed(2)}`),
    state: e.track?.state ?? e.effector?.status ?? e.plant?.state ?? e.geo_details?.status,
    feed: e.provenance.source_feed,
    version: e.version,
  };
}

function nameOf(client: MapClient, id: string): string {
  const x = client.entities.get(id);
  return x?.aliases?.callsign ?? x?.aliases?.track_number ?? x?.aliases?.name ?? id;
}

/** Everything the record says about one object: identity, evidence, source, rules and engagements. */
function explain(id: string, client: MapClient): Omit<Answer, 'asOf'> {
  const e = client.entities.get(id) ?? [...client.entities.values()].find((x) => x.aliases?.track_number === id || x.aliases?.callsign?.toLowerCase() === id.toLowerCase());
  const call = get_entity(client, id);
  if (!e) return { tools: [call], text: `${id} is not in the picture at this time.`, cites: [] };
  const related = client.events.filter((r) => {
    const p = r.payload as { target_id?: string; effector_id?: string; subject_ids?: string[] };
    return r.entity_id === e.entity_id || p?.target_id === e.entity_id || p?.effector_id === e.entity_id || p?.subject_ids?.includes(e.entity_id);
  });
  const records: ToolCall = {
    name: 'records_naming',
    input: { id: e.entity_id },
    output: related.slice(-12).map((r) => ({ kind: r.kind, record: r.record_id, at: r.ingest_time, summary: (r.payload as { note?: string; title?: string; result?: string }).note ?? (r.payload as { title?: string }).title ?? (r.payload as { result?: string }).result })),
  };
  const lines: string[] = [];
  const cls = CLASSES[e.ontology?.class ?? '']?.label ?? e.ontology?.class ?? e.ontology?.template ?? 'object';
  lines.push(`**${e.aliases?.track_number ?? e.entity_id}** is a ${cls}${e.mil_view ? `, identity **${e.mil_view.identity.replace('_', ' ')}**` : ''}${e.classification?.contested ? ', **contested**' : ''}.`);
  if (e.classification?.hypotheses.length) lines.push(`\n**Hypotheses** (margin ${e.classification.margin.toFixed(2)}): ${e.classification.hypotheses.map((h) => `${h.label} ${h.p.toFixed(2)}`).join(' · ')}. ${e.classification.contested ? 'They stay separate until an operator adjudicates.' : ''}`);
  const sensors = (e.track?.contributing ?? []).map((s) => nameOf(client, s));
  lines.push(`\n**Evidence**: ${sensors.length ? `observed by ${sensors.join(', ')}` : 'no contributing sensor listed'}${e.track?.sensor_classes?.length ? ` (${e.track.sensor_classes.join(' + ')})` : ''}.`);
  lines.push(`\n**Source**: ${e.provenance.source_feed}${e.track?.fusion_method ? `, fused by ${e.track.fusion_method}` : ''}; record version ${e.version}.`);
  const rules = related.filter((r) => r.kind === 'rule_fire');
  const eng = related.filter((r) => r.kind === 'engagement');
  if (rules.length) lines.push(`\n**Rules naming it**: ${rules.slice(-3).map((r) => (r.payload as RuleFirePayload).note ?? (r.payload as RuleFirePayload).rule).join(' · ')}.`);
  if (eng.length) lines.push(`\n**Engagements**: ${eng.slice(-4).map((r) => { const p = r.payload as { result: string; effector_id: string; target_id: string }; return p.target_id === e.entity_id ? `${p.result} by ${nameOf(client, p.effector_id)}` : `${p.result} ${nameOf(client, p.target_id)}`; }).join(' · ')}.`);
  return { tools: [call, records], text: lines.join('\n'), cites: [e.entity_id, ...new Set(eng.map((r) => (r.payload as { effector_id: string }).effector_id).filter((x) => x !== e.entity_id))].slice(0, 6) };
}

/** Decision points so far, newest first, each with the authority the record names. */
function decisions(client: MapClient): Omit<Answer, 'asOf'> {
  const ds = client.events.filter((r) => r.kind === 'decision') as Array<JournalRecord<{ dp: string; title: string; layer: string; status: string; authority?: string }>>;
  const call: ToolCall = { name: 'decisions', input: {}, output: ds.map((r) => ({ dp: r.payload.dp, title: r.payload.title, status: r.payload.status, layer: r.payload.layer, authority: r.payload.authority, record: r.record_id, at: r.ingest_time })) };
  const dp7 = [...ds].reverse().find((r) => r.payload.dp === 'DP-7');
  const holder = dp7?.payload.status === 'delegated' ? `delegated to the fire units (${dp7.payload.title})` : 'held at L3, AD Direction Centre';
  const clock = client.scenario?.clock;
  const rows = [...ds].reverse().slice(0, 10).map((r) => `- **${r.payload.dp}** ${r.payload.title} — ${r.payload.status}, ${r.payload.layer}${r.payload.authority ? ` · ${r.payload.authority}` : ''}${clock ? ` · ${formatRaidClock(r.ingest_time, clock)}` : ''}`);
  return { tools: [call], text: `Engagement authority is **${holder}**.\n\n${ds.length ? `Decisions on record (newest first):\n\n${rows.join('\n')}` : 'No decision has been recorded yet.'}`, cites: [] };
}

/** A watch-handover SITREP: what changed in the last `mins` minutes, and the picture now. */
function sitrep(client: MapClient, derived: Derived, mins: number): Omit<Answer, 'asOf'> {
  const now = client.now();
  const from = now - mins * 60_000;
  const recent = client.events.filter((r) => r.ingest_time > from && r.ingest_time <= now);
  const count = (k: JournalRecord['kind']) => recent.filter((r) => r.kind === k).length;
  const kills = recent.filter((r) => r.kind === 'engagement' && (r.payload as { result: string }).result === 'kill').length;
  const fired = recent.filter((r) => r.kind === 'rule_fire' && (r.payload as RuleFirePayload).state === 'fired');
  const ds = recent.filter((r) => r.kind === 'decision');
  const clock = client.scenario?.clock;
  const call: ToolCall = {
    name: 'sitrep',
    input: { minutes: mins },
    output: { window: [from, now], fragments: count('fragment'), decisions: ds.length, rules_fired: fired.length, kills, bda: count('bda'), picture: { tracks: derived.tracks, hostile: derived.hostile, contested: derived.contested, rings: derived.rings } },
  };
  const span = clock ? `${formatRaidClock(from, clock)} to ${formatRaidClock(now, clock)}` : `last ${mins} min`;
  const text = [
    `**SITREP · ${span}**`,
    `\n**Picture now**: ${derived.tracks} tracks, ${derived.hostile} hostile (R4 ${derived.rings.R4} · R3 ${derived.rings.R3} · R2 ${derived.rings.R2} · R1 ${derived.rings.R1}), ${derived.contested} contested, ${derived.groups.length} raid groups.`,
    `\n**Rules**: ${fired.length ? fired.map((r) => `${(r.payload as RuleFirePayload).rule.replaceAll('_', ' ')}${(r.payload as RuleFirePayload).value !== undefined ? ` ${(r.payload as RuleFirePayload).value}` : ''}`).join(' · ') : 'none fired'}; ${derived.activeRules.length} active now.`,
    `\n**Decisions**: ${ds.length ? ds.map((r) => `${(r.payload as { dp: string; title: string }).dp} ${(r.payload as { title: string }).title}`).join(' · ') : 'none recorded'}.`,
    `\n**Engagements**: ${kills} kills${count('bda') ? `, ${count('bda')} damage assessments` : ''}.`,
    `\n**Intel**: ${count('fragment')} fragments received.`,
  ].join('\n');
  return { tools: [call], text, cites: [] };
}

/** Questions worth asking now, from the picture itself. */
export function suggestionsFor(client: MapClient, derived: Derived): string[] {
  const out: string[] = [];
  const rules = derived.activeRules.map((r) => r.payload.rule);
  if (rules.includes('saturation')) out.push('Which decisions are in force, and who holds engagement authority?');
  const contested = [...client.entities.values()].find((e) => e.classification?.contested && e.layer === 'fused');
  if (contested) out.push(`Explain ${contested.aliases?.track_number ?? contested.entity_id}`);
  out.push('SITREP for the last 15 minutes');
  if (derived.hostile) out.push('Which tracks are hostile or suspect right now, and where?');
  const weak = decisionQuestions(client, derived).find((d) => d.answerability !== 'answerable');
  if (weak) out.push(`Is ${weak.id} ${weak.title.toLowerCase()} answerable now?`);
  out.push('What feeds the air picture and how fresh is it?');
  return [...new Set(out)].slice(0, 4);
}

// ------------------------------------------------------------------ answering

const COA = /\b(should we|recommend|which (target|track) (to|should)|engage first|course of action|what to do|best (option|target))\b/i;

/**
 * What an agent answers about (the drawer's agent selector): the whole picture, a watch handover
 * (what happened over the last minutes), or the decision record (decisions in force, authority).
 * The same read-only tools and the same refusal of courses of action serve all three.
 */
export type AssistantFocus = 'picture' | 'handover' | 'decisions';

/** Answer a question from the picture, stamped with the picture time it was read at. */
export function answer(question: string, client: MapClient, derived: Derived, focus: AssistantFocus = 'picture'): Answer {
  return { ...answerFrom(question, client, derived, focus), asOf: client.now() };
}

function answerFrom(question: string, client: MapClient, derived: Derived, focus: AssistantFocus): Omit<Answer, 'asOf'> {
  const q = question.toLowerCase();
  if (COA.test(question)) {
    return {
      tools: [],
      text: 'I describe the picture, its sources and how fresh they are. I do not propose targets or courses of action: that decision stays with the named authority. I can show the tracks, fire-unit readiness or the rules that have fired, if that helps the decision.',
      cites: [],
    };
  }
  // A handover agent summarises a window of time ("last 30 min"; 15 when none is named).
  if (focus === 'handover') {
    const mins = Number(/(\d+) ?min/.exec(q)?.[1] ?? (/\bhour\b/.test(q) ? 60 : 15));
    return sitrep(client, derived, Math.min(240, Math.max(1, mins)));
  }
  // A decision-record agent reads the decisions in force, unless asked about one object.
  if (focus === 'decisions' && !/\b([A-Z]{1,3}-[A-Z0-9-]{2,})\b/.test(question.replace(/\bDP-?\d+\b/gi, ''))) return decisions(client);

  const jm = /\bj(\d{1,2})\b/i.exec(question);
  if (jm) {
    const dq = decisionQuestions(client, derived).find((d) => d.id === `J${jm[1]}`);
    if (dq) {
      const feeds = list_feeds(derived);
      const verdict = dq.answerability === 'answerable' ? 'answerable now' : dq.answerability === 'partial' ? 'only partly answerable' : 'not answerable';
      return {
        tools: [{ name: 'decision_question', input: { id: dq.id }, output: dq }, feeds],
        text: `**${dq.id} ${dq.title}** is ${verdict}.\n\n- ${dq.metric}\n- Worst input: ${dq.worst} (${dq.inputs.join(', ')})\n\n${dq.answerability === 'answerable' ? 'Every input layer is current or aging.' : 'At least one input layer is stale or has no link; treat the figure as indicative.'}`,
        cites: [],
      };
    }
  }

  // Decision points first: "DP-7" looks like an object id but names a decision.
  if (/decision|\bdp-?\d|authority|delegat|in force/.test(q)) return decisions(client);

  const idm = /\b([A-Z]{1,3}-[A-Z0-9-]{2,})\b/.exec(question);
  if (idm) return explain(idm[1]!, client);

  if (/sitrep|summar|handover|last \d+ ?min|what happened/.test(q)) {
    const mins = Number(/(\d+) ?min/.exec(q)?.[1] ?? 15);
    return sitrep(client, derived, Math.min(240, Math.max(1, mins)));
  }

  if (/fresh|feed|source|stale|age/.test(q)) {
    const filter = /air/.test(q) ? 'air' : /coast|sea|mari|ais|port/.test(q) ? (/ais|port/.test(q) ? 'ais' : 'coast') : /land|ground|army/.test(q) ? 'army' : undefined;
    const call = list_feeds(derived, filter);
    const rows = call.output as Array<{ feed: string; objects: number; per_min: number; newest: string; state: string }>;
    const live = rows.filter((r) => r.state !== 'static');
    const worst = [...live].sort((a, b) => STATE_RANK[b.state as AgeState] - STATE_RANK[a.state as AgeState])[0];
    return {
      tools: [call],
      text: rows.length
        ? `${rows.length} feed${rows.length === 1 ? '' : 's'}${filter ? ` matching “${filter}”` : ''} feed the picture.\n\n${rows.map((r) => `- **${r.feed}**: ${r.objects} objects, ${r.per_min}/min, newest ${r.newest}`).join('\n')}${worst ? `\n\nStalest live feed: **${worst.feed}** (${worst.newest}).` : ''}`
        : `No feed matches “${filter}”.`,
      cites: [],
    };
  }

  if (/hostile|suspect|threat|track|where/.test(q)) {
    const ids = /suspect/.test(q) && !/hostile/.test(q) ? ['suspect'] : ['hostile', 'suspect'];
    const call = query_tracks(client, derived, ids);
    const o = call.output as { count: number; nearest: Array<{ id: string; class: string; range_km: number; bearing: number }> };
    return {
      tools: [call, picture_summary(derived)],
      text: `${o.count} ${ids.join(' or ')} tracks in the picture. By ring: R4 ${derived.rings.R4}, R3 ${derived.rings.R3}, R2 ${derived.rings.R2}, R1 ${derived.rings.R1}.\n\nNearest to the defended point:\n\n${o.nearest.map((r) => `- **${r.id}** ${r.class}: ${formatDistance(r.range_km * 1000)} at ${String(r.bearing).padStart(3, '0')}°`).join('\n') || '- none'}`,
      cites: o.nearest.map((r) => r.id),
    };
  }

  if (/saturat|channel|ring|r3/.test(q)) {
    const fu = fire_units(derived);
    const channels = derived.effectors.filter((e) => e.effector?.type === 'interceptor_drone').reduce((a, e) => a + (e.effector?.channels.total ?? 0), 0);
    return {
      tools: [picture_summary(derived), fu],
      text: `Hostile tracks in R3: **${derived.rings.R3}** against **${channels}** interceptor channels${derived.rings.R3 > channels ? ' — the saturation rule threshold is exceeded.' : '.'}\n\nR4 ${derived.rings.R4} · R3 ${derived.rings.R3} · R2 ${derived.rings.R2} · R1 ${derived.rings.R1}.`,
      cites: [],
    };
  }

  if (/magazine|ammo|round|readiness|fire unit|reserve|floor/.test(q)) {
    const call = fire_units(derived);
    const rows = call.output as Array<{ unit: string; ready: number; capacity: number; floor: number; state: string }>;
    const flagged = rows.filter((r) => r.state !== 'ok');
    return {
      tools: [call],
      text: flagged.length
        ? `${flagged.length} fire unit${flagged.length === 1 ? ' is' : 's are'} near or at the reserve floor:\n\n${flagged.map((r) => `- **${r.unit}**: ${r.ready}/${r.capacity} ready, floor ${r.floor} (${r.state === 'floor' ? 'at floor' : 'low'})`).join('\n')}`
        : `All ${rows.length} fire units are above their reserve floors.`,
      cites: [],
    };
  }

  if (/rule|alert|fired|warning/.test(q)) {
    const call = active_rules(derived);
    const rows = call.output as Array<{ rule: string; value?: number; threshold?: number | string; note?: string }>;
    return {
      tools: [call],
      text: rows.length ? `${rows.length} rule${rows.length === 1 ? '' : 's'} active:\n\n${rows.map((r) => `- **${r.rule.replaceAll('_', ' ')}**${r.value !== undefined ? ` ${r.value}${r.threshold !== undefined ? `/${r.threshold}` : ''}` : ''}: ${r.note ?? ''}`).join('\n')}` : 'No rule is active at this time.',
      cites: [],
    };
  }

  const call = picture_summary(derived);
  return {
    tools: [call],
    text: `At this time the picture holds ${derived.tracks} tracks, ${derived.hostile} hostile and ${derived.contested} contested, in ${derived.groups.length} raid groups; ${derived.activeRules.length} rules are active.\n\nAsk about tracks, feeds and freshness, ring occupancy, fire-unit readiness, rules, a decision question (J1–J8) or an object by its id.`,
    cites: [],
  };
}


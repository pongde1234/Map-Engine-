import { describe, expect, it } from 'vitest';
import type { Entity } from '@me/schema';
import { strategicPicture, triggers } from '../src/authority.ts';
import { T, clientWith, decision, derivedWith, fragment } from './fixtures.ts';

// A D-3 picture: two launch-preparation reports (one revised), an emitter, an unassociated
// contact, the prior DP-0, DP-1 raised on the indications, and the L1-only DP-2 option.
const lchN1 = fragment('X-LCH-N', T - 9000, 'launch_prep', 'possible');
const lchW = fragment('X-LCH-W', T - 8900, 'launch_prep', 'possible');
const emt = fragment('X-EMT-1', T - 8000, 'emitter', 'likely', { kind: 'esm', sensor: 'electronic support measures' });
const dhow = fragment('X-RPT-DHOW', T - 7000, 'report', 'doubtful', { associated: false, kind: 'contact_report' });
const lchN2 = fragment('X-LCH-N', T - 1000, 'launch_prep', 'likely');
const dp0 = decision('DP0', 'DP-0', T - 10_000, { layer: 'L1', author: 'National level · L1 (CCS)' });
const dp1 = decision('DP1', 'DP-1', T - 6000, { layer: 'L2', derived: [lchN1.record_id, lchW.record_id, emt.record_id, 'DP0'], author: 'Joint HQ West · L2 duty officer' });
const dp2 = decision('DP2', 'DP-2', T - 5000, {
  layer: 'L1',
  status: 'option',
  rel: ['NATIONAL'],
  options: [
    { id: 'pre-empt', label: 'Strike launch areas', selected: false },
    { id: 'hold', label: 'Hold; defend', selected: false },
  ],
});
const all = [dp0, lchN1, lchW, emt, dp1, dhow, dp2, lchN2];
// What an L3 session holds: the server never sends the NATIONAL record.
const forL3 = all.filter((r) => r !== dp2);

describe('decision-point triggers', () => {
  it('reads DP-1 from the indications; DP-2 is not met below confirmed', () => {
    const t = triggers(clientWith([], all), derivedWith());
    expect(t.get('DP-1')).toMatchObject({ met: true });
    expect(t.get('DP-1')!.evidence).toEqual(expect.arrayContaining(['X-LCH-N', 'X-LCH-W', 'X-EMT-1']));
    expect(t.get('DP-2')).toMatchObject({ met: false, note: 'Highest confidence on record: likely' });
  });

  it('never guesses what the picture cannot evidence', () => {
    const t = triggers(clientWith([], all), derivedWith());
    for (const dp of ['DP-0', 'DP-10', 'DP-11']) expect(t.get(dp)!.met).toBeNull();
  });
});

describe('strategic picture', () => {
  it('never offers DP-2 as an action, at any role, even with a confirmed launch preparation', () => {
    const confirmed = fragment('X-LCH-S', T - 500, 'launch_prep', 'confirmed');
    const c = clientWith([], [...all, confirmed]);
    expect(triggers(c, derivedWith()).get('DP-2')!.met).toBe(true);
    for (const role of ['l1', 'l2', 'l3', 'ril', 'planning']) {
      const p = strategicPicture(c, derivedWith(), role);
      expect(p.actions.some((a) => a.dp === 'DP-2' || a.dp === 'DP-11')).toBe(false);
    }
  });

  it('shows the DP-2 option only to L1, with both options and none selected', () => {
    const l1 = strategicPicture(clientWith([], all), derivedWith(), 'l1');
    expect(l1.dp2?.status).toBe('option');
    expect(l1.dp2Options.map((o) => o.id)).toEqual(['pre-empt', 'hold']);
    const l3 = strategicPicture(clientWith([], forL3), derivedWith(), 'l3');
    expect(l3.dp2).toBeNull();
    expect(l3.dp2Options).toEqual([]);
  });

  it('the same indication at L3, L2 and L1: the L1 column says what this view cannot read', () => {
    const p = strategicPicture(clientWith([], forL3), derivedWith(), 'l3');
    expect(p.ladder.map((c) => c.layer)).toEqual(['L3', 'L2', 'L1']);
    const l1 = p.ladder[2]!;
    expect(l1.beyond).toEqual(['NATIONAL']);
    expect(l1.owns.find((o) => o.dp === 'DP-2')!.status).toBe('not releasable to this view');
    expect(l1.owns.find((o) => o.dp === 'DP-0')!.status).toBe('approved');
    expect(p.ladder[0]!.beyond).toEqual([]);
  });

  it('keeps revisions side by side and the unassociated report visible', () => {
    const p = strategicPicture(clientWith([], all), derivedWith(), 'l3');
    expect(p.event?.entityId).toBe('X-LCH-N');
    expect(p.event?.confidence).toBe('likely');
    const rev = p.thread.revisions.find((r) => r.entityId === 'X-LCH-N')!;
    expect(rev.items.map((i) => i.confidence)).toEqual(['possible', 'likely']);
    expect(p.thread.unassociated.map((i) => i.entityId)).toEqual(['X-RPT-DHOW']);
    expect(p.thread.items.every((i) => i.associated)).toBe(true);
  });

  it('L3 sees the indication elevated by the recorded DP-1; L1 reviews the prior DP-0', () => {
    const l3 = strategicPicture(clientWith([], forL3), derivedWith(), 'l3');
    expect(l3.actions[0]).toMatchObject({ id: 'l3-elevate', state: 'done' });
    const l1 = strategicPicture(clientWith([], all), derivedWith(), 'l1');
    expect(l1.actions.find((a) => a.id === 'l1-dp0')).toMatchObject({ state: 'review', evidence: ['DP0'] });
    expect(l1.plan.map((d) => d.dp)).toEqual(['DP-0', 'DP-1']);
    expect(l1.plan.find((d) => d.dp === 'DP-1')!.inputs.map((i) => i.id)).toContain('DP0');
  });

  it('a decision is due when its trigger is met and nothing is recorded', () => {
    const before = [dp0, lchN1, lchW, emt];
    const l2 = strategicPicture(clientWith([], before), derivedWith(), 'l2');
    expect(l2.actions.find((a) => a.id === 'l2-posture')).toMatchObject({ state: 'due', dp: 'DP-1' });
    const raid = derivedWith({ groups: [{ entity_id: 'G-1', group: { raid_id: 'RAID-1', members: [], axis: 'NORTH', wave: 'W1' } } as unknown as Entity] });
    const l2raid = strategicPicture(clientWith([], all), raid, 'l2');
    expect(l2raid.actions.some((a) => a.id === 'due-DP-3')).toBe(true);
  });

  it('planning owns no decision; RIL sees its plant decision fall due on an aimpoint forecast', () => {
    expect(strategicPicture(clientWith([], all), derivedWith(), 'planning')).toMatchObject({ layer: null, actions: [] });
    const aim = { entity_id: 'CM-AIM-1', layer: 'command', is_live: true, source_time: T, ingest_time: T, version: 1, history: [], last_hash: 'h', label: 'SYNTHETIC//DEMO', provenance: { integration: 'test', source_feed: 'Rules' }, geo_details: { type: 'aimpoint', label: 'AIMPOINT', status: 'active' } } as unknown as Entity;
    const ril = strategicPicture(clientWith([aim], []), derivedWith(), 'ril');
    expect(ril.layer).toBe('L4');
    expect(ril.actions.map((a) => a.id)).toContain('due-DP-8');
  });

  it('before the first indication there is no event and no impact', () => {
    const p = strategicPicture(clientWith([], [dp0]), derivedWith(), 'l3');
    expect(p.event).toBeNull();
    expect(p.impact).toBeNull();
    expect(p.plan.map((d) => d.dp)).toEqual(['DP-0']);
  });
});

/**
 * Presenter bookmarks: one per map frame of the storyboard (v0.7). Times come from the
 * scenario manifest marks, never typed in, so captions match the recorded run. Each frame
 * selects its subject, so the right panel shows that frame's details. A4 opens the Strategic
 * View rather than the map.
 */
import type { Bookmark } from '@me/client';
import type { ScenarioInfo } from '@me/schema';

const MIN = 60_000;

export function storyboardBookmarks(s: ScenarioInfo): Bookmark[] {
  const mark = (id: string) => s.clock.marks.find((m) => m.id === id)?.t ?? s.t0;
  const h = s.clock.h;
  const vp = s.center;
  const theatre = { center: [vp[0] - 0.55, vp[1] + 0.45] as [number, number], zoom: 6.3 };
  const raid = { center: [vp[0] - 0.35, vp[1] + 0.3] as [number, number], zoom: 7.1 };
  const inner = { center: vp, zoom: 9.2 };
  const plant = { center: vp, zoom: 12.6 };
  return [
    { id: 'P1', label: 'Concept of operations', t: mark('H-60') - 30 * MIN, camera: theatre, caption: 'Rings, axes and notional Blue layers', select: 'VP-RIL' },
    { id: 'A1', label: 'D-3 · fragments received', t: mark('D-3') + 20 * MIN, camera: { center: [69.2, 23.9], zoom: 6.6 }, caption: 'Any sensor, any agency, one picture', select: 'X-LCH-N' },
    { id: 'A3', label: 'Indication and DP-1', t: mark('DP-1') + 5 * MIN, camera: { center: [69.2, 23.9], zoom: 6.6 }, caption: 'Every injected fragment is available', select: 'X-EMT-1' },
    { id: 'A4', label: 'Strategic view · decision authority', t: mark('DP-2') + 10 * MIN, page: 'strategic', caption: 'Humans set the rules in advance', select: 'X-HQ-1' },
    { id: 'A5', label: 'H-60 · raid detected', t: mark('H-60') + 8 * MIN, camera: theatre, caption: 'Early detection and civil identification', select: 'G-W2N' },
    { id: 'B1', label: 'H-30 · outer defence', t: h - 29 * MIN, camera: raid, caption: 'Cheap first, missiles for missiles', select: 'F-0410' },
    { id: 'B3', label: 'Pairing review', t: h - 22 * MIN, camera: raid, select: 'B-MRS1' },
    { id: 'B4', label: 'H-15 · salvo and reserve', t: h - 14 * MIN, camera: raid, caption: 'Machines recommend; the record names the authority', select: 'F-0525' },
    { id: 'B6', label: 'H-12 · plant advisory', t: h - 11 * MIN, camera: plant, caption: 'Plant actions synchronised with the air battle', select: 'PU-CDU' },
    { id: 'B5', label: 'H-8 · saturation', t: h - 7 * MIN, camera: inner, caption: 'Decentralised, but within limits', select: 'B-ID3' },
    { id: 'C1', label: 'Replay and BDA', t: h + 20 * MIN, camera: inner, caption: 'Protected Tier-1 units and a complete record', select: 'PU-TNK' },
    { id: 'C1D', label: 'Post-mission debrief', t: h + 20 * MIN, page: 'debrief', caption: 'Every injected fragment and engagement accounted for' },
    { id: 'C2', label: 'National reporting · evidence pack', t: h + 61 * MIN, page: 'evidence', caption: 'Verified events apart from unresolved claims' },
  ];
}

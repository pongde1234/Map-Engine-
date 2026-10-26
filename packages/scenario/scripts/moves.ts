import { generateJamnagar } from '../src/index.ts';
import { Cursor, Engine, MemoryJournal } from '@me/engine-core';
const g = generateJamnagar({ seed: 7 });
const e = new Engine(new MemoryJournal());
e.append(g.drafts);
const c = new Cursor(e);
const h = g.manifest.clock.h;
c.seek(h - 35 * 60_000);
let up = 0, mv = 0;
const why = new Map<string, number>();
for (let t = h - 35 * 60_000 + 6000; t < h - 30 * 60_000; t += 6000) {
  const s0 = c.seq;
  const ch = c.advance(t);
  up += ch.upserts.size; mv += ch.moved.size;
  for (const r of e.journal.readRange(s0 + 1, c.seq)) {
    if (!r.entity_id || !ch.upserts.has(r.entity_id)) continue;
    const k = r.kind + ':' + Object.keys(r.payload as object).sort().join(',');
    why.set(k, (why.get(k) ?? 0) + 1);
  }
}
console.log({ up, mv });
console.log([...why].sort((a, b) => b[1] - a[1]).slice(0, 12));

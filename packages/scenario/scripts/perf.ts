/** Rough performance probe: generate → append (encode+hash) → index → seeks. */
import { generateJamnagar } from '../src/index.ts';
import { Engine, MemoryJournal } from '@me/engine-core';

let t = performance.now();
const g = generateJamnagar({ seed: 7 });
console.log('generate', (performance.now() - t).toFixed(0), 'ms', g.drafts.length, 'records');

t = performance.now();
const j = new MemoryJournal();
j.append(g.drafts);
console.log('journal append (encode+hash)', (performance.now() - t).toFixed(0), 'ms');

t = performance.now();
const e = new Engine(j);
e.index();
console.log('index (decode+apply+keyframes)', (performance.now() - t).toFixed(0), 'ms · keyframes', e.keyframes.count);

t = performance.now();
for (let i = 0; i < 20; i++) e.asOf(g.manifest.clock.h - 30 * 60_000 + i * 97_000);
console.log('asOf ×20 in raid window', (performance.now() - t).toFixed(0), 'ms');

const mem = process.memoryUsage();
console.log('heap MB', (mem.heapUsed / 1e6).toFixed(0), '· rss MB', (mem.rss / 1e6).toFixed(0));

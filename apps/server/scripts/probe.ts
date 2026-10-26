/** Protocol probe: hello → welcome/snapshot → seek into the raid → play 60× → count frames. */
import WebSocket from 'ws';
import { decode, encode, formatRaidClock, type ServerMessage, type ClientMessage } from '@me/schema';

const url = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';

async function connect(): Promise<WebSocket> {
  for (let i = 0; i < 60; i++) {
    try {
      const ws = new WebSocket(url);
      await new Promise<void>((res, rej) => {
        ws.once('open', () => res());
        ws.once('error', rej);
      });
      return ws;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('server not reachable');
}

const ws = await connect();
const send = (m: ClientMessage) => ws.send(encode(m));
const counts: Record<string, number> = {};
let posEntries = 0;
let bytes = 0;
let h = 0;
let clock: ServerMessage & { type: 'welcome' } extends { scenario: infer S } ? S : never;
let snapshotSize = 0;

ws.on('message', (data: Buffer) => {
  bytes += data.byteLength;
  const m = decode<ServerMessage>(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  counts[m.type] = (counts[m.type] ?? 0) + 1;
  if (m.type === 'welcome') {
    clock = m.scenario as never;
    h = m.scenario.clock.h;
    console.log(`welcome ${m.identity.display} · scenario ${m.scenario.name} · journal ${new Date(m.scenario.t0).toISOString()} → ${new Date(m.scenario.t1).toISOString()}`);
  }
  if (m.type === 'snapshot') {
    snapshotSize = m.entities.length;
    console.log(`snapshot epoch ${m.clock.epoch} at ${formatRaidClock(m.clock.t, (clock as { clock: never }).clock)} · ${m.entities.length} entities · ${m.events.length} events · ${(data.byteLength / 1024).toFixed(0)} KB`);
  }
  if (m.type === 'pos') posEntries += m.idx.length;
});

send({ type: 'hello', protocol: 1, role: 'l3' });
await new Promise((r) => setTimeout(r, 800));
send({ type: 'seek', t: h - 35 * 60_000 });
await new Promise((r) => setTimeout(r, 500));
const b0 = bytes;
send({ type: 'play', rate: 60 });
await new Promise((r) => setTimeout(r, 5000));
send({ type: 'pause' });
await new Promise((r) => setTimeout(r, 300));
console.log(`5 s at 60× (5 raid minutes): ${JSON.stringify(counts)} · pos entries ${posEntries} · ${((bytes - b0) / 1024).toFixed(0)} KB · last snapshot ${snapshotSize}`);
const health = await fetch(url.replace('ws://', 'http://').replace('/ws', '/api/health')).then((r) => r.json());
console.log('health', JSON.stringify({ records: health.records, keyframes: health.keyframes, chain: health.chain }));
ws.close();

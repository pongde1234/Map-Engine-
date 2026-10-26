// Screenshot harness: open the app, optionally jump to bookmarks, capture console errors and
// any request to a non-local origin (air-gap check).
//   node tools/checks/shoot.mjs [url] [outDir] [bookmarkIds,comma,separated] [width] [height]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? 'data/shots';
const marks = (process.argv[4] ?? '').split(',').filter(Boolean);
const width = Number(process.argv[5] ?? 1920);
const height = Number(process.argv[6] ?? 1080);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
const external = new Set();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) external.add(u.origin);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/00-load.png` });
for (const id of marks) {
  await page.keyboard.press(']');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${id}.png` });
}
console.log(JSON.stringify({ errors: errors.slice(0, 40), external: [...external] }, null, 2));
await browser.close();

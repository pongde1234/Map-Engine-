// Radius audit: layout corners are small, components keep FDS's.
//   AUDIT_BASE=http://127.0.0.1:5174/ node tools/checks/radius-audit.mjs [width height]  (default 1440 900)
// On Battlespace, Targets and Ontology, reads the computed corner radius of every surface at least 120x60:
//   - layouts (not an FDS class, or the FDS page frame): at most 4px (--bs-radius-zone); fails above that;
//   - components (ds-card and the like): reported, so a change to them is seen.
// See the rule in packages/ui/src/styles.css (--bs-radius-zone, --bs-radius-inner).
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5173/';
const [W, H] = [Number(process.argv[2] ?? 1440), Number(process.argv[3] ?? 900)];
const LAYOUT_MAX = 4;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${BASE}?presenter&bm=B4`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const scan = () =>
  page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('*').forEach((e) => {
      const r = parseFloat(getComputedStyle(e).borderTopLeftRadius);
      const b = e.getBoundingClientRect();
      if (!r || b.width < 120 || b.height < 60) return;
      const cls = (e.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      const ds = cls.some((c) => c.startsWith('ds-'));
      const frame = cls.includes('ds-shell__main');
      if (cls.includes('ds-card__overlay')) return;
      rows.push({ name: cls.slice(0, 2).join('.') || e.tagName.toLowerCase(), radius: r, kind: ds && !frame ? 'component' : 'layout' });
    });
    return rows;
  });

let bad = 0;
for (const view of ['Battlespace', 'Targets', 'Ontology']) {
  await page.getByText(view, { exact: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const seen = new Map();
  for (const r of await scan()) seen.set(`${r.kind} ${r.name}`, r.radius);
  console.log(`== ${view}`);
  for (const [k, r] of seen) {
    const fail = k.startsWith('layout') && r > LAYOUT_MAX;
    if (fail) bad++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ${k.padEnd(44)} ${r}px`);
  }
}
await browser.close();
console.log(bad ? `radius-audit: ${bad} layout surface(s) above ${LAYOUT_MAX}px` : 'radius-audit: clean');
process.exitCode = bad ? 1 : 0;

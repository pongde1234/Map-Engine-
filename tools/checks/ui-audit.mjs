// Full UI audit: walks every view, tab, menu, modal and timeline control of the battlespace app,
// screenshots each state and checks it for breakage — document scroll, content escaping a panel,
// text clipped without an ellipsis, HUD overlap, broken images, console errors and FDS dev
// warnings, failed requests and any request to a non-local origin (air-gap check).
//   node tools/checks/ui-audit.mjs <width> <height> <dark|light> [--bookmarks]
// The frame keys ([ ] PgUp PgDn) work in presenter mode, so every page load carries ?presenter.
// AUDIT_BASE points it at another dev server (default http://localhost:5173/).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [width, height] = [Number(process.argv[2] ?? 1920), Number(process.argv[3] ?? 1080)];
const theme = process.argv[4] ?? 'dark';
const withBookmarks = process.argv.includes('--bookmarks');
const base = process.env.AUDIT_BASE ?? 'http://localhost:5173/';
const out = `data/shots/audit/${width}x${height}-${theme}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width, height } });
await ctx.addInitScript((t) => localStorage.setItem('ds-theme', t), theme);
const page = await ctx.newPage();

const report = { config: `${width}x${height} ${theme}`, steps: [], console: [], requests: [], external: [] };
let stepConsole = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') stepConsole.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => stepConsole.push(`pageerror: ${e.message.slice(0, 400)}`));
page.on('requestfailed', (r) => {
  if (!/ws$|\/ws\b/.test(r.url())) report.requests.push(`failed ${r.url()} ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) report.requests.push(`${r.status()} ${r.url()}`);
});
page.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) report.external.push(u.origin);
});

/** In-page checks for one state. */
const audit = () =>
  page.evaluate(() => {
    const issues = [];
    const notes = [];
    const vis = (el) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 1 && b.height > 1 && !el.closest('.ds-animated-value, .maplibregl-map');
    };
    /** The part of el left after every clipping ancestor (up to `stop`) has cut it; null when nothing shows. */
    const shown = (el, stop) => {
      const b = el.getBoundingClientRect();
      let [l, t, r, btm] = [b.left, b.top, b.right, b.bottom];
      for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const ab = a.getBoundingClientRect();
        l = Math.max(l, ab.left); t = Math.max(t, ab.top); r = Math.min(r, ab.right); btm = Math.min(btm, ab.bottom);
        if (r - l < 1 || btm - t < 1) return null;
      }
      return { left: l, top: t, right: r, bottom: btm };
    };
    const name = (el) => {
      const t = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
      return `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${t}"`;
    };
    const de = document.documentElement;
    if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) issues.push(`document scrolls (${de.scrollWidth}×${de.scrollHeight})`);

    // Content escaping a panel (not hidden by a scroll container inside it).
    for (const sel of ['.bs-left', '.bs-right', '.bs-time']) {
      const p = document.querySelector(sel);
      if (!p) continue;
      const pb = p.getBoundingClientRect();
      for (const el of p.querySelectorAll('*')) {
        if (!vis(el)) continue;
        const b = shown(el, p);
        if (!b) continue;
        if (b.right > pb.right + 1.5 || b.bottom > pb.bottom + 1.5 || b.left < pb.left - 1.5) {
          issues.push(`${sel}: ${name(el)} escapes panel (${Math.round(b.left)},${Math.round(b.top)} → ${Math.round(b.right)},${Math.round(b.bottom)})`);
          break;
        }
      }
    }

    // Horizontal scrollbars inside panels, and text cut off with no ellipsis.
    const scope = [...document.querySelectorAll('.bs-left, .bs-right, .bs-time, .bs-hud, .ds-shell__topnav, header, [role=dialog], [role=menu], [role=listbox]')];
    const seen = new Set();
    for (const root of scope) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el) || !vis(el)) continue;
        seen.add(el);
        const s = getComputedStyle(el);
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.closest('.ds-tabs__list-outer'))
          issues.push(`horizontal scroll: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible') {
          if (s.textOverflow === 'ellipsis') notes.push(`truncated: ${name(el)}`);
          else issues.push(`text cut (no ellipsis): ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
        }
        if (el.scrollHeight > el.clientHeight + 2 && s.overflowY !== 'visible' && s.webkitLineClamp === 'none' && s.textOverflow !== 'ellipsis')
          issues.push(`text cut vertically: ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`);
      }
    }

    // HUD stacks must not overlap each other or leave the map.
    const map = document.querySelector('.bs-map');
    if (map) {
      const mb = map.getBoundingClientRect();
      const kids = (sel) => [...document.querySelectorAll(`${sel} > *`)].filter(vis).map((e) => [e, e.getBoundingClientRect()]);
      const tl = kids('.bs-hud--tl');
      const tr = kids('.bs-hud--tr');
      const bl = kids('.bs-hud--bl');
      const bc = kids('.bs-hud--bc');
      const overlaps = (xs, ys) => {
        for (const [a, ab] of xs)
          for (const [b, bb] of ys)
            if (ab.left < bb.right && bb.left < ab.right && ab.top < bb.bottom && bb.top < ab.bottom) issues.push(`HUD overlap: ${name(a)} × ${name(b)}`);
      };
      overlaps(tl, [...tr, ...bl]);
      overlaps(bc, bl);
      for (const [e, b] of [...tl, ...tr, ...bl, ...bc]) if (b.right > mb.right + 1 || b.bottom > mb.bottom + 1 || b.left < mb.left - 1) issues.push(`HUD leaves map: ${name(e)}`);
      const canvas = map.querySelector('canvas');
      if (!canvas || canvas.width === 0) issues.push('map canvas missing');
    }

    // Console columns: side panels keep their width, the map takes the rest.
    const consoleEl = document.querySelector('.bs-console');
    if (consoleEl) {
      const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
      const [cw, lw, mw, rw] = [w('.bs-console'), w('.bs-left'), w('.bs-center'), w('.bs-right')];
      if (lw > 370 || rw > 370) issues.push(`side panel too wide (left ${Math.round(lw)}, right ${Math.round(rw)})`);
      if (lw && rw && Math.abs(lw - rw) > 1) issues.push(`side panels differ in width (left ${Math.round(lw)}, right ${Math.round(rw)})`);
      if (Math.abs(cw - lw - rw - mw) > 2) issues.push(`map not filling the console (console ${Math.round(cw)}, map ${Math.round(mw)}, left ${Math.round(lw)}, right ${Math.round(rw)})`);
    }

    // The timeline never scrolls sideways, and no scrollbar sits inside it.
    const tl = document.querySelector('.bs-tl');
    if (tl) {
      if (tl.scrollWidth > tl.clientWidth + 1) issues.push(`timeline scrolls horizontally (${tl.scrollWidth} > ${tl.clientWidth})`);
      for (const el of tl.querySelectorAll('*')) {
        const o = getComputedStyle(el);
        if ((o.overflowX === 'auto' || o.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) issues.push(`timeline: ${name(el)} scrolls sideways`);
      }
    }

    // Broken images (symbol glyphs, logos).
    for (const img of document.querySelectorAll('img')) if (img.complete && img.naturalWidth === 0 && vis(img)) issues.push(`broken image: ${img.alt || img.src.slice(0, 60)}`);

    // Anything visible past the viewport edge.
    for (const el of document.querySelectorAll('button, [role=tab], [role=menuitem], [role=option], input')) {
      if (!vis(el)) continue;
      const b = shown(el, null);
      if (b && (b.right > innerWidth + 1 || b.bottom > innerHeight + 1)) issues.push(`control off-screen: ${name(el)}`);
    }
    // Tabs hidden behind a strip's scroll fade.
    for (const outer of document.querySelectorAll('.ds-tabs__list-outer')) {
      if (!vis(outer)) continue;
      const ob = outer.getBoundingClientRect();
      const cut = [...outer.querySelectorAll('[role=tab]')].filter((t) => { const b = t.getBoundingClientRect(); return b.right > ob.right + 1 || b.left < ob.left - 1; });
      if (cut.length) issues.push(`tab strip overflows: ${cut.map((t) => t.textContent.trim()).join(', ')} out of view`);
    }
    return { issues: [...new Set(issues)], notes: [...new Set(notes)].slice(0, 12) };
  });

let n = 0;
async function step(label, fn) {
  n += 1;
  const id = String(n).padStart(2, '0');
  stepConsole = [];
  let error = null;
  try {
    await fn();
  } catch (e) {
    error = e.message.split('\n')[0].slice(0, 300);
  }
  await page.waitForTimeout(400);
  const file = `${id}-${label}.png`;
  await page.screenshot({ path: `${out}/${file}` }).catch(() => {});
  const a = await audit().catch((e) => ({ issues: [`audit failed: ${e.message}`], notes: [] }));
  report.steps.push({ id, label, file, error, ...a, console: stepConsole });
}

// The picture time, as the timeline announces it (its playhead tag shows the same).
const raidText = () => page.locator('.bs-tl__lanes').getAttribute('aria-valuenow').catch(() => null);
const tab = (re) => page.getByRole('tab', { name: re }).first();
const wait = (ms) => page.waitForTimeout(ms);
// The console's views are one strip of tabs (no nav rail). Frames whose storyboard app is not
// the map (A2, B3–B5) open their own view, so map steps return to Battlespace first.
const openView = (name) => page.locator('.console__tabs').getByRole('tab', { name, exact: true }).click();
// The map's one toolbar: a Tools menu and a View menu (map view and panels).
const menuRow = (name) => page.getByRole('menuitem', { name }).or(page.getByRole('option', { name })).first();
const viewItem = async (name) => {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await wait(400);
  await menuRow(name).click();
};

await step('load', async () => {
  await page.goto(`${base}?presenter&bm=B4`, { waitUntil: 'networkidle' });
  await wait(4000);
  await openView('Battlespace');
  await wait(3000);
  if (!(await page.locator('.bs-left').isVisible())) throw new Error('layers panel should start open');
  if (!(await page.locator('.bs-right').isVisible())) throw new Error('inspector should start open');
});
await step('view-menu', async () => {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await wait(500);
  for (const row of ['Reset view', 'Hide layers panel', 'Hide inspector'])
    if (!(await menuRow(row).isVisible())) throw new Error(`view menu row missing: ${row}`);
  await page.keyboard.press('Escape');
  await wait(400);
});
await step('left-alerts', async () => {
  await tab(/^Alerts/).click();
  await wait(800);
});
await step('left-alerts-scrolled', async () => {
  await page.locator('.bs-left .bs-scroll__viewport, .bs-left [role=tabpanel]:not([hidden]) .ds-scroll__viewport').first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await wait(500);
});
await step('alerts-filter-high', async () => {
  await page.getByRole('button', { name: /^Severity/ }).click();
  await page.getByText('High and up', { exact: true }).click();
  await wait(600);
});
await step('alerts-filter-reset', async () => {
  await page.getByRole('button', { name: /^Severity/ }).click();
  await page.getByText('All', { exact: true }).click();
  await wait(400);
});
// A custom alert is set from the Alerts panel; the audit opens the dialog and cancels, so no
// alert is armed on the operator log.
await step('alerts-new', async () => {
  await page.getByRole('button', { name: 'New custom alert' }).click();
  await wait(700);
  const dlg = page.getByRole('dialog', { name: 'New custom alert' });
  // The conditions are the options of a select field.
  await dlg.getByRole('combobox', { name: /Fires when/ }).or(dlg.getByLabel('Fires when')).first().click();
  await wait(400);
  for (const label of ['Count in a ring', 'Near the VA/VP', 'Magazine low', 'A class appears']) {
    if (!(await menuRow(label).isVisible())) throw new Error(`alert condition missing: ${label}`);
  }
  await menuRow('Magazine low').click();
  await wait(400);
});
await step('alerts-new-cancelled', async () => {
  await page.getByRole('dialog', { name: 'New custom alert' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'New custom alert' }).waitFor({ state: 'hidden', timeout: 3000 });
});
await step('left-sources', async () => {
  await tab(/^Sources/).click();
  await wait(800);
});
// A source is registered from the Sources panel; the audit opens the dialog, switches to a feed
// and cancels, so nothing is recorded on the operator log.
await step('sources-new', async () => {
  await page.getByRole('button', { name: 'New source' }).click();
  await wait(700);
  const dlg = page.getByRole('dialog', { name: 'New source' });
  if (!(await dlg.getByLabel(/Range/).first().isVisible())) throw new Error('sensor range field missing');
  await dlg.getByRole('combobox', { name: /Kind/ }).or(dlg.getByLabel('Kind')).first().click();
  await wait(400);
  await menuRow('Feed').click();
  await wait(400);
  if (!(await dlg.getByRole('combobox', { name: /Carries/ }).or(dlg.getByLabel('Carries')).first().isVisible())) throw new Error('feed carries field missing');
});
await step('sources-new-cancelled', async () => {
  await page.getByRole('dialog', { name: 'New source' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'New source' }).waitFor({ state: 'hidden', timeout: 3000 });
});
// A layer is made from the Layers panel; the audit opens the dialog and cancels, so nothing is
// recorded on the operator log.
await step('layers-new', async () => {
  await tab(/^Layers/).click();
  await page.getByRole('button', { name: 'New layer' }).click();
  await wait(700);
  const dlg = page.getByRole('dialog', { name: 'New layer' });
  if (!(await dlg.getByLabel(/Name/).first().isVisible())) throw new Error('layer name field missing');
});
await step('layers-new-cancelled', async () => {
  await page.getByRole('dialog', { name: 'New layer' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'New layer' }).waitFor({ state: 'hidden', timeout: 3000 });
});
await step('left-layers-filter', async () => {
  await tab(/^Layers/).click();
  await page.getByLabel('Filter layers').fill('air');
  await wait(600);
});
await step('left-layers-scrolled', async () => {
  await page.getByLabel('Filter layers').fill('');
  await page.locator('.bs-left .bs-scroll__viewport').first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await wait(500);
});
await step('inspector-theatre', async () => {
  await page.keyboard.press('Escape');
  await wait(800);
});
await step('inspector-theatre-scrolled', async () => {
  await page.locator('.bs-right .bs-scroll__viewport, .bs-right .ds-scroll__viewport').first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await wait(500);
});
await step('search-modal', async () => {
  await page.keyboard.press('Control+k');
  await wait(500);
  await page.keyboard.type('OWA');
  await wait(800);
});
await step('search-mgrs', async () => {
  const box = page.getByRole('dialog').getByRole('searchbox').or(page.getByRole('dialog').locator('input')).first();
  await box.fill('42Q WK 39652 57536');
  await wait(600);
});
await step('entity-overview', async () => {
  const box = page.getByRole('dialog').locator('input').first();
  await box.fill('OWA');
  await wait(600);
  await page.getByRole('dialog').locator('[role=option], [role=menuitem], button').filter({ hasText: /F-|OWA/ }).first().click();
  await wait(1500);
});
for (const t of ['Provenance', 'Intel', 'Links', 'Activity']) {
  await step(`entity-${t.toLowerCase()}`, async () => {
    await tab(new RegExp(`^${t}`)).click({ timeout: 15000 });
    await wait(700);
  });
}
await step('entity-overview-scrolled', async () => {
  await tab(/^Fusion/).click();
  await page.locator('.bs-right .bs-scroll__viewport, .bs-right .ds-scroll__viewport').first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await wait(500);
});
// Frames live on the timeline: ticks from the track's top edge (click to go), and the [ and ] keys.
// B1 (the sixth frame) stays on this view; the picture time's label names it.
await step('frame-tick', async () => {
  await page.locator('.bs-tl__frame').nth(5).dispatchEvent('pointerdown');
  await wait(2500);
  const named = await page.locator('.bs-tl__lanes').getAttribute('aria-valuetext');
  if (!/B1/.test(named)) throw new Error(`frame tick did not go to B1 (slider "${named}")`);
});
// Which kinds of event the track draws: the Show menu.
await step('show-menu', async () => {
  await page.getByRole('button', { name: /^Events shown/ }).click();
  await wait(500);
  await menuRow('Intel').click();
  await wait(400);
  const label = await page.getByRole('button', { name: /^Events shown/ }).innerText();
  await menuRow('Intel').click();
  if (!/2 of 3/.test(label)) throw new Error(`Show did not hide Intel (button "${label}")`);
});
await step('next-frame', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(']');
  await wait(2500);
});
await step('tooltip', async () => {
  await openView('Battlespace');
  await wait(2500);
  await page.getByRole('button', { name: 'Pause', exact: true }).or(page.getByRole('button', { name: 'Play', exact: true })).first().hover();
  await wait(900);
});
await step('profile-menu', async () => {
  await page.keyboard.press('Escape');
  await page.mouse.move(width / 2, height / 2);
  await page.getByRole('button', { name: /account/i }).click();
  await wait(600);
});
await step('launcher', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /app/i }).first().click();
  await wait(800);
});
await step('bell-opens-alerts', async () => {
  await page.keyboard.press('Escape');
  await tab(/^Layers/).click();
  await page.getByRole('button', { name: /notification/i }).first().click();
  await wait(800);
  const sel = await tab(/^Alerts/).getAttribute('aria-selected');
  if (sel !== 'true') throw new Error('bell did not open the Alerts tab');
});
await step('play-300x', async () => {
  const before = await raidText();
  await page.getByRole('button', { name: /^Playback rate/ }).click();
  await page.getByText('300×', { exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await wait(4000);
  const after = await raidText();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  if (before === after) throw new Error(`clock did not advance (${before})`);
});
await step('slider-end', async () => {
  await page.getByRole('slider').first().focus();
  await page.keyboard.press('End');
  await wait(3000);
});
await step('slider-start', async () => {
  await page.getByRole('slider').first().focus();
  await page.keyboard.press('Home');
  await wait(3000);
});
await step('replay-30', async () => {
  await page.goto(`${base}?presenter&bm=B5`, { waitUntil: 'networkidle' });
  await wait(4000);
  await openView('Battlespace');
  await wait(2500);
  // Replay sits in the playback-rate menu.
  await page.getByRole('button', { name: /^Playback rate/ }).click();
  await wait(400);
  await menuRow(/Replay last 30 min/).click();
  await wait(2500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
});
await step('live', async () => {
  // The Live button sits in the timeline's control strip; any menu still open closes first.
  await page.getByRole('menu').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await wait(2500);
});
// Both side panels are open (their default); the earlier steps may have moved the layers panel.
await step('left-open', async () => {
  if (!(await page.locator('.bs-left').isVisible())) await viewItem('Show layers panel');
  await wait(300);
});
await step('right-closed', async () => {
  await viewItem('Hide inspector');
  await wait(1200);
});
await step('both-closed', async () => {
  await viewItem('Hide layers panel');
  await wait(1200);
});
await step('panels-restored', async () => {
  await viewItem('Show layers panel');
  await wait(300);
  await viewItem('Show inspector');
  await wait(1200);
});
const mapCentre = async () => {
  const b = await page.locator('.bs-map').boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
await step('tool-menu', async () => {
  // One Tools menu lists the shapes each tool draws, a section per tool.
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await wait(500);
  if (!(await menuRow(/Path/).isVisible())) throw new Error('tools menu did not open');
});
await step('tool-measure', async () => {
  const [cx, cy] = await mapCentre();
  await menuRow(/Path/).click();
  await wait(300);
  // Below the centre line, clear of the toolbar.
  await page.mouse.click(cx - 140, cy + 30);
  await page.mouse.click(cx - 30, cy + 80);
  await page.mouse.move(cx + 40, cy + 50);
  await wait(500);
});
await step('measure-result', async () => {
  // Finishing a measurement opens its result in a popover at the shape.
  await page.keyboard.press('Enter');
  await wait(700);
  if (!(await page.getByRole('dialog', { name: /Measure/ }).isVisible())) throw new Error('measurement popover did not open');
});
await step('tool-geofence-dialog', async () => {
  const [cx, cy] = await mapCentre();
  await page.keyboard.press('Escape');
  await wait(300);
  await page.keyboard.press('g');
  for (const [dx, dy] of [[-100, -20], [100, -20], [100, 100], [-100, 100]]) await page.mouse.click(cx + dx, cy + dy);
  await page.keyboard.press('Enter');
  await wait(800);
  if (!(await page.getByRole('dialog').isVisible())) throw new Error('promote dialog did not open');
});
await step('tool-cancelled', async () => {
  // Dismissing the promote dialog discards the sketch.
  await page.keyboard.press('Escape');
  // The dialog animates out; under audit load that can take longer than a fixed pause.
  await page
    .getByRole('dialog', { name: 'Promote to command object' })
    .waitFor({ state: 'hidden', timeout: 3000 })
    .catch(() => {
      throw new Error('promote dialog did not close');
    });
});
await step('nav-targets', async () => {
  await openView('Targets');
  await wait(1000);
});
await step('nav-targets-selected', async () => {
  // Whichever stage has cards at this picture time.
  await page.locator('.tb__cols').getByRole('button').first().click();
  await wait(1000);
});
await step('targets-dossier', async () => {
  await page.locator('.tb__detail').getByRole('tab', { name: /^Dossier/ }).click();
  await wait(600);
});
await step('targets-console', async () => {
  // Closing the target brings back the decision record and delegation console.
  await page.locator('.tb__detail').getByRole('button', { name: 'Close' }).click();
  await wait(600);
  await page.locator('.tb__detail').getByRole('tab', { name: /^Record/ }).click();
  await wait(600);
});
// The assistant docks beside whichever view is open (the shell's Bruce button).
const assistant = () => page.getByRole('complementary', { name: 'Assistant' });
await step('assistant-open', async () => {
  await page.getByRole('button', { name: /Bruce/ }).click();
  await wait(1000);
  if (!(await assistant().isVisible())) throw new Error('assistant panel did not open');
});
await step('assistant-answer', async () => {
  // Suggestions follow the situation, so type a fixed question instead.
  await page.getByRole('textbox', { name: /Ask the assistant/ }).fill('SITREP for the last 15 minutes');
  await page.keyboard.press('Enter');
  await wait(1500);
});
await step('nav-back-battlespace', async () => {
  await openView('Battlespace');
  await wait(4000);
  if (!(await assistant().isVisible())) throw new Error('assistant panel closed on switching view');
});
await step('assistant-closed', async () => {
  await assistant().getByRole('button', { name: 'Close chat' }).click();
  // The panel animates out; wait for it rather than a fixed pause.
  await assistant()
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => {
      throw new Error('assistant panel did not close');
    });
});

// Ontology Explorer at frame A2 (the same D-3 snapshot as A1, its source record in focus).
await step('nav-ontology', async () => {
  await page.goto(`${base}?presenter&bm=A2`, { waitUntil: 'networkidle' });
  await wait(5000);
  if (!(await page.locator('.on').count())) throw new Error('ontology view missing');
  if ((await page.locator('.on-graph [data-node]').count()) < 6) throw new Error('lineage graph has too few nodes');
  if ((await page.locator('.on-graph .react-flow__edge-path').count()) < 4) throw new Error('lineage graph draws too few links');
  if ((await page.locator('[aria-label="Rehearsal inset"]').getByText(/Radar report/i).count()) < 2) throw new Error('rehearsal inset lacks both radar reports');
});
await step('ontology-inspector', async () => {
  await page.locator('.on-graph [data-node="grp:fire-units"]').click();
  await wait(800);
  if ((await page.locator('.on section[aria-label="Inspector"]').getByText(/floor/).count()) < 1) throw new Error('fire units do not list their magazines');
});
await step('ontology-history', async () => {
  await page.locator('.on-graph [data-node="X-LCH-N"]').click();
  await page.locator('.on .sv__record').getByRole('tab', { name: 'History' }).click();
  await wait(1500);
  if (!(await page.locator('.on section[aria-label="History"]').getByText(/RECORD/).isVisible())) throw new Error('history did not load');
});
await step('ontology-view-as', async () => {
  await page.getByRole('button', { name: 'View as identity' }).click();
  await wait(500);
  await page.getByRole('menuitem', { name: /RIL control room/ }).or(page.getByRole('option', { name: /RIL control room/ })).first().click();
  await wait(1000);
  if (!(await page.locator('.on-graph').getByText('NOT PERMITTED').count())) throw new Error('no node coloured as not permitted');
  // The documents say permission; none uses the word releasability.
  if ((await page.locator('.on').innerText()).toLowerCase().includes('releasab')) throw new Error('page uses a word the documents do not');
});

if (withBookmarks) {
  for (const bm of ['P1', 'A1', 'A2', 'A3', 'A5', 'B1', 'B3', 'B4', 'B5', 'C1']) {
    await step(`bm-${bm}`, async () => {
      await page.goto(`${base}?presenter&bm=${bm}`, { waitUntil: 'networkidle' });
      await wait(4500);
    });
  }
}

report.external = [...new Set(report.external)];
report.requests = [...new Set(report.requests)];
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
const bad = report.steps.filter((s) => s.error || s.issues.length || s.console.length);
console.log(`${report.config}: ${report.steps.length} states, ${bad.length} with findings; external=${report.external.length} requests=${report.requests.length}`);
await browser.close();

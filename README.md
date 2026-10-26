# Map Engine

A Lattice-style common operating picture for the Shield AI + Faclon Decision Support System:
- an entity journal with hash chain and time travel over source time and receipt time;
- an offline WebGL map with MIL-STD-2525 symbology;
- spatial rules;
- a dense, glyph-first console built on the Faclon Design System (FDS).

Milestone 1 is the India Forum session (Tue 2026-11-17, air-gapped room). The approved product plan is in [docs/PLAN.md](docs/PLAN.md); decisions are recorded in [docs/adr](docs/adr).

> All scenario data is **synthetic and notional**. No real force numbers, placements, raid timelines or system identifiers are used. `pnpm check:denylist` enforces the last point.

## Quick start (development)

```bash
pnpm install                       # pnpm 12, Node ≥ 22 (tested on 24 LTS)
pnpm scenario                      # writes data/journal/jamnagar-raid-7.sqlite + manifest (≈ 7 s)
node --import tsx apps/server/src/main.ts      # engine server on :8787 (REST /api, WS /ws, /tiles)
pnpm --filter @me/battlespace dev  # console on http://127.0.0.1:5173 (proxies /api /ws /tiles)
```

**Offline basemap.** One-time; the tile files are not in git.

```bash
# data/bin/pmtiles.exe = go-pmtiles v1.31.2; data/tiles/fonts + sprites from protomaps/basemaps-assets
./data/bin/pmtiles.exe extract https://build.protomaps.com/20261023.pmtiles data/tiles/basemap.pmtiles --bbox=63,19,75,28 --maxzoom=12
```

**Roles.** `?role=l1|l2|l3|planning|ril` picks a local identity. Releasability is filtered on the server.

**Deep links.** `?t=<ms>&sel=<entity>&bm=<P1|A1|…|C2>`.

**Keys.**
- `Space`: play / pause.
- `]` / `[` (or PgDn / PgUp): next / previous storyboard bookmark.
- `Esc`: clear the selection.

## Checks

| Command | What it proves |
|---|---|
| `pnpm typecheck` | All 14 packages, strict TypeScript 7 |
| `pnpm test` | 49 tests (listed below) |
| `pnpm check:denylist` | No real Indian system names in source, generated strings or build |
| `node tools/checks/shoot.mjs <url> <dir> P1,A1,…` | Screenshot per storyboard bookmark, console errors, and **every request to a non-local origin** (air-gap check) |
| `npx tsx packages/scenario/scripts/perf.ts` | Generate, append, index and seek timings |
| `npx tsx apps/server/scripts/probe.ts` | WebSocket protocol probe (snapshot size, frames, bytes) |

What the 49 tests cover:
- the hash chain and tamper detection;
- the bitemporal "hidden until receipt" rule;
- a property test that a keyframe seek always equals a sequential replay;
- scenario golden checks: 150 threats / 148 defeated / 2 leakers / 0 Tier-1 hits; H = first Wave 2 drone at R1; raid detected about 60 min out; lineage from a kill back to the D-3 fragments;
- every SIDC passes milsymbol validation;
- the typed-array codec round-trips.

## Architecture

```
scenario (seeded) ─► journal-sqlite (SHA-256 chain, WAL) ─► engine-core (asOf · keyframes · cursor · lineage)
                                                              │
                     apps/server  REST /api · WS /ws (msgpack: snapshot · delta · pos frames · events, seek epochs)
                                                              │
client (headless store, clock, dead-reckoning) ─► map (MapLibre offline basemap + deck.gl overlay) ─► ui (FDS) ─► apps/battlespace
```

| Package | Role |
|---|---|
| `packages/schema` | **Frozen contract.** Record envelope, entity components (Lattice-style), WS protocol, msgpack codec, class/SIDC registry, data-age profiles |
| `packages/geo` | WGS84 geodesics (geographiclib): rings, sectors, ellipses, containment, dead reckoning; MGRS/DD/DMS formats and a `CoordinateFormat` plugin point (Indian grid later) |
| `packages/engine-core` | Isomorphic: `MemoryJournal`, `verifyChain`, `Picture` (last writer wins on source time), `KeyframeIndex`, `Engine.asOf(t)`, `Cursor`, `LineageIndex` |
| `packages/journal-sqlite` | SQLite persistence of the exact hashed bytes |
| `packages/scenario` | Deterministic Jamnagar raid generator. All on-screen numbers come from its manifest |
| `packages/symbology` | milsymbol 3.0.4 atlas for deck.gl, symbol SVGs for UI glyphs |
| `packages/client` | Headless client: transport with reconnect, epoch-checked store, clock estimate, positions, trails, view store, cross-window sync |
| `packages/map` | `createMapEngine()`: offline style from FDS tokens, band ordering, layer construction, CPU label declutter, picking, bookmarks |
| `packages/map-react` | `<MapEngineProvider>`, `<MapView>`, throttled hooks (`useEngineTime`, `useSelectedEntity`, `useLineage`, …) |
| `packages/ui` | Dense composites on FDS: layer tree, event feed, inspector (Fusion, Provenance, Intel, Links, Activity), theatre summary, timeline with lanes, HUD |
| `packages/adapters` | **Frozen contract.** Faclon adapter interfaces (I/O Connect, UNS, I/O Sense, Insights, DeepSense, Bruce) + stubs; outbound links |
| `apps/server` | Fastify + ws. Sessions with their own cursor; server-side releasability; CSP `'self'` only |
| `apps/battlespace` | Reference console: AppShell, map console, presenter bookmarks per storyboard frame |

**Time model.**
- Replay runs on the **ingest** axis: `asOf(T)` reads only records with `ingest_time ≤ T`.
- Entity state is the latest `source_time` among those records.
- Data age is `T − source_time`.
- Expiry runs before each record is applied.

**Wire.** The four kinds of message:
- Movement travels in coalesced `pos` frames (typed arrays, latest wins, skipped under backpressure).
- Attribute changes travel in reliable `delta` messages.
- Discrete records travel in `events`, never dropped.
- A seek starts a new `epoch`, and the client drops stale frames.

**UI rules.** FDS Tier-2 tokens only; FDS components or composites of them; type through the Tier-3 classes. MIL-STD-2525 symbol fills are the documented exception (standard artwork).

## Status against the plan (2026-10-23)

**Done**

*Phase 0*
- monorepo;
- frozen schema, protocol and adapter contracts;
- tests and denylist;
- FDS installed and its guardrails followed.

*Phase 1*
- the scenario flows through the journal, WebSocket and map with 2525 symbols;
- offline basemap (Protomaps extract, 61 MB);
- app shell with timeline, seek and play, and the layer tree;
- no external requests (verified).

*Phase 2 (partial)*
- bitemporal time travel and data age everywhere;
- contested hypotheses (fusion currently truth plus noise, labelled as such);
- Fusion and Provenance tabs;
- all command objects;
- six rule types journaled by the generator;
- micro-widgets;
- deep links.

*Phase 3 (partial)*
- 11 storyboard bookmarks;
- lineage trace (Links tab plus "Trace on map");
- role views;
- screenshot harness.

**Next**

*Phase 2*
- the real fusion `step()` with recompute-at-position;
- a live rules evaluator in engine-core (today, rule firings are precomputed);
- annotation tools (terra-draw) promoted to signed command objects;
- DEM hillshade and the elevation endpoint;
- the Survey of India boundary layer;
- WEZ and coverage layers;
- Ed25519 checkpoints and in-browser verification.

*Phase 4*
- the signed bundle (SHA-256 manifest, `docker save`, offline pnpm store);
- performance runs on the presenter laptop.

## Open items (owners)

**Surendra Ahuja**
- Cruise-missile count: 2–4 vs 6. The generator uses 4.
- Salvo time: H-15 vs H-5. The generator uses H-15.
- DP-8 phase.
- Values for N and T. They are shown as symbols, never invented.

**David Sacharny**
- Who owns the Battlespace and Target Board views.
- Presenter-laptop spec.
- The in-room IE path.

**Faclon**
- API specs (you will supply them).
- Highcharts licence (an FDS peer dependency).
- Sign-in that works without AWS.

**Legal**
- Survey of India boundary data and sign-off. OSM boundaries are already hidden from the style.

**Customer**
- Indian Military Grid Reference System specification.
- Indian symbology manual.

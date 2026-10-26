# Map Engine: a Lattice-style common operating picture

Implementation plan, v1, 2026-10-23.

## Context

**Why we are building it.** Shield AI and Faclon are building a Decision Support System (DSS) for Indian defence. The storyboard for the India Forum session (Tuesday 2026-11-17, a 15-minute live product glimpse) runs through 16 frames. At least 9 of them sit on a live map:
- the CONOP overview;
- the Battlespace View at D-3, H-60, H-30 and post-raid;
- raid detection and civil deconfliction;
- the saturation and debris checks;
- the plant aimpoints;
- the replay and BDA thread.

Nothing in the repo provides that map today. The project folder is empty.

**What we are building.** A product-grade map engine, comparable to Anduril Lattice:
- an entity data plane: Lattice-style entities, an append-only signed journal, and time travel across both source time and receipt time;
- a fast WebGL map rendering MIL-STD-2525 symbology;
- spatial rules;
- adapters to the Faclon platform.

It ships as an embeddable library plus a reference "Battlespace" app.

**How the demo fits.** The 17 Nov demo is milestone M1. It is a vertical slice of the product, and nothing in it is throwaway.

**Inputs read for this plan:**
- Shield DSS product deck v2;
- Chapter-2 storyboard v0.7, including the CONOP, the 16 frames, DP-0 to DP-12, the application skeleton and the acronyms;
- the Military Symbology Field Guide;
- nine source-system studies of existing national and service systems (named in the private study set, not in this repository);
- the `@faclon-labs/fds` package metadata and README.

**Hard constraints from the documents:**
- **Air-gapped room in New Delhi.** No uplink and no wireless. The presenter laptop runs a browser only, connected over an isolated switch to one Faclon server plus a DGX. The data bundle arrives on removable media with a SHA-256 manifest.
- **Synthetic data only.** Every force number, placement and timeline is labelled notional. No CUI.
- **No existing Indian system identifiers on screen.**
- **The record is the product.** Every assessment keeps its sources, receipt time, label, version and signature, and the thread runs from the first D-3 fragment to BDA.
- **Machines recommend and humans hold authority.** The map shows rules, envelopes and authority. It never originates an order.
- **UI direction from you:** very dense and minimal. Lots of data on one page, heavy on visual elements (glyphs, chips, micro-charts) and light on text.

## Decisions taken

| Topic | Decision |
|---|---|
| Goal | Product first. The 17 Nov demo is milestone M1 and a vertical slice. |
| Rendering | MapLibre GL JS v5 with deck.gl v9 (interleaved overlay). 2D with pitch and hillshade, 2.5D altitude stalks for air tracks. 3D globe and terrain draping come later. |
| Backend | TypeScript on Node 22 LTS end to end, with one shared schema. |
| Delivery | Embeddable packages (headless client, imperative map, React bindings, UI kit) plus the reference app `apps/battlespace`. |
| Design system | `@faclon-labs/fds` (React 18/19, CSS-first 3-tier tokens, dark theme via `data-theme`, lucide icons, Inter and JetBrains Mono bundled). |
| Layout | Map console: icon rail, compact layer tree, map, dense inspector, timeline with lanes. |
| Screens | 1920×1080 first-class, responsive up to 4K and multi-monitor through pop-out panels. |
| Team | 6+ developers in 6 workstreams (see Workstreams). |
| Map data | No hosted map API. Open data is downloaded once and self-hosted (see Map data). |
| Faclon APIs | You will supply them. They sit behind adapter interfaces, with bundle-backed stubs until then. |

## Architecture

```
 Synthetic scenario ─┐   Faclon I/O Connect / UNS / I/O Sense / Insights (adapters, later live)
 (seeded generator)  │                │
                     ▼                ▼
          ┌─────────────────── apps/server (Node) ───────────────────┐
          │ ingest → envelope+hash chain → SQLite journal (WAL)      │
          │ engine-core (isomorphic): materialiser · asOf(T) ·       │
          │   keyframes · fusion step() · spatial rules · lineage    │
          │ REST (publish/get/query/commands)  WS (live+replay)      │
          │ auth (local identities, roles, releasability filter)     │
          │ static: web app · PMTiles · DEM · glyphs · sprites       │
          └──────────────────────────┬───────────────────────────────┘
                                     │ msgpack over WebSocket (epochs, posFrames, deltas, events)
          ┌──────────────────────────▼───────────────────────────────┐
          │ client (headless column store, clock, selection)          │
          │ map (MapLibre basemap + deck.gl bands, plugins, tools)    │
          │ ui (FDS-based dense widgets) → apps/battlespace           │
          └───────────────────────────────────────────────────────────┘
 Browser-only fallback: engine-core + a signed bundle replay in the browser with no server.
```

### Monorepo (pnpm workspaces, TypeScript project references)

```
packages/
  schema/          envelope, entity components, zod validators, msgpackr codec, SIDC tables, enums
  geo/             geographiclib geodesics (rings, sectors, ranges), ENU, MGRS/DD/DMS formatters,
                   CoordinateFormat plugin API (Indian grid later), EGM2008 geoid (HAE↔MSL)
  engine-core/     JournalStore interface, materialiser, asOf(T), keyframes, fusion step(),
                   spatial rules, lineage/thread graph (no Node or DOM dependencies, so it runs in both)
  journal-sqlite/  better-sqlite3 store, SHA-256 hash chain, Ed25519 signed checkpoints
  symbology/       milsymbol 3.0.4 atlas builder, SIDC mapping and validation, profiles (2525E now,
                   India/Commonwealth later), tactical-graphics subset
  client/          transport, column-oriented entity store, clock/time controller, selection,
                   layer state, subscribe/getSnapshot (useSyncExternalStore compatible)
  map/             imperative engine: createMapEngine(), band registry, LayerPlugin API,
                   draw/measure/ring/geofence tools (terra-draw), picking, bookmarks
  map-react/       <MapEngineProvider>, <MapView/>, useEntity, useClock, useSelection, Inspector slots
  ui/              dense widgets on FDS tokens: LayerTree, TimeBar+lanes, Inspector tabs, HUD,
                   glyph rows, sparklines, ring-occupancy bars, magazine bullets, ring radar
  adapters/        interfaces plus bundle-backed stubs for Faclon (I/O Connect, UNS, I/O Sense,
                   Insights, DeepSense, Bruce) and Shield links (Target Board, IE/Aechelon, Hivemind)
  scenario/        Jamnagar raid generator, sensor models, intel fragments, manifest (counts, H, D)
apps/
  server/          Fastify + ws, auth, REST, WS protocol, static and range-request tile serving
  battlespace/     reference app (Vite + React + FDS), presenter mode, pop-out windows
  devtools/        perf harness (1k/5k/10k entities), journal inspector, fusion metrics viewer
tools/
  offline-data/    PMTiles extract, DEM→terrarium PMTiles, imagery mosaic, boundary layer, glyph PBFs
  bundle/          build, sign, verify bundle; SHA-256 manifest; docker save; offline pnpm store
docs/adr/          architecture decision records (one per decision above)
```

**Pinned libraries.** Verify the exact versions at setup and pin them:
- React 19 and Vite;
- maplibre-gl 5.x, `pmtiles`, deck.gl 9.x (`@deck.gl/mapbox` MapboxOverlay, interleaved);
- milsymbol 3.0.4 (MIT), `geographiclib-geodesic`, `mgrs`, `proj4`, `@turf/*` (planar ops on small areas only);
- terra-draw (drawing tools);
- fastify, ws, msgpackr, better-sqlite3, zod, `@noble/ed25519`, `@noble/hashes`;
- Vitest, fast-check, Playwright.

### Data model (`packages/schema`)

**Envelope on every record.** This is the deck's "provenance, time, label, version, signature, carried once".
- `record_id` (ULID), `seq`, `kind`, `layer` (reference | observation | fused | command | event)
- `entity_id?`, `source_time`, `ingest_time` (integer ms UTC), `valid_from` and `valid_to` (command objects)
- `provenance` {integration, source_feed, sensor_class, source_record_hash}
- `derived_from[]` (record hashes), `thread_id` (D-3 fragment → BDA)
- `label` (e.g. `SYNTHETIC//DEMO`), `releasability[]`, `entity_version`
- `author` (identity, for authored records), `signature?`, `prev_hash`, `hash`

`kind` takes these values: observation, fused, command, decision, rule_fire, correction, reference, fragment, engagement, bda.

**Entity components.** These are modelled on the publicly documented Lattice entity concepts.

| Component | Contents |
|---|---|
| Identity and lifetime | `entity_id`, `is_live`, `expiry_time`, `aliases` {name, track_number, adc_number for civil flights} |
| `ontology` | template: track, asset, sensor, effector, installation, geo, fragment or group; `platform_type`; `specific_type` |
| `location` | lat, lon, HAE, `velocity_enu`, heading, speed |
| `location_uncertainty` | ellipse or covariance |
| `mil_view` | `standard_identity` (pending, unknown, assumed friend, friend, neutral, suspect, hostile); environment; 20-digit `sidc`; context (reality, exercise, simulation) |
| Classification | `hypotheses[]` {class, sidc, p}, `contested`, `margin` |
| Shapes | `geo_shape` (point, line, polygon, geodesic circle, sector, ellipse) and `geo_details.type`: ring, WCS sector, NFZ, corridor, sea restriction, picket box, WEZ, debris footprint, aimpoint, axis, annotation, VA/VP |
| `sensor` | type, coverage model (range by altitude band, azimuth sector, elevation), status |
| `effector` | type, channels, magazine {ready, reserve, floor}, engagement status, WEZ |
| `health` | link up, degraded or down, `last_heard` |
| `track` | contributing observations, fusion method and version, quality |
| `group` | members, hull, raid group id |
| `relationships[]` | contests, associated_with, observed_by, assigned_to, protects, member_of, derived_from |
| `indicators` | simulated, exercise |

**Time.** The raid clock is stored in the scenario manifest: D0 date, the H epoch, and named marks (D-3, H-60, H-30, H-15, H-12, H-8, H+5, H+30, H+42, D+1). H is computed from the data: the first Wave 2 drone reaching R1.

### Journal, time travel and replay (`engine-core`, `journal-sqlite`)

**Storage**
- **One store.** SQLite in WAL mode, single writer. Tables: `records`, `keyframes`, `checkpoints`, `blobs`.
- **Hash chain.** Every record's hash covers the stored bytes, never re-encoded objects.
- **Signed checkpoints.** Each minute, an Ed25519-signed checkpoint covers the Merkle roots of 1-second segments. The screen can then honestly show "verified · sovereign root".

**Replay rules**
- **Replay runs on ingest time.** `asOf(T)` keeps only records with `ingest_time ≤ T`. Each entity's state is its latest `source_time` among those. This is what keeps "later material hidden until receipt". Data age is always `T − source_time`.
- **Adaptive keyframes.** In the dense raid window, take one every 20k records or 30 s, whichever comes first; elsewhere, one every 15 min. Each keyframe holds entity state, fusion internals, rule state (timers, hysteresis), RNG state and the lineage cursor. Target: a seek anywhere from D-3 to D+1 takes under 300 ms.
- **In memory.** Keep the current state plus a column-oriented per-track history (Float32: t, lat, lon, alt, vE, vN) for the dense window. Trails and scrub previews read it directly.
- **Data density.** Full-rate data covers H-120 to H+60. From D-3 to H-120 there are only fragments, civil traffic and AIS at 30–60 s.

**Recompute at position** (the deck's "the fused layer recomputes from the log")
- Fusion is written as a pure function, `step(state, obs[], corrections[])`.
- The engine loads the nearest keyframe, re-runs observations up to T, and compares the result's hash with the journaled fused records.
- The screen shows "identical", or a diff when there is a pending correction.

**Lineage**
- `thread_id` plus `derived_from` make up a graph.
- `lineage(entity|record)` returns the chain from fragment to assessment, decision record, envelope, task, engagement and BDA. The C1 replay walks this chain.

### Wire protocol (`client` and `apps/server`)

- **Encoding.** One binary WebSocket, msgpackr. A protobuf external API comes later.
- **Messages:**
  - `hello/auth`
  - `subscribe{subId, layers, mode: live|replay}`
  - `seek{t}`, which returns a new `epoch`
  - `play{rate}`
  - `keyframe{epoch,t,entities}`
  - `delta{epoch,seq,upserts,removes}`
  - `posFrame{epoch,t,idx:Uint32Array,lon,lat,alt,vE,vN:Float32Array}`
  - `event{seq}`
  - `ack{seq}`
- **Movement and attributes travel separately.** `posFrame` messages are merged and sent at most 10 Hz. Attribute deltas are sent only when something changes. Discrete events (identity changes, decisions, rule firings) go on a reliable, ordered stream that is never merged or dropped.
- **Backpressure.** The server keeps a latest-value-wins dirty set and skips a flush while `ws.bufferedAmount` is above 1 MB.
- **Seek epochs.** The client drops any message from an old epoch. This prevents stale deltas landing after a seek.
- **Replay versus live.** Replay is pulled: the client requests windows `[t, t+Δ]` ahead of the playhead, and the server thins the data at 60× and above. Live is pushed.
- **Smooth motion.** In replay, the client interpolates with a 2–5 s playout buffer. In live mode it dead-reckons, capped at 2× the expected update interval and never for STALE or DISC tracks.
- **Security filtering is server-side.** Role and releasability filtering happen on the server, because that is a security boundary. Spatial filtering is client-side, since 5k entities are cheap to send.

### Fusion: small and real, precomputed for the demo

- **Kinematics:**
  - local ENU frame and a measurement model per sensor (noise, detection probability, clutter);
  - chi-square gating;
  - global nearest-neighbour assignment, with ties broken by ID so it is deterministic;
  - constant-velocity Kalman filter;
  - M-of-N track start and deletion after a set number of misses.
- **Classification.** The scenario emits evidence events (intel, IFF or flight-plan correlation, behaviour, a DeepSense stub). A Bayesian update produces the hypothesis set. When the top two hypotheses are within the margin, the entity is CONTESTED and is never merged automatically.
- **Two kinds of ambiguity:**
  - classification ambiguity is one entity with hypotheses;
  - kinematic ambiguity is two entities linked by `contests`.
- **Corrections.** Reject, merge and reclassify are journaled correction records, labelled for the factory queue.
- **Demo de-risking:**
  - Fusion runs when the bundle is built, and its output is journaled and signed.
  - The same code runs live for recompute and for corrections.
  - CI gates on track purity, completeness, zero ID swaps on scripted tracks, and a golden hash.
  - A flag switches fused output to truth plus noise as a fallback.
- **Raid groups.** Scripted group ids for now, with DBSCAN on position and velocity in v1.

### Spatial rules (`engine-core/rules`)

**How rules work**
- **Rules are command objects.** Each rule is a signed command object with its thresholds, scope and author.
- **Firings are journaled.** Each firing is a `rule_fire` record with references to its input records.
- **Missing thresholds stay symbolic.** The CONOP leaves N and T unspecified, so they display as "N" and "T" until Surendra Ahuja supplies values. The UI never invents them.

**Rules in the CONOP**

| Rule | Condition | Effect / notes |
|---|---|---|
| Saturation (DP-7) | Hostile tracks in R3 exceed fire-unit channels for N s | Uses hysteresis and debounce. Records the delegation window, e.g. 4 min 12 s. |
| Civil/unknown in engagement area | Track is in the WEZ, or its predicted time-to-entry is under the threshold | Blocks automatic engagement and escalates to L3. |
| Debris on Tier-1 VP | Predicted debris footprint (ellipse from intercept point and velocity) intersects a Tier-1 VP | Refuse or flag; the last-chance exception is shown. |
| Comms degraded | L3 link lost for more than T s | Last valid envelope stays in force. |
| Missile appears | Cruise or ballistic class appears | Upper tier re-prioritises and L2 is alerted. |
| Leaker forecast | Leaker forecast exceeds 4 | DP-6 reserve trigger. |
| Ring occupancy | Counts per ring (R4 150–60, R3 60–20, R2 20–5, R1 5–0 km) | Feeds the occupancy widgets. |
| Data-age thresholds | Per-class thresholds (CURRENT under 2 min, AGING 2–10 min, STALE over 10 min) | Held as a signed command object ("commander set"). DISC comes from link health, not from age. |

### Symbology (`packages/symbology`)

- **Atlas.**
  - Built at startup for the scenario's finite set of SIDC × identity combinations.
  - Uses milsymbol `asCanvas()` at 2× DPR, shelf-packed into one texture, with the anchor taken from `getAnchor()`.
  - A new SIDC triggers a debounced rebuild of a second atlas, which is then swapped in, to avoid IconLayer flicker.
- **Changing values stay out of the atlas.** Callsign, altitude, speed and heading are drawn as separate deck layers: speed leaders as LineLayer and labels as SDF TextLayer with CollisionFilterExtension. Data age is shown through per-instance opacity, desaturation or a stale overlay.
- **SIDC table.** One table maps scenario classes to SIDCs, each checked with milsymbol `isValid()` in CI. Classes:
  - OWA drone, decoy, jet drone, cruise missile, ARM;
  - interceptor drone, fighter, AEW&C, aerostat;
  - surface, low-level and coastal radar;
  - SAM (short/medium), VSHORADS, gun, laser DEW, C-UAS, EW;
  - civil aircraft, merchant vessel, tanker;
  - refinery installation.
- **Tactical graphics.** For M1, a custom deck subset: geodesic rings, sectors, polygons with labels, axis arrows, picket boxes, ellipses. mil-sym-ts comes in v1, after its licence is checked.
- **Profiles.** 2525E is the default. An India/Commonwealth profile (abbreviations, double-outline monochrome, CI incident markers) waits until the customer shares their symbol manual.

### Map rendering (`packages/map`)

- **Basemap.** MapLibre renders the basemap only, using our dark minimal style built from `@protomaps/basemaps` and FDS tokens.
  - The PMTiles protocol, glyphs and sprites are all local.
  - Hillshade comes from the DEM.
  - Satellite imagery is an optional raster layer.
  - `maxBounds` is set to the theatre.
  - OSM country boundaries are removed and replaced by the Survey of India layer.
- **deck.gl bands.** Every overlay is drawn in deck.gl, giving one picking model. A band registry fixes the order: basemap, reference, command areas, observation, fused, labels, then selection and draw. Each band maps to a MapLibre `beforeId` plus a deck order.
- **Layers used:**
  - IconLayer for symbols, LineLayer for speed leaders, TripsLayer for trails;
  - SolidPolygonLayer and PathLayer for rings, sectors, WEZ, WCS, NFZ, corridors and footprints;
  - TextLayer for labels, ScatterplotLayer for selection and age halos;
  - LineLayer for altitude stalks when the map is pitched;
  - ArcLayer or LineLayer for pairing and engagement lines.
- **Performance rules.** Positions are updated in place each frame, with no per-frame allocation. React never re-renders on ticks; panels are throttled to 4 Hz.
- **Budgets:**
  - 60 fps at 5k entities on the presenter laptop, and at least 30 fps at 10k;
  - seek under 300 ms;
  - ingest to screen under 500 ms;
  - first load under 5 s on the LAN.
- **Terrain.** 3D terrain stays off for M1, because deck.gl layers do not drape onto MapLibre terrain and the area is nearly flat. Elevation and slope come from a server endpoint that samples the DEM, with EGM2008 conversion.
- **Public API sketch:**
  ```ts
  const engine = createMapEngine({ container, style, client, symbology, plugins });
  engine.layers.register(plugin); engine.clock.seek(t); engine.selection.set(ids);
  engine.camera.apply(bookmark); const g = await engine.tools.start('rangeRing');
  await client.commands.promote(g, meta);   // server signs; becomes a command object
  interface LayerPlugin<S> { id; group: 'fused'|'observation'|'command'|'reference'; band;
    derive(snap, ctx): S; render(s, ctx): Layer[]; pick?(info): EntityRef;
    stats?(s): { count: number; age: Record<'current'|'aging'|'stale'|'disc', number> } }
  ```

### Coordinates

- **Display formats.** MGRS by default, plus DD, DMS and Zulu DTG with IST secondary.
- **Indian grid.** The Indian Grid (Kalianpur/Everest LCC zones via proj4; the zone for Jamnagar is to be confirmed) is a `CoordinateFormat` plugin. The Indian Military Grid Reference System is not public: we need the specification from the customer.
- **Cursor readout.** MGRS, elevation (MSL), slope and range/bearing to the selected VP.

### Identity, labels, security (air gap)

- **Login and roles.**
  - Local identities: a file-based user and role store with argon2 hashes, and OIDC later.
  - The engine must not depend on Faclon sign-in, which needs AWS today and is flagged as a risk in the deck.
  - Roles: L1, L2, L3, L4-RIL, planning staff, releasing officer, data admin and model admin.
  - Columns and panels are subtractive by role, and records are filtered by releasability on the server.
- **No outbound traffic.**
  - CSP `default-src 'self'`; no CDN, no telemetry, no NTP. The server is the clock authority.
  - Fonts come from FDS @fontsource; vendor milsymbol through npm, never jsDelivr.
  - A Noto Sans Devanagari UI font is needed for Hindi text in the Bruce panel. Map labels stay in English, because MapLibre's Indic text shaping is limited.
- **Signatures in the browser.** Verify with `@noble/*`, because WebCrypto needs a secure context, or serve HTTPS from a local CA installed on the laptop.
- **Synthetic content.**
  - A permanent `SYNTHETIC // DEMO` banner, and labels on records.
  - A CI denylist scans the source, docs, scenario strings and built app for real system names. Its term list is stored encoded, so the check does not publish the names it blocks.

### Adapters (`packages/adapters`)

**Inbound interfaces.** These are typed now, with stubs that read the bundle; live versions follow when you supply the Faclon APIs.

| Interface | Faclon component | Carries |
|---|---|---|
| `IngestAdapter` | I/O Connect | Records plus adapter status, shown in frame A1 |
| `OntologyAdapter` | UNS | Maps node types to entity templates |
| `TimeSeriesAdapter` | I/O Sense | Readiness, magazines, sensor health (frames B1, B3–B4) |
| `RecordsAdapter` | Insights | Reports, decision records, SITREPs |
| `ModelAdapter` | DeepSense | Classification hypotheses, readiness forecasts, anomalies |
| `AssistantAdapter` | Bruce | Entity and record context handoff; citations resolve to `record_id` |

**Outbound links.**
- Deep links: `/map?t=…&sel=…&layers=…&bm=…`.
- Target Board "Compare on map".
- IE and Aechelon run references, linked from the entity's Links tab.
- A map snapshot export (PNG plus label and hash) for the Evidence Pack.

### Synthetic feed catalogue

Each research study sets the category, cadence and entity types of one synthetic feed. On-screen names stay neutral.

| Shapes the feed (study) | Synthetic feed on screen | Entities, cadence |
|---|---|---|
| National air C2 study | Air picture network | Fused air tracks at 1–5 s; sensor health per minute; civil flight plans with AD clearance number (civil identity by correlation) |
| Army AD C2 study | Army AD control and reporting | Low-level tracks, fire units, engagements (seconds) |
| Naval sensor-net studies | Naval sensor net | Ship-borne air and surface tracks (10–60 s) |
| Coastal surveillance studies | Coastal surveillance chain | Coastal radar, AIS (10 s), long-range position reports (6 h) |
| Maritime fusion study | Regional maritime fusion | White shipping, incidents using the published taxonomy (piracy, smuggling, IUU, migration, maritime incidents), advisories |
| Land surveillance study | Land surveillance grid | Ground observations, observer reports (minutes) |
| Army force-state studies | Force state (via I/O Sense) | Fire-unit readiness, magazines, serviceability (minutes to daily) |
| CONOP | Intel fragments | Space-ISR change reports (D-3, D-1), 3 new ESM emitters, HUMINT on a senior officer, adversary speech (D-2), Wave 0 probes |
| CONOP | Civil and plant | DGCA/AAI traffic and corridor, ports and AIS with 2 tankers due, State/CISF, RIL plant unit states |

### Scenario (`packages/scenario`), deterministic and seeded

**Geography and forces**
- Defended point: the RIL Jamnagar complex. Rings R4 to R1 around it.
- Axes: NORTH over land and WEST over the Arabian Sea.
- Blue laydown follows frame P1 (all notional): AEW&C orbit, surface, coastal and low-level radars, interceptor-drone pickets and the R3 box, short- and medium-range SAM, VSHORADS, radar-cued guns, CISF C-UAS, laser DEW.

**Waves**

| Wave | Content |
|---|---|
| 0 | Probes, H-6h to H-1h |
| 1 | 40 decoys plus ARMs on NORTH, from H-30 |
| 2 | 60–70 OWA drones low on both axes, plus jet drones |
| Cruise | 2–4 missiles. Open conflict: the CONOP text says 6, at H-15 vs H-5. |
| 3 | 20 drones at H+30 |

**Effects and outcome**
- Soft kill turns away 30–40% of drones before anything is fired.
- Outcome targets come from the run itself, not from captions: 148 of 150 intercepted, 2 leakers into R1, 0 Tier-1 hits, a fragment hit on a tank-farm roof.

**Generator outputs**
- ground truth;
- noisy observations per sensor;
- fragments with source and ingest times;
- decision records DP-0 to DP-12 (DP-2 and DP-11 as unselected options);
- engagements and BDA;
- `manifest.json` holding counts, H, marks and the seed.

All on-screen numbers come from the manifest.

## UI specification: dense, minimal, built from visual elements

**Rules**
1. **The map is the hero.** At 1080p with all panels open, the map keeps at least 55% of the viewport. Every panel collapses, from the icon rail or a key.
2. **Glyphs before words.**
   - State is shown by shape, colour and numeral: 2525 frames for identity; an age dot plus numeral (`●4m`); link pips (`▮▮▯`); a hypothesis split bar (`▓▓▓░ .82`); DP diamonds (`◆`).
   - Full text appears only in hover cards (about 300 ms delay) and the pinned inspector.
3. **Micro-visualisations instead of paragraphs:**
   - ring-occupancy bars (R4, R3, R2, R1 counts);
   - magazine bullets (ready against reserve floor);
   - per-layer age histograms (4 segments);
   - track-count sparklines;
   - a polar ring radar (bearing × range of hostiles around the VP);
   - leaker-forecast gauge, raid ETA ladder, fire-unit channel pips.
4. **Colour budget.**
   - Identity colours come from the 2525 palette in medium/dark mode.
   - Age states have 4 colours. Alerts use one accent from FDS tones.
   - Everything else is greyscale.
   - Shape always repeats the meaning, for colour-blind safety and monochrome projectors.
5. **Numbers and text.** Tabular numerals in JetBrains Mono, units in small caps, abbreviations from a single glossary (for example `WCS`, `WEZ`, `ToT`). Every abbreviation has a tooltip.
6. **Progressive disclosure:** hover card, then pinned inspector, then drawer or pop-out. Keyboard first:
   - `Ctrl+K` command palette (entities, MGRS, commands);
   - single-key layer toggles;
   - `[` and `]` step through bookmarks;
   - `Space` play or pause; `,` and `.` step frames.
7. **No decorative chrome.** No gradients, glows or filler. Lines are 1 px, the radius comes from FDS `--radius-s`, and the compact density uses FDS spacing 2/4/6/8.

**Layout (map console, chosen)**

| Region | Size | Contents |
|---|---|---|
| Banner | 16 px | `SYNTHETIC // DEMO`, releasability |
| Top bar | 32 px | FDS AppShell; raid clock `D-0 H-30` with Zulu and IST; counters `▲150 ◆12 ●4 ⚠2`; link pips; role chip |
| Icon rail | 40 px | Layers, Feeds and events, Search, Tools, Bookmarks |
| Left panel | 240 px, collapsible | FDS TreeView by model (Fused, Observation, Command, Reference). Each row: eye, count, 4-segment age bar, filter chip. Feeds tab: received-event list as glyph rows, with adapter status pips |
| Map HUD | Overlaid on the map | Top-left: connection, replication and clock pills. Top-right: age legend with thresholds. Bottom-left: cursor readout (MGRS, elevation, slope, range/bearing). Bottom-right: scale and north. Map toolbar: select, draw, measure, ring, geofence. Optional ring radar and occupancy widget |
| Inspector | 320 px | Header: symbol, ID, chips (identity, Fused or Contested, age). Icon tabs: Fusion (hypothesis bars; Reject, Merge, Reclassify), Provenance (source chips, method and version, source vs ingest time, label, signature tick), Intel, Links (mini lineage graph), Activity (mini timeline). Actions: Nominate, Ask assistant |
| Timeline | 88 px, expandable to 240 | Transport (play, rate, step). Segmented axis that compresses days and expands minutes (D-3 … H-60 … H+42). Lanes: fragments, detections, decisions (DP◆), rule firings, engagements, link health. Track-count sparkline; bookmark ticks |

**FDS usage**
- **Chrome from FDS:** AppShell, TreeView, Tabs, Table (event list and track table), Tag, Chip, Badge, Indicator, Counter, Metric, Tooltip, Popover, DropdownMenu, SliderInput, Switch, ResizeHandle, ScrollArea, Toast, Drawer.
- **Map-specific widgets** (glyph rows, micro-charts, timeline lanes) are our own components in `packages/ui`. They use only FDS Tier-2 tokens and add no new literals.
- **Lightweight micro-charts.** Use SVG or canvas inside widgets. Keep FDS Chart (Highcharts) for larger charts only.
- **Read before building any UI:** `node_modules/@faclon-labs/fds/dist/index.md` and `guardrails.json`.

**Responsive and multi-monitor**
- Container queries set three densities:
  - 1280–1600 compact, where the inspector overlays the map;
  - 1600–2560 standard;
  - 2560+ expanded, with a second inspector column and a docked track table and timeline at 240 px.
- Any panel can pop out into a new window. Windows share state through BroadcastChannel (one client per window, synced on the clock and selection), which supports ops-centre multi-monitor setups.

**Presenter mode.** Bookmarks capture time, camera, layers, selection and panel state. One bookmark per storyboard frame. Clicker keys (PgUp and PgDn) step through them, with an optional caption strip.

## Map data (free, self-hosted; there is no live map API)

| Need | Source | Licence / note |
|---|---|---|
| Vector basemap | Protomaps OSM daily build (v4), `pmtiles extract` with a bbox of about 63–75°E, 19–28°N (theatre plus NORTH-axis launch areas), z0–15; plus z0–6 world | ODbL; credit OSM. Self-hosting is fine. |
| Alternative / development | OpenFreeMap (no key; commercial use allowed per its FAQ) | Development convenience only. |
| Elevation | Copernicus DEM GLO-30, converted to terrarium PMTiles for hillshade, plus a GeoTIFF for the server elevation endpoint | Free licence; attribution and no-liability text are required. |
| Imagery (v1, optional) | Our own cloud-free Sentinel-2 L2A mosaic (dry season, 10 m) as a COG and raster PMTiles | Copernicus data is free and open. Avoid EOX s2cloudless for 2018 onwards (non-commercial; 2022+ needs a paid EOX licence). Fallback: Landsat 8/9 (public domain). |
| India boundary | Survey of India official external boundary | Required for political maps of India. Until the data is in hand and legal has signed off, hide international boundaries and use `maxBounds`. |
| Fonts | Glyph PBFs built locally from Inter and Noto Sans | No CDN. |

An offline attribution panel lists ODbL, Copernicus DEM and Sentinel-2.

## Workstreams (6+ developers)

| WS | Scope | People |
|---|---|---|
| A. Engine and server | schema, journal-sqlite, engine-core (asOf, keyframes, rules, lineage), WS protocol, auth | 2 |
| B. Map and symbology | map, map-react, geo, symbology atlas, tactical subset, tools, perf | 2 |
| C. UI and app | ui on FDS, layout, inspector, timeline, layer tree, presenter mode, pop-outs, responsive | 2 |
| D. Scenario and fusion | Jamnagar generator, sensor models, fusion `step()`, metrics, manifest | 1–2 |
| E. Offline data and ops | basemap, DEM, imagery and boundary pipeline; bundle signing; offline install; air-gap CI; hardware rehearsal | 1 |
| F. Integration (from Phase 2) | Faclon adapters once APIs arrive, Bruce and Target Board links, Shield IE/Aechelon references | 1 |

## Phases and timeline

**Phase 0: contracts and setup** (Fri 10-23 → Mon 10-26)
- Monorepo scaffold, CI (lint, typecheck, test, offline job with network disabled), ADRs.
- **Freeze three contracts first,** because 6+ developers will work in parallel:
  - the `schema` envelope and components;
  - the WS protocol;
  - the `LayerPlugin` and adapter interfaces.
- Install FDS and read its `index.md` and guardrails.
- Send the open questions (below) to Surendra Ahuja, David Sacharny and the Faclon team.
- Save the project decisions to project memory.

**Phase 1: walking skeleton** (10-27 → 11-01)
- Scenario v0 with waves and civil traffic, flowing through the journal, WS and the map with 2525 icons, in both replay and live.
- Basemap bundle v0 (PMTiles, glyphs, hillshade) served offline.
- App shell with the dense layout on FDS, the time bar with seek and play, and the layer tree.
- First rehearsal with the network cable unplugged.

**Phase 2: core** (11-02 → 11-08)
- Bitemporal `asOf` with keyframes, and data age everywhere.
- Fusion with contested hypotheses; the Fusion and Provenance tabs.
- Command objects: rings, sectors, WCS, civil restrictions, WEZ, picket boxes, debris footprints, aimpoints.
- The six spatial rules, with journaled firings.
- Annotation tools promoted to signed command objects.
- Micro-widgets: ring occupancy, magazines, age histograms, ring radar.
- Adapter stubs for readiness and magazines; deep links.
- Performance tuning on the actual presenter laptop by 11-04.

**Phase 3: demo flow** (11-09 → 11-12, feature freeze Thu 11-12)
- Presenter bookmarks for the 9 map frames (P1, A1, A3, A5, B1, B3–B6 overlays, C1).
- Lineage thread trace in C1. Recompute-at-position with the hash match shown.
- Role views (L1, L2, L3, RIL). Signature verification in the UI. Evidence-pack map snapshot.
- Playwright screenshot per bookmark.

**Phase 4: hardening** (11-13 → 11-16)
- Bundle cut with SHA-256 manifest, signed. Docker images saved; offline install script.
- Three rehearsals on a replica isolated switch, using the real laptop and the projector resolution.
- Browser-only fallback replay checked. Backup screen recording made. Fixes only.

**M1: India Forum, Tue 11-17.**

**Phase 5: product v1** (11-18 → end of Jan 2027)
- Live Faclon adapters (I/O Connect, UNS, I/O Sense, Insights, DeepSense, Bruce).
- Live (non-replay) ingest with backpressure at 10k entities.
- Multi-user collaboration: shared command objects and presence.
- mil-sym-ts tactical graphics.
- India symbology profile and Indian grid (after the customer supplies their specs).
- Sentinel-2 imagery mosaic.
- Radar coverage by altitude band (radar-horizon model), then DEM viewshed.
- Public REST and protobuf/gRPC API: publish, get and stream entities, Lattice-style.
- Plugin SDK docs.

**Phase 6: v2** (Feb–Apr 2027)
- 3D globe and terrain draping (MapLibre globe with deck.gl, or a Cesium view).
- Tasking API and lifecycle.
- High availability with multi-node journal replication (tiered L4 → L3 → L2).
- Corrections-to-training pipeline into the Shield factory.
- 50k-entity scale (AIS-class density).

## Map engine coverage of the storyboard frames

| Frame | What the map engine provides |
|---|---|
| P1 CONOP | Static "design" bookmark: axes, R4–R1, notional Blue placements, phase strip, notional labels |
| A1 D-3 sources | Fragments appearing on receipt; event list; source record; adapter status pip; imported object |
| A2 Ontology | Lineage and links API (the Ontology Explorer itself is outside the map) |
| A3 Indication | Alert from fragments; unassociated fragments visible; uncertainty ellipses |
| A5 H-60 | Raid estimate (count, axes, ETA per ring); WCS sectors; drafted civil corridor and sea restriction; civil tracks and AIS; source age |
| B1 H-30 | Inbound strike; soft-kill area and deflected tracks; group selection opens readiness and magazines (adapter) |
| B3–B4 | "Compare on map": pairing lines, WEZ, time-to-engage, debris footprint per option |
| B5 Saturation | Ring-occupancy trigger, delegation window on the timeline, debris conflict on a Tier-1 VP highlighted |
| B6 Plant | Predicted aimpoints with ToT over generic process units |
| C1 Replay/BDA | Post-raid map, BDA markers, thread trace from the first D-3 fragment to the engagement, prior assessments kept beside revisions |
| C2 Evidence | Signed map snapshot export |

## Open items to resolve (owners)

- **Surendra Ahuja:**
  - cruise-missile count (2–4 vs 6) and salvo time (H-15 vs §5.2's H-5);
  - DP-8 timing (H-12 vs phase 4);
  - values for N and T;
  - VA/VP wording;
  - the Blue placement list.
- **David Sacharny:**
  - who owns the Battlespace View, the Target Board and the delegation console (the storyboard lists them under David), and how this engine embeds into them;
  - room inventory and presenter-laptop spec (GPU, browser, resolution);
  - the in-room IE path.
- **Faclon:**
  - API specs (you will supply them);
  - Highcharts commercial licence for FDS charts;
  - whether Faclon sign-in can run without AWS;
  - local identity.
- **Legal / Shield:** Survey of India boundary source and sign-off; the licence for mil-sym-ts.
- **Customer:** Indian Military Grid Reference System spec; Indian symbology manual.

## Top risks and mitigations

1. **Presenter-laptop GPU and browser.** Rendering happens on the laptop. Pin the hardware and browser, and run the perf harness on it by 11-04.
2. **Air-gap leaks.** CDN fonts, npm postinstall downloads, docker pulls, NTP. Mitigate with CI with the network disabled, the strict CSP, an offline pnpm store, `docker save`, and the server as the clock authority.
3. **India boundary depiction.** Strip OSM boundaries, overlay the Survey of India line, set `maxBounds`, and get legal sign-off.
4. **Fusion artefacts.** Precompute the output, gate on CI metrics, and keep the truth-plus-noise fallback flag.
5. **Single server failure.** Fall back to browser-only replay, then to the recorded video.
6. **Scope creep with 6+ developers.** Contracts are frozen in Phase 0, and each frame bookmark is an acceptance test.
7. **FDS density.** FDS controls are sized for apps (buttons 28–40 px). Compact map widgets live in `packages/ui` on FDS tokens; ask the FDS team about a compact density mode.

## Verification

- **Unit and property tests (Vitest, fast-check):**
  - full replay to T equals keyframe plus deltas;
  - hash chain and checkpoint signature verification;
  - `asOf` never returns a record with `ingest_time` > T;
  - geodesic ring radius error under 10 m at 150 km.
- **Golden runs.** Per seed: a root hash, the manifest counts (150 tracks, 148 intercepted, H), and fusion metrics (purity, completeness, zero ID swaps).
- **Symbology.** Every SIDC in the table passes milsymbol `isValid()`. An atlas snapshot test.
- **Performance harness (`apps/devtools`).** 1k, 5k and 10k entities at 1 Hz; frame time, seek time and memory; run on the presenter laptop at 1080p and 4K.
- **End to end (Playwright).** One screenshot per frame bookmark, a role-view test, and a test that no network request goes to any origin other than the server.
- **Offline CI job.** Install and build from the offline store with the network disabled; the denylist scan for real system names; licence attribution present.
- **Rehearsal checklist.** Replica isolated switch; cold boot from the bundle; SHA-256 verified; the 15-minute run timed against the storyboard clock (0:00–15:00); fallback drills (server down, then browser replay, then video).

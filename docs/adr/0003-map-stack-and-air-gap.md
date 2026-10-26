# ADR 0003: Map stack, offline data and air gap

**Status:** accepted, 2026-10-23.

## Rendering

- MapLibre GL 6 draws the basemap only.
- One interleaved `@deck.gl/maplibre` overlay draws everything else, with a single picking model.
- deck.gl's CollisionFilterExtension does not draw under the interleaved overlay, so labels are decluttered on the CPU in screen space (`declutter()` in `packages/map/src/layers.ts`).
- 3D terrain stays off because deck.gl layers do not drape onto MapLibre terrain. A pitched view shows altitude stalks.

## Data

No hosted map API is used.

| Item | Source | Licence / terms |
|---|---|---|
| Vector basemap | Protomaps OSM PMTiles extract | ODbL |
| Glyphs | Noto Sans | OFL |
| Sprites | Protomaps basemaps assets | — |
| Elevation (next) | Copernicus DEM GLO-30 | Attribution and no-liability text required |
| Boundaries | OSM boundaries are removed from the style. The Survey of India boundary is added as a separate authorised layer. | Required for political maps of India |

## Air gap

- Server CSP is `'self'` only; there is no CDN, telemetry or outbound request.
- Fonts come from FDS `@fontsource`. milsymbol is vendored through npm.
- The screenshot harness fails visibly if any request leaves localhost.

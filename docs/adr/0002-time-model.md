# ADR 0002: Time travel on the ingest axis

**Status:** accepted, 2026-10-23.

## Decision

Replay and `asOf(T)` select records by `ingest_time ≤ T`. The storyboard requires that later material stays hidden until receipt; selecting by source time would leak late intelligence into earlier views.

Rules for reading state:
- Entity state is last-writer-wins on `source_time`. A late record with an older source time is journaled but does not change state.
- Before applying a record received at `t_r`, entities with `expiry_time ≤ t_r` are removed.
- A read at T ends with a sweep at T.
- `Engine.index`, `Engine.asOf` and `Cursor.advance` all follow these rules. A property test checks that a keyframe seek always equals a sequential replay.

Keyframes:
- Policy: every 10,000 records or 30 minutes of ingest time.
- Entities are immutable values, so a keyframe is a shallow `Map` copy.
- Measured: about 18 ms per seek in the raid window, and about 1 s to index 294k records.

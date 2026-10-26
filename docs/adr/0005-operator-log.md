# ADR 0005: Operator objects on a chained operator log

**Status:** accepted, 2026-10-24.

## Context

The console's annotate tools (Draw, Measure, Geofence) turn a sketch into a command object. That object has to be part of the record: it needs an author, a time, a label, releasability and a hash, like everything else on screen.

The base journal cannot take these records directly, for two reasons:
- **It is append-only in ingest order,** and keyframes depend on that order.
- **Operators annotate during replay,** at whatever picture time is on screen, which is usually in the journal's past.

## Decision

- **A second hash chain, the operator log** (`packages/engine-core/src/operator.ts`). Its first record's `prev_hash` is the journal head hash, so the operator's work extends the same verifiable record.
  - Seqs start at 1,000,000,001, so they never collide with journal seqs.
  - Reads go through a time index, because records arrive out of ingest order.
- **Time.** A record is stamped at the author's picture time: `source_time = ingest_time = T` on screen.
  - `asOf(T)` and every cursor apply the log alongside the journal.
  - A session already past T picks the record up at once (`Cursor.late`). A session before T picks it up as its clock crosses T.
- **The server stamps; the console never does.** It sets the author (session identity), label, releasability (the author's own), provenance (`integration: 'console'`), times and the hash chain.
  - The console sends only the shape and its details (`publish` on the existing WebSocket).
  - Only `annotation`, `axis`, `nfz`, `geofence` and `measure` may be authored from the console.
- **Withdrawal is a new record** (`is_live: false`); the original stays in the chain. Withdrawing a geofence also journals a `cleared` firing, and its firings after that time are superseded.
- **Geofences fire like any other rule.**
  - On promotion, the server replays the picture forward from the geofence's time to the end of the journal, sampling every 5 s.
  - It journals every entry, exit or end-inside of a watched track (hostile, unidentified or any) as a `rule_fire` with `rule_id: geofence:<id>`. Firings are capped at 300.
  - Replay and scrubbing then show them at the times they happened.
- **Persistence:** one JSON line per record, in `<journal>.operator.jsonl`.
  - On start, each record is re-hashed against the chain.
  - A file anchored to another journal root (the journal was regenerated) is renamed `.orphan-<ms>` and not loaded.

## Consequences

- Every drawn object and every geofence alert is attributable and verifiable back to the sovereign root.
- **Geofence firings are precomputed,** not evaluated live. That suits replay. Live ingest (Phase 5) will need the same rule evaluated as records arrive.
- **Ed25519 signatures** are still pending; they will cover the operator log as well as the journal.

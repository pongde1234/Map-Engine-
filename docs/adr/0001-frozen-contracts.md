# ADR 0001: Frozen contracts for parallel work

**Status:** accepted, 2026-10-23.

## Context

Six or more developers work in parallel. Three interfaces sit between their workstreams, so they are frozen first. A change to any of them needs an ADR and a version bump.

## Decision

1. **Record envelope and entity components** (`packages/schema/src/envelope.ts`, `entity.ts`).
   - A record carries provenance, `source_time` and `ingest_time` (integer ms UTC), label, releasability, `derived_from`, `thread_id` and the hash chain.
   - Entity components follow publicly documented Lattice concepts (ontology, location, mil_view, provenance, expiry) plus DSS additions (classification hypotheses, effector magazines, groups, plant units).
2. **WebSocket protocol** (`packages/schema/src/protocol.ts`, `PROTOCOL_VERSION = 1`).
   - Message types: `snapshot`, `delta`, `pos`, `events` and `clock`.
   - Time-dependent messages carry an epoch.
3. **Adapter interfaces** (`packages/adapters/src/index.ts`).
   - Faclon I/O Connect, UNS, I/O Sense, Insights, DeepSense and Bruce, plus outbound links.
   - Stubs serve the recorded bundle until the live APIs arrive.

## Consequences

Packages build against source exports, with no build step in development. Any contract change breaks the type check across the workspace first, which is intended.

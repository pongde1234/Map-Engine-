# ADR 0004: Dense console on the Faclon Design System

**Status:** accepted, 2026-10-23.

## Decision

- **Chrome from FDS:** AppShell (the map is a canvas page: `pagePadding="none"`, `pageHeight="fill"`), TreeView, ActionList, Tabs, Badge, Counter, Indicator, Tooltip, ChipGroup, ScrollArea and Button.
- **Map widgets are composites** in `packages/ui`: age bars, hypothesis meters, magazine bullets, ring occupancy, ring radar and timeline lanes. They use only defined Tier-2 tokens. FDS ships no `--zone-*`, `--background-surface-sunken` or `--background-surface-default`, and spacing tokens stop at 64.
- **Map colours are read from tokens at runtime** (`packages/map/src/theme.ts`), so the basemap re-themes with FDS.
- **Documented exception:** MIL-STD-2525 symbol fills (standard artwork via milsymbol).
- **Glyph-first density:** shape, colour and numeral first; words go in tooltips and the pinned inspector.

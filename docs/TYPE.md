# Type in the console

One page for everyone building screens. The rule: **text is set by role, in FDS type classes and tokens, at 12px or more.** The roles live in `packages/ui/src/type.ts`; use `<Text role="…">` or `typeClass(role)` instead of picking a class and a colour by hand. `pnpm check` runs `tools/checks/type-lint.mjs`, and `tools/checks/type-audit.mjs` measures the rendered app.

## Roles

| Role | Class | Ink | For |
|---|---|---|---|
| Panel / entity title | HeadingSmallSemibold (18) | normal | the title of an inspector or a detail panel |
| `section` | BodyMediumSemibold (14) | normal | a panel section's heading (`Section`, `Facts` title) |
| `subhead` | BodySmallSemibold (12) | normal | a heading inside a card or tile |
| `row` | BodyMediumMedium (14) | normal | the title of a row or a card |
| `value` | BodyMediumMedium (14) + tabular | normal | a fact's value |
| `label` | BodySmallMedium (12) | muted | a field, tile or eyebrow label |
| `caption` | BodySmallRegular (12) | muted, or secondary if it carries data | a secondary line |
| `empty` | BodySmallRegular (12) | muted | nothing to show, in a list (FDS `EmptyState` for a whole area) |
| `error` | BodySmallRegular (12) | negative | a validation message |
| `alarm` | BodySmallMedium (12) | negative or notice | a status line the reader must act on |

Figures: a KPI tile is Metric Heading Large (24); a tile in the Target Board strip is Metric Heading Small (18); a figure in a dense row is BodySmallMedium with `bs-num`.

## Inks

- **normal**: identity and values.
- **secondary** (`bs-ink-secondary`, `--text-neutral-subtle`): supporting facts that carry data: ranges, probabilities, costs, descriptions.
- **muted** (`bs-muted`, `--text-neutral-muted`): labels, units, timestamps. Never an alarm and never a figure. In dark theme `bs-muted` is lifted to the subtle ink, because FDS's muted is 4.33:1 on a dark panel.
- **negative / notice** (`bs-ink-negative`, `bs-ink-notice`): the `-normal` tokens only. The `-subtle` and `-muted` chromatic tokens fail contrast as text.

## Size floor

12px for anything read. 10px is only what FDS fixes: a small Badge (a category tag such as DRAWN or a frame id) and a small Counter (a count at the end of a row). A status word (a badge that says something is wrong, contested, delegated) is a Medium Badge. Never `BodyXSmall` or `CodeSmall` in app code.

## Badges

Intense is for Neutral and Negative badges only. In dark theme the Intense fills of Brand, Notice, Positive and Information fall below 4.5:1 with white text, so those colours are Subtle. Amber (Notice) Subtle is 4.2:1 on a light panel: it is FDS's token, used for graded caution (aging, degraded, medium); a word that must be read at a glance uses Neutral, Negative or Brand instead.

## Map text

deck.gl labels are 12px; basemap labels keep Protomaps' sizes with a 10px floor; the scale and attribution use Inter 12px through FDS's font tokens (`map.css`). Text on the map is coloured from `--text-*` tokens where it is text; symbols (a contested diamond, a kill cross) are graphics and keep their status colours.

## Checks

- `node tools/checks/type-lint.mjs`: no 10px class, no hand-set font property, no literal text colour, no muted error.
- `AUDIT_BASE=http://127.0.0.1:5174/ node tools/checks/type-audit.mjs`: share of text under 12px, neutral text under 4.5:1, size/weight pairs per view, in dark and light.

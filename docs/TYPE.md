# Type in the console

One page for everyone building screens. The rule: **text is set by role, in FDS type classes and tokens, at 12px or more.** The roles live in `packages/ui/src/type.ts`; use `<Text role="…">` or `typeClass(role)` instead of picking a class and a colour by hand. `pnpm check` runs `tools/checks/type-lint.mjs`, and `tools/checks/type-audit.mjs` measures the rendered app.

## Roles

One reading size: **16px for headings and body alike, set apart by weight**: semibold for a title or a heading, medium for a subhead or a row's title, regular for values and prose. Labels, captions and metadata are 12px, a step below. FDS has no bold at 16px, so a title and the section headings beneath it share semibold; position (and the symbol beside an object's name) marks the title. Text inside FDS components (ActionList, Table, Button, Badge) keeps FDS's own size.

| Role | Class | Ink | For |
|---|---|---|---|
| `title` | BodyLargeSemibold (16) | normal | the title of an inspector, a detail panel or a dialog |
| `section` | BodyLargeSemibold (16) | normal | a panel section's heading (`Section`, `Facts` title) |
| `subhead` | BodyMediumMedium (14) | normal | a heading inside a card or tile: a step under the card's 16px title |
| `row` | BodyLargeMedium (16) | normal | the title of a row or a card |
| `value` | BodyMediumRegular (14) + tabular | normal | a fact's value |
| `body` | BodyLargeRegular (16) | normal | a sentence of prose (a dialog's text) |
| `label` | BodySmallMedium (12) | muted | a field, tile or eyebrow label |
| `caption` | BodySmallRegular (12) | muted, or secondary if it carries data | a secondary line |
| `empty` | BodySmallRegular (12) | muted | nothing to show, in a list (FDS `EmptyState` for a whole area) |
| `error` | BodySmallRegular (12) | negative | a validation message |
| `alarm` | BodySmallMedium (12) | negative or notice | a status line the reader must act on |

FDS list rows (`ActionListItem`, `ActionListSection`) in the panels take these roles from one scoped block at the end of `packages/ui/src/styles.css`: a row's title is 14px / 500 in normal ink, its detail line 12px in the secondary ink (it carries data), a group title 12px / 500 muted. A new list needs no per-row classes; `type-audit.mjs` fails a panel row off these sizes. A high-severity row is red in its icon and its tag only, never its title.

Figures: a KPI tile is Metric Heading Large (24); a tile in the Target Board strip is Metric Heading Small (18); a figure in a dense row is BodySmallMedium with `bs-num`.

## Inks

- **normal**: identity and values.
- **secondary** (`bs-ink-secondary`, `--text-neutral-subtle`): supporting facts that carry data: ranges, probabilities, costs, descriptions.
- **muted** (`bs-muted`, `--text-neutral-muted`): labels, units, timestamps. Never an alarm and never a figure. In dark theme `bs-muted` is lifted to the subtle ink, because FDS's muted is 4.33:1 on a dark panel.
- **negative / notice / positive / info** (`bs-ink-negative`, `bs-ink-notice`, `bs-ink-positive`, `bs-ink-info`): the `-normal` tokens only. The `-subtle` and `-muted` chromatic tokens fail contrast as text. Positive and info are for state words (CLEAR, READY, ENGAGING), never for body text.

## Case

Text is in sentence case: a state word is "Saturated", "Engaging", "At floor"; a kind is "Fused track". Capitals are kept for codes and identifiers only (R3, P1, DP-6, F-0530, NORTH · W1, MGRS, SYNTHETIC as the marking) and for Badge labels, which are chips. Colour and the dot already make a state stand out.

## Size floor

12px for anything read. 10px is only what FDS fixes: a small Badge (a category tag such as DRAWN or a frame id) and a small Counter (a count at the end of a row). Every Badge in the console is Small (16px), whatever it says (a status word, a priority, a gate, a time tag, a verdict) and wherever it sits (a card, a row, a fact, a panel's header chips); the lint fails a Medium or Large one. Never `BodyXSmall` or `CodeSmall` in app code.

## Badges

One size: Small. Only the colour and the emphasis say what a tag is.

Intense is for Neutral and Negative badges only. In dark theme the Intense fills of Brand, Notice, Positive and Information fall below 4.5:1 with white text, so those colours are Subtle. Amber (Notice) Subtle is 4.2:1 on a light panel: it is FDS's token, used for graded caution (aging, degraded, medium); a word that must be read at a glance uses Neutral, Negative or Brand instead.

## Map text

deck.gl labels are 12px; basemap labels keep Protomaps' sizes with a 10px floor; the scale uses Inter 12px through FDS's font tokens (`map.css`). Text on the map is coloured from `--text-*` tokens where it is text; symbols (a contested diamond, a kill cross) are graphics and keep their status colours.

## Checks

- `node tools/checks/type-lint.mjs`: no 10px class, no hand-set font property, no literal text colour, no muted error, no Badge larger than Small, no layout corner that is not a radius token.
- `AUDIT_BASE=http://127.0.0.1:5174/ node tools/checks/type-audit.mjs`: share of text under 12px, neutral text under 4.5:1, size/weight pairs per view, in dark and light.

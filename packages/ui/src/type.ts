/**
 * The product's type roles, each one FDS class and one ink. Text in the console is set through
 * these (see Text.tsx), so a role looks the same on every page and a change is one edit here.
 *
 * Reading text is 12px at the least: BodyXSmall (10px) is left to what FDS fixes at that size
 * (a small Badge, a small Counter). Three inks, as the FDS Table guard names them:
 *   normal    identity and values
 *   secondary supporting facts: ranges, probabilities, costs, descriptions (--text-neutral-subtle)
 *   muted     metadata: labels, units, timestamps (--text-neutral-muted); never an alarm or a figure
 * Chromatic ink is the -normal token only: the -subtle and -muted ones fail contrast as text.
 */
export type TextRole =
  | 'section' // a panel section's heading
  | 'subhead' // a heading inside a card or tile
  | 'row' // the title of a row
  | 'value' // a fact's value
  | 'label' // a field, tile or eyebrow label
  | 'caption' // a secondary line
  | 'empty' // nothing to show, in a list
  | 'error' // a validation message
  | 'alarm'; // a status line the reader must act on

export type Ink = 'normal' | 'secondary' | 'muted' | 'negative' | 'notice';

/** FDS type class (size, weight, line-height) per role. */
export const TYPE: Record<TextRole, string> = {
  section: 'BodyMediumSemibold',
  subhead: 'BodySmallSemibold',
  row: 'BodyMediumMedium',
  value: 'BodyMediumMedium bs-num',
  label: 'BodySmallMedium',
  caption: 'BodySmallRegular',
  empty: 'BodySmallRegular',
  error: 'BodySmallRegular',
  alarm: 'BodySmallMedium',
};

/** The ink a role has unless the caller says otherwise. */
export const DEFAULT_INK: Record<TextRole, Ink> = {
  section: 'normal',
  subhead: 'normal',
  row: 'normal',
  value: 'normal',
  label: 'muted',
  caption: 'muted',
  empty: 'muted',
  error: 'negative',
  alarm: 'negative',
};

/** CSS class per ink (normal inherits the text colour). */
export const INK_CLASS: Record<Ink, string> = {
  normal: '',
  secondary: 'bs-ink-secondary',
  muted: 'bs-muted',
  negative: 'bs-ink-negative',
  notice: 'bs-ink-notice',
};

/** The class string for a role and ink, for places a component cannot be used (SVG, FDS slots). */
export const typeClass = (role: TextRole, ink: Ink = DEFAULT_INK[role]): string => [TYPE[role], INK_CLASS[ink]].filter(Boolean).join(' ');

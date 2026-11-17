/**
 * The colour of a drawn object on the map: the eight colours an operator may choose, as dots in a
 * row (FDS Buttons, the chosen one raised), and a reset to the console's own pick once another
 * is chosen. Always shows the colour in use, so the default reads as chosen until it is changed.
 */
import { Button, IconButton, Tooltip } from '@faclon-labs/fds';
import { RotateCcw } from 'lucide-react';
import type { OperatorColor } from '@me/schema';
import { COLOR_TONE, OPERATOR_COLORS, toneCss } from '@me/map';

const WORD: Record<OperatorColor, string> = { sapphire: 'Sapphire', indigo: 'Indigo', green: 'Green', teal: 'Teal', pink: 'Pink', lavender: 'Lavender', steel: 'Steel', amber: 'Amber' };

export function ColorPicker({ value, isDefault, onChange, onReset, isDisabled }: { value: OperatorColor; isDefault: boolean; onChange: (c: OperatorColor) => void; onReset: () => void; isDisabled?: boolean }) {
  return (
    <div className="bs-colors" role="group" aria-label="Colour on the map">
      {OPERATOR_COLORS.map((c) => (
        <Tooltip key={c} content={c === value && isDefault ? `${WORD[c]} (default)` : WORD[c]}>
          <Button iconOnly size="xs" variant={c === value ? 'secondary' : 'ghost'} tone="neutral" aria-label={WORD[c]} aria-pressed={c === value} isDisabled={isDisabled ?? false} onClick={() => onChange(c)}>
            <span className="bs-swatch bs-swatch--lg" style={{ background: toneCss(COLOR_TONE[c]) }} />
          </Button>
        </Tooltip>
      ))}
      {!isDefault ? (
        <Tooltip content="Use the default colour">
          <IconButton icon={RotateCcw} size="Small" isHighlighted accessibilityLabel="Use the default colour" isDisabled={isDisabled ?? false} onClick={onReset} />
        </Tooltip>
      ) : null}
    </div>
  );
}

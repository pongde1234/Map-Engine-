/**
 * MIL-STD-2525 symbol artwork (milsymbol) as an image. FDS has no military symbology; this is
 * content artwork, like a picture, not a UI component.
 */
import { memo } from 'react';
import { symbolSvg } from '@me/symbology';

export function symbolDataUri(sidc: string, size = 18): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbolSvg(sidc, size))}`;
}

export const SymbolGlyph = memo(function SymbolGlyph({ sidc, size = 18, title }: { sidc: string; size?: number; title?: string }) {
  return <img className="bs-glyph" src={symbolDataUri(sidc, size)} alt={title ?? `symbol ${sidc}`} />;
});

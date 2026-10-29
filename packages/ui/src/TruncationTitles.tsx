/**
 * Hover text for cut-off text. Wherever a line is shortened with an ellipsis (a name, a title, a
 * detail line) or clamped to a few lines, pointing at it shows the whole text in the browser's
 * hover tooltip, as the icon buttons' names do (IconTitles.tsx). One listener for the whole
 * console, so new views and FDS's own rows need nothing: on pointer over, the nearest cut-off
 * element at or above the pointer gets its text as its `title`; the title is taken away again when
 * the text fits (a wider panel), and an element that already has its own title keeps it.
 */
import { useEffect } from 'react';

const OURS = 'data-bs-trunc';

function isCut(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  const clamp = cs.getPropertyValue('-webkit-line-clamp');
  return !!clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
}

const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function tag(from: EventTarget | null): void {
  let el = from instanceof HTMLElement ? from : null;
  // A cut-off line is the element itself or the row around the pointer: look a few levels up.
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    const ours = el.hasAttribute(OURS);
    const cut = isCut(el);
    if (cut && (ours || !el.hasAttribute('title'))) {
      const text = textOf(el);
      if (text) {
        el.setAttribute('title', text);
        el.setAttribute(OURS, '');
      }
      return;
    }
    if (ours && !cut) {
      el.removeAttribute('title');
      el.removeAttribute(OURS);
    }
  }
}

export function TruncationTitles() {
  useEffect(() => {
    const onOver = (e: PointerEvent) => tag(e.target);
    document.addEventListener('pointerover', onOver, { passive: true });
    return () => document.removeEventListener('pointerover', onOver);
  }, []);
  return null;
}

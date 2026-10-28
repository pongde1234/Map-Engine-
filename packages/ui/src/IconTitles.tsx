/**
 * Hover text for the icon-only buttons FDS draws itself, which take no Tooltip from outside: the
 * shell's applications, notifications and profile buttons, a dialog's close, the assistant's
 * attach and send. Each gets its accessible name as its `title`, which the browser shows on hover.
 *
 * Every icon button the console draws carries an FDS Tooltip instead (marked `data-bs-tip` where
 * it is an FDS IconButton, so it is not given a second, native one).
 */
import { useEffect } from 'react';

const BUTTONS = '.ds-icon-btn, .ds-ai-composer button, .ds-shell button:has(.ds-avatar)';

function nameOf(el: Element): string | null {
  const own = el.getAttribute('aria-label');
  if (own) return own;
  // A button holding only an avatar (the profile menu): the avatar's name.
  return el.querySelector('.ds-avatar')?.getAttribute('aria-label') ?? null;
}

function apply(root: ParentNode): void {
  root.querySelectorAll(BUTTONS).forEach((el) => {
    if (el.hasAttribute('title') || el.hasAttribute('data-bs-tip') || el.closest('[data-bs-tip]')) return;
    const name = nameOf(el);
    if (name) el.setAttribute('title', name);
  });
}

export function IconTitles() {
  useEffect(() => {
    apply(document);
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(document));
    });
    // New buttons arrive with dialogs, menus and the assistant; a label can change (the bell's unread count).
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return null;
}

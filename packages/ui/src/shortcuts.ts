/**
 * When a global single-key shortcut (Space, L, I, D, M, G, the presenter's [ and ]) must leave a
 * key alone. A key belongs to the widget in focus when that widget is typing (an input), picking
 * (a menu, list, tree, select, dialog) or pressing (Space on a button, checkbox or switch); and to
 * whoever already handled it (`defaultPrevented`, which a menu or the sketch sets on Escape).
 * While any dialog or menu is open the page behind it takes no shortcut at all.
 */
export interface KeyLike {
  key: string;
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}
interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** Widgets that read letters and arrows themselves (type-ahead, row focus). */
const READS_KEYS = '[role="menu"],[role="menuitem"],[role="dialog"],[role="alertdialog"],[role="listbox"],[role="option"],[role="combobox"],[role="tree"],[role="treeitem"],[role="grid"]';
/** Controls that Space and Enter press. */
const PRESSED_BY_SPACE = 'button,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"]';
/**
 * Anything open over the page that owns the keyboard until it closes: a dialog, or a dropdown's
 * overlay. FDS keeps closed dropdowns mounted (laid out as nothing), and a plain ActionList in a
 * panel is also role="menu", so what counts is a match that is on screen.
 */
const OPEN_OVER_PAGE = '[role="dialog"],[role="alertdialog"],.ds-dropdown-menu-positioner,.ds-dropdown-menu';

const onScreen = (selector: string): boolean => typeof document !== 'undefined' && [...document.querySelectorAll(selector)].some((el) => el.getClientRects().length > 0);

export function shortcutBlocked(e: KeyLike, hasOpen: (selector: string) => boolean = onScreen): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target as ElementLike | null;
  if (el) {
    const tag = el.tagName?.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (el.closest?.(READS_KEYS)) return true;
    if ((e.key === ' ' || e.key === 'Enter') && el.closest?.(PRESSED_BY_SPACE)) return true;
  }
  return hasOpen(OPEN_OVER_PAGE);
}

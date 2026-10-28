import { describe, expect, it } from 'vitest';
import { shortcutBlocked, type KeyLike } from '../src/shortcuts.ts';

/** A target that is `tag`, inside any of the selectors in `within` (a stand-in for a DOM ancestor). */
const target = (tag: string, within: string[] = [], editable = false) => ({
  tagName: tag,
  isContentEditable: editable,
  closest: (sel: string) => (within.some((w) => sel.includes(w)) ? {} : null),
});
const key = (k: string, t: unknown, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, target: t, ...over });
const none = () => false;

describe('shortcutBlocked', () => {
  it('lets a plain key on the page through', () => {
    expect(shortcutBlocked(key('l', target('DIV')), none)).toBe(false);
    expect(shortcutBlocked(key(' ', target('BODY')), none)).toBe(false);
  });

  it('leaves typing to inputs, text areas, selects and editable text', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(shortcutBlocked(key('g', target(tag)), none)).toBe(true);
    expect(shortcutBlocked(key('g', target('DIV', [], true)), none)).toBe(true);
  });

  it('leaves letters to menus, lists, trees and dialogs (type-ahead)', () => {
    for (const role of ['menu', 'menuitem', 'listbox', 'option', 'tree', 'treeitem', 'dialog']) expect(shortcutBlocked(key('g', target('DIV', [`role="${role}"`])), none)).toBe(true);
  });

  it('leaves Space and Enter to the control that is pressed, but not letters', () => {
    const button = target('BUTTON', ['button,a[href]']);
    expect(shortcutBlocked(key(' ', button), none)).toBe(true);
    expect(shortcutBlocked(key('Enter', button), none)).toBe(true);
    expect(shortcutBlocked(key('l', button), none)).toBe(false);
  });

  it('leaves a key already handled (Escape that closed a menu or cancelled a sketch)', () => {
    expect(shortcutBlocked(key('Escape', target('DIV'), { defaultPrevented: true }), none)).toBe(true);
  });

  it('leaves chords to the browser', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) expect(shortcutBlocked(key('l', target('DIV'), { [mod]: true }), none)).toBe(true);
  });

  it('takes nothing while a dialog or menu is open over the page', () => {
    expect(shortcutBlocked(key('d', target('DIV')), (s) => s.includes('dialog'))).toBe(true);
    expect(shortcutBlocked(key('d', null), (s) => s.includes('ds-dropdown-menu'))).toBe(true);
    // A plain list in a panel is not "open over the page".
    expect(shortcutBlocked(key('d', target('DIV')), (s) => s.includes('role="menu"') && !s.includes('ds-dropdown-menu'))).toBe(false);
  });
});

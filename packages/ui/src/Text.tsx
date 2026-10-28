/**
 * Text by role: one FDS type class and one ink, from type.ts. Use it instead of choosing a
 * class and a colour by hand, so a heading, a caption or an error reads the same everywhere.
 */
import type { ElementType, ReactNode } from 'react';
import { typeClass, type Ink, type TextRole } from './type.ts';

export function Text({ role, ink, as, className, children }: { role: TextRole; ink?: Ink; as?: ElementType; className?: string; children: ReactNode }) {
  const Tag = as ?? 'span';
  const cls = [typeClass(role, ink), className].filter(Boolean).join(' ');
  return <Tag className={cls}>{children}</Tag>;
}

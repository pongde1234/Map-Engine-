/**
 * The body of a review dialog for an operator object (custom alert, registered source, operator
 * layer): what it is as the lead line with its state tag beside it, then its record facts on the
 * dialog's own inset (no second padding), then one quiet line saying what Withdraw does.
 */
import type { ReactNode } from 'react';
import { Facts, type Fact } from './Facts.tsx';
import { typeClass } from './type.ts';

export function Review({ lead, state, facts, note }: { lead: string; state?: ReactNode; facts: Fact[]; note: string }) {
  return (
    <div className="bs-review">
      <div className="bs-review__lead">
        <span className={typeClass('subhead')}>{lead}</span>
        {state}
      </div>
      <Facts flush items={facts} />
      <p className="BodySmallRegular bs-muted bs-review__note">{note}</p>
    </div>
  );
}

/**
 * Custom alerts, set from the Alerts panel. An alert is an operator object on the record: name,
 * what it watches and its severity, stamped with the operator's identity at the picture time. The
 * rules engine then walks the picture from that moment and journals each firing and clearing, so
 * the firings appear in the feed (type "Custom alerts") at the times they happened. Every number
 * is the operator's own. Withdrawing an alert clears it.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListSection,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuOverlay,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SelectInput,
  TextInput,
  useToast,
} from '@faclon-labs/fds';
import { CLASSES, type AlertRule, type Entity, type EntityComponents, type RuleFirePayload } from '@me/schema';
import type { MapClient } from '@me/client';
import { useClient, useEngineTime, useEvents } from '@me/map-react';
import { Facts } from './Facts.tsx';
import { raidLabel } from './format.ts';
import { WATCH } from './sketch.ts';

type Condition = AlertRule['condition'];
type Severity = AlertRule['severity'];

const CONDITIONS: Array<{ id: Condition; label: string }> = [
  { id: 'count_in_ring', label: 'Count in a ring' },
  { id: 'near_vp', label: 'Near the VA/VP' },
  { id: 'magazine_low', label: 'Magazine low' },
  { id: 'class_appears', label: 'A class appears' },
];
const RINGS: Array<{ id: NonNullable<AlertRule['ring']>; label: string }> = [
  { id: 'R4', label: 'R4' },
  { id: 'R3', label: 'R3' },
  { id: 'R2', label: 'R2' },
  { id: 'R1', label: 'R1' },
  { id: 'all', label: 'Whole picture' },
];
const SEVERITIES: Array<{ id: Severity; label: string }> = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
const SEVERITY_COLOR: Record<Severity, 'Negative' | 'Notice' | 'Neutral'> = { high: 'Negative', medium: 'Notice', low: 'Neutral' };
const THREAT_CLASSES = Object.values(CLASSES).filter((c) => c.threat);

/** A field that picks one of a few options: the FDS SelectInput over a DropdownMenu. */
export function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string; description?: string }>; onChange: (v: T) => void }) {
  return (
    <DropdownMenu selectionType="single" value={[value]} onChange={({ values }) => values[0] && onChange(values[0] as T)}>
      <SelectInput label={label} placeholder={label} />
      <DropdownMenuOverlay placement="bottom-start">
        <ActionList accessibilityLabel={label}>
          {options.map((o) => (
            <ActionListItem key={o.id} value={o.id} title={o.label} {...(o.description ? { description: o.description } : {})} />
          ))}
        </ActionList>
      </DropdownMenuOverlay>
    </DropdownMenu>
  );
}

const watchWord = (w: AlertRule['watch']) => (w === 'unidentified' ? 'unidentified tracks' : w === 'any' ? 'tracks' : 'hostile tracks');

/** The alert in one line, as the operator set it. */
export function alertSummary(rule: AlertRule, client: MapClient): string {
  switch (rule.condition) {
    case 'count_in_ring':
      return `${rule.count ?? 1} or more ${watchWord(rule.watch)} ${rule.ring && rule.ring !== 'all' ? `in ${rule.ring}` : 'in the picture'}`;
    case 'near_vp':
      return `${watchWord(rule.watch).replace(/s$/, '')} within ${(rule.distance_m ?? 0) / 1000} km of the VA/VP`.replace(/^\w/, (c) => `A ${c}`);
    case 'magazine_low': {
      const unit = rule.unit ? (client.entities.get(rule.unit)?.aliases?.name ?? rule.unit) : 'Any fire unit';
      return rule.ready !== undefined ? `${unit} at ${rule.ready} ready or fewer` : `${unit} at its magazine floor`;
    }
    case 'class_appears':
      return `${(rule.classes ?? []).map((c) => CLASSES[c]?.label ?? c).join(' or ') || 'A class'} appears`;
  }
}

/** The operator's custom alerts in the picture, with their latest state from the feed. */
export function useCustomAlerts(): Array<{ e: Entity; rule: AlertRule; state: 'armed' | 'fired' | 'clear'; last?: number }> {
  const client = useClient();
  const events = useEvents();
  return useMemo(() => {
    const latest = new Map<string, { state: string; t: number }>();
    for (const r of events) {
      if (r.kind !== 'rule_fire') continue;
      const p = r.payload as RuleFirePayload;
      if (p.rule === 'custom') latest.set(p.rule_id, { state: p.state, t: r.ingest_time });
    }
    return [...client.entities.values()]
      .filter((e) => e.geo_details?.type === 'alert' && e.alert_rule)
      .map((e) => {
        const l = latest.get(`alert:${e.entity_id}`);
        return { e, rule: e.alert_rule!, state: !l ? ('armed' as const) : l.state === 'fired' ? ('fired' as const) : ('clear' as const), ...(l ? { last: l.t } : {}) };
      });
    // Recomputed when the events or the entities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, client.entities.size]);
}

/** The custom alerts, as a section above the feed; selecting one opens it. */
export function CustomAlertList({ onOpen }: { onOpen: (id: string) => void }) {
  const client = useClient();
  const alerts = useCustomAlerts();
  const clock = client.scenario?.clock;
  if (!alerts.length) return null;
  return (
    <ActionList accessibilityLabel="Custom alerts">
      <ActionListSection title={`Custom alerts · ${alerts.length}`}>
        {alerts.map(({ e, rule, state, last }) => (
          <ActionListItem
            key={e.entity_id}
            value={e.entity_id}
            title={e.aliases?.name ?? e.entity_id}
            description={`${alertSummary(rule, client)}${last !== undefined ? ` · ${raidLabel(last, clock)}` : ''}`}
            titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={state === 'fired' ? SEVERITY_COLOR[rule.severity] : 'Neutral'} emphasis="Subtle" label={state === 'fired' ? 'FIRED' : state === 'clear' ? 'CLEAR' : 'ARMED'} />}
            onClick={() => onOpen(e.entity_id)}
          />
        ))}
      </ActionListSection>
    </ActionList>
  );
}

/**
 * Set a new custom alert, or (with `alertId`) review one and withdraw it. Recorded as the session's
 * identity at the picture time on screen; the rules engine fires it from then on.
 */
export function AlertRuleModal({ isOpen, alertId, onClose }: { isOpen: boolean; alertId: string | null; onClose: () => void }) {
  const client = useClient();
  const toast = useToast();
  const t = useEngineTime(1000);
  const clock = client.scenario?.clock;
  const who = client.identity;
  const existing = alertId ? client.entities.get(alertId) : undefined;
  const [name, setName] = useState('');
  const [condition, setCondition] = useState<Condition>('count_in_ring');
  const [watch, setWatch] = useState<NonNullable<AlertRule['watch']>>('hostile');
  const [ring, setRing] = useState<NonNullable<AlertRule['ring']>>('R3');
  const [count, setCount] = useState('');
  const [km, setKm] = useState('');
  const [unit, setUnit] = useState<string>('any');
  const [level, setLevel] = useState<'floor' | 'number'>('floor');
  const [ready, setReady] = useState('');
  const [classes, setClasses] = useState<string[]>(['cruise_missile']);
  const [severity, setSeverity] = useState<Severity>('high');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setCondition('count_in_ring');
    setCount('');
    setKm('');
    setUnit('any');
    setLevel('floor');
    setReady('');
    setSeverity('high');
    setError(null);
  }, [isOpen]);
  const units = [...client.entities.values()].filter((e) => e.ontology?.template === 'effector' && e.effector?.magazine).sort((a, b) => (a.aliases?.name ?? '').localeCompare(b.aliases?.name ?? ''));
  const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

  // The rule as entered; null with a reason when something the rule needs is missing.
  const built = (): { rule: AlertRule } | { error: string } => {
    if (!name.trim()) return { error: 'Give the alert a name.' };
    switch (condition) {
      case 'count_in_ring': {
        const n = whole(count);
        return n >= 1 ? { rule: { condition, watch, ring, count: n, severity } } : { error: 'Enter how many tracks fire it (1 or more).' };
      }
      case 'near_vp': {
        const d = Number(km);
        return km.trim() && d > 0 ? { rule: { condition, watch, distance_m: Math.round(d * 1000), severity } } : { error: 'Enter the distance from the VA/VP in km.' };
      }
      case 'magazine_low': {
        const base = { condition, severity, ...(unit !== 'any' ? { unit } : {}) } as AlertRule;
        if (level === 'floor') return { rule: base };
        const n = whole(ready);
        return n >= 0 ? { rule: { ...base, ready: n } } : { error: 'Enter the ready rounds that fire it.' };
      }
      case 'class_appears':
        return classes.length ? { rule: { condition, classes, severity } } : { error: 'Pick at least one class.' };
    }
  };

  const arm = async () => {
    const b = built();
    if ('error' in b) {
      setError(b.error);
      return;
    }
    setBusy(true);
    setError(null);
    const payload: EntityComponents = { aliases: { name: name.trim() }, geo_details: { type: 'alert', label: name.trim().toUpperCase(), status: 'active' }, alert_rule: b.rule };
    try {
      const rec = await client.publish({ payload });
      toast.show({ color: 'Positive', content: `Alert “${name.trim()}” armed. It fires from ${raidLabel(rec.ingest_time, clock)}.` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await client.publish({ entity_id: existing.entity_id, payload: { is_live: false } });
      toast.show({ color: 'Neutral', content: `Alert “${existing.aliases?.name ?? existing.entity_id}” withdrawn.` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (existing?.alert_rule) {
    const rule = existing.alert_rule;
    return (
      <Modal isOpen={isOpen} onDismiss={onClose} size="sm" accessibilityLabel="Custom alert">
        <ModalHeader title={existing.aliases?.name ?? existing.entity_id} subtitle={`Custom alert · set by ${existing.geo_details?.author ?? '—'} at ${raidLabel(existing.ingest_time, clock)}`} />
        <ModalBody>
          <Facts
            items={[
              ['Watches', alertSummary(rule, client), 'wide'],
              ['Severity', <Badge size="Small" color={SEVERITY_COLOR[rule.severity]} emphasis="Subtle" label={rule.severity.toUpperCase()} />],
              ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label={existing.label} />],
              ['Permission', existing.releasability?.join(' · ') ?? '—', 'wide'],
            ]}
          />
          {error ? <p className="BodySmallRegular bs-muted">{error}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" tone="negative" isLoading={busy} onClick={() => void withdraw()}>
            Withdraw alert
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onDismiss={onClose} size="md" accessibilityLabel="New custom alert">
      <ModalHeader title="New custom alert" subtitle={`Recorded as ${who?.display ?? 'you'} at ${raidLabel(t, clock)} · fires from then on`} />
      <ModalBody>
        <div className="bs-form">
          <div className="bs-form__wide">
          <TextInput label="Name" value={name} onChange={({ value }) => setName(value ?? '')} placeholder="R3 watch" isRequired necessityIndicator="required" maxCharacters={40} autoFocus {...(error && !name.trim() ? { validationState: 'error' as const, errorText: error } : {})} />
          </div>
          <Pick label="Fires when" value={condition} options={CONDITIONS} onChange={setCondition} />
          {condition === 'count_in_ring' || condition === 'near_vp' ? <Pick label="Tracks" value={watch} options={WATCH} onChange={setWatch} /> : null}
          {condition === 'count_in_ring' ? (
            <>
              <Pick label="Where" value={ring} options={RINGS} onChange={setRing} />
              <TextInput label="How many" value={count} onChange={({ value }) => setCount(value ?? '')} placeholder="Tracks that fire it" isRequired necessityIndicator="required" />
            </>
          ) : null}
          {condition === 'near_vp' ? <TextInput label="Within (km of the VA/VP)" value={km} onChange={({ value }) => setKm(value ?? '')} placeholder="Distance in km" isRequired necessityIndicator="required" /> : null}
          {condition === 'magazine_low' ? (
            <>
              <Pick
                label="Fire unit"
                value={unit}
                options={[{ id: 'any', label: 'Any fire unit' }, ...units.map((u) => ({ id: u.entity_id, label: u.aliases?.name ?? u.entity_id, description: `${u.effector!.magazine!.ready} ready · floor ${u.effector!.magazine!.floor}` }))]}
                onChange={setUnit}
              />
              <Pick label="Level" value={level} options={[{ id: 'floor', label: 'At its floor' }, { id: 'number', label: 'At a number' }]} onChange={setLevel} />
              {level === 'number' ? <TextInput label="Ready rounds or fewer" value={ready} onChange={({ value }) => setReady(value ?? '')} placeholder="Rounds" isRequired necessityIndicator="required" /> : null}
            </>
          ) : null}
          {condition === 'class_appears' ? (
            <DropdownMenu selectionType="multiple" value={classes} onChange={({ values }) => setClasses(values)}>
              <SelectInput label="Classes" placeholder="Pick one or more" maxRows="multiple" />
              <DropdownMenuOverlay placement="bottom-start">
                <ActionList accessibilityLabel="Classes">
                  {THREAT_CLASSES.map((c) => (
                    <ActionListItem key={c.id} value={c.id} title={c.label} />
                  ))}
                </ActionList>
              </DropdownMenuOverlay>
            </DropdownMenu>
          ) : null}
          <Pick label="Severity" value={severity} options={SEVERITIES} onChange={setSeverity} />
          {error && name.trim() ? <p className="BodySmallRegular bs-muted bs-form__wide">{error}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button size="sm" variant="secondary" tone="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" tone="brand" isLoading={busy} onClick={() => void arm()}>
          Arm alert
        </Button>
      </ModalFooter>
    </Modal>
  );
}

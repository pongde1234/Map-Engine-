/**
 * Assistant: ask about the live picture, docked beside whichever view is open (AppShell's
 * `panel`, opened from the shell's Bruce button). Built on the FDS AI kit (drawer, home,
 * conversation, messages, tool calls, response, composer). Until Bruce is connected through the
 * Faclon adapter, answers come from the picture through fixed read-only tools, every call shown;
 * the assistant never proposes targets or courses of action. Every answer is stamped with the
 * picture time and the journal it read, and its citations open on the map beside it.
 * Suggestions follow the picture, the weakest decision question among them.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@faclon-labs/fds';
import { MapPinned } from 'lucide-react';
import { formatZulu } from '@me/schema';
import { AiComposer, AiConversation, AiDrawer, AiDrawerHome, AiMessage, AiResponse, AiTool, type AiStatus, type AiSuggestion } from '@faclon-labs/fds/ai';
import { useClient } from '@me/map-react';
import { answer, raidLabel, shortHash, suggestionsFor, useDerived, useHealth, type Answer } from '@me/ui';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  answer?: Answer;
}

const PLACEHOLDER = 'Ask about tracks, feeds, freshness, fire units or a decision question';

export function AssistantPanel({
  isOpen,
  onDismiss,
  onOpenOnMap,
  pending,
  onPendingTaken,
}: {
  isOpen: boolean;
  onDismiss: () => void;
  onOpenOnMap: (id: string) => void;
  pending?: string | null;
  onPendingTaken?: () => void;
}) {
  const client = useClient();
  const derived = useDerived(1000);
  const health = useHealth();
  const clock = client.scenario?.clock;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState<AiStatus>('ready');
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextId = useRef(1);
  // Answers that land after the panel has gone are dropped; a development remount keeps them.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || status === 'submitted' || status === 'streaming') return;
    setMsgs((m) => [...m, { id: nextId.current++, role: 'user', text: q }]);
    setDraft('');
    setStatus('submitted');
    // The tools read the picture as it stands when the answer is composed.
    timer.current = setTimeout(() => {
      if (!alive.current) return;
      const a = answer(q, client, derived);
      setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: a.text, answer: a }]);
      setStatus('ready');
    }, 450);
  };
  const stop = () => {
    clearTimeout(timer.current);
    setStatus('ready');
  };
  // A question handed over from a view ("Ask the assistant" on a selected object).
  const taken = useRef<string | null>(null);
  useEffect(() => {
    // Once per hand-over, even when effects run twice (development StrictMode).
    if (!pending || taken.current === pending) return;
    taken.current = pending;
    onPendingTaken?.();
    ask(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  // Suggestions follow the picture: saturation, a contested track, a stale input.
  const suggestions: AiSuggestion[] = suggestionsFor(client, derived).map((label, i) => ({ id: `s${i}`, label }));

  return (
    <AiDrawer
      isOpen={isOpen}
      onDismiss={onDismiss}
      title="Bruce"
      subtitle="Read-only assistant"
      accessibilityLabel="Assistant"
      {...(msgs.length ? { onNewChat: () => (stop(), setMsgs([])) } : {})}
      footer={<AiComposer onSubmit={({ text }) => ask(text)} onStop={stop} status={status} value={draft} onChange={setDraft} placeholder={preview ?? PLACEHOLDER} accessibilityLabel="Ask the assistant" />}
    >
      {msgs.length ? (
        <AiConversation status={status} accessibilityLabel="Conversation with the assistant">
          {msgs.map((m) =>
            m.role === 'user' ? (
              <AiMessage key={m.id} role="user">
                {m.text}
              </AiMessage>
            ) : (
              <AiMessage key={m.id} role="assistant">
                {m.answer?.tools.map((tc, i) => <AiTool key={i} name={tc.name} state="output-available" input={tc.input} output={tc.output} inputLabel="Query" outputLabel="Picture" />)}
                <AiResponse>{m.text}</AiResponse>
                {m.answer ? (
                  <div className="as__cite">
                    {m.answer.cites.map((id) => (
                      <Button key={id} size="xs" variant="secondary" tone="neutral" leadingIcon={<MapPinned size={14} />} onClick={() => onOpenOnMap(id)}>
                        {id}
                      </Button>
                    ))}
                    <span className="BodySmallRegular bs-muted bs-num">
                      Picture as of {clock ? raidLabel(m.answer.asOf, clock) : ''} · {formatZulu(m.answer.asOf).slice(0, 5)}Z{health ? ` · journal ${health.records.toLocaleString('en')} records · root ${shortHash(health.head.hash)}` : ''}
                    </span>
                  </div>
                ) : null}
              </AiMessage>
            ),
          )}
        </AiConversation>
      ) : (
        <AiDrawerHome
          title="Bruce"
          description="Answers from the picture on screen through read-only tools; never targets or courses of action."
          suggestions={suggestions}
          onSuggestionPick={(s) => setDraft(s.label)}
          onSuggestionPreview={(s) => setPreview(s?.label ?? null)}
        />
      )}
    </AiDrawer>
  );
}

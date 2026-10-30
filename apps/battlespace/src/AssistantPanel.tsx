/**
 * Assistant: ask about the live picture, docked beside whichever view is open (AppShell's
 * `panel`, opened from the shell's Bruce button). Built on the FDS AI kit (drawer, home,
 * conversation, messages, tool calls, response, composer). Until Bruce is connected through the
 * Faclon adapter, answers come from the picture through fixed read-only tools, every call shown;
 * the assistant never proposes targets or courses of action. Every answer is stamped with the
 * picture time and the journal it read, and its citations open on the map beside it.
 * Suggestions follow the picture, the weakest decision question among them.
 *
 * Agents (the drawer header's selector, FDS AiDrawer `agents`): Bruce answers about the whole
 * picture; Watch handover summarises a window of time; Decision record reads the decisions in
 * force and who holds authority. Each is a focus of the same read-only tools (assistant.ts
 * AssistantFocus), with its own prompts; switching agent starts a new chat.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@faclon-labs/fds';
import { ClipboardList, Gavel, MapPinned } from 'lucide-react';
import { formatZulu } from '@me/schema';
import { AiComposer, AiConversation, AiDrawer, AiDrawerHome, AiMark, AiMessage, AiResponse, AiTool, type AiAgent, type AiStatus, type AiSuggestion } from '@faclon-labs/fds/ai';
import { useClient } from '@me/map-react';
import { answer, raidLabel, shortHash, suggestionsFor, useDerived, useHealth, type Answer, type AssistantFocus } from '@me/ui';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  answer?: Answer;
}

/** An agent's tile: a 16px rounded square in its colour with a white glyph (Bruce wears FDS's AiMark). */
const tile = (Glyph: typeof Gavel, tone: 'positive' | 'notice') => (
  <span className={`bs-agent bs-agent--${tone}`} aria-hidden>
    <Glyph size={10} strokeWidth={2.5} />
  </span>
);

/**
 * The agents the drawer's header lists, Bruce first (the default). Their mark and name show in the
 * header and the list; the line under the name shows on the start view.
 */
const AGENTS: Array<AiAgent & { focus: AssistantFocus; placeholder: string; prompts?: string[] }> = [
  {
    id: 'bruce',
    name: 'Bruce',
    mark: <AiMark size={16} />,
    description: 'Answers from the picture on screen through read-only tools; never targets or courses of action.',
    focus: 'picture',
    placeholder: 'Ask about tracks, feeds, freshness, fire units or a decision question',
  },
  {
    id: 'handover',
    name: 'Watch handover',
    mark: tile(ClipboardList, 'positive'),
    description: 'Summarises what changed over a window of the raid, for the next watch. Read-only.',
    focus: 'handover',
    placeholder: 'Name a window, such as the last 30 minutes',
    prompts: ['SITREP for the last 15 minutes', 'Summarise the last 30 minutes', 'What happened in the last hour?'],
  },
  {
    id: 'decisions',
    name: 'Decision record',
    mark: tile(Gavel, 'notice'),
    description: 'Reads the decisions in force and who holds engagement authority, from the record.',
    focus: 'decisions',
    placeholder: 'Ask about a decision, a DP or who holds authority',
    prompts: ['Which decisions are in force?', 'Who holds engagement authority now?', 'What does DP-7 allow?'],
  },
];

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
  const [agentId, setAgentId] = useState(AGENTS[0]!.id);
  const agent = AGENTS.find((a) => a.id === agentId) ?? AGENTS[0]!;
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
      const a = answer(q, client, derived, agent.focus);
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
  // Bruce's suggestions follow the picture (saturation, a contested track, a stale input); the other
  // agents offer their own.
  const suggestions: AiSuggestion[] = (agent.prompts ?? suggestionsFor(client, derived)).map((label, i) => ({ id: `s${i}`, label }));

  return (
    <AiDrawer
      isOpen={isOpen}
      onDismiss={onDismiss}
      // The header is FDS's agent selector: the current agent's mark (Bruce's is FDS's own, as on the
      // top bar) and name, opening "Switch to another agent". A new agent starts a new chat.
      agents={AGENTS}
      agent={agent.id}
      onAgentChange={(id) => {
        stop();
        setMsgs([]);
        setDraft('');
        setAgentId(id);
      }}
      accessibilityLabel="Assistant"
      // "+" stays in the header, disabled until a chat is under way.
      onNewChat={() => (stop(), setMsgs([]))}
      hasChat={msgs.length > 0}
      footer={<AiComposer onSubmit={({ text }) => ask(text)} onStop={stop} status={status} value={draft} onChange={setDraft} placeholder={preview ?? agent.placeholder} accessibilityLabel="Ask the assistant" />}
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
                {/* The tool calls, the answer and its citations, at the answer's own 12px rhythm. */}
                <div className="as__turn">
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
                </div>
              </AiMessage>
            ),
          )}
        </AiConversation>
      ) : (
        <AiDrawerHome
          // The mark, the name and the line under it come from the current agent (AGENTS).
          suggestions={suggestions}
          onSuggestionPick={(s) => setDraft(s.label)}
          onSuggestionPreview={(s) => setPreview(s?.label ?? null)}
        />
      )}
    </AiDrawer>
  );
}

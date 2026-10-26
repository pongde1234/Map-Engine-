import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, EmptyState, NAV_ICON_SIZE, Spinner, ThemeProvider, ToastContainer, type NavItem } from '@faclon-labs/fds';
import { ClipboardCheck, Crosshair, Factory, FileCheck2, Landmark, Map as MapIcon, MessageSquare, Network, PlayCircle } from 'lucide-react';
import { MapClient, createViewStore, syncAcrossWindows } from '@me/client';
import { MapEngineProvider, useClient, useViewStore } from '@me/map-react';
import { useDerived } from '@me/ui';
import { BattlespacePage, type PanelState } from './BattlespacePage.tsx';
import { ShellActions } from './ShellActions.tsx';
import { TargetsPage } from './TargetsPage.tsx';
import { StrategicPage } from './StrategicPage.tsx';
import { DebriefPage } from './DebriefPage.tsx';
import { EvidencePage } from './EvidencePage.tsx';
import { usePresenter } from './presenter.ts';

// The assistant brings the FDS AI kit (markdown, syntax highlighting): loaded on first visit so
// the map's first load does not pay for it.
const AssistantPage = lazy(() => import('./AssistantPage.tsx').then((m) => ({ default: m.AssistantPage })));

const NAV: NavItem[] = [
  {
    kind: 'section',
    id: 'dss',
    label: 'Decision System',
    items: [
      { id: 'battlespace', label: 'Battlespace', icon: <MapIcon size={NAV_ICON_SIZE} /> },
      { id: 'strategic', label: 'Strategic', icon: <Landmark size={NAV_ICON_SIZE} /> },
      { id: 'targets', label: 'Targets', icon: <Crosshair size={NAV_ICON_SIZE} /> },
      { id: 'assistant', label: 'Assistant', icon: <MessageSquare size={NAV_ICON_SIZE} /> },
      { id: 'debrief', label: 'Debrief', icon: <ClipboardCheck size={NAV_ICON_SIZE} /> },
      { id: 'evidence', label: 'Evidence', icon: <FileCheck2 size={NAV_ICON_SIZE} /> },
      { id: 'rehearsal', label: 'Rehearsal', icon: <PlayCircle size={NAV_ICON_SIZE} /> },
      { id: 'factory', label: 'Factory', icon: <Factory size={NAV_ICON_SIZE} /> },
      { id: 'ontology', label: 'Ontology', icon: <Network size={NAV_ICON_SIZE} /> },
    ],
  },
];

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function App() {
  const role = new URLSearchParams(location.search).get('role') ?? 'l3';
  const client = useMemo(() => new MapClient({ url: wsUrl(), role }), [role]);
  const view = useMemo(() => createViewStore(), []);

  useEffect(() => {
    client.connect();
    const unsubSync = syncAcrossWindows(view);
    return () => {
      unsubSync();
      client.disconnect();
    };
  }, [client, view]);

  return (
    <ThemeProvider defaultPreference="dark">
      <MapEngineProvider client={client} view={view}>
        <Console />
        <ToastContainer />
      </MapEngineProvider>
    </ThemeProvider>
  );
}

/** Pages with their own scroll regions (canvas pages in the AppShell). */
const CANVAS_PAGES = new Set(['battlespace', 'strategic', 'targets', 'assistant', 'debrief', 'evidence']);

function Console() {
  const client = useClient();
  const view = useViewStore();
  const [page, setPage] = useState('battlespace');
  const [panels, setPanelState] = useState<PanelState>({ leftOpen: true, leftTab: 'layers', rightOpen: true });
  // A question handed to the assistant from another page.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const setPanels = useCallback((p: Partial<PanelState>) => setPanelState((s) => ({ ...s, ...p })), []);
  const derived = useDerived(250);
  // Storyboard frames step from any page; a frame opens its own page (A4: Strategic).
  const presenter = usePresenter(client, view, setPage);
  const isCanvas = CANVAS_PAGES.has(page);
  const label = NAV[0] && 'items' in NAV[0] ? NAV[0].items.find((i) => i.id === page)?.label : undefined;
  return (
    <AppShell
      navItems={NAV}
      activeId={page}
      onNavigate={setPage}
      workspace="Decision System"
      defaultIsPinned={false}
      profile={{ name: client.identity?.display ?? 'Connecting…', org: client.identity?.releasability.join(' · ') ?? '' }}
      unreadCount={derived.activeRules.length}
      onOpenNotifications={() => {
        setPage('battlespace');
        setPanels({ leftOpen: true, leftTab: 'alerts' });
      }}
      actions={<ShellActions />}
      pagePadding={isCanvas ? 'none' : 'default'}
      pageHeight={isCanvas ? 'fill' : 'auto'}
    >
      {page === 'battlespace' ? (
        <BattlespacePage
          derived={derived}
          panels={panels}
          setPanels={setPanels}
          presenter={presenter}
          onNominate={(id) => {
            view.set({ selected: id });
            setPage('targets');
          }}
          onAsk={(q) => {
            setPendingAsk(q);
            setPage('assistant');
          }}
        />
      ) : page === 'strategic' ? (
        <StrategicPage
          presenter={presenter}
          onOpenOnMap={(id, highlight) => {
            view.set({ selected: id, highlight: highlight ?? [] });
            setPage('battlespace');
          }}
          onAsk={(q) => {
            setPendingAsk(q);
            setPage('assistant');
          }}
        />
      ) : page === 'debrief' ? (
        <DebriefPage
          presenter={presenter}
          onOpenOnMap={(id, highlight) => {
            view.set({ selected: id, highlight: highlight ?? [] });
            setPage('battlespace');
          }}
          onReplay={(from) => {
            client.seek(from);
            setPage('battlespace');
            client.play(60);
          }}
        />
      ) : page === 'evidence' ? (
        <EvidencePage presenter={presenter} />
      ) : page === 'targets' ? (
        <TargetsPage
          onOpenOnMap={(id, highlight) => {
            view.set({ selected: id, highlight: highlight ?? [] });
            setPage('battlespace');
          }}
        />
      ) : page === 'assistant' ? (
        <Suspense
          fallback={
            <div className="page-loading">
              <Spinner size="Large" accessibilityLabel="Loading the assistant" />
            </div>
          }
        >
          <AssistantPage
            pending={pendingAsk}
            onPendingTaken={() => setPendingAsk(null)}
            onOpenOnMap={(id) => {
              view.set({ selected: id });
              setPage('battlespace');
            }}
          />
        </Suspense>
      ) : (
        <EmptyState title={`${label ?? 'This view'} is not in this build`} description="The Battlespace map engine is the milestone-1 slice; this section is on the DSS roadmap." />
      )}
    </AppShell>
  );
}

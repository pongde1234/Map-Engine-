import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { AppShell, Badge, TabItem, TabList, TabPanel, Tabs, ThemeProvider, ToastContainer } from '@faclon-labs/fds';
import { Crosshair, Map as MapIcon, Network } from 'lucide-react';
import { MapClient, createViewStore, syncAcrossWindows } from '@me/client';
import { MapEngineProvider, useClient, useViewStore } from '@me/map-react';
import { ConnectionBanner, IconTitles, useDerived } from '@me/ui';
import { BattlespacePage, type PanelState } from './BattlespacePage.tsx';
import { DroppedCommands } from './DroppedCommands.tsx';
import { fitPanels } from './panels.ts';
import { ShellActions } from './ShellActions.tsx';
import { TargetsPage } from './TargetsPage.tsx';
import { OntologyPage } from './OntologyPage.tsx';
import { usePresenter } from './presenter.ts';

// The assistant brings the FDS AI kit (markdown, syntax highlighting): loaded when it is first
// opened, so the map's first load does not pay for it.
const AssistantPanel = lazy(() => import('./AssistantPanel.tsx').then((m) => ({ default: m.AssistantPanel })));

/** The console's views, one page: a strip of tabs in place of a nav rail. Battlespace, Ontology and Targets. */
const VIEWS: Array<{ id: string; label: string; icon: ComponentType<{ size?: number | string }> }> = [
  { id: 'battlespace', label: 'Battlespace', icon: MapIcon },
  { id: 'ontology', label: 'Ontology', icon: Network },
  { id: 'targets', label: 'Targets', icon: Crosshair },
];
const isView = (id: string) => VIEWS.some((v) => v.id === id);

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

function Console() {
  const client = useClient();
  const view = useViewStore();
  const [page, setPage] = useState('battlespace');
  const [panels, setPanelState] = useState<PanelState>(() => fitPanels<PanelState>({ leftOpen: true, leftTab: 'layers', rightOpen: true }, {}, window.innerWidth));
  // The assistant docks beside the open view; it loads on first open and then stays mounted, so
  // its conversation survives closing it and switching views.
  const [assistant, setAssistant] = useState({ open: false, loaded: false });
  // A question handed to the assistant from a view.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const setPanels = useCallback((p: Partial<PanelState>) => setPanelState((s) => fitPanels(s, p, window.innerWidth)), []);
  useEffect(() => {
    const onResize = () => setPanelState((s) => fitPanels(s, {}, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Below 1600 px the docked assistant would leave the map too narrow: the layers panel steps
  // aside while it is open and comes back when it closes (unless the operator moved it meanwhile).
  const stepAside = useRef(false);
  const openAssistant = useCallback(
    (open: boolean) => {
      setAssistant((a) => ({ open, loaded: a.loaded || open }));
      if (open && panels.leftOpen && window.innerWidth < 1600) {
        stepAside.current = true;
        setPanels({ leftOpen: false });
      } else if (!open && stepAside.current) {
        stepAside.current = false;
        if (!panels.leftOpen) setPanels({ leftOpen: true });
      }
    },
    [panels.leftOpen, setPanels],
  );
  const derived = useDerived(250);
  // Storyboard frames step from any view; a frame opens its own view (A2: Ontology).
  const presenter = usePresenter(client, view, setPage);
  const openOnMap = (id: string | null, highlight?: string[]) => {
    // The map takes the id and flies there once it is on screen (it may not be mounted yet).
    view.set({ selected: id, highlight: highlight ?? [], locate: id });
    setPage('battlespace');
  };
  const ask = (q: string) => {
    setPendingAsk(q);
    openAssistant(true);
  };

  const render = (id: string): ReactNode => {
    switch (id) {
      case 'battlespace':
        return (
          <BattlespacePage
            derived={derived}
            panels={panels}
            setPanels={setPanels}
            presenter={presenter}
            onNominate={(id) => {
              view.set({ selected: id });
              setPage('targets');
            }}
            onAsk={ask}
          />
        );
      case 'ontology':
        return <OntologyPage presenter={presenter} onOpenOnMap={openOnMap} />;
      case 'targets':
        return <TargetsPage presenter={presenter} onOpenOnMap={openOnMap} />;
      default:
        return null;
    }
  };

  return (
    <AppShell
      activeId={page}
      // A link to a view (#/strategic) opens it; one to the assistant opens the panel.
      onNavigate={(id) => (id === 'assistant' ? openAssistant(true) : isView(id) ? setPage(id) : undefined)}
      collapsible="none"
      trail={[{ label: 'Decision System' }]}
      profile={{ name: client.identity?.display ?? 'Connecting…', org: client.identity?.releasability.join(' · ') ?? '' }}
      unreadCount={derived.activeRules.length}
      onOpenNotifications={() => {
        setPage('battlespace');
        setPanels({ leftOpen: true, leftTab: 'alerts' });
      }}
      onOpenAssistant={() => openAssistant(!assistant.open)}
      isAssistantOpen={assistant.open}
      panel={
        assistant.loaded ? (
          <Suspense fallback={null}>
            <AssistantPanel
              isOpen={assistant.open}
              onDismiss={() => openAssistant(false)}
              pending={pendingAsk}
              onPendingTaken={() => setPendingAsk(null)}
              onOpenOnMap={(id) => openOnMap(id)}
            />
          </Suspense>
        ) : null
      }
      actions={
        <>
          {presenter.mode ? <Badge size="Medium" color="Information" emphasis="Subtle" label="PRESENTER" /> : null}
          <ShellActions onOpenOnMap={(id) => openOnMap(id)} />
          <IconTitles />
          <DroppedCommands />
        </>
      }
      pagePadding="none"
      pageHeight="fill"
    >
      <Tabs className="bs-tabs-fill console" value={page} onChange={setPage} size="Small" variant="borderless">
        <ConnectionBanner />
        <div className="console__tabs">
          <TabList>
            {VIEWS.map((v) => (
              <TabItem key={v.id} value={v.id} leading={v.icon}>
                {v.label}
              </TabItem>
            ))}
          </TabList>
        </div>
        {/* Only the open view is mounted: the map's engine and each view's fetches run while it is shown. */}
        {VIEWS.map((v) => (
          <TabPanel key={v.id} value={v.id} className="console__view">
            {page === v.id ? render(v.id) : null}
          </TabPanel>
        ))}
      </Tabs>
    </AppShell>
  );
}

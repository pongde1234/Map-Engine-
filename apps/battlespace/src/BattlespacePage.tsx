/**
 * Battlespace console, FDS components only: left panel (Tabs: Layers · Alerts · Sources) · map
 * with its toolbar (annotate tools, storyboard frames, view, panels)
 * with HUD (Badges, Card, Code, ButtonGroups) and the SliderInput timeline beneath it ·
 * inspector. The columns are plain grid inside the AppShell page (AppShell guard).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActionList, ActionListItem, Button, ButtonGroup, Card, Counter, DropdownMenu, DropdownMenuOverlay, DropdownMenuTrigger, TabItem, TabList, TabPanel, Tabs, Tooltip } from '@faclon-labs/fds';
import { Bookmark as BookmarkIcon, ChevronLeft, ChevronRight, Compass, LocateFixed, Maximize, PanelLeft, PanelRight, PencilLine, Ruler, Shapes } from 'lucide-react';
import { MapView, useClient, useDrawState, useEngine, useViewStore } from '@me/map-react';
import { AgeLegend, CursorReadout, DEFAULT_SHAPE, DrawBar, EventFeed, Inspector, LayerList, PromoteModal, SourceList, StatusBadges, TimeBar, raidLabel, type Derived, type InspectorHandover } from '@me/ui';
import type { ToolKind } from '@me/map';
import type { Presenter } from './presenter.ts';

export type LeftTab = 'layers' | 'alerts' | 'sources';

export interface PanelState {
  leftOpen: boolean;
  leftTab: LeftTab;
  rightOpen: boolean;
}

export function BattlespacePage({
  derived,
  panels,
  setPanels,
  presenter,
  onNominate,
  onAsk,
}: { derived: Derived; panels: PanelState; setPanels: (p: Partial<PanelState>) => void; presenter: Presenter } & InspectorHandover) {
  const client = useClient();
  const view = useViewStore();
  const engine = useEngine();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const { state: sketch } = useDrawState();
  const s = client.scenario;

  // A finished drawing or geofence goes straight to the promote dialog.
  const sketchDone = sketch.done && (sketch.tool === 'draw' || sketch.tool === 'geofence');
  useEffect(() => {
    if (sketchDone) setPromoteOpen(true);
  }, [sketchDone]);
  // The sketch is driven from the DrawBar on the map, so no panel needs to open for it.
  const startTool = useCallback((tool: ToolKind) => engine?.tools.start(tool, DEFAULT_SHAPE[tool]), [engine]);
  const { bookmarks, go: goBookmark, step, pending, applied } = presenter;

  // Frames are stepped by the console (presenter.ts); the camera applies here once the map exists.
  useEffect(() => {
    if (!pending || !engine) return;
    if (pending.camera) engine.flyTo(pending.camera);
    applied();
  }, [pending, engine, applied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable || e.ctrlKey || e.metaKey) return;
      // Enter, Backspace and Escape belong to the sketch while a tool is active.
      const sketching = !!engine?.tools.get().tool;
      if (e.key === ' ') {
        e.preventDefault();
        if (client.clock.playing) client.pause();
        else client.play(client.clock.rate > 1 ? client.clock.rate : 60);
      } else if (e.key === 'Escape') {
        if (!sketching && !document.querySelector('[role="dialog"]')) view.set({ selected: null, highlight: [] });
      } else if (e.key === 'l' || e.key === 'L') setPanels({ leftOpen: !panels.leftOpen });
      else if (e.key === 'i' || e.key === 'I') setPanels({ rightOpen: !panels.rightOpen });
      else if (e.key === 'd' || e.key === 'D') startTool('draw');
      else if (e.key === 'm' || e.key === 'M') startTool('measure');
      else if (e.key === 'g' || e.key === 'G') startTool('geofence');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client, view, panels, setPanels, engine, startTool]);

  const bm = presenter.current;
  const bmIndex = presenter.index;
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  return (
    <div className="bs-console">
      {panels.leftOpen ? (
        <aside className="bs-left" aria-label="Layers, alerts and sources">
          <Tabs className="bs-left__tabs" value={panels.leftTab} onChange={(v) => setPanels({ leftTab: v as LeftTab })} variant="filled" size="Small" isLazy>
            <div className="bs-tabbar">
              <TabList>
                <TabItem value="layers">Layers</TabItem>
                <TabItem value="alerts" trailing={<Counter value={client.events.length} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${client.events.length} alerts and events received`} />}>
                  Alerts
                </TabItem>
                <TabItem value="sources">Sources</TabItem>
              </TabList>
            </div>
            <TabPanel value="layers" className="bs-left__tabpanel">
              <LayerList derived={derived} />
            </TabPanel>
            <TabPanel value="alerts" className="bs-left__tabpanel">
              <EventFeed />
            </TabPanel>
            <TabPanel value="sources" className="bs-left__tabpanel">
              <SourceList derived={derived} />
            </TabPanel>
          </Tabs>
        </aside>
      ) : null}

      <div className="bs-center">
        <div className="bs-map">
          {s ? (
            <MapView
              basemap={{ pmtiles: '/tiles/basemap.pmtiles', glyphs: '/tiles/fonts/{fontstack}/{range}.pbf', sprite: '/tiles/sprites/v4/dark' }}
              center={s.center}
              zoom={s.zoom}
              maxBounds={[
                [58, 14],
                [80, 32],
              ]}
            />
          ) : null}
          <div className="bs-hud bs-hud--tl">
            <StatusBadges derived={derived} />
            {sketch.tool ? (
              <DrawBar onPromote={() => setPromoteOpen(true)} />
            ) : bm ? (
              <Card padding={12} size="Medium" width="fit-content" maxWidth="100%" accessibilityLabel="Storyboard frame">
                <span className="BodySmallSemibold">{bm.id}</span> <span className="BodySmallRegular bs-muted">{bm.caption ?? bm.label}</span>
              </Card>
            ) : null}
          </div>
          <div className="bs-hud bs-hud--tr">
            <div className="bs-row">
              <ButtonGroup variant="Secondary" size="xs">
                <Tooltip content="Draw an annotation, axis or no-fly zone (D)">
                  <Button iconOnly aria-label="Draw" onClick={() => startTool('draw')}>
                    <PencilLine size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Measure distance, bearing, area or range (M)">
                  <Button iconOnly aria-label="Measure" onClick={() => startTool('measure')}>
                    <Ruler size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Geofence: alert when tracks enter or leave an area (G)">
                  <Button iconOnly aria-label="Geofence" onClick={() => startTool('geofence')}>
                    <Shapes size={14} />
                  </Button>
                </Tooltip>
              </ButtonGroup>
              <ButtonGroup variant="Secondary" size="xs">
                <Tooltip content="Previous frame ([)">
                  <Button iconOnly aria-label="Previous frame" onClick={() => step(-1)}>
                    <ChevronLeft size={14} />
                  </Button>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button iconOnly aria-label="Storyboard frames">
                      <BookmarkIcon size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuOverlay placement="bottom-end">
                    <ActionList accessibilityLabel="Storyboard frames">
                      {bookmarks.map((b, i) => (
                        <ActionListItem key={b.id} value={b.id} title={`${b.id} · ${b.label}`} description={s ? raidLabel(b.t, s.clock) : ''} isSelected={i === bmIndex} onClick={() => goBookmark(b)} />
                      ))}
                    </ActionList>
                  </DropdownMenuOverlay>
                </DropdownMenu>
                <Tooltip content="Next frame (])">
                  <Button iconOnly aria-label="Next frame" onClick={() => step(1)}>
                    <ChevronRight size={14} />
                  </Button>
                </Tooltip>
              </ButtonGroup>
              <ButtonGroup variant="Secondary" size="xs">
                <Tooltip content="Centre on the defended point">
                  <Button iconOnly aria-label="Centre on the defended point" onClick={() => s && engine?.flyTo({ center: s.center, zoom: s.zoom })}>
                    <LocateFixed size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="North up, flat">
                  <Button iconOnly aria-label="North up" onClick={() => engine?.map.easeTo({ bearing: 0, pitch: 0, duration: 600 })}>
                    <Compass size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Full screen">
                  <Button iconOnly aria-label="Full screen" onClick={fullscreen}>
                    <Maximize size={14} />
                  </Button>
                </Tooltip>
              </ButtonGroup>
              <ButtonGroup variant="Secondary" size="xs">
                <Tooltip content={panels.leftOpen ? 'Hide layers panel (L)' : 'Show layers panel (L)'}>
                  <Button iconOnly aria-label={panels.leftOpen ? 'Hide layers panel' : 'Show layers panel'} onClick={() => setPanels({ leftOpen: !panels.leftOpen })}>
                    <PanelLeft size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content={panels.rightOpen ? 'Hide inspector (I)' : 'Show inspector (I)'}>
                  <Button iconOnly aria-label={panels.rightOpen ? 'Hide inspector' : 'Show inspector'} onClick={() => setPanels({ rightOpen: !panels.rightOpen })}>
                    <PanelRight size={14} />
                  </Button>
                </Tooltip>
              </ButtonGroup>
            </div>
            <AgeLegend />
          </div>
          <div className="bs-hud bs-hud--bl">
            <CursorReadout center={derived.center} />
          </div>
        </div>
        <div className="bs-time">
          <TimeBar bookmarks={bookmarks} onBookmark={goBookmark} />
        </div>
      </div>

      {panels.rightOpen ? (
        <aside className="bs-right" aria-label="Inspector">
          <Inspector derived={derived} {...(onNominate ? { onNominate } : {})} {...(onAsk ? { onAsk } : {})} />
        </aside>
      ) : null}
      <PromoteModal isOpen={promoteOpen} onClose={() => setPromoteOpen(false)} />
    </div>
  );
}

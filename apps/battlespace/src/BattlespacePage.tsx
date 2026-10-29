/**
 * Battlespace console, FDS components only: left panel (Tabs: Layers · Alerts · Sources) · map
 * with one toolbar (Tools and View menus), the SYNTHETIC badge and a frame caption that fades,
 * and the timeline beneath it · inspector. The columns are plain grid inside the AppShell page
 * (AppShell guard).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionList, ActionListItem, ActionListItemIcon, ActionListItemText, ActionListSection, Button, Card, Counter, DropdownMenu, DropdownMenuOverlay, DropdownMenuTrigger, TabItem, TabList, TabPanel, Tabs } from '@faclon-labs/fds';
import { ChevronDown, Eye, LocateFixed, PanelLeft, PanelRight, PencilLine, Ruler, Shapes } from 'lucide-react';
import type { Bookmark } from '@me/client';
import { MapView, useClient, useDrawState, useEngine, useView, useViewStore } from '@me/map-react';
import { CursorReadout, DEFAULT_SHAPE, entityCenter, EventFeed, Inspector, LayerList, MapHover, MeasurePopover, PromoteModal, SourceList, StatusBadges, TimeBar, ToolMenu, shortcutBlocked, toolValue, type Derived, type InspectorHandover } from '@me/ui';
import type { SketchShape, ToolKind } from '@me/map';
import type { Presenter } from './presenter.ts';

export type LeftTab = 'layers' | 'alerts' | 'sources';

/** The Tools menu's trigger shows the tool in use. */
const TOOL_ICON: Record<ToolKind, typeof PencilLine> = { draw: PencilLine, measure: Ruler, geofence: Shapes };
/** How long a frame's caption stays on the map. */
const CAPTION_MS = 5000;
/** The frame whose caption has shown, kept across remounts of the view. */
let captioned: Bookmark | undefined;

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
  onOpenBoard,
}: { derived: Derived; panels: PanelState; setPanels: (p: Partial<PanelState>) => void; presenter: Presenter } & InspectorHandover) {
  const client = useClient();
  const view = useViewStore();
  const engine = useEngine();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const { state: sketch } = useDrawState();
  const s = client.scenario;

  // Selecting an object shows its details, even when the inspector was hidden: a new selection
  // from anywhere (map, feed, search, a frame), or a click on the map that picks an object again.
  const rightOpen = useRef(panels.rightOpen);
  rightOpen.current = panels.rightOpen;
  useEffect(() => {
    const reveal = () => {
      if (view.get().selected && !rightOpen.current) setPanels({ rightOpen: true });
    };
    let prev = view.get().selected;
    const unsub = view.subscribe(() => {
      const next = view.get().selected;
      if (next !== prev) {
        prev = next;
        reveal();
      }
    });
    // The map's own click lands first; read the selection it set once it has.
    const onMapClick = () => window.setTimeout(reveal, 0);
    engine?.map.on('click', onMapClick);
    return () => {
      unsub();
      engine?.map.off('click', onMapClick);
    };
  }, [engine, view, setPanels]);

  // A finished drawing or geofence goes straight to the promote dialog.
  const sketchDone = sketch.done && (sketch.tool === 'draw' || sketch.tool === 'geofence');
  useEffect(() => {
    if (sketchDone) setPromoteOpen(true);
  }, [sketchDone]);
  // Tools start from their toolbar menus (or D/M/G with the default shape); the map says what
  // finishes a sketch, so no bar or panel opens for it.
  const startTool = useCallback((tool: ToolKind) => engine?.tools.start(tool, DEFAULT_SHAPE[tool]), [engine]);
  const pickShape = useCallback(
    (tool: ToolKind, shape: SketchShape) => {
      const t = engine?.tools;
      if (!t) return;
      const cur = t.get();
      if (cur.tool === tool && !cur.done) t.setShape(shape);
      else t.start(tool, shape);
    },
    [engine],
  );
  const { bookmarks, go: goBookmark, pending, applied } = presenter;

  // The camera the operator left (kept in the view store); none the first time.
  const camera = view.get().camera;
  // An object another view or a list asked to bring into view: the map flies to it, once.
  const locate = useView((v) => v.locate);
  useEffect(() => {
    if (!locate || !engine) return;
    const e = client.entities.get(locate);
    const c = e ? entityCenter(e) : null;
    if (c) engine.flyTo({ center: c, zoom: Math.max(engine.getCamera().zoom, 9) }, 900);
    view.set({ locate: null });
  }, [locate, engine, client, view]);

  // Frames are stepped by the console (presenter.ts); the camera applies here once the map exists.
  useEffect(() => {
    if (!pending || !engine) return;
    if (pending.camera) engine.flyTo(pending.camera);
    applied();
  }, [pending, engine, applied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A key a menu, dialog, field or pressed control owns is left alone; so is one already handled
      // (the sketch cancelled by Escape, a menu closed by it): see shortcuts.ts.
      if (shortcutBlocked(e)) return;
      // Enter, Backspace and Escape belong to the sketch while a tool is active.
      const sketching = !!engine?.tools.get().tool;
      if (e.key === ' ') {
        e.preventDefault();
        if (client.clock.playing) client.pause();
        else client.play(client.clock.rate > 1 ? client.clock.rate : 60);
      } else if (e.key === 'Escape') {
        if (!sketching) view.set({ selected: null, highlight: [] });
      } else if (e.key === 'l' || e.key === 'L') setPanels({ leftOpen: !panels.leftOpen });
      else if (e.key === 'i' || e.key === 'I') setPanels({ rightOpen: !panels.rightOpen });
      else if (e.key === 'd' || e.key === 'D') startTool('draw');
      else if (e.key === 'm' || e.key === 'M') startTool('measure');
      else if (e.key === 'g' || e.key === 'G') startTool('geofence');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client, view, panels, setPanels, engine, startTool]);

  const drawing = sketch.tool && !sketch.done ? sketch.tool : null;
  const ToolIcon = drawing ? TOOL_ICON[drawing] : PencilLine;

  return (
    <div className="bs-console">
      {panels.leftOpen ? (
        <aside className="bs-left" aria-label="Layers, alerts and sources">
          <Tabs className="bs-left__tabs" value={panels.leftTab} onChange={(v) => setPanels({ leftTab: v as LeftTab })} variant="filled" size="Small" isLazy>
            <div className="bs-tabbar">
              <TabList>
                <TabItem value="layers">Layers</TabItem>
                <TabItem value="alerts" trailing={<Counter value={client.events.length} max={999} size="Medium" color="Neutral" emphasis="Subtle" accessibilityLabel={`${client.events.length} alerts and events received`} />}>
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
              center={camera?.center ?? s.center}
              zoom={camera?.zoom ?? s.zoom}
              {...(camera ? { pitch: camera.pitch, bearing: camera.bearing } : {})}
              maxBounds={[
                [58, 14],
                [80, 32],
              ]}
            />
          ) : null}
          <MapHover />
          <MeasurePopover hidden={promoteOpen} onKeep={() => setPromoteOpen(true)} />
          <div className="bs-hud bs-hud--tl">
            <StatusBadges />
          </div>
          <div className="bs-hud bs-hud--tr">
            <div className="bs-row">
              <DropdownMenu
                selectionType="single"
                value={drawing ? [toolValue(drawing, sketch.shape)] : []}
                onChange={({ values }) => {
                  const [tool, shape] = (values[0] ?? '').split(':');
                  if (tool && shape) pickShape(tool as ToolKind, shape as SketchShape);
                }}
              >
                <DropdownMenuTrigger>
                  <Button size="sm" className="bs-mapbtn" variant={drawing ? 'primary' : 'secondary'} tone={drawing ? 'brand' : 'neutral'} leadingIcon={<ToolIcon size={14} />} trailingIcon={<ChevronDown size={14} />}>
                    Tools
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuOverlay placement="bottom-end">
                  <ToolMenu />
                </DropdownMenuOverlay>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button size="sm" className="bs-mapbtn" variant="secondary" tone="neutral" leadingIcon={<Eye size={14} />} trailingIcon={<ChevronDown size={14} />}>
                    View
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuOverlay placement="bottom-end">
                  <ActionList accessibilityLabel="View">
                    <ActionListSection>
                      {/* The defended point at the scenario zoom, north up and flat (flyTo resets both). */}
                      <ActionListItem value="centre" title="Reset view" leading={<ActionListItemIcon icon={LocateFixed} />} onClick={() => s && engine?.flyTo({ center: s.center, zoom: s.zoom })} />
                    </ActionListSection>
                    <ActionListSection>
                      <ActionListItem value="layers" title={panels.leftOpen ? 'Hide layers panel' : 'Show layers panel'} leading={<ActionListItemIcon icon={PanelLeft} />} trailing={<ActionListItemText>L</ActionListItemText>} onClick={() => setPanels({ leftOpen: !panels.leftOpen })} />
                      <ActionListItem value="inspector" title={panels.rightOpen ? 'Hide inspector' : 'Show inspector'} leading={<ActionListItemIcon icon={PanelRight} />} trailing={<ActionListItemText>I</ActionListItemText>} onClick={() => setPanels({ rightOpen: !panels.rightOpen })} />
                    </ActionListSection>
                  </ActionList>
                </DropdownMenuOverlay>
              </DropdownMenu>
            </div>
          </div>
          {sketch.tool ? null : <FrameCaption bm={presenter.current} pending={presenter.pending} />}
          <div className="bs-hud bs-hud--bl">
            <CursorReadout center={derived.center} />
          </div>
        </div>
        <div className="bs-time">
          <TimeBar bookmarks={bookmarks} onBookmark={goBookmark} current={presenter.current?.id} />
        </div>
      </div>

      {panels.rightOpen ? (
        <aside className="bs-right" aria-label="Inspector">
          <Inspector derived={derived} {...(onNominate ? { onNominate } : {})} {...(onAsk ? { onAsk } : {})} {...(onOpenBoard ? { onOpenBoard } : {})} />
        </aside>
      ) : null}
      <PromoteModal isOpen={promoteOpen} onClose={() => setPromoteOpen(false)} />
    </div>
  );
}

/** A frame's caption, at the foot of the map when the frame is applied; it fades after a while. */
function FrameCaption({ bm, pending }: { bm: Bookmark | undefined; pending: unknown }) {
  const [shown, setShown] = useState(false);
  // A frame applied, or applied again, shows its caption; coming back to the view does not.
  useEffect(() => {
    if (!bm || (bm === captioned && !pending)) return;
    captioned = bm;
    setShown(true);
  }, [bm, pending]);
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(false), CAPTION_MS);
    return () => window.clearTimeout(id);
  }, [shown]);
  if (!bm) return null;
  return (
    <div className="bs-hud bs-hud--bc bs-caption" data-shown={shown} aria-hidden={!shown}>
      <Card padding={12} size="Medium" width="fit-content" maxWidth="100%" accessibilityLabel="Storyboard frame">
        <span className="BodySmallSemibold">{bm.id}</span> <span className="BodySmallRegular bs-muted">{bm.caption ?? bm.label}</span>
      </Card>
    </div>
  );
}

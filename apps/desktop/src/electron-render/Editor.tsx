import type { DesignDocument, ElementType } from '@design-ai/design-schema';
import {
  findElement,
  type ElementAlignment,
  type ElementPatch,
  type ElementPosition,
} from '@design-ai/editor-core';
import { CircleUser, Menu, PanelLeft, Play } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Canvas } from './Canvas';
import {
  DEFAULT_CANVAS_VIEWPORT,
  type CanvasEngineFactory,
  type CanvasViewport,
} from './canvas-engine';
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar';
import { elementLabel } from './element-labels';
import { LayerTree } from './LayerTree';
import { cn } from './lib/utils';
import { PromptDock } from './PromptDock';
import { PropertiesPanel } from './PropertiesPanel';

/** Zoom stops used by the canvas zoom control. */
export const ZOOM_LEVELS = [
  0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4,
] as const;

export function nextZoom(scale: number, direction: -1 | 1): number {
  if (direction === 1) {
    return ZOOM_LEVELS.find((level) => level > scale) ?? scale;
  }
  return ZOOM_LEVELS.findLast((level) => level < scale) ?? scale;
}

const SIDEBAR_TOGGLE_CLASS =
  'flex size-7 cursor-pointer items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#ECEDEF]';
const FILE_MENU_ITEM_CLASS =
  'cursor-pointer rounded-md px-2 py-1 text-left text-xs hover:bg-[#F6F6F6]';
const MIN_SIDEBAR_CARD_WIDTH = 250;
const DEFAULT_SIDEBAR_CARD_WIDTH = 280;
const MIN_SPACE_OUTSIDE_SIDEBAR_CARDS = 380;

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      aria-label="切换图层面板"
      aria-pressed={open}
      title="切换图层面板"
      onClick={onToggle}
      className={SIDEBAR_TOGGLE_CLASS}
    >
      <PanelLeft size={16} strokeWidth={2} />
    </button>
  );
}

interface PanStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
}

interface SidebarResizeStart {
  pointerId: number;
  clientX: number;
  width: number;
}

export interface EditorProps {
  document: DesignDocument | null;
  selectionId: string | null;
  /** The active tab's inspector expansion, owned by its session snapshot. */
  inspectorExpanded: boolean;
  /** The shared top tab bar, rendered in the editor window chrome. */
  tabBar: ReactNode;
  documentName: string;
  saveStatus: string | null;
  busy: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onSelect: (id: string | null) => void;
  onToggleInspector: () => void;
  /** Commits a drag between parent-local positions. */
  onMoveElement: (
    id: string,
    from: ElementPosition,
    to: ElementPosition,
  ) => boolean;
  onAddRoot: (type: ElementType) => void;
  onUpdate: (patch: ElementPatch) => void;
  onAlign: (alignment: ElementAlignment) => void;
  onAddChild: (type: ElementType) => void;
  onDelete: () => void;
  /** Whether the tab's session can restore an earlier design document. */
  canUndo: boolean;
  /** Whether the tab's session can reapply the last undone document. */
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Canvas engine factory, injectable for tests. */
  createCanvasEngine?: CanvasEngineFactory;
}

/**
 * Pencil editor shell: layer sidebar, window chrome with the shared tab bar,
 * floating canvas toolbar, zoom and pan, and the right inspector.
 */
export function Editor({
  document,
  selectionId,
  inspectorExpanded,
  tabBar,
  documentName,
  saveStatus,
  busy,
  onOpen,
  onCreate,
  onSelect,
  onToggleInspector,
  onMoveElement,
  onAddRoot,
  onUpdate,
  onAlign,
  onAddChild,
  onDelete,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  createCanvasEngine,
}: EditorProps) {
  const [tool, setTool] = useState<CanvasTool>('pointer');
  const [viewport, setViewport] = useState<CanvasViewport>(
    DEFAULT_CANVAS_VIEWPORT,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCardWidth, setSidebarCardWidth] = useState(
    DEFAULT_SIDEBAR_CARD_WIDTH,
  );
  const panStart = useRef<PanStart | null>(null);
  const sidebarResizeStart = useRef<SidebarResizeStart | null>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);

  // Undo and redo follow the active tab's session history. Text inputs keep
  // their native editing shortcuts instead.
  const emitUndo = useEffectEvent(() => {
    if (canUndo) {
      onUndo();
    }
  });
  const emitRedo = useEffectEvent(() => {
    if (canRedo) {
      onRedo();
    }
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      const undo = key === 'z' && !event.shiftKey;
      if (!undo && !redo) {
        return;
      }
      event.preventDefault();
      if (undo) {
        emitUndo();
      } else {
        emitRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const selected =
    document !== null && selectionId !== null
      ? findElement(document, selectionId)
      : undefined;
  const zoomPercent = Math.round(viewport.scale * 100);
  const maxSidebarCardWidth = () =>
    Math.max(
      MIN_SIDEBAR_CARD_WIDTH,
      window.innerWidth - MIN_SPACE_OUTSIDE_SIDEBAR_CARDS,
    );

  const resizeSidebar = (width: number) => {
    setSidebarCardWidth(
      Math.max(MIN_SIDEBAR_CARD_WIDTH, Math.min(width, maxSidebarCardWidth())),
    );
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || sidebarResizeStart.current !== null) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sidebarResizeStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      width: Math.min(sidebarCardWidth, maxSidebarCardWidth()),
    };
  };

  const moveSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = sidebarResizeStart.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    resizeSidebar(start.width + event.clientX - start.clientX);
  };

  const endSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarResizeStart.current?.pointerId === event.pointerId) {
      sidebarResizeStart.current = null;
    }
  };

  const runFileAction = (action: () => void) => {
    if (fileMenu.current !== null) {
      fileMenu.current.open = false;
    }
    action();
  };

  const zoomBy = (direction: -1 | 1) => {
    setViewport((current) => ({
      ...current,
      scale: nextZoom(current.scale, direction),
    }));
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'hand' || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
    };
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStart.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    setViewport((current) => ({
      ...current,
      x: start.x + event.clientX - start.clientX,
      y: start.y + event.clientY - start.clientY,
    }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panStart.current === null) {
      return;
    }
    panStart.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="relative isolate min-h-0 flex-1 bg-[#F6F6F6]"
      data-testid="editor"
    >
      <div className="absolute inset-0 z-0">
        <Canvas
          document={document}
          selectionId={selectionId}
          viewport={viewport}
          selectable={tool === 'pointer'}
          onSelect={onSelect}
          onMoveElement={onMoveElement}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          createEngine={createCanvasEngine}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <header
          data-testid="window-chrome"
          className="relative z-30 flex h-[63px] shrink-0 items-center justify-center px-24"
        >
          <div className="pointer-events-auto absolute left-3 flex h-8 items-center gap-2 rounded-full bg-[#F6F6F6] px-1.5">
            <SidebarToggle
              open={sidebarOpen}
              onToggle={() => {
                sidebarResizeStart.current = null;
                setSidebarOpen((open) => !open);
              }}
            />
            {sidebarOpen ? (
              <details
                ref={fileMenu}
                className="relative z-30"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    event.currentTarget.open = false;
                  }
                }}
              >
                <summary
                  aria-label="更多操作"
                  title="更多操作"
                  data-testid="file-actions-toggle"
                  className={`${SIDEBAR_TOGGLE_CLASS} list-none [&::-webkit-details-marker]:hidden`}
                >
                  <Menu size={16} strokeWidth={2} />
                </summary>
                <div className="absolute top-full left-0 mt-1 flex w-52 flex-col gap-1 rounded-xl border border-[#ECECEE] bg-white p-2 shadow-[0_4px_18px_#00000014]">
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <span
                      className="truncate text-xs font-medium"
                      title={documentName}
                    >
                      {documentName}
                    </span>
                    {saveStatus === null ? null : (
                      <span
                        data-testid="save-status"
                        className="shrink-0 text-[11px] text-[#8A8C93]"
                      >
                        {saveStatus}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => runFileAction(onOpen)}
                    disabled={busy}
                    className={`${FILE_MENU_ITEM_CLASS} disabled:cursor-progress disabled:opacity-60`}
                  >
                    打开设计稿
                  </button>
                  <button
                    type="button"
                    onClick={() => runFileAction(onCreate)}
                    disabled={busy}
                    className={`${FILE_MENU_ITEM_CLASS} disabled:cursor-progress disabled:opacity-60`}
                  >
                    新建设计稿
                  </button>
                  <button
                    type="button"
                    onClick={() => runFileAction(onUndo)}
                    disabled={busy || !canUndo}
                    className={`${FILE_MENU_ITEM_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    撤销
                  </button>
                  <button
                    type="button"
                    onClick={() => runFileAction(onRedo)}
                    disabled={busy || !canRedo}
                    className={`${FILE_MENU_ITEM_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    重做
                  </button>
                </div>
              </details>
            ) : null}
          </div>
          <div className="flex min-w-0 [&>*]:pointer-events-auto">{tabBar}</div>
          <div
            aria-hidden="true"
            className="pointer-events-auto absolute right-3 hidden h-8 items-center gap-5 rounded-full bg-[#F6F6F6] px-2 text-[#222222] md:flex"
          >
            <CircleUser size={16} strokeWidth={2} />
            <Play size={16} strokeWidth={2} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {sidebarOpen ? (
            <aside
              data-testid="layer-sidebar"
              className="flex shrink-0 flex-col pr-2 pl-2.5"
            >
              <div
                className="flex min-h-0 flex-1 flex-col gap-2.5 pb-2.5 [&>section]:pointer-events-auto"
                style={{
                  width: sidebarCardWidth,
                  maxWidth: `max(${MIN_SIDEBAR_CARD_WIDTH}px, calc(100vw - ${MIN_SPACE_OUTSIDE_SIDEBAR_CARDS}px))`,
                }}
              >
                <section
                  aria-label="图层面板"
                  className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-[#ECECEE] bg-white p-2 shadow-[0_6px_24px_#00000012]"
                >
                  <div className="flex h-10 shrink-0 items-center gap-3">
                    <button
                      type="button"
                      data-testid="sidebar-tab-agent"
                      disabled
                      className="flex h-[30px] cursor-not-allowed items-center rounded-lg px-2 text-[13px] text-[#C2C3C9]"
                    >
                      Agent
                    </button>
                    <button
                      type="button"
                      data-testid="sidebar-tab-layers"
                      aria-pressed="true"
                      className="flex h-[30px] items-center rounded-lg bg-[#E9E9E9] px-2 text-[13px] font-medium text-[#1A1A1A]"
                    >
                      图层
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto">
                    <LayerTree
                      document={document}
                      selectionId={selectionId}
                      onSelect={onSelect}
                    />
                  </div>
                  <div
                    role="separator"
                    aria-label="调整图层面板宽度"
                    aria-orientation="vertical"
                    aria-valuemin={MIN_SIDEBAR_CARD_WIDTH}
                    aria-valuemax={maxSidebarCardWidth()}
                    aria-valuenow={Math.min(
                      sidebarCardWidth,
                      maxSidebarCardWidth(),
                    )}
                    tabIndex={0}
                    className="absolute inset-y-0 -right-2 w-3 cursor-ew-resize touch-none select-none outline-none after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full focus-visible:after:bg-[#7599DB]"
                    onPointerDown={startSidebarResize}
                    onPointerMove={moveSidebarResize}
                    onPointerUp={endSidebarResize}
                    onPointerCancel={endSidebarResize}
                    onLostPointerCapture={endSidebarResize}
                    onKeyDown={(event) => {
                      const width = Math.min(
                        sidebarCardWidth,
                        maxSidebarCardWidth(),
                      );
                      if (
                        event.key === 'ArrowLeft' ||
                        event.key === 'ArrowRight'
                      ) {
                        event.preventDefault();
                        resizeSidebar(
                          width + (event.key === 'ArrowLeft' ? -10 : 10),
                        );
                      }
                    }}
                  />
                </section>

                <PromptDock />
              </div>
            </aside>
          ) : null}

          <div className="relative min-w-0 flex-1 [--inspector-width:min(259px,50%)]">
            <CanvasToolbar
              tool={tool}
              onToolChange={setTool}
              onCreate={onAddRoot}
              className={cn(
                'pointer-events-auto',
                sidebarOpen ? 'left-0' : 'left-3',
              )}
            />

            <div
              data-testid="zoom-control"
              className={`pointer-events-auto absolute bottom-3.5 flex h-10 w-[143px] items-center justify-between rounded-[14px] border border-[#ECECEE] bg-white px-[18px] shadow-[0_4px_18px_#00000010] ${
                selected === undefined || !inspectorExpanded
                  ? 'right-8'
                  : 'right-[calc(2rem+var(--inspector-width))]'
              }`}
            >
              <button
                type="button"
                aria-label="缩小"
                title="缩小"
                data-testid="zoom-out"
                disabled={viewport.scale <= ZOOM_LEVELS[0]}
                onClick={() => zoomBy(-1)}
                className="cursor-pointer text-[24px] leading-none font-light text-[#666971] transition-colors hover:text-[#1A1A1A] disabled:cursor-not-allowed disabled:text-[#C2C3C9]"
              >
                −
              </button>
              <span
                data-testid="zoom-percentage"
                className="text-[14px] font-medium text-[#575A62]"
              >
                {zoomPercent}%
              </span>
              <button
                type="button"
                aria-label="放大"
                title="放大"
                data-testid="zoom-in"
                disabled={viewport.scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                onClick={() => zoomBy(1)}
                className="cursor-pointer text-[20px] leading-none font-normal text-[#666971] transition-colors hover:text-[#1A1A1A] disabled:cursor-not-allowed disabled:text-[#C2C3C9]"
              >
                +
              </button>
            </div>

            {selected === undefined ? null : (
              <div
                data-testid="selection-pill"
                className={`pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-[14px] border border-[#E7E7E9] bg-[#F6F6F6] px-4 py-1 text-[14px] font-medium text-[#6A6B72] ${inspectorExpanded ? 'left-[calc((100%-var(--inspector-width))/2)]' : 'left-1/2'}`}
              >
                {elementLabel(selected)}
              </div>
            )}
            {document !== null && selected !== undefined ? (
              <PropertiesPanel
                document={document}
                element={selected}
                expanded={inspectorExpanded}
                onToggle={onToggleInspector}
                onUpdate={onUpdate}
                onAlign={onAlign}
                onAddChild={onAddChild}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

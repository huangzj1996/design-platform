import type { DesignDocument, ElementType } from '@design-ai/design-schema';
import { findElement, type ElementPatch } from '@design-ai/editor-core';
import { CircleUser, Menu, PanelLeft, Play } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Canvas } from './Canvas';
import type { CanvasEngineFactory } from './canvas-engine';
import { CanvasToolbar, type CanvasTool } from './CanvasToolbar';
import { elementLabel } from './element-labels';
import { LayerTree } from './LayerTree';
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

interface PanStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
}

export interface EditorProps {
  document: DesignDocument | null;
  selectionId: string | null;
  /** The shared top tab bar, rendered in the editor window chrome. */
  tabBar: ReactNode;
  documentName: string;
  saveStatus: string | null;
  busy: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onSelect: (id: string | null) => void;
  onAddRoot: (type: ElementType) => void;
  onUpdate: (patch: ElementPatch) => void;
  onAddChild: (type: ElementType) => void;
  onDelete: () => void;
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
  tabBar,
  documentName,
  saveStatus,
  busy,
  onOpen,
  onCreate,
  onSelect,
  onAddRoot,
  onUpdate,
  onAddChild,
  onDelete,
  createCanvasEngine,
}: EditorProps) {
  const [tool, setTool] = useState<CanvasTool>('pointer');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const panStart = useRef<PanStart | null>(null);

  const viewport = useMemo(
    () => ({ scale: zoom, x: pan.x, y: pan.y }),
    [zoom, pan],
  );
  const selected =
    document !== null && selectionId !== null
      ? findElement(document, selectionId)
      : undefined;
  const zoomPercent = Math.round(zoom * 100);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'hand' || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: pan.x,
      y: pan.y,
    };
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStart.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    setPan({
      x: start.x + event.clientX - start.clientX,
      y: start.y + event.clientY - start.clientY,
    });
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
    <div className="flex min-h-0 flex-1 bg-[#F6F6F6]" data-testid="editor">
      {sidebarOpen ? (
        <aside
          data-testid="layer-sidebar"
          className="flex w-[300px] shrink-0 flex-col"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 px-5">
            <button
              type="button"
              aria-label="切换图层面板"
              aria-pressed={sidebarOpen}
              title="切换图层面板"
              onClick={() => setSidebarOpen(false)}
              className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#ECEDEF]"
            >
              <PanelLeft size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="更多操作（暂不可用）"
              title="更多操作（暂不可用）"
              disabled
              className="flex size-7 cursor-not-allowed items-center justify-center rounded-lg text-[#C2C3C9]"
            >
              <Menu size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-3 px-2">
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

            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              <LayerTree
                document={document}
                selectionId={selectionId}
                onSelect={onSelect}
              />
            </div>

            <div className="shrink-0 p-2.5">
              <div className="rounded-[10px] border border-[#ECECEE] bg-white p-3 shadow-[0_6px_24px_#00000012]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[#1A1A1A]">
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
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={onOpen}
                    disabled={busy}
                    className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-lg bg-[#1A1A1A] text-[12px] font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-progress disabled:opacity-60"
                  >
                    打开设计稿
                  </button>
                  <button
                    type="button"
                    onClick={onCreate}
                    disabled={busy}
                    className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-lg border border-[#E7E8EA] bg-white text-[12px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#F6F6F6] disabled:cursor-progress disabled:opacity-60"
                  >
                    新建设计稿
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-testid="window-chrome"
          className="relative flex h-12 shrink-0 items-center justify-center"
        >
          {!sidebarOpen ? (
            <button
              type="button"
              aria-label="切换图层面板"
              aria-pressed={sidebarOpen}
              title="切换图层面板"
              onClick={() => setSidebarOpen(true)}
              className="absolute left-3 flex size-7 cursor-pointer items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#ECEDEF]"
            >
              <PanelLeft size={16} strokeWidth={2} />
            </button>
          ) : null}
          {tabBar}
        </header>

        <section className="relative min-h-0 flex-1">
          <Canvas
            document={document}
            selectionId={selectionId}
            viewport={viewport}
            selectable={tool === 'pointer'}
            onSelect={onSelect}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            createEngine={createCanvasEngine}
          />
          <CanvasToolbar
            tool={tool}
            onToolChange={setTool}
            onCreate={onAddRoot}
          />

          <div
            data-testid="zoom-control"
            className="absolute right-8 bottom-3.5 flex h-10 w-[143px] items-center justify-between rounded-[14px] border border-[#ECECEE] bg-white px-[18px] shadow-[0_4px_18px_#00000010]"
          >
            <button
              type="button"
              aria-label="缩小"
              title="缩小"
              data-testid="zoom-out"
              disabled={zoom <= ZOOM_LEVELS[0]}
              onClick={() => setZoom((current) => nextZoom(current, -1))}
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
              disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              onClick={() => setZoom((current) => nextZoom(current, 1))}
              className="cursor-pointer text-[20px] leading-none font-normal text-[#666971] transition-colors hover:text-[#1A1A1A] disabled:cursor-not-allowed disabled:text-[#C2C3C9]"
            >
              +
            </button>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1.5 left-1/2 h-1.5 w-[276px] -translate-x-1/2 rounded-[3px] bg-[#BDBEC3]"
          />

          {selected === undefined ? null : (
            <div
              data-testid="selection-pill"
              className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-[14px] border border-[#E7E7E9] bg-[#F6F6F6] px-4 py-1 text-[14px] font-medium text-[#6A6B72]"
            >
              {elementLabel(selected)}
            </div>
          )}
        </section>
      </div>

      <aside className="flex w-[259px] shrink-0 flex-col">
        <div
          aria-hidden="true"
          className="flex h-12 shrink-0 items-center justify-end gap-5 px-5 text-[#222222]"
        >
          <CircleUser size={16} strokeWidth={2} />
          <Play size={16} strokeWidth={2} />
        </div>
        <div className="min-h-0 flex-1 px-2 pb-2">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#ECEDEF] bg-white shadow-[0_4px_18px_#00000014]">
            <PropertiesPanel
              document={document}
              selectionId={selectionId}
              onUpdate={onUpdate}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

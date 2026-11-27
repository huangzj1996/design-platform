import type { UI as LeaferElement } from 'leafer-ui';
import type { ElementPosition } from '@design-ai/editor-core';
import { selectedElementId } from '@design-ai/editor-core/leafer';
import {
  DEFAULT_CANVAS_VIEWPORT,
  type CanvasEngine,
  type CanvasEngineOptions,
  type CanvasViewport,
} from './canvas-engine';
import {
  CANVAS_STAGE_PADDING,
  MIN_CANVAS_SIZE,
  canvasStageSize,
  type CanvasScene,
  type CanvasSelection,
} from './canvas-scene';

export { selectedElementId };

/** The subset of a mounted leaf the drag handling reads and writes. */
interface DraggedLeaf {
  data?: { elementId?: unknown };
  draggable?: unknown;
  x: number;
  y: number;
}

/** A dragged leaf that belongs to a movable design element. */
type DraggableLeaf = DraggedLeaf & { data: { elementId: string } };

interface ActiveDrag {
  id: string;
  leaf: DraggableLeaf;
  start: ElementPosition;
}

function isDraggableLeaf(leaf: DraggedLeaf): leaf is DraggableLeaf {
  return leaf.draggable === true && typeof leaf.data?.elementId === 'string';
}

/**
 * Creates the LeaferJS rendering of one design scene. The scene already holds
 * mountable nodes adapted from the design document, so the engine only mounts
 * them and owns the viewport and selection overlay.
 */
export async function createLeaferEngine(
  host: HTMLElement,
  options: CanvasEngineOptions,
): Promise<CanvasEngine> {
  const leaferModule = await import('leafer-ui');
  const { Leafer, Box, Text, Group, Rect, DragEvent } = leaferModule;

  // Without an explicit size the canvas follows the host element, so the
  // viewport can pan and zoom the scene inside the editor area.
  const leafer = new Leafer({
    view: host,
    fill: '#f6f6f6',
  });
  leafer.on('tap', (event) => {
    options.onSelect(selectedElementId(event.target));
  });

  let content: LeaferElement | null = null;
  let overlay: LeaferElement | null = null;
  let lastScene: CanvasScene | null = null;
  let lastSelection: CanvasSelection | null = null;
  let activeDrag: ActiveDrag | null = null;
  let viewport: CanvasViewport = DEFAULT_CANVAS_VIEWPORT;

  /**
   * Leafer moves draggable nodes during a pointer drag, which is the canvas
   * preview. On release the landing position is committed through the editor;
   * an uncommitted landing restores the pre-drag position.
   */
  leafer.on(DragEvent.START, (event) => {
    if (options.onMoveElement === undefined) {
      return;
    }
    const leaves = (event.path?.list ?? []) as DraggedLeaf[];
    const leaf = leaves.find(isDraggableLeaf);
    if (leaf === undefined) {
      return;
    }
    const id = leaf.data.elementId;
    activeDrag = { id, leaf, start: { x: leaf.x, y: leaf.y } };
    options.onSelect(id);
    // The element itself previews the move; the static outline would lag.
    showSelection(null);
  });

  leafer.on(DragEvent.END, () => {
    const drag = activeDrag;
    if (drag === null) {
      return;
    }
    activeDrag = null;
    const accepted =
      options.onMoveElement?.(drag.id, drag.start, {
        x: drag.leaf.x,
        y: drag.leaf.y,
      }) ?? false;
    if (!accepted) {
      drag.leaf.x = drag.start.x;
      drag.leaf.y = drag.start.y;
    }
    showSelection(lastSelection);
  });

  /**
   * Centers the scene in the host and applies the UI viewport on top. The
   * editor owns zoom and pan as UI state; applying them through Leafer's
   * viewport properties keeps rendering and hit testing at the actual scale.
   */
  function applyViewport(): void {
    const stage =
      lastScene === null
        ? { width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE }
        : canvasStageSize(lastScene);
    const hostWidth = host.clientWidth || stage.width;
    const hostHeight = host.clientHeight || stage.height;
    leafer.scale = viewport.scale;
    leafer.x = (hostWidth - stage.width * viewport.scale) / 2 + viewport.x;
    leafer.y = (hostHeight - stage.height * viewport.scale) / 2 + viewport.y;
  }

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => applyViewport())
      : null;
  resizeObserver?.observe(host);

  function buildContent(scene: CanvasScene): LeaferElement {
    const root = new Box({
      x: CANVAS_STAGE_PADDING,
      y: CANVAS_STAGE_PADDING,
      width: Math.max(MIN_CANVAS_SIZE, scene.width),
      height: Math.max(MIN_CANVAS_SIZE, scene.height),
      fill: '#ffffff',
      hitFill: 'all',
      zIndex: 0,
    });
    for (const node of scene.roots) {
      root.add(node.node);
    }
    return root;
  }

  function showSelection(selection: CanvasSelection | null): void {
    if (overlay !== null) {
      overlay.destroy();
      overlay = null;
    }
    if (selection === null) {
      return;
    }

    const selectionOverlay = new Group({
      hittable: false,
      zIndex: 1,
      data: { selectionId: selection.id },
    });
    selectionOverlay.add(
      new Rect({
        x: CANVAS_STAGE_PADDING + selection.box.x,
        y: CANVAS_STAGE_PADDING + selection.box.y,
        width: selection.box.width,
        height: selection.box.height,
        stroke: selection.outline.color,
        strokeWidth: selection.outline.strokeWidth,
        rotation: selection.rotation,
        origin: 'center',
        hittable: false,
      }),
    );

    const tag = selection.sizeTag;
    selectionOverlay.add(
      new Box({
        x: CANVAS_STAGE_PADDING + tag.box.x,
        y: CANVAS_STAGE_PADDING + tag.box.y,
        width: tag.box.width,
        height: tag.box.height,
        fill: tag.fill,
        cornerRadius: tag.cornerRadius,
        hittable: false,
      }),
    );
    selectionOverlay.add(
      new Text({
        x: CANVAS_STAGE_PADDING + tag.box.x,
        y: CANVAS_STAGE_PADDING + tag.box.y,
        width: tag.box.width,
        height: tag.box.height,
        text: tag.text,
        fill: tag.color,
        fontSize: tag.fontSize,
        fontWeight: tag.fontWeight,
        textAlign: 'center',
        verticalAlign: 'middle',
        hittable: false,
      }),
    );

    overlay = selectionOverlay;
    leafer.add(selectionOverlay);
  }

  return {
    setScene(scene: CanvasScene, selection: CanvasSelection | null): void {
      lastSelection = selection;
      if (scene !== lastScene) {
        lastScene = scene;
        if (content !== null) {
          content.destroy();
        }
        content = buildContent(scene);
        leafer.add(content);
        applyViewport();
      }
      showSelection(activeDrag === null ? selection : null);
    },

    setViewport(next: CanvasViewport): void {
      viewport = next;
      applyViewport();
    },

    destroy(): void {
      resizeObserver?.disconnect();
      leafer.destroy(true);
    },
  };
}

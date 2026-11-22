import type { IFill, UI as LeaferElement } from 'leafer-ui';
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
  type CanvasSceneNode,
  type CanvasSelection,
} from './canvas-scene';
import {
  ICON_VIEWBOX_SIZE,
  loadLucideIconPaths,
  type IconPath,
} from './lucide-icon';

interface TargetWithParent {
  data?: { elementId?: unknown };
  parent?: TargetWithParent | null;
}

/**
 * Builds the paint used for a fill. A partial fill opacity becomes a solid
 * paint so it affects only the fill, independently of element opacity.
 */
export function fillPaint(
  color: string | undefined,
  opacity: number | undefined,
): IFill | undefined {
  if (color === undefined) {
    return undefined;
  }
  if (opacity === undefined || opacity >= 1) {
    return color;
  }
  return { type: 'solid', color, opacity };
}

/** Maps one scene node to the LeaferJS input shared by every canvas shape. */
export function canvasNodeInput(node: CanvasSceneNode) {
  return {
    x: node.box.x,
    y: node.box.y,
    width: node.box.width,
    height: node.box.height,
    fill: fillPaint(node.fill, node.fillOpacity),
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    cornerRadius: node.cornerRadius,
    opacity: node.opacity,
    rotation: node.rotation,
    visible: node.visible,
    overflow:
      node.type === 'frame' && node.clipContent === true
        ? ('hide' as const)
        : undefined,
    origin: 'center' as const,
    hitFill: 'all' as const,
    data: { elementId: node.id },
  };
}

/** Walks from a hit node to the nearest node carrying a document element id. */
export function selectedElementId(
  target: TargetWithParent | undefined,
): string | null {
  let current: TargetWithParent | null = target ?? null;
  while (current !== null) {
    const id = current.data?.elementId;
    if (typeof id === 'string') {
      return id;
    }
    current = current.parent ?? null;
  }
  return null;
}

/**
 * Creates the LeaferJS rendering of one design scene. Content elements receive
 * the document element id, and every pointer tap selects the deepest element
 * under the pointer by walking up from the hit node.
 */
export async function createLeaferEngine(
  host: HTMLElement,
  options: CanvasEngineOptions,
): Promise<CanvasEngine> {
  const leaferModule = await import('leafer-ui');
  const { Leafer, Box, Rect, Ellipse, Text, Path, Group } = leaferModule;

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
  let viewport: CanvasViewport = DEFAULT_CANVAS_VIEWPORT;

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

  function iconPlaceholder(node: CanvasSceneNode): LeaferElement {
    const box = new Box({
      width: node.box.width,
      height: node.box.height,
      hitFill: 'all',
    });
    box.add(
      new Rect({
        width: node.box.width,
        height: node.box.height,
        fill: '#faf5ff',
        stroke: '#8250df',
        strokeWidth: 1,
        dashPattern: [4, 4],
        hittable: false,
      }),
    );
    box.add(
      new Text({
        width: node.box.width,
        height: node.box.height,
        text: '?',
        fill: '#8250df',
        fontSize: 11,
        textAlign: 'center',
        verticalAlign: 'middle',
        hittable: false,
      }),
    );
    return box;
  }

  function addIconPaths(
    container: LeaferElement,
    node: CanvasSceneNode,
    shapes: IconPath[],
  ): void {
    const icon = node.icon;
    if (icon === undefined) {
      return;
    }
    const scaleX = node.box.width / ICON_VIEWBOX_SIZE;
    const scaleY = node.box.height / ICON_VIEWBOX_SIZE;
    const paint = fillPaint(icon.color, node.fillOpacity);
    for (const shape of shapes) {
      container.add(
        new Path({
          path: shape.path,
          fill: shape.filled ? paint : undefined,
          stroke: paint,
          strokeWidth: icon.strokeWidth,
          strokeCap: 'round',
          strokeJoin: 'round',
          scaleX,
          scaleY,
          hittable: false,
        }),
      );
    }
  }

  function iconNode(node: CanvasSceneNode): LeaferElement {
    const container = new Box(canvasNodeInput(node));
    const icon = node.icon;
    if (icon === undefined) {
      return container;
    }

    void loadLucideIconPaths(icon.library, icon.icon).then((shapes) => {
      if (container.destroyed) {
        // The scene was replaced while the icon was loading.
        return;
      }
      if (shapes === null) {
        container.add(iconPlaceholder(node));
        return;
      }
      addIconPaths(container, node, shapes);
    });

    return container;
  }

  function textNode(node: CanvasSceneNode): LeaferElement {
    const input = canvasNodeInput(node);
    const text = node.text;
    if (text === undefined) {
      return new Text(input);
    }
    return new Text({
      ...input,
      text: text.content,
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      lineHeight: { type: 'percent', value: text.lineHeight },
      textAlign: text.textAlign,
      textWrap: text.textWrap === 'none' ? 'none' : 'break',
      verticalAlign: 'top',
    });
  }

  function sceneNode(node: CanvasSceneNode): LeaferElement {
    switch (node.type) {
      case 'frame': {
        const frame = new Box(canvasNodeInput(node));
        for (const child of node.children) {
          frame.add(sceneNode(child));
        }
        return frame;
      }
      case 'rectangle':
        return new Rect(canvasNodeInput(node));
      case 'ellipse':
        return new Ellipse(canvasNodeInput(node));
      case 'text':
        return textNode(node);
      case 'icon':
        return iconNode(node);
    }
  }

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
      root.add(sceneNode(node));
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
      if (scene !== lastScene) {
        lastScene = scene;
        if (content !== null) {
          content.destroy();
        }
        content = buildContent(scene);
        leafer.add(content);
        applyViewport();
      }
      showSelection(selection);
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

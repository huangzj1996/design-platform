import type { UI as LeaferElement } from 'leafer-ui';
import type { CanvasEngine, CanvasEngineOptions } from './canvas-engine';
import {
  CANVAS_STAGE_PADDING,
  type CanvasScene,
  type CanvasSceneNode,
  type CanvasSelection,
} from './canvas-scene';
import { ICON_VIEWBOX_SIZE, loadLucideIconPaths } from './lucide-icon';

interface TargetWithParent {
  data?: { elementId?: unknown };
  parent?: TargetWithParent | null;
}

const DEFAULT_CANVAS_SIZE = 1;

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

  const leafer = new Leafer({
    view: host,
    width: DEFAULT_CANVAS_SIZE,
    height: DEFAULT_CANVAS_SIZE,
    fill: '#ffffff',
  });
  leafer.on('tap', (event) => {
    options.onSelect(
      selectedElementId(event.target as unknown as TargetWithParent),
    );
  });

  let content: LeaferElement | null = null;
  let overlay: LeaferElement | null = null;
  let lastScene: CanvasScene | null = null;
  let sceneVersion = 0;

  function elementInput(node: CanvasSceneNode) {
    return {
      x: node.box.x,
      y: node.box.y,
      width: node.box.width,
      height: node.box.height,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      cornerRadius: node.cornerRadius,
      opacity: node.opacity,
      rotation: node.rotation,
      visible: node.visible,
      origin: 'center' as const,
      hitFill: 'all' as const,
      data: { elementId: node.id },
    };
  }

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
    shapes: NonNullable<Awaited<ReturnType<typeof loadLucideIconPaths>>>,
  ): void {
    if (node.icon === undefined) {
      return;
    }
    const scaleX = node.box.width / ICON_VIEWBOX_SIZE;
    const scaleY = node.box.height / ICON_VIEWBOX_SIZE;
    for (const shape of shapes) {
      container.add(
        new Path({
          path: shape.path,
          fill: shape.filled ? node.icon.color : undefined,
          stroke: node.icon.color,
          strokeWidth: node.icon.strokeWidth,
          strokeCap: 'round',
          strokeJoin: 'round',
          scaleX,
          scaleY,
          hittable: false,
        }),
      );
    }
  }

  function iconNode(node: CanvasSceneNode, version: number): LeaferElement {
    const container = new Box({
      x: node.box.x,
      y: node.box.y,
      width: node.box.width,
      height: node.box.height,
      opacity: node.opacity,
      rotation: node.rotation,
      visible: node.visible,
      origin: 'center',
      hitFill: 'all',
      data: { elementId: node.id },
    });

    if (node.icon === undefined) {
      return container;
    }

    void loadLucideIconPaths(node.icon.library, node.icon.icon).then(
      (shapes) => {
        if (container.destroyed || version !== sceneVersion) {
          return;
        }
        if (shapes === null) {
          container.add(iconPlaceholder(node));
          return;
        }
        addIconPaths(container, node, shapes);
      },
    );

    return container;
  }

  function textNode(node: CanvasSceneNode): LeaferElement {
    const input = elementInput(node);
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

  function sceneNode(node: CanvasSceneNode, version: number): LeaferElement {
    switch (node.type) {
      case 'frame': {
        const frame = new Box(elementInput(node));
        for (const child of node.children) {
          frame.add(sceneNode(child, version));
        }
        return frame;
      }
      case 'rectangle':
        return new Rect(elementInput(node));
      case 'ellipse':
        return new Ellipse(elementInput(node));
      case 'text':
        return textNode(node);
      case 'icon':
        return iconNode(node, version);
    }
  }

  function buildContent(scene: CanvasScene, version: number): LeaferElement {
    const root = new Box({
      x: CANVAS_STAGE_PADDING,
      y: CANVAS_STAGE_PADDING,
      width: Math.max(DEFAULT_CANVAS_SIZE, scene.width),
      height: Math.max(DEFAULT_CANVAS_SIZE, scene.height),
      fill: '#ffffff',
      hitFill: 'all',
      zIndex: 0,
    });
    for (const node of scene.roots) {
      root.add(sceneNode(node, version));
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
        sceneVersion += 1;
        const version = sceneVersion;
        leafer.resize({
          width:
            Math.max(DEFAULT_CANVAS_SIZE, scene.width) +
            CANVAS_STAGE_PADDING * 2,
          height:
            Math.max(DEFAULT_CANVAS_SIZE, scene.height) +
            CANVAS_STAGE_PADDING * 2,
        });
        if (content !== null) {
          content.destroy();
        }
        content = buildContent(scene, version);
        leafer.add(content);
      }
      showSelection(selection);
    },

    destroy(): void {
      sceneVersion += 1;
      leafer.destroy(true);
    },
  };
}

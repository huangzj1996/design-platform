import type {
  CanvasEngine,
  CanvasEngineFactory,
  CanvasViewport,
} from '../src/electron-render/canvas-engine';
import type {
  CanvasScene,
  CanvasSceneNode,
  CanvasSelection,
} from '../src/electron-render/canvas-scene';

/** Records the scene handed to the canvas and simulates pointer taps. */
export class TestCanvasEngine implements CanvasEngine {
  scene: CanvasScene | null = null;
  selection: CanvasSelection | null = null;
  viewport: CanvasViewport | null = null;
  destroyed = false;

  constructor(private readonly onSelect: (id: string | null) => void) {}

  setScene(scene: CanvasScene, selection: CanvasSelection | null): void {
    this.scene = scene;
    this.selection = selection;
  }

  setViewport(viewport: CanvasViewport): void {
    this.viewport = viewport;
  }

  destroy(): void {
    this.destroyed = true;
  }

  tap(id: string | null): void {
    this.onSelect(id);
  }
}

/** Keeps the latest engine created by the injectable canvas factory. */
export class TestCanvasRegistry {
  engine: TestCanvasEngine | null = null;

  readonly factory: CanvasEngineFactory = (_host, options) => {
    this.engine = new TestCanvasEngine(options.onSelect);
    return this.engine;
  };

  tap(id: string | null): void {
    if (this.engine === null) {
      throw new Error('Canvas engine not created');
    }
    this.engine.tap(id);
  }
}

export function hasSceneNode(scene: CanvasScene | null, id: string): boolean {
  if (scene === null) {
    return false;
  }
  const visit = (nodes: CanvasSceneNode[]): boolean =>
    nodes.some((node) => node.id === id || visit(node.children));
  return visit(scene.roots);
}

export function findSceneNode(
  scene: CanvasScene | null,
  id: string,
): CanvasSceneNode {
  if (scene === null) {
    throw new Error('Canvas scene not rendered');
  }
  const visit = (nodes: CanvasSceneNode[]): CanvasSceneNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) {
        return node;
      }
      const nested = visit(node.children);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  };

  const node = visit(scene.roots);
  if (node === undefined) {
    throw new Error(`No canvas scene node for ${id}`);
  }
  return node;
}

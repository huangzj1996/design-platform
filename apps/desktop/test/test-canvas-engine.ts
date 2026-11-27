import type {
  CanvasEngine,
  CanvasEngineFactory,
  CanvasViewport,
} from '../src/electron-render/canvas-engine';
import type {
  CanvasScene,
  CanvasSceneNode,
} from '../src/electron-render/canvas-scene';

/** Records the scene and viewport handed to the canvas. */
class TestCanvasEngine implements CanvasEngine {
  scene: CanvasScene | null = null;
  viewport: CanvasViewport | null = null;
  destroyed = false;

  setScene(scene: CanvasScene): void {
    this.scene = scene;
  }

  setViewport(viewport: CanvasViewport): void {
    this.viewport = viewport;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** Keeps the latest engine created by the injectable canvas factory. */
export class TestCanvasRegistry {
  engine: TestCanvasEngine | null = null;

  readonly factory: CanvasEngineFactory = () => {
    this.engine = new TestCanvasEngine();
    return this.engine;
  };
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

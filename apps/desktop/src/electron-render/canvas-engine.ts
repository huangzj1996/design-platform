import type { CanvasScene, CanvasSelection } from './canvas-scene';

export interface CanvasEngineOptions {
  /** Called when the pointer selects an element, or null for empty space. */
  onSelect: (id: string | null) => void;
}

/** Drawing surface shared by the LeaferJS engine and test doubles. */
export interface CanvasEngine {
  setScene(scene: CanvasScene, selection: CanvasSelection | null): void;
  destroy(): void;
}

export type CanvasEngineFactory = (
  host: HTMLElement,
  options: CanvasEngineOptions,
) => CanvasEngine | Promise<CanvasEngine>;

/**
 * Loads LeaferJS only when a design is first shown, so the renderer and its
 * tests can import the canvas component without a browser canvas.
 */
export const createLeaferCanvasEngine: CanvasEngineFactory = async (
  host,
  options,
) => {
  const { createLeaferEngine } = await import('./leafer-canvas');
  return createLeaferEngine(host, options);
};

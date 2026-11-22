import type { CanvasScene, CanvasSelection } from './canvas-scene';

export interface CanvasEngineOptions {
  /** Called when the pointer selects an element, or null for empty space. */
  onSelect: (id: string | null) => void;
}

/** Drawing surface shared by the LeaferJS engine and test doubles. */
export interface CanvasEngine {
  /** Rebuilds the drawing when the scene changes, and always updates the selection. */
  setScene(scene: CanvasScene, selection: CanvasSelection | null): void;
  destroy(): void;
}

/** Creates the drawing surface for a stage host; may load its renderer lazily. */
export type CanvasEngineFactory = (
  host: HTMLElement,
  options: CanvasEngineOptions,
) => CanvasEngine | Promise<CanvasEngine>;

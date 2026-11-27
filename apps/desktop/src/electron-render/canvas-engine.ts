import type { ElementPosition } from '@design-ai/editor-core';
import type { CanvasScene, CanvasSelection } from './canvas-scene';

export interface CanvasEngineOptions {
  /** Called when the pointer selects an element, or null for empty space. */
  onSelect: (id: string | null) => void;
  /**
   * Called when a drag ends with its start and landing positions, both
   * relative to the element's parent border box. The editor converts them to
   * declaration coordinates. Returns false when the landing was not
   * committed, so the canvas restores the pre-drag position.
   */
  onMoveElement?: (
    id: string,
    from: ElementPosition,
    to: ElementPosition,
  ) => boolean;
}

/**
 * Canvas viewport in UI state: the scale and the screen offset of the scene
 * from its centered position. Never part of the saved design document.
 */
export interface CanvasViewport {
  /** 1 renders the scene at 100%. */
  scale: number;
  /** Horizontal drag offset in screen pixels. */
  x: number;
  /** Vertical drag offset in screen pixels. */
  y: number;
}

/** The scene at 100% with no drag offset. */
export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
  scale: 1,
  x: 0,
  y: 0,
};

/** Drawing surface shared by the LeaferJS engine and test doubles. */
export interface CanvasEngine {
  /** Rebuilds the drawing when the scene changes, and always updates the selection. */
  setScene(scene: CanvasScene, selection: CanvasSelection | null): void;
  /** Applies a viewport change without rebuilding the scene. */
  setViewport(viewport: CanvasViewport): void;
  destroy(): void;
}

/** Creates the drawing surface for a stage host; may load its renderer lazily. */
export type CanvasEngineFactory = (
  host: HTMLElement,
  options: CanvasEngineOptions,
) => CanvasEngine | Promise<CanvasEngine>;

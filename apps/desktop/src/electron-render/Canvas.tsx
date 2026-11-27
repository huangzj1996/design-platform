import type { DesignDocument } from '@design-ai/design-schema';
import type { IconPaintMap } from '@design-ai/editor-core/leafer';
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
} from 'react';
import {
  DEFAULT_CANVAS_VIEWPORT,
  type CanvasEngine,
  type CanvasEngineFactory,
  type CanvasViewport,
} from './canvas-engine';
import {
  buildCanvasScene,
  collectCanvasIconKeys,
  findCanvasSelection,
  loadCanvasIconPaints,
} from './canvas-scene';
import { createLeaferEngine } from './leafer-canvas';

/**
 * Loads the paint paths of every icon in the document. Missing paints fall back
 * to the adapter's placeholder until the lazy icon modules resolve.
 */
function useCanvasIconPaints(
  document: DesignDocument | null,
): IconPaintMap | undefined {
  const iconKeys = useMemo(
    () => (document === null ? [] : collectCanvasIconKeys(document)),
    [document],
  );
  // Keying the effect on the joined keys rather than the array identity keeps
  // edits that do not change the icon set from reloading its paints.
  const iconKeySignature = iconKeys.join('\n');
  const [iconPaints, setIconPaints] = useState<IconPaintMap | undefined>(
    undefined,
  );

  useEffect(() => {
    if (iconKeys.length === 0) {
      setIconPaints(undefined);
      return;
    }
    let cancelled = false;
    void loadCanvasIconPaints(iconKeys).then((paints) => {
      if (!cancelled) {
        setIconPaints(paints);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [iconKeySignature]);

  return iconKeys.length === 0 ? undefined : iconPaints;
}

export interface CanvasProps {
  document: DesignDocument | null;
  selectionId?: string | null;
  /** Canvas scale and offset; UI state only, never saved with the document. */
  viewport?: CanvasViewport;
  /** False while the hand tool owns pointer gestures, so taps do not select. */
  selectable?: boolean;
  onSelect?: (id: string | null) => void;
  /** Pointer handlers, used by the editor's hand tool to pan the viewport. */
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  /** Engine factory, injectable for tests; defaults to the LeaferJS renderer. */
  createEngine?: CanvasEngineFactory;
}

export function Canvas({
  document,
  selectionId = null,
  viewport = DEFAULT_CANVAS_VIEWPORT,
  selectable = true,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  createEngine = createLeaferEngine,
}: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const emitSelect = useEffectEvent((id: string | null) => {
    if (selectable) {
      onSelect?.(id);
    }
  });

  const iconPaints = useCanvasIconPaints(document);
  const scene = useMemo(
    () => (document === null ? null : buildCanvasScene(document, iconPaints)),
    [document, iconPaints],
  );
  const hasElements = scene !== null && scene.roots.length > 0;
  const selection = useMemo(
    () => (scene === null ? null : findCanvasSelection(scene, selectionId)),
    [scene, selectionId],
  );
  const sceneRef = useRef(scene);
  const selectionRef = useRef(selection);
  const viewportRef = useRef(viewport);

  useEffect(() => {
    sceneRef.current = scene;
    selectionRef.current = selection;
    if (scene === null) {
      return;
    }
    engineRef.current?.setScene(scene, selection);
  }, [scene, selection]);

  useEffect(() => {
    viewportRef.current = viewport;
    engineRef.current?.setViewport(viewport);
  }, [viewport]);

  useEffect(() => {
    if (!hasElements) {
      return;
    }
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    let disposed = false;
    let engine: CanvasEngine | null = null;
    void (async () => {
      try {
        const created = await createEngine(host, { onSelect: emitSelect });
        if (disposed) {
          created.destroy();
          return;
        }
        engine = created;
        engineRef.current = created;
        if (sceneRef.current !== null) {
          created.setScene(sceneRef.current, selectionRef.current);
        }
        created.setViewport(viewportRef.current);
      } catch (error) {
        console.error('无法创建画布', error);
      }
    })();

    return () => {
      disposed = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [createEngine, hasElements]);

  if (scene === null) {
    return <div className="canvas canvas-empty">尚未打开设计稿</div>;
  }

  if (scene.roots.length === 0) {
    return (
      <div className="canvas canvas-empty" data-empty="true">
        空白设计稿
      </div>
    );
  }

  return (
    <div
      className={`canvas ${selectable ? '' : 'canvas-panning'}`}
      data-testid="canvas"
      data-zoom={viewport.scale}
      data-pan-x={viewport.x}
      data-pan-y={viewport.y}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div ref={hostRef} className="canvas-stage" data-testid="canvas-stage" />
    </div>
  );
}

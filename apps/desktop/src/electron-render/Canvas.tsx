import type { DesignDocument } from '@design-ai/design-schema';
import { useEffect, useMemo, useRef } from 'react';
import {
  createLeaferCanvasEngine,
  type CanvasEngine,
  type CanvasEngineFactory,
} from './canvas-engine';
import {
  buildCanvasScene,
  CANVAS_STAGE_PADDING,
  findCanvasSelection,
} from './canvas-scene';

export interface CanvasProps {
  document: DesignDocument | null;
  selectionId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Engine factory, injectable for tests; defaults to the LeaferJS renderer. */
  createEngine?: CanvasEngineFactory;
}

export function Canvas({
  document,
  selectionId = null,
  onSelect,
  createEngine = createLeaferCanvasEngine,
}: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const hasElements = document !== null && document.children.length > 0;
  const scene = useMemo(
    () => (document === null ? null : buildCanvasScene(document)),
    [document],
  );
  const selection = useMemo(
    () => (scene === null ? null : findCanvasSelection(scene, selectionId)),
    [scene, selectionId],
  );
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

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
        const created = await createEngine(host, {
          onSelect: (id) => onSelectRef.current?.(id),
        });
        if (disposed) {
          created.destroy();
          return;
        }
        engine = created;
        engineRef.current = created;
        if (sceneRef.current !== null) {
          created.setScene(sceneRef.current, selectionRef.current);
        }
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

  useEffect(() => {
    if (scene === null) {
      return;
    }
    engineRef.current?.setScene(scene, selection);
  }, [scene, selection]);

  if (document === null) {
    return <div className="canvas canvas-empty">尚未打开设计稿</div>;
  }

  if (!hasElements || scene === null) {
    return (
      <div className="canvas canvas-empty" data-empty="true">
        空白设计稿
      </div>
    );
  }

  return (
    <div className="canvas" data-testid="canvas">
      <div
        ref={hostRef}
        className="canvas-stage"
        data-testid="canvas-stage"
        style={{
          width: `${Math.max(1, scene.width) + CANVAS_STAGE_PADDING * 2}px`,
          height: `${Math.max(1, scene.height) + CANVAS_STAGE_PADDING * 2}px`,
        }}
      />
    </div>
  );
}

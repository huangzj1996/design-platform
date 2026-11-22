import type { DesignDocument } from '@design-ai/design-schema';
import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import type { CanvasEngine, CanvasEngineFactory } from './canvas-engine';
import {
  buildCanvasScene,
  canvasStageSize,
  findCanvasSelection,
} from './canvas-scene';
import { createLeaferEngine } from './leafer-canvas';

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
  createEngine = createLeaferEngine,
}: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const emitSelect = useEffectEvent((id: string | null) => {
    onSelect?.(id);
  });

  const scene = useMemo(
    () => (document === null ? null : buildCanvasScene(document)),
    [document],
  );
  const hasElements = scene !== null && scene.roots.length > 0;
  const selection = useMemo(
    () => (scene === null ? null : findCanvasSelection(scene, selectionId)),
    [scene, selectionId],
  );
  const sceneRef = useRef(scene);
  const selectionRef = useRef(selection);

  useEffect(() => {
    sceneRef.current = scene;
    selectionRef.current = selection;
    if (scene === null) {
      return;
    }
    engineRef.current?.setScene(scene, selection);
  }, [scene, selection]);

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

  const stage = canvasStageSize(scene);
  return (
    <div className="canvas" data-testid="canvas">
      <div
        ref={hostRef}
        className="canvas-stage"
        data-testid="canvas-stage"
        style={{ width: `${stage.width}px`, height: `${stage.height}px` }}
      />
    </div>
  );
}

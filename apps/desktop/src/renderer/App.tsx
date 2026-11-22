import { useState } from 'react';
import type { OpenDesignFileResult } from '../shared/open-design-file';
import { Canvas } from './Canvas';
import {
  applyOpenError,
  applyOpenResult,
  documentName,
  initialEditorState,
  type EditorState,
} from './editor-state';

export interface AppProps {
  openDesignFile?: () => Promise<OpenDesignFileResult>;
  initialState?: EditorState;
}

async function openThroughBridge(): Promise<OpenDesignFileResult> {
  if (window.designAi === undefined) {
    throw new Error('设计稿打开桥接不可用');
  }
  return window.designAi.openDesignFile();
}

export function App({
  openDesignFile = openThroughBridge,
  initialState = initialEditorState,
}: AppProps) {
  const [state, setState] = useState<EditorState>(initialState);
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    setOpening(true);
    try {
      const result = await openDesignFile();
      setState((current) => applyOpenResult(current, result));
    } catch (error) {
      setState((current) => applyOpenError(current, error));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="document-summary">
          <strong className="app-name">Design AI</strong>
          <span className="document-name">{documentName(state.filePath)}</span>
        </div>
        <button type="button" onClick={handleOpen} disabled={opening}>
          {opening ? '正在打开…' : '打开设计稿'}
        </button>
      </header>

      {state.diagnostics.length > 0 ? (
        <section className="diagnostics" role="alert" aria-live="polite">
          <h2>无法打开设计稿</h2>
          <ul>
            {state.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.path}-${index}`}>
                <code className="diagnostic-code">{diagnostic.code}</code>
                <code className="diagnostic-path">{diagnostic.path}</code>
                <span className="diagnostic-message">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <main className="workspace">
        <Canvas document={state.document} />
      </main>
    </div>
  );
}

import type { DesignDocument, DesignElement } from '@design-ai/design-schema';
import {
  ChevronDown,
  Circle,
  Frame,
  Sparkles,
  Square,
  Type,
} from 'lucide-react';
import { ELEMENT_TYPE_LABELS, elementLabel } from './element-labels';

function ElementTypeIcon({ element }: { element: DesignElement }) {
  const props = { size: 16, strokeWidth: 2 } as const;
  switch (element.type) {
    case 'frame':
      return <Frame {...props} />;
    case 'rectangle':
      return <Square {...props} />;
    case 'ellipse':
      return <Circle {...props} />;
    case 'text':
      return <Type {...props} />;
    case 'icon':
      return <Sparkles {...props} />;
  }
}

interface LayerTreeItemProps {
  element: DesignElement;
  depth: number;
  selectionId: string | null;
  onSelect: (id: string) => void;
}

function LayerTreeItem({
  element,
  depth,
  selectionId,
  onSelect,
}: LayerTreeItemProps) {
  const selected = element.id === selectionId;
  const children = element.type === 'frame' ? (element.children ?? []) : [];

  return (
    <li
      data-layer-id={element.id}
      data-selected={selected ? 'true' : 'false'}
      className="layer-item"
    >
      <button
        type="button"
        className={`layer-row flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-lg text-left text-[12px] transition-colors ${
          selected
            ? 'bg-[#D9DADD] font-semibold text-[#111827]'
            : 'text-[#1F2937] hover:bg-[#ECEDEF]'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 12 }}
        onClick={() => onSelect(element.id)}
        aria-pressed={selected}
        title={ELEMENT_TYPE_LABELS[element.type]}
      >
        <span className="flex w-3.5 shrink-0 items-center justify-center text-[#94A3B8]">
          {children.length > 0 ? <ChevronDown size={14} /> : null}
        </span>
        <span className="flex shrink-0 items-center text-[#64748B]">
          <ElementTypeIcon element={element} />
        </span>
        <span className="layer-label truncate">{elementLabel(element)}</span>
      </button>
      {children.length > 0 ? (
        <ul className="layer-children">
          {children.map((child) => (
            <LayerTreeItem
              key={child.id}
              element={child}
              depth={depth + 1}
              selectionId={selectionId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export interface LayerTreeProps {
  document: DesignDocument | null;
  selectionId: string | null;
  onSelect: (id: string) => void;
}

export function LayerTree({ document, selectionId, onSelect }: LayerTreeProps) {
  const elements = document?.children ?? [];

  return (
    <div className="layer-tree" data-testid="layer-tree">
      <h2 className="sr-only">图层</h2>
      {elements.length === 0 ? (
        <p className="panel-empty">还没有元素</p>
      ) : (
        <ul className="layer-roots">
          {elements.map((element) => (
            <LayerTreeItem
              key={element.id}
              element={element}
              depth={0}
              selectionId={selectionId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

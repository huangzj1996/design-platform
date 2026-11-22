import type {
  DesignDocument,
  DesignElement,
  ElementType,
} from '@design-ai/design-schema';

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  frame: '容器',
  rectangle: '矩形',
  ellipse: '圆形',
  text: '文字',
  icon: '图标',
};

function elementLabel(element: DesignElement): string {
  if (element.type === 'text') {
    const text = element.text.trim();
    return text.length === 0 ? element.id : text;
  }
  return element.id;
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
      className={selected ? 'layer-item layer-item-selected' : 'layer-item'}
    >
      <button
        type="button"
        className="layer-row"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(element.id)}
        aria-pressed={selected}
      >
        <span className="layer-type">{ELEMENT_TYPE_LABELS[element.type]}</span>
        <span className="layer-label">{elementLabel(element)}</span>
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
      <h2>图层</h2>
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

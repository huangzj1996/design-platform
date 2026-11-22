import {
  layoutDesignDocument,
  type DesignDocument,
  type DesignElement,
  type EllipseElement,
  type FrameElement,
  type IconElement,
  type LayoutNode,
  type RectangleElement,
  type TextElement,
} from '@design-ai/design-schema';
import { icons, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

type ShapeElement = RectangleElement | EllipseElement;

export interface CanvasProps {
  document: DesignDocument | null;
}

export function Canvas({ document }: CanvasProps) {
  if (document === null) {
    return <div className="canvas canvas-empty">尚未打开设计稿</div>;
  }

  if (document.children.length === 0) {
    return (
      <div className="canvas canvas-empty" data-empty="true">
        空白设计稿
      </div>
    );
  }

  const layout = layoutDesignDocument(document);

  return (
    <div className="canvas" data-testid="canvas">
      <div
        className="canvas-stage"
        style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
      >
        {layout.roots.map((node) => (
          <CanvasNode key={node.element.id} node={node} />
        ))}
      </div>
    </div>
  );
}

function CanvasNode({ node }: { node: LayoutNode }) {
  const { element } = node;

  switch (element.type) {
    case 'frame':
      return (
        <FrameView element={element} node={node}>
          {node.children.map((child) => (
            <CanvasNode key={child.element.id} node={child} />
          ))}
        </FrameView>
      );
    case 'rectangle':
    case 'ellipse':
      return <ShapeView element={element} node={node} />;
    case 'text':
      return <TextView element={element} node={node} />;
    case 'icon':
      return <IconView element={element} node={node} />;
  }
}

function boxStyle(node: LayoutNode): CSSProperties {
  return {
    position: 'absolute',
    left: `${node.box.x}px`,
    top: `${node.box.y}px`,
    width: `${node.box.width}px`,
    height: `${node.box.height}px`,
  };
}

function elementAttributes(node: LayoutNode) {
  return {
    'data-element-id': node.element.id,
    'data-element-type': node.element.type,
    'data-box-x': String(node.box.x),
    'data-box-y': String(node.box.y),
    'data-box-width': String(node.box.width),
    'data-box-height': String(node.box.height),
  };
}

function stateStyle(element: DesignElement): CSSProperties {
  return {
    opacity: element.opacity,
    visibility: element.visible === false ? 'hidden' : undefined,
    transform:
      element.rotation === undefined
        ? undefined
        : `rotate(${element.rotation}deg)`,
  };
}

function strokeShadow(element: DesignElement): string | undefined {
  if (element.stroke === undefined) {
    return undefined;
  }
  return `inset 0 0 0 ${element.strokeWidth ?? 1}px ${element.stroke}`;
}

function surfaceStyle(
  element: DesignElement,
  borderRadius: CSSProperties['borderRadius'],
): CSSProperties {
  return {
    backgroundColor: element.fill,
    borderRadius,
    boxShadow: strokeShadow(element),
  };
}

interface FrameViewProps {
  element: FrameElement;
  node: LayoutNode;
  children: ReactNode;
}

function FrameView({ element, node, children }: FrameViewProps) {
  const layout = element.layout ?? 'horizontal';
  const style: CSSProperties = {
    ...boxStyle(node),
    ...stateStyle(element),
    ...surfaceStyle(element, element.cornerRadius),
  };

  return (
    <div
      className={`canvas-frame canvas-frame-${layout}`}
      {...elementAttributes(node)}
      data-layout={layout}
      data-justify-content={element.justifyContent ?? 'start'}
      data-align-items={element.alignItems ?? 'start'}
      style={style}
    >
      {children}
    </div>
  );
}

function ShapeView({
  element,
  node,
}: {
  element: ShapeElement;
  node: LayoutNode;
}) {
  const style: CSSProperties = {
    ...boxStyle(node),
    ...stateStyle(element),
    ...surfaceStyle(
      element,
      element.type === 'ellipse' ? '50%' : element.cornerRadius,
    ),
  };

  return (
    <div
      className={`canvas-shape canvas-${element.type}`}
      {...elementAttributes(node)}
      style={style}
    />
  );
}

function TextView({
  element,
  node,
}: {
  element: TextElement;
  node: LayoutNode;
}) {
  const style: CSSProperties = {
    ...boxStyle(node),
    ...stateStyle(element),
    color: element.fill,
    fontFamily: element.fontFamily,
    fontSize:
      element.fontSize === undefined ? undefined : `${element.fontSize}px`,
    fontWeight: element.fontWeight,
    lineHeight: element.lineHeight,
    textAlign: element.textAlign,
    whiteSpace: element.textWrap === 'none' ? 'nowrap' : 'pre-wrap',
    overflowWrap: element.textWrap === 'none' ? undefined : 'anywhere',
    WebkitTextStroke:
      element.stroke === undefined
        ? undefined
        : `${element.strokeWidth ?? 1}px ${element.stroke}`,
  };

  return (
    <span className="canvas-text" {...elementAttributes(node)} style={style}>
      {element.text}
    </span>
  );
}

function IconView({
  element,
  node,
}: {
  element: IconElement;
  node: LayoutNode;
}) {
  const icon = resolveLucideIcon(element);
  const style: CSSProperties = {
    ...boxStyle(node),
    ...stateStyle(element),
    color: element.fill ?? element.stroke,
    borderRadius: element.cornerRadius,
  };

  const attributes = {
    ...elementAttributes(node),
    className: `canvas-icon${icon === null ? ' canvas-icon-placeholder' : ''}`,
    'data-icon-library': element.library,
    'data-icon-name': element.icon,
    'data-icon-resolved': icon === null ? 'false' : 'true',
    style,
  };

  if (icon === null) {
    return (
      <span {...attributes} title={`${element.library}/${element.icon}`}>
        ?
      </span>
    );
  }

  const Icon = icon;
  return (
    <span {...attributes} aria-label={element.icon}>
      <Icon
        width="100%"
        height="100%"
        strokeWidth={element.strokeWidth ?? 2}
        aria-hidden="true"
      />
    </span>
  );
}

function resolveLucideIcon(element: IconElement): LucideIcon | null {
  if (element.library.toLowerCase() !== 'lucide') {
    return null;
  }
  const key = toPascalCase(element.icon);
  const icon = (icons as Record<string, LucideIcon | undefined>)[key];
  return icon ?? null;
}

function toPascalCase(name: string): string {
  return name
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

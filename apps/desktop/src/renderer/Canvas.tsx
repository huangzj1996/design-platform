import type {
  DesignDocument,
  DesignElement,
  Dimension,
  EllipseElement,
  FrameElement,
  FrameLayout,
  IconElement,
  RectangleElement,
  SizedElement,
  TextElement,
} from '@design-ai/design-schema';
import type { CSSProperties } from 'react';

type ShapeElement = RectangleElement | EllipseElement;

const FRAME_FLEX_DIRECTIONS: Record<
  FrameLayout,
  CSSProperties['flexDirection']
> = {
  none: undefined,
  horizontal: 'row',
  vertical: 'column',
};

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

  return (
    <div className="canvas" data-testid="canvas">
      {document.children.map((element) => (
        <CanvasElement key={element.id} element={element} />
      ))}
    </div>
  );
}

function CanvasElement({ element }: { element: DesignElement }) {
  switch (element.type) {
    case 'frame':
      return <FrameView element={element} />;
    case 'text':
      return <TextView element={element} />;
    case 'icon':
      return <IconView element={element} />;
    case 'rectangle':
    case 'ellipse':
      return <ShapeView element={element} />;
  }
}

function FrameView({ element }: { element: FrameElement }) {
  const layout = element.layout ?? 'horizontal';
  const style: CSSProperties = {
    ...sizedStyle(element),
    ...commonStyle(element),
    display: 'flex',
    flexDirection: FRAME_FLEX_DIRECTIONS[layout],
    gap: element.gap === undefined ? undefined : `${element.gap}px`,
    padding:
      element.padding === undefined
        ? undefined
        : element.padding.map((value) => `${value}px`).join(' '),
    background: element.fill,
  };

  return (
    <div
      className={`canvas-frame canvas-frame-${layout}`}
      data-element-id={element.id}
      data-element-type="frame"
      data-layout={layout}
      style={style}
    >
      {element.children?.map((child) => (
        <CanvasElement key={child.id} element={child} />
      ))}
    </div>
  );
}

function TextView({ element }: { element: TextElement }) {
  const style: CSSProperties = {
    ...sizedStyle(element),
    ...stateStyle(element),
    color: element.fill,
    fontFamily: element.fontFamily,
    fontSize:
      element.fontSize === undefined ? undefined : `${element.fontSize}px`,
    fontWeight: element.fontWeight,
    lineHeight: element.lineHeight,
    textAlign: element.textAlign,
    whiteSpace: element.textWrap === 'none' ? 'nowrap' : 'pre-wrap',
  };

  return (
    <span
      className="canvas-text"
      data-element-id={element.id}
      data-element-type="text"
      style={style}
    >
      {element.text}
    </span>
  );
}

function ShapeView({ element }: { element: ShapeElement }) {
  const shape = element.type;
  const style: CSSProperties = {
    ...sizedStyle(element),
    ...commonStyle(element),
    background: element.fill,
    borderRadius: shape === 'ellipse' ? '50%' : element.cornerRadius,
  };

  return (
    <div
      className={`canvas-shape canvas-${shape}`}
      data-element-id={element.id}
      data-element-type={shape}
      style={style}
    />
  );
}

function IconView({ element }: { element: IconElement }) {
  const style: CSSProperties = {
    ...sizedStyle(element),
    ...commonStyle(element),
    background: element.fill,
  };

  return (
    <span
      className="canvas-icon"
      data-element-id={element.id}
      data-element-type="icon"
      data-icon-library={element.library}
      data-icon-name={element.icon}
      style={style}
    >
      {element.icon}
    </span>
  );
}

function sizedStyle(element: SizedElement): CSSProperties {
  return {
    width: cssDimension(element.width),
    height: cssDimension(element.height),
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

function commonStyle(element: DesignElement): CSSProperties {
  return {
    ...stateStyle(element),
    border: element.stroke
      ? `${element.strokeWidth ?? 1}px solid ${element.stroke}`
      : undefined,
    borderRadius: element.cornerRadius,
  };
}

function cssDimension(value: Dimension | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return `${value}px`;
  }

  switch (value.mode) {
    case 'fill_container':
      return '100%';
    case 'fit_content':
      return value.fallback === undefined ? undefined : `${value.fallback}px`;
  }
}

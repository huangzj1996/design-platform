import { layoutDocument, type DesignLayout, type LayoutNode } from './layout';
import type {
  DesignElement as LayoutElement,
  DesignVariables,
  Dimension,
  FrameElement,
} from './types';
import type { DesignDocument, DesignElement } from './validation';
import { resolveVariableValue } from './variables';

type Axis = 'width' | 'height';

function numericValue(
  value: unknown,
  variables: Readonly<DesignVariables>,
): number | undefined {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'number' ? resolved : undefined;
}

function layoutDimension(
  value: Extract<DesignElement, { type: 'frame' }>['width'],
  variables: Readonly<DesignVariables>,
  stretch: boolean,
): Dimension | undefined {
  if (value === 'fit_content' || value === 'fill_container') {
    return { mode: value };
  }
  if (value === undefined && stretch) {
    return { mode: 'fill_container' };
  }
  return numericValue(value, variables);
}

function layoutPadding(
  padding: Extract<DesignElement, { type: 'frame' }>['padding'],
  variables: Readonly<DesignVariables>,
): FrameElement['padding'] {
  if (padding === undefined) {
    return undefined;
  }
  if (!Array.isArray(padding)) {
    const inset = numericValue(padding, variables) ?? 0;
    return [inset, inset, inset, inset];
  }

  const top = numericValue(padding[0], variables) ?? 0;
  const right = numericValue(padding[1], variables) ?? 0;
  if (padding.length === 2) {
    return [top, right, top, right];
  }
  return [
    top,
    right,
    numericValue(padding[2], variables) ?? 0,
    numericValue(padding[3], variables) ?? 0,
  ];
}

/** Projects v2 declarations to the shared layout engine's input. */
function projectElements(
  roots: DesignElement[],
  variables: Readonly<DesignVariables>,
): LayoutElement[] {
  const elements: LayoutElement[] = [];
  const pending: {
    sources: DesignElement[];
    target: LayoutElement[];
    stretchAxis?: Axis;
  }[] = [{ sources: roots, target: elements }];
  for (let group = pending.pop(); group !== undefined; group = pending.pop()) {
    const { sources, target, stretchAxis } = group;
    for (const source of sources) {
      const position = {
        id: source.id,
        x: numericValue(source.x, variables),
        y: numericValue(source.y, variables),
      };
      if (source.type === 'text') {
        const {
          content,
          textGrowth = 'auto',
          width,
          height,
          fontSize,
          lineHeight,
        } = source.textStyle;
        const text = resolveVariableValue(content, variables);
        target.push({
          ...position,
          type: 'text',
          text: typeof text === 'string' ? text : content,
          width:
            textGrowth === 'auto'
              ? undefined
              : layoutDimension(width, variables, false),
          height:
            textGrowth === 'fixed-width-height'
              ? layoutDimension(height, variables, false)
              : undefined,
          fontSize: numericValue(fontSize, variables),
          lineHeight: numericValue(lineHeight, variables),
        });
        continue;
      }

      const sized = {
        ...position,
        width: layoutDimension(
          source.width,
          variables,
          stretchAxis === 'width',
        ),
        height: layoutDimension(
          source.height,
          variables,
          stretchAxis === 'height',
        ),
      };
      if (source.type === 'frame') {
        const layout = source.layout ?? 'horizontal';
        const alignment = source.alignItems ?? 'start';
        let childStretchAxis: Axis | undefined;
        if (alignment === 'stretch' && layout !== 'none') {
          childStretchAxis = layout === 'horizontal' ? 'height' : 'width';
        }
        const children: LayoutElement[] = [];
        target.push({
          ...sized,
          type: 'frame',
          layout,
          gap: numericValue(source.gap, variables),
          padding: layoutPadding(source.padding, variables),
          justifyContent: source.justifyContent,
          alignItems: alignment === 'stretch' ? 'start' : alignment,
          children,
        });
        if (source.children !== undefined) {
          pending.push({
            sources: source.children,
            target: children,
            stretchAxis: childStretchAxis,
          });
        }
      } else if (source.type === 'icon') {
        target.push({
          ...sized,
          type: 'icon',
          library: source.library,
          icon: source.icon,
        });
      } else {
        target.push({ ...sized, type: source.type });
      }
    }
  }
  return elements;
}

function attachSource(
  nodes: LayoutNode[],
  sources: DesignElement[],
): LayoutNode<DesignElement>[] {
  const roots: LayoutNode<DesignElement>[] = [];
  const pending = [{ nodes, sources, target: roots }];
  for (let group = pending.pop(); group !== undefined; group = pending.pop()) {
    for (let index = 0; index < group.nodes.length; index += 1) {
      const { box, children, textLines } = group.nodes[index];
      const element = group.sources[index];
      const nested: LayoutNode<DesignElement>[] = [];
      group.target.push({
        element,
        box,
        ...(textLines === undefined ? {} : { textLines }),
        children: nested,
      });
      if (element.type === 'frame' && element.children !== undefined) {
        pending.push({
          nodes: children,
          sources: element.children,
          target: nested,
        });
      }
    }
  }
  return roots;
}

/** Computes layout boxes and text lines while retaining each node's v2 declarations. */
export function layoutDesignDocumentV2(
  document: DesignDocument,
): DesignLayout<DesignElement> {
  const layout = layoutDocument(
    projectElements(document.children, document.variables),
    {
      dimensionField: (element, axis) =>
        element.type === 'text' ? `textStyle.${axis}` : axis,
    },
  );
  return { ...layout, roots: attachSource(layout.roots, document.children) };
}

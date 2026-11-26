import { layoutDocument, type DesignLayout, type LayoutNode } from './layout';
import type {
  DesignElement,
  DesignVariables,
  Dimension,
  FrameElement,
} from './types';
import type { DesignDocumentV2, DesignElementV2 } from './v2';
import type {
  DimensionV2,
  FrameLayoutFieldsV2,
  NumericValueV2,
} from './validation';
import { resolveVariableValue } from './variables';

type Axis = 'width' | 'height';

function numericValue(
  value: NumericValueV2 | undefined,
  variables: Readonly<DesignVariables>,
): number | undefined {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'number' ? resolved : undefined;
}

function layoutDimension(
  value: DimensionV2 | undefined,
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
  padding: FrameLayoutFieldsV2['padding'],
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
  sources: DesignElementV2[],
  variables: Readonly<DesignVariables>,
  stretchAxis?: Axis,
): DesignElement[] {
  const elements: DesignElement[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
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
      elements.push({
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
      width: layoutDimension(source.width, variables, stretchAxis === 'width'),
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
      elements.push({
        ...sized,
        type: 'frame',
        layout,
        gap: numericValue(source.gap, variables),
        padding: layoutPadding(source.padding, variables),
        justifyContent: source.justifyContent,
        alignItems: alignment === 'stretch' ? 'start' : alignment,
        children: projectElements(
          source.children ?? [],
          variables,
          childStretchAxis,
        ),
      });
    } else if (source.type === 'icon') {
      elements.push({
        ...sized,
        type: 'icon',
        library: source.library,
        icon: source.icon,
      });
    } else {
      elements.push({ ...sized, type: source.type });
    }
  }
  return elements;
}

function attachSource(
  nodes: LayoutNode[],
  sources: DesignElementV2[],
): LayoutNode<DesignElementV2>[] {
  return nodes.map(({ box, children, textLines }, index) => {
    const element = sources[index];
    return {
      element,
      box,
      ...(textLines === undefined ? {} : { textLines }),
      children: attachSource(
        children,
        element.type === 'frame' ? (element.children ?? []) : [],
      ),
    };
  });
}

/** Computes layout boxes and text lines while retaining each node's v2 declarations. */
export function layoutDesignDocumentV2(
  document: DesignDocumentV2,
): DesignLayout<DesignElementV2> {
  const layout = layoutDocument(
    projectElements(document.children, document.variables),
    {
      dimensionField: (element, axis) =>
        element.type === 'text' ? `textStyle.${axis}` : axis,
    },
  );
  return { ...layout, roots: attachSource(layout.roots, document.children) };
}

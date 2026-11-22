import {
  booleanField,
  colorField,
  dimensionField,
  enumField,
  nonEmptyStringField,
  nonNegativeNumberField,
  numberField,
  opacityField,
  paddingField,
  positiveNumberField,
  stringField,
} from './fields';
import type { ElementType, NodeInspector } from './types';

const commonFields = {
  x: numberField,
  y: numberField,
  visible: booleanField,
  opacity: opacityField,
  rotation: numberField,
  fill: colorField,
  stroke: colorField,
  strokeWidth: nonNegativeNumberField,
  cornerRadius: nonNegativeNumberField,
} as const;

const sizedFields = {
  width: dimensionField,
  height: dimensionField,
} as const;

const frameInspector: NodeInspector = {
  type: 'frame',
  allowsChildren: true,
  fields: {
    ...sizedFields,
    ...commonFields,
    layout: enumField(['none', 'horizontal', 'vertical']),
    gap: nonNegativeNumberField,
    padding: paddingField,
    justifyContent: enumField([
      'start',
      'center',
      'end',
      'space_between',
      'space_around',
    ]),
    alignItems: enumField(['start', 'center', 'end']),
  },
};

const rectangleInspector: NodeInspector = {
  type: 'rectangle',
  allowsChildren: false,
  fields: { ...sizedFields, ...commonFields },
};

const ellipseInspector: NodeInspector = {
  type: 'ellipse',
  allowsChildren: false,
  fields: { ...sizedFields, ...commonFields },
};

const textInspector: NodeInspector = {
  type: 'text',
  allowsChildren: false,
  requiredFields: ['text'],
  fields: {
    ...sizedFields,
    ...commonFields,
    text: stringField,
    fontFamily: stringField,
    fontSize: positiveNumberField,
    fontWeight: positiveNumberField,
    lineHeight: positiveNumberField,
    textAlign: enumField(['left', 'center', 'right', 'justify']),
    textWrap: enumField(['wrap', 'none']),
  },
};

const iconInspector: NodeInspector = {
  type: 'icon',
  allowsChildren: false,
  requiredFields: ['library', 'icon'],
  fields: {
    ...sizedFields,
    ...commonFields,
    library: nonEmptyStringField,
    icon: nonEmptyStringField,
  },
};

const builtInInspectors: readonly NodeInspector[] = [
  frameInspector,
  rectangleInspector,
  ellipseInspector,
  textInspector,
  iconInspector,
];

const registry = new Map<string, NodeInspector>(
  builtInInspectors.map((inspector) => [inspector.type, inspector]),
);

/**
 * The inspector registry used by the document validator. Each native element
 * type is validated by the inspector registered under its `type`.
 */
export const nodeInspectorRegistry: ReadonlyMap<string, NodeInspector> =
  registry;

export function registerNodeInspector(inspector: NodeInspector): void {
  registry.set(inspector.type, inspector);
}

export function getNodeInspector(type: string): NodeInspector | undefined {
  return registry.get(type);
}

export function supportedNodeTypes(): ElementType[] {
  return [...registry.keys()] as ElementType[];
}

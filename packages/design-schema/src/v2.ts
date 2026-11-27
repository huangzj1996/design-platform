import {
  nonEmptyStringField,
  numberField,
  opacityField,
  stringField,
} from './fields';
import { layoutDesignDocumentV2 } from './layout-v2';
import { layoutIssueToDiagnostic } from './layout';
import type { DesignVariables, NodeInspector, ValidationResult } from './types';
import {
  appearanceFieldsV2,
  dimensionFieldV2,
  frameLayoutFieldsV2,
  parseDocumentJson,
  textStyleFieldV2,
  validateDocumentStructure,
  type CornerRadiusV2,
  type DimensionV2,
  type EffectV2,
  type FillLayerV2,
  type FrameLayoutFieldsV2,
  type NumericValueV2,
  type StrokeV2,
  type TextStyleV2,
} from './validation';

export type {
  CornerRadiusV2,
  EffectV2,
  FillLayerV2,
  StrokeV2,
  TextStyleV2,
} from './validation';

export const DESIGN_DOCUMENT_VERSION_V2 = 2 as const;

interface ElementStyleV2 {
  id: string;
  name?: string;
  opacity?: NumericValueV2;
  x?: NumericValueV2;
  y?: NumericValueV2;
  rotation?: NumericValueV2;
  fill?: FillLayerV2[];
  stroke?: StrokeV2;
  cornerRadius?: CornerRadiusV2;
  effect?: EffectV2[];
}

interface SizedElementV2 extends ElementStyleV2 {
  width?: DimensionV2;
  height?: DimensionV2;
}

export type DesignElementV2 =
  | (SizedElementV2 &
      FrameLayoutFieldsV2 & {
        type: 'frame';
        children?: DesignElementV2[];
      })
  | (SizedElementV2 & { type: 'rectangle' })
  | (SizedElementV2 & { type: 'ellipse' })
  | (SizedElementV2 & { type: 'icon'; library: string; icon: string })
  | (ElementStyleV2 & { type: 'text'; textStyle: TextStyleV2 });

export interface DesignDocumentV2 {
  version: typeof DESIGN_DOCUMENT_VERSION_V2;
  children: DesignElementV2[];
  filePath?: string;
  variables: DesignVariables;
}

const commonFields = {
  name: stringField,
  opacity: opacityField,
  x: numberField,
  y: numberField,
  rotation: numberField,
  ...appearanceFieldsV2,
};

const sizedFields = {
  ...commonFields,
  width: dimensionFieldV2,
  height: dimensionFieldV2,
};

const inspectors: readonly NodeInspector[] = [
  {
    type: 'frame',
    allowsChildren: true,
    fields: { ...sizedFields, ...frameLayoutFieldsV2 },
  },
  { type: 'rectangle', allowsChildren: false, fields: sizedFields },
  { type: 'ellipse', allowsChildren: false, fields: sizedFields },
  {
    type: 'icon',
    allowsChildren: false,
    requiredFields: ['library', 'icon'],
    fields: {
      ...sizedFields,
      library: nonEmptyStringField,
      icon: nonEmptyStringField,
    },
  },
  {
    type: 'text',
    allowsChildren: false,
    requiredFields: ['textStyle'],
    fields: { ...commonFields, textStyle: textStyleFieldV2 },
  },
];

/** Parses JSON against the version 2 element schema. */
export function parseDesignDocumentV2(
  text: string,
): ValidationResult<DesignDocumentV2> {
  return parseDocumentJson(text, validateDesignDocumentV2);
}

/** Validates structure, bindings and size dependencies for the version 2 schema. */
export function validateDesignDocumentV2(
  input: unknown,
): ValidationResult<DesignDocumentV2> {
  const result = validateDocumentStructure(
    input,
    DESIGN_DOCUMENT_VERSION_V2,
    (type) => inspectors.find((inspector) => inspector.type === type),
  );
  if (!result.ok) {
    return result;
  }
  const document = result.document as DesignDocumentV2;
  const errors = layoutDesignDocumentV2(document).issues.map(
    layoutIssueToDiagnostic,
  );
  return errors.length > 0 ? { ok: false, errors } : { ok: true, document };
}

import { createDiagnostic, DiagnosticCodes } from './diagnostics';
import {
  isPlainObject,
  nonEmptyStringField,
  nonNegativeNumberField,
  numberField,
  opacityField,
  stringField,
} from './fields';
import type {
  DesignVariables,
  FieldValidator,
  NodeInspector,
  ValidationResult,
} from './types';
import {
  parseDocumentJson,
  validateDocumentStructure,
  validateObjectFields,
} from './validation';

export const DESIGN_DOCUMENT_VERSION_V2 = 2 as const;

type NumericValue = number | `$${string}`;

interface ElementStyleV2 {
  id: string;
  name?: string;
  opacity?: NumericValue;
  x?: NumericValue;
  y?: NumericValue;
  rotation?: NumericValue;
}

interface SizedElementV2 extends ElementStyleV2 {
  width?: NumericValue;
  height?: NumericValue;
}

export type DesignElementV2 =
  | (SizedElementV2 & { type: 'frame'; children?: DesignElementV2[] })
  | (SizedElementV2 & { type: 'rectangle' })
  | (SizedElementV2 & { type: 'ellipse' })
  | (SizedElementV2 & { type: 'icon'; library: string; icon: string })
  | (ElementStyleV2 & { type: 'text'; textStyle: { content: string } });

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
};

const sizedFields = {
  ...commonFields,
  width: nonNegativeNumberField,
  height: nonNegativeNumberField,
};

const textStyleSchema = {
  fields: { content: stringField },
  requiredFields: ['content'],
};

const textStyleField: FieldValidator = (value, path, variables = {}) => {
  if (!isPlainObject(value)) {
    return [
      createDiagnostic(
        DiagnosticCodes.invalidStructure,
        path,
        'textStyle 必须是对象',
      ),
    ];
  }
  return validateObjectFields(value, path, textStyleSchema, variables);
};

const inspectors: readonly NodeInspector[] = [
  { type: 'frame', allowsChildren: true, fields: sizedFields },
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
    fields: { ...commonFields, textStyle: textStyleField },
  },
];

/** Parses JSON against the version 2 element schema. */
export function parseDesignDocumentV2(
  text: string,
): ValidationResult<DesignDocumentV2> {
  return parseDocumentJson(text, validateDesignDocumentV2);
}

/** Validates structure and bindings for the version 2 element schema. */
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
  return { ok: true, document: result.document as DesignDocumentV2 };
}

import { z } from 'zod';
import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
  type DiagnosticCode,
} from './diagnostics';
import { isHexColor, isPlainObject } from './fields';
import {
  dimensionModes,
  frameAlignItems,
  frameJustifyContent,
  frameLayouts,
} from './layout-values';
import { layoutDesignDocumentV2 } from './layout-v2';
import { layoutIssueToDiagnostic } from './layout';
import { parseDocumentJson } from './parse-json';
import { isSystemAbsolutePath } from './path';
import type { DesignVariables, VariableType } from './types';
import {
  isVariableName,
  resolveBoundField,
  resolveVariableValue,
  variableReferenceName,
} from './variables';

export const DESIGN_DOCUMENT_VERSION = 2 as const;

const nonNegativeNumberSchema = z.number().nonnegative();
const positiveNumberSchema = z.number().positive();
const unitIntervalSchema = z.number().min(0).max(1);
const hexColorSchema = z.string().regex(/^#[\da-f]{6}(?:[\da-f]{2})?$/i);
const rawChildrenSchema = z.custom<unknown[]>(Array.isArray);

type VariableReference = `$${string}`;
const variableReferenceSchema = z.custom<VariableReference>(
  (value) => variableReferenceName(value) !== undefined,
);

function createElementSchema(variables?: Readonly<DesignVariables>) {
  function bound<Schema extends z.ZodType>(
    schema: Schema,
    variableTypes: readonly VariableType[],
  ) {
    // Keep references in the output. The second pass checks their literal values.
    return z
      .union([variableReferenceSchema, schema])
      .superRefine((value, context) => {
        if (
          variables === undefined ||
          !variableReferenceSchema.safeParse(value).success
        ) {
          return;
        }
        const resolved = resolveBoundField(value, variableTypes, variables);
        if ('code' in resolved) {
          context.addIssue({
            code: 'custom',
            message: resolved.message,
            params: { diagnosticCode: resolved.code },
          });
          return;
        }
        const literal = schema.safeParse(resolved.value);
        if (!literal.success) {
          for (const issue of literal.error.issues) {
            context.addIssue({ ...issue });
          }
        }
      });
  }

  function resolveOffset(offset: number | VariableReference): unknown {
    return variables === undefined
      ? offset
      : resolveVariableValue(offset, variables);
  }

  const unitInterval = bound(unitIntervalSchema, ['number']);
  const color = bound(hexColorSchema, ['color']);
  const nonNegativeNumber = bound(nonNegativeNumberSchema, ['number']);
  const number = bound(z.number(), ['number']);
  const url = bound(z.string(), ['string']);
  const fillOpacity = unitInterval.optional();
  const gradientPointSchema = z.strictObject({ x: number, y: number });
  const gradientStopsSchema = z
    .array(z.strictObject({ offset: unitInterval, color }))
    .min(2)
    .superRefine((stops, context) => {
      for (let index = 1; index < stops.length; index += 1) {
        const previous = resolveOffset(stops[index - 1].offset);
        const current = resolveOffset(stops[index].offset);
        if (
          typeof previous === 'number' &&
          typeof current === 'number' &&
          current < previous
        ) {
          context.addIssue({
            code: 'custom',
            path: [index, 'offset'],
            message: '色标偏移必须按非递减顺序声明',
          });
        }
      }
    });
  const meshPointsSchema = z
    .array(
      z
        .array(
          z.strictObject({
            x: unitInterval,
            y: unitInterval,
            color,
          }),
        )
        .min(2),
    )
    .min(2)
    .superRefine((rows, context) => {
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index].length !== rows[0].length) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: '网格渐变的每一行必须有相同数量的顶点',
          });
        }
      }
    });
  const uniform = z.union([
    bound(z.union([z.number(), z.boolean()]), ['number', 'boolean']),
    z.tuple([number, number]),
    z.tuple([number, number, number]),
    z.tuple([number, number, number, number]),
  ]);
  const uniforms = jsonRecord(z.string(), uniform);
  const gradientLayer = { type: z.literal('gradient'), opacity: fillOpacity };
  const fillLayer = z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('color'),
      opacity: fillOpacity,
      color,
    }),
    z.discriminatedUnion('gradientType', [
      z.strictObject({
        ...gradientLayer,
        gradientType: z.literal('linear'),
        start: gradientPointSchema,
        end: gradientPointSchema,
        stops: gradientStopsSchema,
      }),
      z.strictObject({
        ...gradientLayer,
        gradientType: z.literal('radial'),
        center: gradientPointSchema,
        radius: nonNegativeNumber,
        stops: gradientStopsSchema,
      }),
      z.strictObject({
        ...gradientLayer,
        gradientType: z.literal('angular'),
        center: gradientPointSchema,
        rotation: number,
        stops: gradientStopsSchema,
      }),
      z.strictObject({
        ...gradientLayer,
        gradientType: z.literal('mesh'),
        points: meshPointsSchema,
      }),
    ]),
    z.strictObject({
      type: z.literal('image'),
      opacity: fillOpacity,
      url,
      mode: z.enum(['cover', 'contain', 'stretch']).optional(),
    }),
    z.strictObject({
      type: z.literal('shader'),
      opacity: fillOpacity,
      url,
      uniforms: uniforms.optional(),
    }),
  ]);
  const fill = z.array(fillLayer);
  const stroke = z.strictObject({
    fill,
    alignment: z.enum(['inner', 'center', 'outer']).optional(),
    width: nonNegativeNumber.optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  });
  const cornerRadius = z.union([
    nonNegativeNumber,
    z.tuple([
      nonNegativeNumber,
      nonNegativeNumber,
      nonNegativeNumber,
      nonNegativeNumber,
    ]),
  ]);
  const effect = z.array(
    z.discriminatedUnion('type', [
      z.strictObject({
        type: z.enum(['drop_shadow', 'inner_shadow']),
        color,
        offsetX: number,
        offsetY: number,
        blurRadius: nonNegativeNumber,
      }),
      z.strictObject({
        type: z.enum(['layer_blur', 'background_blur']),
        radius: nonNegativeNumber,
      }),
    ]),
  );

  const dimension = z.union([z.enum(dimensionModes), nonNegativeNumber]);
  const textStyle = z
    .strictObject({
      content: bound(z.string(), ['string']),
      textGrowth: z
        .enum(['auto', 'fixed-width', 'fixed-width-height'])
        .optional(),
      width: dimension.optional(),
      height: dimension.optional(),
      fontFamily: bound(z.string().min(1), ['string']).optional(),
      fontSize: bound(positiveNumberSchema, ['number']).optional(),
      fontWeight: bound(z.number().int().min(1).max(1000), [
        'number',
      ]).optional(),
      lineHeight: bound(positiveNumberSchema, ['number']).optional(),
      textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
    })
    .superRefine((style, context) => {
      const growth = style.textGrowth ?? 'auto';
      if (growth !== 'auto' && style.width === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['width'],
          message: '当前文字增长模式要求提供 width',
        });
      }
      if (growth === 'fixed-width-height' && style.height === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['height'],
          message: '当前文字增长模式要求提供 height',
        });
      }
    });

  const commonFields = {
    id: z
      .string()
      .refine((id) => id.trim().length > 0, '元素 ID 必须是非空字符串'),
    name: bound(z.string(), ['string']).optional(),
    opacity: unitInterval.optional(),
    x: number.optional(),
    y: number.optional(),
    rotation: number.optional(),
    fill: fill.optional(),
    stroke: stroke.optional(),
    cornerRadius: cornerRadius.optional(),
    effect: effect.optional(),
  };
  const sizedFields = {
    ...commonFields,
    width: dimension.optional(),
    height: dimension.optional(),
  };

  return z.discriminatedUnion('type', [
    z.strictObject({
      ...sizedFields,
      type: z.literal('frame'),
      children: rawChildrenSchema.optional(),
      clip: bound(z.boolean(), ['boolean']).optional(),
      layout: z.enum(frameLayouts).optional(),
      gap: nonNegativeNumber.optional(),
      padding: z
        .union([
          nonNegativeNumber,
          z.tuple([nonNegativeNumber, nonNegativeNumber]),
          z.tuple([
            nonNegativeNumber,
            nonNegativeNumber,
            nonNegativeNumber,
            nonNegativeNumber,
          ]),
        ])
        .optional(),
      justifyContent: z.enum(frameJustifyContent).optional(),
      alignItems: z.enum([...frameAlignItems, 'stretch']).optional(),
    }),
    z.strictObject({ ...sizedFields, type: z.literal('rectangle') }),
    z.strictObject({ ...sizedFields, type: z.literal('ellipse') }),
    z.strictObject({
      ...sizedFields,
      type: z.literal('icon'),
      library: bound(z.string().min(1), ['string']),
      icon: bound(z.string().min(1), ['string']),
    }),
    z.strictObject({ ...commonFields, type: z.literal('text'), textStyle }),
  ]);
}

const elementSchema = createElementSchema();
type ElementFields = z.infer<typeof elementSchema>;
type FrameFields = Extract<ElementFields, { type: 'frame' }>;
type LeafElement = Exclude<ElementFields, FrameFields>;
type FrameElement = Omit<FrameFields, 'children'> & {
  children?: DesignElement[];
};
export type DesignElement = FrameElement | LeafElement;

export type FillLayerV2 = NonNullable<DesignElement['fill']>[number];
export type StrokeV2 = NonNullable<DesignElement['stroke']>;
export type CornerRadiusV2 = NonNullable<DesignElement['cornerRadius']>;
export type EffectV2 = NonNullable<DesignElement['effect']>[number];
export type TextStyleV2 = Extract<DesignElement, { type: 'text' }>['textStyle'];

function jsonRecord<Value extends z.ZodType>(
  key: z.ZodType<string>,
  value: Value,
) {
  // A Map lets Zod validate every own JSON key, including "__proto__".
  return z
    .preprocess(
      (input) =>
        isPlainObject(input) &&
        Object.prototype.toString.call(input) === '[object Object]'
          ? new Map(Object.entries(input))
          : undefined,
      z.map(key, value),
    )
    .transform((entries) => Object.fromEntries(entries));
}

const variablesSchema = jsonRecord(
  z.string().superRefine((name, context) => {
    if (!isVariableName(name)) {
      context.addIssue({
        code: 'custom',
        params: { diagnosticCode: DiagnosticCodes.invalidVariableName },
        message: '变量名必须由小写字母或数字分段组成，分段之间用单连字符连接',
      });
    }
  }),
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('color'),
      value: z.custom<string>(isHexColor),
    }),
    z.strictObject({ type: z.literal('number'), value: z.number() }),
    z.strictObject({ type: z.literal('string'), value: z.string() }),
    z.strictObject({ type: z.literal('boolean'), value: z.boolean() }),
  ]),
);

const documentSchema = z.strictObject({
  version: z.literal(DESIGN_DOCUMENT_VERSION),
  children: rawChildrenSchema.transform(parseElementTree),
  filePath: z.string().refine(isSystemAbsolutePath).optional(),
  variables: variablesSchema.default(() => ({})),
});
export type DesignDocument = z.infer<typeof documentSchema>;
export type ValidationResult =
  { ok: true; document: DesignDocument } | { ok: false; errors: Diagnostic[] };

type Path = PropertyKey[];

function parseElementTree(
  input: unknown[],
  context: z.RefinementCtx,
): DesignElement[] {
  const children: DesignElement[] = [];
  const stack = [{ input, children, path: [] as Path, index: 0 }];
  const ancestors = new Set([input]);
  // Validate one element at a time so the schema does not recurse with tree depth.
  while (stack.length > 0) {
    const parent = stack[stack.length - 1];
    if (parent.index === parent.input.length) {
      ancestors.delete(parent.input);
      stack.pop();
      continue;
    }

    const index = parent.index++;
    const child = parent.input[index];
    const path = [...parent.path, index];
    const parsed = elementSchema.safeParse(child);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ ...issue, path: [...path, ...issue.path] });
      }
      continue;
    }
    if (parsed.data.type !== 'frame') {
      parent.children.push(parsed.data);
      continue;
    }

    const { children: source, ...frame } = parsed.data;
    if (source === undefined) {
      if (Object.hasOwn(parsed.data, 'children')) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'children'],
          message: 'children 必须是有序数组',
        });
      }
      parent.children.push(frame);
      continue;
    }

    const childPath = [...path, 'children'];
    if (ancestors.has(source)) {
      context.addIssue({
        code: 'custom',
        path: childPath,
        message: '元素树不能包含循环引用',
      });
      continue;
    }
    const nested: DesignElement[] = [];
    parent.children.push({ ...frame, children: nested });
    ancestors.add(source);
    stack.push({ input: source, children: nested, path: childPath, index: 0 });
  }
  return children;
}

function checkVersion(input: Record<string, unknown>): Diagnostic | undefined {
  const version = input.version;
  if (version === undefined) {
    return createDiagnostic(
      DiagnosticCodes.missingVersion,
      '$.version',
      '设计稿缺少版本号',
    );
  }
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return createDiagnostic(
      DiagnosticCodes.invalidVersion,
      '$.version',
      '设计稿版本号必须是有限数值',
    );
  }
  if (version !== DESIGN_DOCUMENT_VERSION) {
    return createDiagnostic(
      DiagnosticCodes.unsupportedVersion,
      '$.version',
      `不支持的设计稿版本 ${version}，当前只支持版本 ${DESIGN_DOCUMENT_VERSION}`,
    );
  }
}

function formatPath(path: Path): string {
  return path.reduce<string>((parent, key) => {
    if (typeof key === 'number') {
      return `${parent}[${key}]`;
    }
    const name = String(key);
    return /^[a-z_$][\w$-]*$/i.test(name)
      ? `${parent}.${name}`
      : `${parent}[${JSON.stringify(name)}]`;
  }, '$');
}

function isElementPath(path: Path): boolean {
  return (
    path.length > 0 &&
    path.every((key, index) =>
      index % 2 === 0 ? key === 'children' : typeof key === 'number',
    ) &&
    path.length % 2 === 0
  );
}

function diagnosticsFromIssues(
  issues: readonly z.core.$ZodIssue[],
  source: unknown,
  prefix: Path = [],
): Diagnostic[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    const last = path.at(-1);
    const parent = path.slice(0, -1);
    const onElement = isElementPath(parent);
    const value = issue.path.reduce<unknown>(
      (input, key) =>
        typeof input === 'object' && input !== null && Object.hasOwn(input, key)
          ? (input as Record<PropertyKey, unknown>)[key]
          : undefined,
      source,
    );

    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) =>
        createDiagnostic(
          key === 'children' && isElementPath(path)
            ? DiagnosticCodes.invalidChildren
            : DiagnosticCodes.unknownField,
          formatPath([...path, key]),
          `不支持的字段 "${key}"`,
        ),
      );
    }
    if (issue.code === 'invalid_union') {
      // Unwrap a tuple's component failures or a scalar's failed binding check.
      const branch = issue.errors.find((branch) =>
        Array.isArray(value)
          ? branch.length > 0 &&
            branch.every(
              ({ path: [key] }) =>
                typeof key === 'number' && key < value.length,
            )
          : branch.some(
              (issue) =>
                issue.code === 'custom' &&
                issue.params?.diagnosticCode !== undefined,
            ),
      );
      if (branch !== undefined) {
        return diagnosticsFromIssues(branch, value, path);
      }
    }

    let code: DiagnosticCode = DiagnosticCodes.invalidValue;
    if (issue.code === 'custom' && issue.params?.diagnosticCode !== undefined) {
      code = issue.params.diagnosticCode as DiagnosticCode;
    } else if (onElement && last === 'id') {
      code = DiagnosticCodes.invalidId;
    } else if (onElement && last === 'children') {
      code = DiagnosticCodes.invalidChildren;
    } else if (path.length === 1 && last === 'filePath') {
      code = DiagnosticCodes.invalidFilePath;
    } else if (
      isElementPath(path) ||
      (onElement &&
        last === 'type' &&
        value !== undefined &&
        typeof value !== 'string') ||
      (onElement && last === 'textStyle' && value !== undefined) ||
      (path.length === 1 && (last === 'children' || last === 'variables')) ||
      (path.length === 2 && path[0] === 'variables')
    ) {
      code = DiagnosticCodes.invalidStructure;
    } else if (value === undefined) {
      code = DiagnosticCodes.missingField;
    } else if (onElement && last === 'type') {
      code = DiagnosticCodes.unknownNodeType;
    } else if (
      variableReferenceName(value) !== undefined &&
      ((parent.at(-1) === 'textStyle' &&
        isElementPath(parent.slice(0, -1)) &&
        (last === 'textGrowth' || last === 'textAlign')) ||
        (onElement &&
          (last === 'layout' ||
            last === 'justifyContent' ||
            last === 'alignItems')))
    ) {
      code = DiagnosticCodes.variableTypeMismatch;
    }
    return [createDiagnostic(code, formatPath(path), issue.message)];
  });
}

function validateDocumentRules(document: DesignDocument): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const bindingSchema = createElementSchema(document.variables);
  const ids = new Map<string, Path>();
  const stack = [
    { children: document.children, path: ['children'] as Path, index: 0 },
  ];
  while (stack.length > 0) {
    const parent = stack[stack.length - 1];
    if (parent.index === parent.children.length) {
      stack.pop();
      continue;
    }
    const index = parent.index++;
    const element = parent.children[index];
    const path = [...parent.path, index];
    const idPath = [...path, 'id'];
    const firstPath = ids.get(element.id);
    if (firstPath === undefined) {
      ids.set(element.id, idPath);
    } else {
      errors.push(
        createDiagnostic(
          DiagnosticCodes.duplicateId,
          formatPath(idPath),
          `重复的元素 ID "${element.id}"，首次出现在 ${formatPath(firstPath)}`,
        ),
      );
    }

    const bindings = bindingSchema.safeParse(element);
    if (!bindings.success) {
      errors.push(
        ...diagnosticsFromIssues(bindings.error.issues, element, path),
      );
    }
    if (element.type === 'frame' && element.children !== undefined) {
      stack.push({
        children: element.children,
        path: [...path, 'children'],
        index: 0,
      });
    }
  }

  return errors.length > 0
    ? errors
    : layoutDesignDocumentV2(document).issues.map(layoutIssueToDiagnostic);
}

/** Parses JSON and validates it against the native v2 contract. */
export function parseDesignDocument(text: string): ValidationResult {
  return parseDocumentJson(text, validateDesignDocument);
}

/** Validates v2 fields, then checks IDs, bindings and dimension dependencies. */
export function validateDesignDocument(input: unknown): ValidationResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        createDiagnostic(
          DiagnosticCodes.invalidStructure,
          '$',
          '设计稿根节点必须是对象',
        ),
      ],
    };
  }
  const versionError = checkVersion(input);
  if (versionError !== undefined) {
    return { ok: false, errors: [versionError] };
  }

  const fields = documentSchema.safeParse(input);
  if (!fields.success) {
    return {
      ok: false,
      errors: diagnosticsFromIssues(fields.error.issues, input),
    };
  }

  const errors = validateDocumentRules(fields.data);
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, document: fields.data };
}

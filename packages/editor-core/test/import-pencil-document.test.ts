import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  layoutDesignDocument,
  resolveDesignDocument,
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Diagnostic,
  type FrameElement,
} from '@design-ai/design-schema';
import {
  importPencilDocument,
  type PencilImportFailure,
  type PencilImportResult,
  type PencilImportSuccess,
} from '../src/index';

const fixturePath = fileURLToPath(
  new URL('./fixtures/pencil-2.25-five-elements.pen', import.meta.url),
);

async function importFixture(): Promise<PencilImportSuccess> {
  const text = await readFile(fixturePath, 'utf8');
  const result = importPencilDocument(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result;
}

function elementOf(
  elements: DesignElement[] | undefined,
  id: string,
): DesignElement {
  const element = (elements ?? []).find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new Error(`No imported element named ${id}`);
  }
  return element;
}

function frameOf(
  elements: DesignElement[] | undefined,
  id: string,
): FrameElement {
  const element = elementOf(elements, id);
  if (element.type !== 'frame') {
    throw new Error(`${id} is not a frame`);
  }
  return element;
}

function successOf(result: PencilImportResult): PencilImportSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result;
}

function failureOf(result: PencilImportResult): PencilImportFailure {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected the import to fail');
  }
  return result;
}

function warningFor(
  warnings: Diagnostic[],
  code: string,
  path?: string,
): Diagnostic | undefined {
  return warnings.find(
    (warning) =>
      warning.code === code && (path === undefined || warning.path === path),
  );
}

function expectValid(document: Parameters<typeof validateDesignDocument>[0]) {
  const result = validateDesignDocument(document);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
}

describe('importPencilDocument', () => {
  it('imports a real Pencil 2.25 sample with JSON comments and all five element types', async () => {
    const { document, warnings } = await importFixture();

    expect(warnings).toEqual([]);
    expect(document.version).toBe(1);
    expect(document.filePath).toBeUndefined();
    expect(validateDesignDocument(document).ok).toBe(true);

    const page = frameOf(document.children, 'page');
    expect(page).toMatchObject({
      id: 'page',
      type: 'frame',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      layout: 'vertical',
      gap: 12,
      padding: [20, 24, 20, 24],
      fill: '#FFFFFF',
      cornerRadius: 12,
      stroke: '#D0D7DE',
      strokeWidth: 1,
    });
    expect(page.children?.map((child) => child.id)).toEqual(['header', 'card']);

    const header = frameOf(page.children, 'header');
    expect(header).toMatchObject({
      width: { mode: 'fill_container' },
      height: 56,
      layout: 'horizontal',
      padding: [10, 10, 10, 10],
      gap: 8,
      alignItems: 'center',
      fill: '#F6F8FA',
    });
    expect(header.children?.map((child) => child.id)).toEqual([
      'logo',
      'title',
    ]);

    expect(elementOf(header.children, 'logo')).toMatchObject({
      type: 'icon',
      library: 'lucide',
      icon: 'sparkles',
      width: 24,
      height: 24,
      fill: '#8250DF',
    });
    expect(elementOf(header.children, 'title')).toEqual({
      id: 'title',
      type: 'text',
      text: '基础元素',
      width: { mode: 'fill_container' },
      fontFamily: 'Inter',
      fontSize: 18,
      fontWeight: 700,
      lineHeight: 1.4,
      fill: '#1F2328',
      textWrap: 'wrap',
    });

    const card = frameOf(page.children, 'card');
    expect(card).toMatchObject({
      width: { mode: 'fill_container' },
      height: { mode: 'fit_content' },
      layout: 'vertical',
      gap: 8,
      padding: [12, 16, 12, 16],
      fill: '#FFFFFF',
      cornerRadius: 8,
    });
    expect(card.children?.map((child) => child.id)).toEqual([
      'thumbnail',
      'status',
      'caption',
    ]);

    expect(elementOf(card.children, 'thumbnail')).toMatchObject({
      type: 'rectangle',
      width: { mode: 'fill_container' },
      height: 72,
      fill: '#FFD8A8',
      cornerRadius: 6,
    });
    expect(elementOf(card.children, 'status')).toMatchObject({
      type: 'ellipse',
      width: 12,
      height: 12,
      fill: '#1F883D',
      opacity: 0.8,
      rotation: 15,
    });
    expect(elementOf(card.children, 'caption')).toMatchObject({
      type: 'text',
      text: '五种基础元素',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.5,
      textAlign: 'center',
      textWrap: 'none',
      fill: '#57606A',
      visible: false,
    });
  });

  it('normalizes all supported padding shorthands and keeps the four-item order', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "one", "type": "frame", "width": 10, "height": 10, "padding": 4 },
          { "id": "two", "type": "frame", "width": 10, "height": 10, "padding": [4, 8] },
          { "id": "four", "type": "frame", "width": 10, "height": 10, "padding": [1, 2, 3, 4] }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(frameOf(document.children, 'one').padding).toEqual([4, 4, 4, 4]);
    expect(frameOf(document.children, 'two').padding).toEqual([4, 8, 4, 8]);
    expect(frameOf(document.children, 'four').padding).toEqual([1, 2, 3, 4]);
    expectValid(document);
  });

  it('converts document variables and rewrites whole-value property references', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "color.brand": { "type": "color", "value": "#3366FF" },
          "space.gap": { "type": "number", "value": 12 },
          "label.title": { "type": "string", "value": "欢迎" },
          "show.title": { "type": "boolean", "value": false }
        },
        "children": [
          {
            "id": "card",
            "type": "frame",
            "layout": "vertical",
            "width": 320,
            "height": 200,
            "gap": "$space.gap",
            "fill": "$color.brand",
            "children": [
              {
                "id": "title",
                "type": "text",
                "content": "$label.title",
                "fontSize": 16,
                "enabled": "$show.title",
                "fill": "$color.brand"
              },
              {
                "id": "block",
                "type": "rectangle",
                "width": "$space.gap",
                "height": "$space.gap",
                "fill": { "type": "color", "color": "$color.brand" }
              }
            ]
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(document.variables).toEqual({
      'color-brand': { type: 'color', value: '#3366FF' },
      'space-gap': { type: 'number', value: 12 },
      'label-title': { type: 'string', value: '欢迎' },
      'show-title': { type: 'boolean', value: false },
    });

    const card = frameOf(document.children, 'card');
    expect(card.gap).toBe('$space-gap');
    expect(card.fill).toBe('$color-brand');
    expect(elementOf(card.children, 'title')).toMatchObject({
      text: '$label-title',
      visible: '$show-title',
      fill: '$color-brand',
    });
    expect(elementOf(card.children, 'block')).toMatchObject({
      width: '$space-gap',
      height: '$space-gap',
      fill: '$color-brand',
    });
    expectValid(document);

    const resolved = resolveDesignDocument(document);
    const resolvedCard = frameOf(resolved.children, 'card');
    expect(resolvedCard.gap).toBe(12);
    expect(elementOf(resolvedCard.children, 'title')).toMatchObject({
      text: '欢迎',
      visible: false,
      fill: '#3366FF',
    });
    expect(elementOf(resolvedCard.children, 'block')).toMatchObject({
      width: 12,
      height: 12,
      fill: '#3366FF',
    });

    const changed: DesignDocument = {
      ...document,
      variables: {
        ...document.variables,
        'color-brand': { type: 'color', value: '#FF5500' },
      },
    };
    const changedCard = frameOf(
      resolveDesignDocument(changed).children,
      'card',
    );
    expect(changedCard.fill).toBe('#FF5500');
    expect(elementOf(changedCard.children, 'title')).toMatchObject({
      text: '欢迎',
      visible: false,
      fill: '#FF5500',
    });
    expect(elementOf(changedCard.children, 'block')).toMatchObject({
      width: 12,
      height: 12,
      fill: '#FF5500',
    });
  });

  it('assigns numeric suffixes to colliding normalized variable names and keeps each binding', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "color.brand": { "type": "color", "value": "#111111" },
          "color-brand": { "type": "color", "value": "#222222" }
        },
        "children": [
          { "id": "first", "type": "rectangle", "width": 10, "height": 10, "fill": "$color.brand" },
          { "id": "second", "type": "rectangle", "width": 10, "height": 10, "fill": "$color-brand" }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(document.variables).toEqual({
      'color-brand': { type: 'color', value: '#111111' },
      'color-brand-2': { type: 'color', value: '#222222' },
    });
    expect(elementOf(document.children, 'first').fill).toBe('$color-brand');
    expect(elementOf(document.children, 'second').fill).toBe('$color-brand-2');
    expectValid(document);

    const changed: DesignDocument = {
      ...document,
      variables: {
        ...document.variables,
        'color-brand': { type: 'color', value: '#ABCDEF' },
      },
    };
    const resolved = resolveDesignDocument(changed);
    expect(elementOf(resolved.children, 'first').fill).toBe('#ABCDEF');
    expect(elementOf(resolved.children, 'second').fill).toBe('#222222');
  });

  it('skips themed variables and unconvertible references while keeping legal content', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "color.themed": {
            "type": "color",
            "value": [
              { "value": "#111111", "theme": { "mode": "light" } },
              { "value": "#000000", "theme": { "mode": "dark" } }
            ]
          },
          "color.alias": { "type": "color", "value": "$color.base" },
          "color.base": { "type": "color", "value": "#ABCDEF" },
          "size.bad": { "type": "number", "value": "12" },
          "!!!": { "type": "string", "value": "无法命名" }
        },
        "children": [
          { "id": "themed", "type": "rectangle", "width": 10, "height": 10, "fill": "$color.themed" },
          { "id": "alias", "type": "rectangle", "width": 10, "height": 10, "fill": "$color.alias" },
          { "id": "missing", "type": "rectangle", "width": 10, "height": 10, "fill": "$missing.variable" },
          { "id": "valid", "type": "rectangle", "width": 10, "height": 10, "fill": "$color.base" },
          { "id": "bad-text", "type": "text", "content": "$label.missing" }
        ]
      }`),
    );

    expect(document.variables).toEqual({
      'color-base': { type: 'color', value: '#ABCDEF' },
    });
    expect(
      warningFor(
        warnings,
        'unsupported_variable',
        '$.variables.color.themed.value',
      ),
    ).toBeDefined();
    expect(
      warningFor(
        warnings,
        'unsupported_variable',
        '$.variables.color.alias.value',
      ),
    ).toBeDefined();
    expect(
      warningFor(
        warnings,
        'unsupported_variable',
        '$.variables.size.bad.value',
      ),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_variable', '$.variables.!!!.name'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].fill'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[1].fill'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[2].fill'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[4].content'),
    ).toBeDefined();
    expect(warningFor(warnings, 'skipped_node', '$.children[4]')).toBeDefined();

    expect(elementOf(document.children, 'themed')).not.toHaveProperty('fill');
    expect(elementOf(document.children, 'alias')).not.toHaveProperty('fill');
    expect(elementOf(document.children, 'missing')).not.toHaveProperty('fill');
    expect(elementOf(document.children, 'valid').fill).toBe('$color-base');
    expect(document.children.map((child) => child.id)).toEqual([
      'themed',
      'alias',
      'missing',
      'valid',
    ]);
    expectValid(document);
  });

  it('binds scalar radius and gap variables but drops padding tuples that cannot bind', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "space.gap": { "type": "number", "value": 8 },
          "radius.card": { "type": "number", "value": 6 },
          "space.pad": { "type": "number", "value": 4 }
        },
        "children": [
          {
            "id": "card",
            "type": "frame",
            "width": 100,
            "height": 100,
            "gap": "$space.gap",
            "padding": ["$space.pad", "$space.pad"],
            "cornerRadius": "$radius.card"
          }
        ]
      }`),
    );

    const card = frameOf(document.children, 'card');
    expect(card.gap).toBe('$space-gap');
    expect(card.cornerRadius).toBe('$radius-card');
    expect(card).not.toHaveProperty('padding');
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].padding'),
    ).toBeDefined();
    expectValid(document);

    const resolved = frameOf(resolveDesignDocument(document).children, 'card');
    expect(resolved).toMatchObject({
      gap: 8,
      cornerRadius: 6,
    });
  });

  it('drops a binding whose resolved value is invalid for that property', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "range.value": { "type": "number", "value": 8 }
        },
        "children": [
          {
            "id": "frame",
            "type": "frame",
            "width": 100,
            "height": 100,
            "gap": "$range.value",
            "opacity": "$range.value"
          }
        ]
      }`),
    );

    const frame = frameOf(document.children, 'frame');
    expect(frame.gap).toBe('$range-value');
    expect(frame).not.toHaveProperty('opacity');
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].opacity'),
    ).toBeDefined();
    expectValid(document);
  });

  it('measures group bounds using resolved variable sizes', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "variables": {
          "size.child": { "type": "number", "value": 20 }
        },
        "children": [
          {
            "id": "group",
            "type": "group",
            "children": [
              {
                "id": "child",
                "type": "rectangle",
                "width": "$size.child",
                "height": "$size.child"
              }
            ]
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    const group = frameOf(document.children, 'group');
    expect(group).toMatchObject({ width: 20, height: 20 });
    expect(elementOf(group.children, 'child')).toMatchObject({
      width: '$size-child',
      height: '$size-child',
    });
    expectValid(document);
  });

  it('treats a frame without layout as horizontal, matching the shared layout rules', () => {
    const { document } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "row",
            "type": "frame",
            "width": 300,
            "height": 100,
            "gap": 10,
            "children": [
              { "id": "a", "type": "rectangle", "width": 20, "height": 20 },
              { "id": "b", "type": "rectangle", "width": 30, "height": 20 }
            ]
          }
        ]
      }`),
    );

    expect(frameOf(document.children, 'row').layout).toBeUndefined();
    const layout = layoutDesignDocument(document);
    expect(layout.issues).toEqual([]);
    expect(layout.roots[0]?.children.map((child) => child.box.x)).toEqual([
      0, 30,
    ]);
  });

  it('assigns new ids for missing and duplicate ids and points at each location', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "type": "text", "content": "缺少 ID" },
          { "id": "duplicate", "type": "rectangle", "width": 10, "height": 10 },
          { "id": "duplicate", "type": "rectangle", "width": 10, "height": 10 }
        ]
      }`),
    );

    expect(document.children.map((child) => child.id)).toEqual([
      'text-1',
      'duplicate',
      'rectangle-1',
    ]);
    expect(
      warningFor(warnings, 'missing_id', '$.children[0].id'),
    ).toMatchObject({ code: 'missing_id', path: '$.children[0].id' });
    expect(
      warningFor(warnings, 'duplicate_id', '$.children[2].id'),
    ).toMatchObject({ code: 'duplicate_id', path: '$.children[2].id' });
    expect(
      warningFor(warnings, 'duplicate_id', '$.children[2].id')?.message,
    ).toContain('duplicate');
    expectValid(document);
  });

  it('imports a Pencil group as a free-positioned transparent frame sized to its children', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "group",
            "type": "group",
            "x": 24,
            "y": 16,
            "children": [
              { "id": "title", "type": "text", "content": "Hello", "x": 8, "y": 4, "fontSize": 20 },
              { "id": "badge", "type": "rectangle", "x": 64, "y": 12, "width": 8, "height": 8, "fill": "#FF0000" }
            ]
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    const group = frameOf(document.children, 'group');
    expect(group).toMatchObject({
      id: 'group',
      type: 'frame',
      layout: 'none',
      x: 24,
      y: 16,
      width: 72,
      height: 28,
    });
    expect(group.fill).toBeUndefined();
    expect(group).not.toHaveProperty('clip');
    expect(group.children?.map((child) => child.id)).toEqual([
      'title',
      'badge',
    ]);

    const layout = layoutDesignDocument(document);
    expect(layout.issues).toEqual([]);
    expect(layout.roots[0]?.box).toMatchObject({
      x: 24,
      y: 16,
      width: 72,
      height: 28,
    });
    expect(layout.roots[0]?.children[0]?.box).toMatchObject({
      x: 8,
      y: 4,
      width: 40,
      height: 24,
    });
    expect(layout.roots[0]?.children[1]?.box).toMatchObject({
      x: 64,
      y: 12,
      width: 8,
      height: 8,
    });
    expectValid(document);
  });

  it('keeps convertible group children and reports unsupported group properties', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "group",
            "type": "group",
            "name": "组合",
            "effect": { "type": "blur", "radius": 2 },
            "opacity": 0.5,
            "rotation": 10,
            "children": [
              { "id": "label", "type": "text", "content": "Hi", "x": 0, "y": 0 },
              { "id": "unsupported", "type": "path" },
              { "id": "dot", "type": "ellipse", "x": 20, "y": 10, "width": 8, "height": 8 }
            ]
          }
        ]
      }`),
    );

    const group = frameOf(document.children, 'group');
    expect(group).toMatchObject({
      id: 'group',
      type: 'frame',
      layout: 'none',
      opacity: 0.5,
      rotation: 10,
      width: 28,
      height: 19.2,
    });
    expect(group.children?.map((child) => child.id)).toEqual(['label', 'dot']);
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].name'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].effect'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_node', '$.children[0].children[1]'),
    ).toBeDefined();
    expectValid(document);
  });

  it('lays a converted group out as a fixed-size child of an auto-layout frame', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "row",
            "type": "frame",
            "layout": "horizontal",
            "width": 300,
            "height": 80,
            "gap": 10,
            "children": [
              {
                "id": "group",
                "type": "group",
                "x": 999,
                "y": 999,
                "children": [
                  { "id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 40, "height": 20 },
                  { "id": "b", "type": "rectangle", "x": 20, "y": 10, "width": 60, "height": 30 }
                ]
              },
              { "id": "tail", "type": "rectangle", "width": 10, "height": 10 }
            ]
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(
      frameOf(frameOf(document.children, 'row').children, 'group'),
    ).toMatchObject({ width: 80, height: 40 });

    const layout = layoutDesignDocument(document);
    expect(layout.issues).toEqual([]);
    expect(layout.roots[0]?.children[0]?.box).toMatchObject({
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    });
    expect(layout.roots[0]?.children[1]?.box).toMatchObject({ x: 90, y: 0 });
    expect(layout.roots[0]?.children[0]?.children[1]?.box).toMatchObject({
      x: 20,
      y: 10,
      width: 60,
      height: 30,
    });
    expectValid(document);
  });

  it('anchors the converted frame to children that extend beyond the group origin', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "group",
            "type": "group",
            "x": 100,
            "y": 50,
            "children": [
              { "id": "offset", "type": "rectangle", "x": -10, "y": -5, "width": 20, "height": 15 }
            ]
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    const group = frameOf(document.children, 'group');
    expect(group).toMatchObject({
      x: 90,
      y: 45,
      width: 20,
      height: 15,
    });
    expect(elementOf(group.children, 'offset')).toMatchObject({ x: 0, y: 0 });

    const layout = layoutDesignDocument(document);
    expect(layout.issues).toEqual([]);
    expect(layout.roots[0]?.children[0]?.box).toMatchObject({
      x: 0,
      y: 0,
      width: 20,
      height: 15,
    });
    expectValid(document);
  });

  it('skips unsupported nodes together with their subtrees and reports the location', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "before", "type": "rectangle", "width": 10, "height": 10 },
          {
            "id": "path",
            "type": "path",
            "children": [
              { "id": "nested", "type": "text", "content": "不应导入" }
            ]
          },
          { "id": "after", "type": "text", "content": "仍然导入" }
        ]
      }`),
    );

    expect(document.children.map((child) => child.id)).toEqual([
      'before',
      'after',
    ]);
    const warning = warningFor(warnings, 'unsupported_node', '$.children[1]');
    expect(warning?.message).toContain('path');
    expectValid(document);
  });

  it('drops unsupported properties while keeping nodes that remain valid', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          {
            "id": "frame",
            "type": "frame",
            "width": 200,
            "height": 100,
            "layout": "horizontal",
            "name": "页面",
            "clip": true,
            "layoutIncludeStroke": true,
            "fill": { "type": "gradient" },
            "children": [
              {
                "id": "text",
                "type": "text",
                "content": "Hi",
                "letterSpacing": 2,
                "href": "https://example.com",
                "fill": { "type": "color", "color": "#112233" }
              }
            ]
          }
        ]
      }`),
    );

    expect(document.children.map((child) => child.id)).toEqual(['frame']);
    const frame = frameOf(document.children, 'frame');
    expect(frame.fill).toBeUndefined();
    expect(frame).not.toHaveProperty('clip');
    expect(frame.children?.map((child) => child.id)).toEqual(['text']);
    expect(elementOf(frame.children, 'text')).toMatchObject({
      type: 'text',
      text: 'Hi',
      fill: '#112233',
    });
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].clip'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].name'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[0].fill'),
    ).toBeDefined();
    expect(
      warningFor(
        warnings,
        'unsupported_property',
        '$.children[0].children[0].letterSpacing',
      ),
    ).toBeDefined();
    expect(
      warningFor(
        warnings,
        'unsupported_property',
        '$.children[0].children[0].href',
      ),
    ).toBeDefined();
    expectValid(document);
  });

  it('skips nodes that cannot form a legal native element and explains why', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "no-size", "type": "rectangle" },
          { "id": "no-icon", "type": "icon", "width": 10, "height": 10 },
          { "id": "bad-width", "type": "rectangle", "width": "grow", "height": 10 },
          { "id": "ok", "type": "text", "content": "Hello" }
        ]
      }`),
    );

    expect(document.children.map((child) => child.id)).toEqual(['ok']);
    expect(
      warningFor(warnings, 'skipped_node', '$.children[0]')?.message,
    ).toContain('宽度');
    expect(
      warningFor(warnings, 'skipped_node', '$.children[1]')?.message,
    ).toContain('icon');
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[2].width'),
    ).toBeDefined();
    expect(
      warningFor(warnings, 'skipped_node', '$.children[2]')?.message,
    ).toContain('width');
    expectValid(document);
  });

  it('defaults a missing icon library to lucide and preserves the icon name', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "icon", "type": "icon", "icon": "star", "width": 16, "height": 16 }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(document.children[0]).toMatchObject({
      type: 'icon',
      library: 'lucide',
      icon: 'star',
    });
  });

  it('imports a genuinely empty Pencil document as an empty native draft', () => {
    const result = successOf(
      importPencilDocument('{ "version": "2.25", "children": [] }'),
    );

    expect(result.document).toEqual({
      version: 1,
      children: [],
      variables: {},
    });
    expect(result.document.filePath).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('fails when the source has nodes but every node is skipped', () => {
    const result = failureOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "group", "type": "group", "children": [] },
          { "id": "path", "type": "path" }
        ]
      }`),
    );

    expect(result.errors.map((error) => error.code)).toContain('empty_import');
    expect(result.errors.map((error) => error.code)).toContain(
      'unsupported_node',
    );
    for (const error of result.errors) {
      expect(error.path.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('reports parse and version failures as errors', () => {
    const parseFailure = failureOf(importPencilDocument('{ not json'));
    expect(parseFailure.errors[0]).toMatchObject({
      code: 'invalid_json',
      path: '$',
    });

    const cases: Array<[string, unknown, string]> = [
      [{ children: [] }, 'missing_version'],
      [{ version: 2.25, children: [] }, 'invalid_version'],
      [{ version: '2.24', children: [] }, 'unsupported_version'],
      [{ version: '2.25' }, 'invalid_structure'],
      [{ version: '2.25', children: {} }, 'invalid_structure'],
      [[], 'invalid_structure'],
    ];
    for (const [value, code] of cases) {
      const result = failureOf(importPencilDocument(JSON.stringify(value)));
      expect(result.errors[0]?.code, JSON.stringify(value)).toBe(code);
    }
  });

  it('normalizes numeric and named Pencil font weights', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        "version": "2.25",
        "children": [
          { "id": "a", "type": "text", "content": "A", "fontWeight": "bold" },
          { "id": "b", "type": "text", "content": "B", "fontWeight": "semi-bold" },
          { "id": "c", "type": "text", "content": "C", "fontWeight": "650" },
          { "id": "d", "type": "text", "content": "D", "fontWeight": "unknown" }
        ]
      }`),
    );

    expect(
      document.children.map((child) =>
        child.type === 'text' ? child.fontWeight : undefined,
      ),
    ).toEqual([700, 600, 650, undefined]);
    expect(
      warningFor(warnings, 'unsupported_property', '$.children[3].fontWeight'),
    ).toBeDefined();
  });

  it('keeps comment-like sequences inside strings intact', () => {
    const { document, warnings } = successOf(
      importPencilDocument(`{
        // 行注释
        "version": "2.25",
        "children": [
          {
            "id": "text",
            "type": "text",
            /* 块注释 */
            "content": "https://example.com/*not-a-comment*/",
            "fontFamily": "A//B"
          }
        ]
      }`),
    );

    expect(warnings).toEqual([]);
    expect(elementOf(document.children, 'text')).toMatchObject({
      type: 'text',
      text: 'https://example.com/*not-a-comment*/',
      fontFamily: 'A//B',
    });
  });
});

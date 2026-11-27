import { expect, it } from 'vitest';
import {
  layoutDesignDocument,
  parseDesignDocument,
  validateDesignDocument,
} from '../src/index';

it('accepts the same complete v2 design through both public entry points', () => {
  const input = {
    version: 2,
    variables: {
      brand: { type: 'color', value: '#1D4ED8' },
      gap: { type: 'number', value: 8 },
      title: { type: 'string', value: '设计稿预览' },
    },
    children: [
      {
        id: 'card',
        type: 'frame',
        layout: 'vertical',
        width: 320,
        height: 'fit_content',
        gap: '$gap',
        padding: ['$gap', 16],
        cornerRadius: [12, 12, '$gap', 0],
        children: [
          {
            id: 'surface',
            type: 'rectangle',
            width: 'fill_container',
            height: 80,
            fill: [
              { type: 'color', color: '$brand' },
              {
                type: 'gradient',
                gradientType: 'linear',
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
                stops: [
                  { offset: 0, color: '$brand' },
                  { offset: 1, color: '#FFFFFF00' },
                ],
              },
              { type: 'image', url: 'texture.png' },
              {
                type: 'shader',
                url: 'grain.frag',
                uniforms: { scale: [1, '$gap'] },
              },
            ],
            stroke: {
              fill: [
                { type: 'color', color: '#FFFFFF' },
                { type: 'color', color: '$brand', opacity: 0.5 },
              ],
              style: 'dashed',
            },
            effect: [
              {
                type: 'drop_shadow',
                color: '$brand',
                offsetX: 0,
                offsetY: 2,
                blurRadius: '$gap',
              },
              { type: 'layer_blur', radius: 1 },
            ],
          },
          { id: 'badge', type: 'ellipse', width: 24, height: 24 },
          {
            id: 'heading',
            type: 'text',
            textStyle: {
              content: '$title',
              textGrowth: 'fixed-width',
              width: 'fill_container',
              fontWeight: 600,
            },
          },
          {
            id: 'star',
            type: 'icon',
            width: 20,
            height: 20,
            library: 'lucide',
            icon: 'star',
          },
        ],
      },
    ],
  };
  const expected = { ok: true, document: input };

  const parsed = parseDesignDocument(JSON.stringify(input));
  expect(parsed).toStrictEqual(expected);
  if (!parsed.ok) throw new Error('Expected a valid design document');

  expect(
    layoutDesignDocument(parsed.document).roots[0]?.children.map(
      ({ element }) => element.id,
    ),
  ).toEqual(['surface', 'badge', 'heading', 'star']);
  expect(validateDesignDocument(input)).toStrictEqual(expected);
});

it('preserves omitted optional fields and supplies only the root variables default', () => {
  const input = {
    version: 2,
    children: [
      { id: 'empty', type: 'frame' },
      { id: 'heading', type: 'text', textStyle: { content: '' } },
    ],
  };
  const expected = { ok: true, document: { ...input, variables: {} } };

  expect(parseDesignDocument(JSON.stringify(input))).toStrictEqual(expected);
  expect(validateDesignDocument(input)).toStrictEqual(expected);
});

it('reports malformed JSON at the root', () => {
  expect(parseDesignDocument('{ nope')).toMatchObject({
    ok: false,
    errors: [{ code: 'invalid_json', path: '$', message: expect.any(String) }],
  });
});

it.each([
  [null, 'invalid_structure', '$'],
  [{ children: [] }, 'missing_version', '$.version'],
  [{ version: '2', children: [] }, 'invalid_version', '$.version'],
  [
    { version: 1, children: null, extra: true },
    'unsupported_version',
    '$.version',
  ],
  [
    { version: 2, children: [], filePath: 'relative.json' },
    'invalid_file_path',
    '$.filePath',
  ],
])('diagnoses invalid documents at %s', (input, code, path) => {
  const expected = {
    ok: false,
    errors: [{ code, path, message: expect.any(String) }],
  };

  expect(parseDesignDocument(JSON.stringify(input))).toEqual(expected);
  expect(validateDesignDocument(input)).toEqual(expected);
});

it.each([
  [
    { id: 'box', type: 'rectangle', width: { mode: 'fit_content' } },
    'invalid_value',
    'width',
  ],
  [
    { id: 'title', type: 'text', textStyle: { content: '' }, text: 'legacy' },
    'unknown_field',
    'text',
  ],
  [
    { id: 'box', type: 'rectangle', strokeWidth: 1 },
    'unknown_field',
    'strokeWidth',
  ],
  [
    { id: 'box', type: 'rectangle', strokeAlignment: 'center' },
    'unknown_field',
    'strokeAlignment',
  ],
  [
    { id: 'box', type: 'rectangle', enabled: false },
    'unknown_field',
    'enabled',
  ],
  [{ id: 'box', type: 'triangle' }, 'unknown_node_type', 'type'],
  [{ id: '', type: 'rectangle' }, 'invalid_id', 'id'],
  [
    { id: 'box', type: 'ellipse', children: [] },
    'invalid_children',
    'children',
  ],
  [
    {
      id: 'title',
      type: 'text',
      textStyle: { content: 'Title', textGrowth: 'fixed-width' },
    },
    'missing_field',
    'textStyle.width',
  ],
  [
    { id: 'title', type: 'text', textStyle: { content: '$absent' } },
    'missing_variable',
    'textStyle.content',
  ],
  [
    { id: 'box', type: 'rectangle', width: '$brand', height: 20 },
    'variable_type_mismatch',
    'width',
  ],
  [
    { id: 'box', type: 'rectangle', width: 'fill_container', height: 20 },
    'missing_size_basis',
    'width',
  ],
])('diagnoses invalid elements at %s', (element, code, field) => {
  const input = {
    version: 2,
    variables: { brand: { type: 'color', value: '#1D4ED8' } },
    children: [element],
  };
  const expected = {
    ok: false,
    errors: [
      { code, path: `$.children[0].${field}`, message: expect.any(String) },
    ],
  };

  expect(parseDesignDocument(JSON.stringify(input))).toEqual(expected);
  expect(validateDesignDocument(input)).toEqual(expected);
});

it('checks field rules before duplicate IDs, bindings and size dependencies', () => {
  const box = {
    id: 'box',
    type: 'rectangle',
    width: 'fill_container',
    height: '$absent',
  };
  const input = { version: 2, children: [box, { ...box, visible: false }] };
  const expected = {
    ok: false,
    errors: [
      {
        code: 'unknown_field',
        path: '$.children[1].visible',
        message: expect.any(String),
      },
    ],
  };

  expect(parseDesignDocument(JSON.stringify(input))).toEqual(expected);
  expect(validateDesignDocument(input)).toEqual(expected);
});

it.each([
  ['bad.name', '$.variables["bad.name"]'],
  ['__proto__', '$.variables.__proto__'],
])(
  'diagnoses an invalid variable declaration name %s at its own key',
  (name, path) => {
    const input = {
      version: 2,
      variables: { [name]: { type: 'number', value: 1 } },
      children: [],
    };
    const expected = {
      ok: false,
      errors: [
        {
          code: 'invalid_variable_name',
          path,
          message: expect.any(String),
        },
      ],
    };

    expect(parseDesignDocument(JSON.stringify(input))).toEqual(expected);
    expect(validateDesignDocument(input)).toEqual(expected);
  },
);

it('diagnoses a duplicate ID at its second occurrence in the tree', () => {
  const box = { id: 'box', type: 'rectangle', width: 20, height: 20 };
  const input = {
    version: 2,
    children: [box, { id: 'frame', type: 'frame', children: [box] }],
  };
  const expected = {
    ok: false,
    errors: [
      {
        code: 'duplicate_id',
        path: '$.children[1].children[0].id',
        message: expect.any(String),
      },
    ],
  };

  expect(parseDesignDocument(JSON.stringify(input))).toEqual(expected);
  expect(validateDesignDocument(input)).toEqual(expected);
});

it('validates deeply nested Frame JSON without exhausting the call stack', () => {
  let json = '{"id":"label","type":"text","textStyle":{"content":"Title"}}';
  for (let depth = 0; depth < 3_000; depth += 1) {
    json = `{"id":"frame-${depth}","type":"frame","children":[${json}]}`;
  }
  const documentJson = `{"version":2,"children":[${json}]}`;

  expect(parseDesignDocument(documentJson).ok).toBe(true);
  expect(validateDesignDocument(JSON.parse(documentJson)).ok).toBe(true);
});

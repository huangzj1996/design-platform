import { describe, expect, it } from 'vitest';
import {
  layoutDesignDocumentV2,
  parseDesignDocumentV2,
  validateDesignDocumentV2,
} from '../src/index';

describe('version 2 design document schema', () => {
  it('parses a frame containing the four leaf element types in order', () => {
    const input = {
      version: 2,
      filePath: '/tmp/design.json',
      children: [
        {
          id: 'card',
          type: 'frame',
          name: 'Card',
          width: 320,
          height: 240,
          children: [
            { id: 'surface', type: 'rectangle', width: 120, height: 80 },
            { id: 'badge', type: 'ellipse', width: 24, height: 24 },
            {
              id: 'star',
              type: 'icon',
              width: 16,
              height: 16,
              library: 'lucide',
              icon: 'star',
            },
            { id: 'title', type: 'text', textStyle: { content: '标题' } },
          ],
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
  });

  it('preserves bindings on elements and within textStyle', () => {
    const input = {
      version: 2,
      variables: {
        label: { type: 'string', value: '标题' },
        size: { type: 'number', value: 120 },
        alpha: { type: 'number', value: 0.75 },
        accent: { type: 'color', value: '#112233' },
        flag: { type: 'boolean', value: false },
      },
      children: [
        {
          id: 'box',
          type: 'rectangle',
          width: '$size',
          height: 24,
          opacity: '$alpha',
        },
        {
          id: '$label',
          type: 'text',
          name: '$label',
          x: -40,
          y: 10,
          rotation: -15,
          textStyle: { content: '$label' },
        },
      ],
    };

    expect(validateDesignDocumentV2(input)).toEqual({
      ok: true,
      document: input,
    });
  });

  it('preserves Frame layout fields, dimension modes and padding bindings', () => {
    const input = {
      version: 2,
      variables: {
        size: { type: 'number', value: 120 },
        inset: { type: 'number', value: 8 },
        clipped: { type: 'boolean', value: true },
      },
      children: [
        {
          id: 'row',
          type: 'frame',
          width: '$size',
          height: 'fit_content',
          layout: 'horizontal',
          clip: '$clipped',
          gap: '$inset',
          padding: ['$inset', 12],
          justifyContent: 'space_around',
          alignItems: 'center',
          children: [
            {
              id: 'box',
              type: 'rectangle',
              width: 'fill_container',
              height: 24,
            },
          ],
        },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    expect(result).toEqual({
      ok: true,
      document: input,
    });
    if (!result.ok) throw new Error('Expected a valid design document');

    expect(layoutDesignDocumentV2(result.document)).toMatchObject({
      issues: [],
      roots: [
        {
          box: { x: 0, y: 0, width: 120, height: 40 },
          children: [{ box: { x: 12, y: 8, width: 96, height: 24 } }],
        },
      ],
    });
  });

  it('reports both dimensions in a same-axis parent-child cycle', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'row',
          type: 'frame',
          width: 'fit_content',
          height: 40,
          children: [
            { id: 'fixed', type: 'ellipse', width: 16, height: 16 },
            {
              id: 'fill',
              type: 'ellipse',
              width: 'fill_container',
              height: 16,
            },
          ],
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [
        { code: 'missing_size_basis', path: '$.children[0].width' },
        { code: 'missing_size_basis', path: '$.children[0].children[1].width' },
      ],
    });
  });

  it.each([
    { padding: 0 },
    { padding: '$inset' },
    { padding: ['$inset', 0] },
    { padding: [0, '$inset', 0, '$inset'] },
  ])('preserves padding $padding', ({ padding }) => {
    const input = {
      version: 2,
      variables: { inset: { type: 'number', value: 8 } },
      children: [{ id: 'frame', type: 'frame', layout: 'vertical', padding }],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: input,
    });
  });

  it.each([
    [{ width: -1 }, 'invalid_value', 'width'],
    [{ height: { mode: 'fit_content' } }, 'invalid_value', 'height'],
    [{ width: '$negative' }, 'invalid_value', 'width'],
    [{ layout: 'grid' }, 'invalid_value', 'layout'],
    [{ clip: 'true' }, 'invalid_value', 'clip'],
    [{ gap: -1 }, 'invalid_value', 'gap'],
    [{ justifyContent: 'between' }, 'invalid_value', 'justifyContent'],
    [{ alignItems: 'baseline' }, 'invalid_value', 'alignItems'],
    [{ padding: [1] }, 'invalid_value', 'padding'],
    [{ padding: [1, 2, 3] }, 'invalid_value', 'padding'],
    [{ padding: -1 }, 'invalid_value', 'padding'],
    [{ padding: [0, -1] }, 'invalid_value', 'padding[1]'],
    [{ padding: [0, 1, '$negative', 3] }, 'invalid_value', 'padding[2]'],
    [{ padding: ['$missing', 0] }, 'missing_variable', 'padding[0]'],
    [{ padding: [0, '$label'] }, 'variable_type_mismatch', 'padding[1]'],
  ])('reports invalid Frame fields %j', (fields, code, field) => {
    const input = {
      version: 2,
      variables: {
        negative: { type: 'number', value: -1 },
        label: { type: 'string', value: 'fit_content' },
      },
      children: [{ id: 'frame', type: 'frame', ...fields }],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].${field}` }],
    });
  });

  it('rejects JSON numbers that overflow the finite size range', () => {
    expect(
      parseDesignDocumentV2(
        '{"version":2,"children":[{"id":"frame","type":"frame","width":1e400}]}',
      ),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'invalid_value', path: '$.children[0].width' }],
    });
  });

  it('reports an intrinsic size that overflows while accepting finite fixed sizes', () => {
    const child = { id: 'first', type: 'rectangle', width: 1e308, height: 1 };
    expect(
      parseDesignDocumentV2(JSON.stringify({ version: 2, children: [child] })),
    ).toMatchObject({ ok: true });

    const input = {
      version: 2,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 'fit_content',
          children: [child, { ...child, id: 'second' }],
        },
      ],
    };
    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [{ code: 'missing_size_basis', path: '$.children[0].width' }],
    });
  });

  it('allows a free-positioned child to fill a fixed Frame content area', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'none',
          width: 100,
          height: 0,
          clip: true,
          padding: 8,
          children: [
            {
              id: 'box',
              type: 'rectangle',
              x: -4,
              y: 6,
              width: 'fill_container',
              height: 'fill_container',
            },
          ],
        },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    expect(result).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
    if (!result.ok) throw new Error('Expected a valid design document');

    expect(
      layoutDesignDocumentV2(result.document).roots[0]?.children[0]?.box,
    ).toEqual({ x: 4, y: 14, width: 84, height: 0 });
  });

  it('uses four-sided padding, gap and alignment in a vertical Frame', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 100,
          height: 150,
          padding: [10, 20, 30, 4],
          gap: 6,
          justifyContent: 'center',
          alignItems: 'end',
          children: [
            { id: 'first', type: 'rectangle', width: 10, height: 20 },
            { id: 'second', type: 'rectangle', width: 30, height: 40 },
          ],
        },
      ],
    };
    const result = parseDesignDocumentV2(JSON.stringify(input));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid design document');

    expect(
      layoutDesignDocumentV2(result.document).roots[0]?.children.map(
        (child) => child.box,
      ),
    ).toEqual([
      { x: 70, y: 32, width: 10, height: 20 },
      { x: 50, y: 58, width: 30, height: 40 },
    ]);
  });

  it('defaults to horizontal layout and preserves the omitted layout and dimensions', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'row',
          type: 'frame',
          height: 'fit_content',
          alignItems: 'stretch',
          children: [
            { id: 'fixed', type: 'rectangle', width: 24, height: 10 },
            { id: 'stretched', type: 'rectangle', width: 24 },
            {
              id: 'fill',
              type: 'ellipse',
              width: 12,
              height: 'fill_container',
            },
            {
              id: 'intrinsic',
              type: 'frame',
              width: 24,
              height: 'fit_content',
              children: [
                { id: 'nested', type: 'ellipse', width: 12, height: 16 },
              ],
            },
            { id: 'text', type: 'text', textStyle: { content: '标题' } },
          ],
        },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    expect(result).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
    if (!result.ok) throw new Error('Expected a valid design document');

    expect(
      layoutDesignDocumentV2(result.document).roots[0]?.children.map(
        (child) => child.box,
      ),
    ).toEqual([
      { x: 0, y: 0, width: 24, height: 10 },
      { x: 24, y: 0, width: 24, height: 19.2 },
      { x: 48, y: 0, width: 12, height: 19.2 },
      { x: 60, y: 0, width: 24, height: 16 },
      { x: 84, y: 0, width: 32, height: 19.2 },
    ]);
  });

  it.each([false, true])(
    'reports a cross-axis stretch cycle with clip %s',
    (clip) => {
      const input = {
        version: 2,
        children: [
          {
            id: 'column',
            type: 'frame',
            layout: 'vertical',
            width: 'fit_content',
            alignItems: 'stretch',
            clip,
            children: [{ id: 'box', type: 'rectangle', height: 24 }],
          },
        ],
      };

      expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
        ok: false,
        errors: [
          { code: 'missing_size_basis', path: '$.children[0].width' },
          {
            code: 'missing_size_basis',
            path: '$.children[0].children[0].width',
          },
        ],
      });
    },
  );

  it('requires a size basis for root fill and explicit fit on a leaf under stretch', () => {
    const input = {
      version: 2,
      children: [
        { id: 'root', type: 'ellipse', width: 'fill_container', height: 24 },
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 100,
          height: 120,
          alignItems: 'stretch',
          children: [
            { id: 'box', type: 'rectangle', width: 'fit_content', height: 24 },
            { id: 'unsized', type: 'rectangle', width: 16 },
          ],
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [
        { code: 'missing_size_basis', path: '$.children[0].width' },
        { code: 'missing_size_basis', path: '$.children[1].children[0].width' },
        {
          code: 'missing_size_basis',
          path: '$.children[1].children[1].height',
        },
      ],
    });
  });

  it('reports missing, incompatible and out-of-range variables at their uses', () => {
    expect(
      validateDesignDocumentV2({
        version: 2,
        variables: {
          number: { type: 'number', value: 2 },
          label: { type: 'string', value: '标题' },
        },
        children: [
          {
            id: 'title',
            type: 'text',
            x: '$label',
            opacity: '$number',
            textStyle: { content: '$missing' },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        { code: 'invalid_value', path: '$.children[0].opacity' },
        { code: 'variable_type_mismatch', path: '$.children[0].x' },
        { code: 'missing_variable', path: '$.children[0].textStyle.content' },
      ],
    });
  });

  it('requires a literal type even when a string variable names an element type', () => {
    expect(
      validateDesignDocumentV2({
        version: 2,
        variables: { kind: { type: 'string', value: 'rectangle' } },
        children: [{ id: 'box', type: '$kind' }],
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'unknown_node_type', path: '$.children[0].type' }],
    });
  });

  it.each([
    [{ id: ' ', type: 'rectangle' }, 'invalid_id', 'id'],
    [{ id: 'box', type: 'rectangle', name: true }, 'invalid_value', 'name'],
    [{ id: 'box', type: 'rectangle', y: Infinity }, 'invalid_value', 'y'],
    [
      { id: 'box', type: 'rectangle', rotation: NaN },
      'invalid_value',
      'rotation',
    ],
    [{ id: 'box', type: 'rectangle', height: -1 }, 'invalid_value', 'height'],
    [
      { id: 'box', type: 'ellipse', children: [] },
      'invalid_children',
      'children',
    ],
    [
      { id: 'box', type: 'ellipse', children: undefined },
      'invalid_children',
      'children',
    ],
    [{ id: 'star', type: 'icon', icon: 'star' }, 'missing_field', 'library'],
    [
      { id: 'star', type: 'icon', library: 'lucide', icon: '' },
      'invalid_value',
      'icon',
    ],
    [{ id: 'title', type: 'text' }, 'missing_field', 'textStyle'],
    [
      { id: 'title', type: 'text', textStyle: [] },
      'invalid_structure',
      'textStyle',
    ],
    [
      { id: 'title', type: 'text', textStyle: {} },
      'missing_field',
      'textStyle.content',
    ],
    [
      { id: 'title', type: 'text', textStyle: { content: 1 } },
      'invalid_value',
      'textStyle.content',
    ],
    [
      { id: 'title', type: 'text', textStyle: { content: '', visible: true } },
      'unknown_field',
      'textStyle.visible',
    ],
    [
      { id: 'box', type: 'rectangle', visible: false },
      'unknown_field',
      'visible',
    ],
  ])('diagnoses invalid element data %j', (element, code, field) => {
    expect(
      validateDesignDocumentV2({ version: 2, children: [element] }),
    ).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].${field}` }],
    });
  });

  it('reports IDs repeated across different levels of the tree', () => {
    expect(
      validateDesignDocumentV2({
        version: 2,
        children: [
          { id: 'shared', type: 'rectangle' },
          {
            id: 'frame',
            type: 'frame',
            children: [{ id: 'shared', type: 'ellipse' }],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'duplicate_id', path: '$.children[1].children[0].id' }],
    });
  });

  it.each([
    [{ children: [] }, 'missing_version', '$.version'],
    [{ version: '2', children: [] }, 'invalid_version', '$.version'],
    [{ version: 1, children: [] }, 'unsupported_version', '$.version'],
    [{ version: 2 }, 'invalid_structure', '$.children'],
    [{ version: 2, children: {} }, 'invalid_structure', '$.children'],
    [
      { version: 2, children: [], filePath: 'design.json' },
      'invalid_file_path',
      '$.filePath',
    ],
    [
      { version: 2, children: [], variables: [] },
      'invalid_structure',
      '$.variables',
    ],
    [{ version: 2, children: [], extra: 1 }, 'unknown_field', '$.extra'],
  ])('reports invalid document data %j', (input, code, path) => {
    expect(validateDesignDocumentV2(input)).toMatchObject({
      ok: false,
      errors: [{ code, path }],
    });
  });

  it('reports invalid JSON at the document root', () => {
    expect(parseDesignDocumentV2('{ nope')).toMatchObject({
      ok: false,
      errors: [{ code: 'invalid_json', path: '$' }],
    });
  });

  it('reports the index of an absent element in a sparse children array', () => {
    expect(
      validateDesignDocumentV2({
        version: 2,
        children: [{ id: 'frame', type: 'frame', children: new Array(1) }],
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        { code: 'invalid_structure', path: '$.children[0].children[0]' },
      ],
    });
  });

  it('reads elements by index when the supplied array shadows entries', () => {
    const child = { id: 'box', type: 'rectangle' };
    const children = Object.assign([child, child], { entries: undefined });

    expect(validateDesignDocumentV2({ version: 2, children })).toMatchObject({
      ok: false,
      errors: [{ code: 'duplicate_id', path: '$.children[1].id' }],
    });
  });

  it('validates and lays out children when caller-supplied arrays shadow methods', () => {
    const input = {
      version: 2,
      children: Object.assign(
        [
          {
            id: 'frame',
            type: 'frame',
            children: Object.assign(
              [{ id: 'box', type: 'rectangle', width: 20, height: 10 }],
              { map: undefined },
            ),
          },
        ],
        { forEach: undefined },
      ),
    };

    const result = validateDesignDocumentV2(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid design document');

    expect(layoutDesignDocumentV2(result.document).roots[0]?.box).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
  });

  it('validates deeply nested Frames that size themselves to content', () => {
    let element: unknown = {
      id: 'box',
      type: 'rectangle',
      width: 2,
      height: 2,
    };
    for (let depth = 0; depth < 1_500; depth += 1) {
      element = { id: String(depth), type: 'frame', children: [element] };
    }

    const result = validateDesignDocumentV2({
      version: 2,
      children: [element],
    });
    expect(result.ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { parseDesignDocumentV2, validateDesignDocumentV2 } from '../src/index';

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
        { id: 'box', type: 'rectangle', width: '$size', opacity: '$alpha' },
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
});

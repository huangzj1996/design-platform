import { describe, expect, it } from 'vitest';
import {
  layoutDesignDocumentV2,
  parseDesignDocumentV2,
  validateDesignDocumentV2,
} from '../src/index';

describe('v2 textStyle', () => {
  it('uses auto for omitted growth, preserving manual line breaks and declarations', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'text',
          type: 'text',
          textStyle: {
            content: 'AAAA\r\nB',
            width: 10,
            height: 'fill_container',
            fontSize: 10,
            lineHeight: 1.5,
          },
        },
        { id: 'empty', type: 'text', textStyle: { content: '' } },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    expect(result).toEqual({ ok: true, document: { ...input, variables: {} } });
    if (!result.ok) throw new Error('Expected a valid design document');
    const [text, empty] = layoutDesignDocumentV2(result.document).roots;
    expect(text.box).toEqual({ x: 0, y: 0, width: 20, height: 30 });
    expect(text.textLines).toEqual(['AAAA', 'B']);
    expect(empty.box.width).toBe(0);
  });

  it.each([
    ['fixed-width', ['width']],
    ['fixed-width-height', ['width', 'height']],
  ])('requires the declared dimensions for %s', (textGrowth, fields) => {
    const input = {
      version: 2,
      children: [
        { id: 'text', type: 'text', textStyle: { content: '', textGrowth } },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: fields.map((field) => ({
        code: 'missing_field',
        path: `$.children[0].textStyle.${field}`,
      })),
    });
  });

  it('wraps to the width allocated by the parent and grows the parent height', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'row',
          type: 'frame',
          width: 64,
          padding: 4,
          gap: 6,
          children: [
            { id: 'box', type: 'rectangle', width: 30, height: 1 },
            {
              id: 'text',
              type: 'text',
              textStyle: {
                content: 'backpack\r\ncard',
                textGrowth: 'fixed-width',
                width: 'fill_container',
                height: 2,
                fontSize: 10,
                lineHeight: 1.5,
              },
            },
          ],
        },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    if (!result.ok) throw new Error('Expected a valid design document');
    const [row] = layoutDesignDocumentV2(result.document).roots;
    expect(row.box).toEqual({ x: 0, y: 0, width: 64, height: 53 });
    expect(row.children[1]?.box).toEqual({
      x: 40,
      y: 4,
      width: 20,
      height: 45,
    });
    expect(row.children[1]?.textLines).toEqual(['back', 'pack', 'card']);
  });

  it('preserves bound content and typography while resolving a fixed text box', () => {
    const input = {
      version: 2,
      variables: {
        label: { type: 'string', value: 'AAAAAA' },
        family: { type: 'string', value: 'Inter' },
        size: { type: 'number', value: 10 },
        weight: { type: 'number', value: 1000 },
        leading: { type: 'number', value: 2 },
      },
      children: [
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 30,
          height: 54,
          padding: 5,
          children: [
            {
              id: 'fixed',
              type: 'text',
              textStyle: {
                content: '$label',
                textGrowth: 'fixed-width-height',
                width: '$size',
                height: 'fill_container',
                fontFamily: '$family',
                fontSize: '$size',
                fontWeight: '$weight',
                lineHeight: '$leading',
                textAlign: 'justify',
              },
            },
            {
              id: 'intrinsic',
              type: 'text',
              textStyle: {
                content: '$label',
                textGrowth: 'fixed-width-height',
                width: 'fill_container',
                height: 'fit_content',
                fontSize: '$size',
                lineHeight: '$leading',
              },
            },
          ],
        },
      ],
    };

    const result = validateDesignDocumentV2(input);
    expect(result).toEqual({ ok: true, document: input });
    if (!result.ok) throw new Error('Expected a valid design document');
    const [column] = layoutDesignDocumentV2(result.document).roots;
    expect(column.children.map(({ box }) => box)).toEqual([
      { x: 5, y: 5, width: 10, height: 4 },
      { x: 5, y: 9, width: 20, height: 40 },
    ]);
    expect(column.children[0]?.textLines).toEqual(['AA', 'AA', 'AA']);
  });

  it('measures a long paragraph in a narrow box without throwing', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'text',
          type: 'text',
          textStyle: {
            content: 'A'.repeat(150_000),
            textGrowth: 'fixed-width',
            width: 1,
            fontSize: 10,
            lineHeight: 1,
          },
        },
      ],
    };

    const result = parseDesignDocumentV2(JSON.stringify(input));
    if (!result.ok) throw new Error('Expected a valid design document');
    expect(layoutDesignDocumentV2(result.document).roots[0]?.box.height).toBe(
      1_500_000,
    );
  });

  it('reports unresolved size bases on the nested textStyle dimensions', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'root-text',
          type: 'text',
          textStyle: {
            content: '',
            textGrowth: 'fixed-width-height',
            width: 'fill_container',
            height: 'fill_container',
          },
        },
        {
          id: 'row',
          type: 'frame',
          width: 'fit_content',
          children: [
            {
              id: 'fill-text',
              type: 'text',
              textStyle: {
                content: '标题',
                textGrowth: 'fixed-width',
                width: 'fill_container',
              },
            },
          ],
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [
        { code: 'missing_size_basis', path: '$.children[0].textStyle.width' },
        { code: 'missing_size_basis', path: '$.children[0].textStyle.height' },
        { code: 'missing_size_basis', path: '$.children[1].width' },
        {
          code: 'missing_size_basis',
          path: '$.children[1].children[0].textStyle.width',
        },
      ],
    });
  });

  it.each(['width', 'height', 'content', 'text', 'textGrowth', 'fontSize'])(
    'rejects the element-level text field %s',
    (field) => {
      const input = {
        version: 2,
        children: [
          { id: 'text', type: 'text', textStyle: { content: '' }, [field]: 1 },
        ],
      };
      expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
        ok: false,
        errors: [{ code: 'unknown_field', path: `$.children[0].${field}` }],
      });
    },
  );

  it.each([
    ['textGrowth', 'wrap'],
    ['textAlign', 'middle'],
    ['fontFamily', ''],
    ['fontSize', 0],
    ['fontWeight', 0],
    ['fontWeight', 1001],
    ['fontWeight', 400.5],
    ['fontWeight', 'bold'],
    ['lineHeight', -1],
    ['width', { mode: 'fit_content' }],
    ['height', -1],
  ])('rejects an invalid %s of %j', (field, value) => {
    const input = {
      version: 2,
      children: [
        {
          id: 'text',
          type: 'text',
          textStyle: { content: '', [field]: value },
        },
      ],
    };
    expect(parseDesignDocumentV2(JSON.stringify(input))).toMatchObject({
      ok: false,
      errors: [
        { code: 'invalid_value', path: `$.children[0].textStyle.${field}` },
      ],
    });
  });

  it.each([
    ['content', '$missing', 'missing_variable'],
    ['content', '$number', 'variable_type_mismatch'],
    ['fontSize', '$label', 'variable_type_mismatch'],
    ['fontWeight', '$number', 'invalid_value'],
    ['lineHeight', '$missing', 'missing_variable'],
    ['width', '$label', 'variable_type_mismatch'],
    ['textGrowth', '$growth', 'variable_type_mismatch'],
    ['textAlign', '$alignment', 'variable_type_mismatch'],
  ])('diagnoses %s bound to %s at its use', (field, value, code) => {
    const input = {
      version: 2,
      variables: {
        label: { type: 'string', value: '标题' },
        number: { type: 'number', value: 1001 },
        growth: { type: 'string', value: 'auto' },
        alignment: { type: 'string', value: 'center' },
      },
      children: [
        {
          id: 'text',
          type: 'text',
          textStyle: { content: '', [field]: value },
        },
      ],
    };
    expect(validateDesignDocumentV2(input)).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].textStyle.${field}` }],
    });
  });
});

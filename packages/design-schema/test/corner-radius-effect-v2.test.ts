import { describe, expect, it } from 'vitest';
import {
  parseDesignDocumentV2,
  validateDesignDocumentV2,
  type DesignVariables,
  type EffectV2,
} from '../src';

const rectangle = { id: 'box', type: 'rectangle', width: 24, height: 24 };
const shadow = {
  type: 'drop_shadow',
  color: '#11223380',
  offsetX: -2,
  offsetY: 3,
  blurRadius: 0,
} satisfies EffectV2;
const blur = { type: 'layer_blur', radius: 4 } satisfies EffectV2;
const variables: DesignVariables = {
  ink: { type: 'color', value: '#112233' },
  'short-color': { type: 'color', value: '#123' },
  amount: { type: 'number', value: 8 },
  negative: { type: 'number', value: -3 },
  'effect-type': { type: 'string', value: 'layer_blur' },
};

function documentWith(fields: Record<string, unknown>) {
  return { version: 2, children: [{ ...rectangle, ...fields }], variables };
}

describe('v2 corner radius and effects', () => {
  it('preserves authored corner order, effect order, and variable references', () => {
    const input = {
      version: 2,
      variables,
      children: [
        {
          ...rectangle,
          cornerRadius: [0, '$amount', 3, 6],
          effect: [
            { ...shadow, color: '$ink', offsetY: '$negative' },
            { ...blur, radius: '$amount' },
            { ...shadow, type: 'inner_shadow', blurRadius: '$amount' },
            { type: 'background_blur', radius: 0 },
          ] satisfies EffectV2[],
        },
        {
          id: 'container',
          type: 'frame',
          width: 40,
          height: 40,
          cornerRadius: '$amount',
          effect: [],
        },
        {
          ...rectangle,
          id: 'oval',
          type: 'ellipse',
          cornerRadius: 2,
          effect: [blur],
        },
        {
          ...rectangle,
          id: 'symbol',
          type: 'icon',
          library: 'lucide',
          icon: 'star',
          cornerRadius: 1,
          effect: [blur],
        },
        {
          id: 'label',
          type: 'text',
          textStyle: { content: 'Label' },
          cornerRadius: 0,
          effect: [blur],
        },
        { ...rectangle, id: 'plain' },
      ],
    };

    const expected = { ok: true, document: input };
    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual(expected);
    expect(validateDesignDocumentV2(input)).toEqual(expected);
  });

  it.each([
    [{ cornerRadius: -1 }, 'invalid_value', 'cornerRadius'],
    [{ cornerRadius: '$negative' }, 'invalid_value', 'cornerRadius'],
    [{ cornerRadius: '$ink' }, 'variable_type_mismatch', 'cornerRadius'],
    [{ cornerRadius: [1, 2, 3] }, 'invalid_value', 'cornerRadius'],
    [{ cornerRadius: [1, 2, 3, 4, 5] }, 'invalid_value', 'cornerRadius'],
    [{ cornerRadius: [0, 1, -1, 3] }, 'invalid_value', 'cornerRadius[2]'],
    [
      { cornerRadius: [0, '$absent', 2, 3] },
      'missing_variable',
      'cornerRadius[1]',
    ],
    [
      { cornerRadius: [0, 1, 2, '$ink'] },
      'variable_type_mismatch',
      'cornerRadius[3]',
    ],
    [{ effect: blur }, 'invalid_value', 'effect'],
    [
      { effect: [shadow, { type: 'shadow' }] },
      'invalid_value',
      'effect[1].type',
    ],
    [
      { effect: [{ ...blur, type: '$effect-type' }] },
      'invalid_value',
      'effect[0].type',
    ],
    [{ effect: [{ radius: 3 }] }, 'missing_field', 'effect[0].type'],
    [
      { effect: [blur, { ...shadow, spread: 1 }] },
      'unknown_field',
      'effect[1].spread',
    ],
    [
      { effect: [{ ...blur, enabled: false }] },
      'unknown_field',
      'effect[0].enabled',
    ],
    [
      { effect: [{ ...shadow, blurRadius: undefined }] },
      'missing_field',
      'effect[0].blurRadius',
    ],
    [
      { effect: [shadow, { type: 'background_blur' }] },
      'missing_field',
      'effect[1].radius',
    ],
    [
      { effect: [{ ...shadow, offsetX: '2' }] },
      'invalid_value',
      'effect[0].offsetX',
    ],
    [
      { effect: [{ ...shadow, color: '$short-color' }] },
      'invalid_value',
      'effect[0].color',
    ],
    [
      { effect: [{ ...shadow, color: '$absent' }] },
      'missing_variable',
      'effect[0].color',
    ],
    [
      { effect: [{ ...shadow, offsetY: '$ink' }] },
      'variable_type_mismatch',
      'effect[0].offsetY',
    ],
    [
      { effect: [blur, { ...shadow, blurRadius: '$negative' }] },
      'invalid_value',
      'effect[1].blurRadius',
    ],
    [
      { effect: [{ ...blur, radius: '$negative' }] },
      'invalid_value',
      'effect[0].radius',
    ],
  ])('reports invalid appearance %j at %s / %s', (fields, code, path) => {
    expect(
      parseDesignDocumentV2(JSON.stringify(documentWith(fields))),
    ).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].${path}` }],
    });
  });

  it('rejects an infinite shadow offset through the object validation API', () => {
    const input = documentWith({ effect: [{ ...shadow, offsetY: Infinity }] });

    expect(validateDesignDocumentV2(input)).toMatchObject({
      ok: false,
      errors: [
        { code: 'invalid_value', path: '$.children[0].effect[0].offsetY' },
      ],
    });
  });
});

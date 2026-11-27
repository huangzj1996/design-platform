import { describe, expect, it } from 'vitest';
import { parseDesignDocumentV2, type DesignVariables } from '../src/index';

const solid = { type: 'color', color: '#123456' };
const stops = [
  { offset: 0, color: '#ffffff' },
  { offset: 1, color: '#000000' },
];
const linear = {
  type: 'gradient',
  gradientType: 'linear',
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
  stops,
};
const vertex = { x: 0, y: 0, color: '#ffffff' };
const mesh = { type: 'gradient', gradientType: 'mesh' };

function parseBox(
  fields: Record<string, unknown>,
  variables?: DesignVariables,
) {
  return parseDesignDocumentV2(
    JSON.stringify({
      version: 2,
      variables,
      children: [
        { id: 'box', type: 'rectangle', width: 20, height: 10, ...fields },
      ],
    }),
  );
}

describe('v2 fill and stroke', () => {
  it('preserves layer order and omitted styling on both fill and stroke', () => {
    const input = {
      version: 2,
      children: [
        {
          id: 'box',
          type: 'rectangle',
          width: 20,
          height: 10,
          fill: [
            { type: 'color', color: '#123456' },
            { type: 'color', color: '#abcdef80', opacity: 0 },
          ],
          stroke: {
            fill: [
              { type: 'color', color: '#ABCDEF80', opacity: 1 },
              { type: 'color', color: '#654321' },
            ],
          },
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
  });

  it('accepts images and shaders in the same ordered layers as colors', () => {
    const fill = [
      { type: 'image', url: '/assets/photo.png' },
      { type: 'color', color: '#123456' },
      {
        type: 'shader',
        url: '/assets/glow.frag',
        opacity: 0.5,
        uniforms: { speed: 2, enabled: true, uv: [0, 1], tint: [1, 0, 1, 1] },
      },
    ];
    const input = {
      version: 2,
      children: [
        {
          id: 'label',
          type: 'text',
          textStyle: { content: '标题' },
          fill,
          stroke: {
            fill: [fill[2], fill[0]],
            alignment: 'outer',
            width: 0,
            style: 'dotted',
          },
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
  });

  it('accepts the four gradient geometries and equal neighboring offsets', () => {
    const stops = [
      { offset: 0, color: '#ff0000' },
      { offset: 0, color: '#00ff00' },
      { offset: 1, color: '#0000ff' },
    ];
    const fill = [
      { type: 'color', color: '#123456' },
      {
        type: 'gradient',
        gradientType: 'linear',
        start: { x: -0.25, y: 0 },
        end: { x: 1.25, y: 1 },
        stops,
      },
      {
        type: 'gradient',
        gradientType: 'radial',
        center: { x: 0.5, y: 0.5 },
        radius: 0.75,
        stops,
      },
      {
        type: 'gradient',
        gradientType: 'angular',
        center: { x: 0.5, y: 0.5 },
        rotation: -45,
        stops,
      },
      {
        type: 'gradient',
        gradientType: 'mesh',
        points: [
          [
            { x: 0, y: 0, color: '#ff0000' },
            { x: 1, y: 0, color: '#00ff00' },
          ],
          [
            { x: 0, y: 1, color: '#0000ff' },
            { x: 1, y: 1, color: '#ffffff' },
          ],
        ],
      },
    ];
    const input = {
      version: 2,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 20,
          height: 10,
          fill,
          stroke: { fill: fill.slice(1) },
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: { ...input, variables: {} },
    });
  });

  it('preserves bindings to gradient, stroke and shader leaves', () => {
    const point = { x: '$half', y: 0, color: '$accent' };
    const input = {
      version: 2,
      variables: {
        half: { type: 'number', value: 0.5 },
        accent: { type: 'color', value: '#00000080' },
        shader: { type: 'string', value: '/glow.frag' },
        flag: { type: 'boolean', value: true },
      },
      children: [
        {
          id: 'ellipse',
          type: 'ellipse',
          width: 20,
          height: 10,
          fill: [
            {
              type: 'gradient',
              gradientType: 'linear',
              opacity: '$half',
              start: { x: '$half', y: 0 },
              end: { x: 1, y: 1 },
              stops: [
                { offset: 0, color: '$accent' },
                { offset: '$half', color: '#ffffff' },
              ],
            },
            {
              type: 'gradient',
              gradientType: 'mesh',
              points: [
                [point, point],
                [point, point],
              ],
            },
          ],
          stroke: {
            width: '$half',
            fill: [
              {
                type: 'shader',
                url: '$shader',
                uniforms: {
                  flag: '$flag',
                  amount: '$half',
                  vector: [1, '$half', 0],
                },
              },
            ],
          },
        },
      ],
    };

    expect(parseDesignDocumentV2(JSON.stringify(input))).toEqual({
      ok: true,
      document: input,
    });
  });

  it('quotes shader uniform keys containing path punctuation', () => {
    expect(
      parseBox({
        fill: [
          {
            type: 'shader',
            url: 'a.frag',
            uniforms: { 'gain.rgb': [0, false] },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        {
          code: 'invalid_value',
          path: '$.children[0].fill[0].uniforms["gain.rgb"][1]',
        },
      ],
    });
  });

  it.each([
    [{ stroke: {} }, 'missing_field', 'stroke.fill'],
    [{ stroke: { fill: solid } }, 'invalid_value', 'stroke.fill'],
    [
      { stroke: { fill: [], alignment: 'inside' } },
      'invalid_value',
      'stroke.alignment',
    ],
    [
      { stroke: { fill: [], style: 'double' } },
      'invalid_value',
      'stroke.style',
    ],
    [{ stroke: { fill: [], width: -1 } }, 'invalid_value', 'stroke.width'],
    [{ fill: solid }, 'invalid_value', 'fill'],
    [{ fill: [solid, { color: '#ffffff' }] }, 'missing_field', 'fill[1].type'],
    [{ fill: [{ ...solid, color: '#fff' }] }, 'invalid_value', 'fill[0].color'],
    [
      { fill: [{ ...solid, enabled: false }] },
      'unknown_field',
      'fill[0].enabled',
    ],
    [
      { fill: [{ ...solid, opacity: -0.01 }] },
      'invalid_value',
      'fill[0].opacity',
    ],
    [
      { stroke: { fill: [solid, { ...solid, opacity: 1.01 }] } },
      'invalid_value',
      'stroke.fill[1].opacity',
    ],
    [{ fill: [{ type: 'image' }] }, 'missing_field', 'fill[0].url'],
    [
      { fill: [{ type: 'image', url: 'a.png', mode: 'repeat' }] },
      'invalid_value',
      'fill[0].mode',
    ],
    [
      { fill: [{ type: 'shader', url: 'a.frag', uniforms: { size: [0] } }] },
      'invalid_value',
      'fill[0].uniforms.size',
    ],
    [
      {
        fill: [
          {
            type: 'shader',
            url: 'a.frag',
            uniforms: { size: [0, 0, 0, 0, 0] },
          },
        ],
      },
      'invalid_value',
      'fill[0].uniforms.size',
    ],
    [
      {
        fill: [
          { type: 'shader', url: 'a.frag', uniforms: { size: [0, true] } },
        ],
      },
      'invalid_value',
      'fill[0].uniforms.size[1]',
    ],
    [
      {
        fill: [
          { type: 'shader', url: 'a.frag', uniforms: { ['__proto__']: {} } },
        ],
      },
      'invalid_value',
      'fill[0].uniforms.__proto__',
    ],
  ])('validates appearance %j at its field path', (fields, code, path) => {
    expect(parseBox(fields)).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].${path}` }],
    });
  });

  it.each([
    'strokeWidth',
    'strokeAlignment',
    'strokeDash',
    'strokeLinecap',
    'strokeLinejoin',
  ])('rejects the legacy %s field', (field) => {
    expect(parseBox({ [field]: 1 })).toMatchObject({
      ok: false,
      errors: [{ code: 'unknown_field', path: `$.children[0].${field}` }],
    });
  });

  it.each([
    [{ type: 'gradient' }, 'missing_field', 'gradientType'],
    [{ ...linear, end: undefined }, 'missing_field', 'end'],
    [
      { type: 'gradient', gradientType: 'radial', center: linear.start, stops },
      'missing_field',
      'radius',
    ],
    [
      {
        type: 'gradient',
        gradientType: 'angular',
        center: linear.start,
        rotation: false,
        stops,
      },
      'invalid_value',
      'rotation',
    ],
    [{ ...linear, stops: [stops[0]] }, 'invalid_value', 'stops'],
    [
      { ...linear, stops: [stops[1], stops[0]] },
      'invalid_value',
      'stops[1].offset',
    ],
    [
      { ...linear, stops: [stops[0], { offset: 1.1, color: '#ffffff' }] },
      'invalid_value',
      'stops[1].offset',
    ],
    [
      { ...linear, stops: [stops[0], { offset: 1 }] },
      'missing_field',
      'stops[1].color',
    ],
    [
      { ...linear, stops: [stops[0], { ...stops[1], radius: 1 }] },
      'unknown_field',
      'stops[1].radius',
    ],
    [{ ...mesh, points: [[vertex, vertex]] }, 'invalid_value', 'points'],
    [{ ...mesh, points: [[vertex], [vertex]] }, 'invalid_value', 'points[0]'],
    [
      {
        ...mesh,
        points: [
          [vertex, vertex],
          [vertex, vertex, vertex],
        ],
      },
      'invalid_value',
      'points[1]',
    ],
    [
      {
        ...mesh,
        points: [
          [vertex, vertex],
          [vertex, { x: 1, y: 1 }],
        ],
      },
      'missing_field',
      'points[1][1].color',
    ],
    [
      {
        ...mesh,
        points: [
          [vertex, vertex],
          [vertex, { ...vertex, x: 2 }],
        ],
      },
      'invalid_value',
      'points[1][1].x',
    ],
  ])('diagnoses gradient %j at its nested path', (layer, code, path) => {
    expect(parseBox({ stroke: { fill: [solid, layer] } })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        {
          code,
          path: `$.children[0].stroke.fill[1].${path}`,
          message: expect.any(String),
        },
      ]),
    });
  });

  it.each([
    [
      { fill: [{ ...solid, opacity: '$large' }] },
      'invalid_value',
      'fill[0].opacity',
    ],
    [
      { fill: [{ ...solid, color: '$short' }] },
      'invalid_value',
      'fill[0].color',
    ],
    [
      { fill: [{ ...solid, color: '$label' }] },
      'variable_type_mismatch',
      'fill[0].color',
    ],
    [
      {
        fill: [
          {
            ...linear,
            stops: [
              { offset: 0.75, color: '#ffffff' },
              { offset: '$half', color: '#000000' },
            ],
          },
        ],
      },
      'invalid_value',
      'fill[0].stops[1].offset',
    ],
    [
      {
        fill: [
          { ...linear, stops: [stops[0], { offset: 1, color: '$missing' }] },
        ],
      },
      'missing_variable',
      'fill[0].stops[1].color',
    ],
    [
      {
        fill: [
          {
            ...mesh,
            points: [
              [vertex, vertex],
              [vertex, { ...vertex, y: '$large' }],
            ],
          },
        ],
      },
      'invalid_value',
      'fill[0].points[1][1].y',
    ],
    [
      {
        fill: [
          {
            type: 'shader',
            url: 'a.frag',
            uniforms: { vector: [1, '$label'] },
          },
        ],
      },
      'variable_type_mismatch',
      'fill[0].uniforms.vector[1]',
    ],
    [
      { stroke: { fill: [solid], width: '$negative' } },
      'invalid_value',
      'stroke.width',
    ],
    [
      { stroke: { fill: [], alignment: '$label' } },
      'invalid_value',
      'stroke.alignment',
    ],
  ])('validates resolved values in %j', (fields, code, path) => {
    expect(
      parseBox(fields, {
        large: { type: 'number', value: 2 },
        half: { type: 'number', value: 0.5 },
        negative: { type: 'number', value: -1 },
        short: { type: 'color', value: '#fff' },
        label: { type: 'string', value: 'center' },
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code, path: `$.children[0].${path}` }],
    });
  });
});

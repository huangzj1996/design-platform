import { describe, expect, it } from 'vitest';
import { validateDesignDocument, type Diagnostic } from '../src/index';

function errorsOf(input: unknown): Diagnostic[] {
  const result = validateDesignDocument(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected validation to fail');
  }
  return result.errors;
}

function errorAt(input: unknown, path: string): Diagnostic | undefined {
  return errorsOf(input).find((error) => error.path === path);
}

const fourTypeVariables = [
  { name: '--color-brand', type: 'color', value: '#3366ff' },
  { name: '--label-title', type: 'string', value: '欢迎' },
  { name: '--space-gap', type: 'number', value: 8 },
  { name: '--is-visible', type: 'boolean', value: false },
];

describe('document variables', () => {
  it('accepts color, string, number and boolean definitions in whole-value references', () => {
    const input = {
      version: 1,
      variables: fourTypeVariables,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 200,
          height: 120,
          gap: '$${--space-gap}',
          children: [
            {
              id: 'rectangle',
              type: 'rectangle',
              width: 80,
              height: 40,
              fill: '$${--color-brand}',
            },
            {
              id: 'title',
              type: 'text',
              text: '$${--label-title}',
              visible: '$${--is-visible}',
            },
          ],
        },
      ],
    };

    const result = validateDesignDocument(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.variables).toEqual(fourTypeVariables);
      expect(result.document.children).toEqual(input.children);
    }
  });

  it('enforces the documented variable name pattern', () => {
    for (const name of [
      '--color-brand',
      '--bg-error-normal',
      '--a1-b2',
      '--2fa',
      '--x',
    ]) {
      const result = validateDesignDocument({
        version: 1,
        variables: [{ name, type: 'string', value: 'ok' }],
        children: [],
      });
      expect(result.ok, name).toBe(true);
    }

    for (const name of [
      '--',
      'color-brand',
      '-color-brand',
      '---color-brand',
      '--Color-brand',
      '--color_brand',
      '--color--brand',
      '--color-',
      '--color brand',
    ]) {
      const error = errorAt(
        {
          version: 1,
          variables: [{ name, type: 'string', value: 'ok' }],
          children: [],
        },
        '$.variables[0].name',
      );
      expect(error?.code, name).toBe('invalid_variable_name');
    }
  });

  it('requires variable names to be unique within the document', () => {
    const error = errorAt(
      {
        version: 1,
        variables: [
          { name: '--color-brand', type: 'color', value: '#112233' },
          { name: '--color-brand', type: 'color', value: '#445566' },
        ],
        children: [],
      },
      '$.variables[1].name',
    );

    expect(error?.code).toBe('duplicate_variable_name');
    expect(error?.message).toContain('--color-brand');
    expect(error?.message).toContain('$.variables[0].name');
  });

  it('requires each variable value to be a literal of its declared type', () => {
    const errors = errorsOf({
      version: 1,
      variables: [
        { name: '--color-brand', type: 'color', value: 'blue' },
        { name: '--label-title', type: 'string', value: 7 },
        { name: '--space-gap', type: 'number', value: '8' },
        { name: '--is-visible', type: 'boolean', value: 'false' },
      ],
      children: [],
    });

    expect(errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        '$.variables[0].value',
        '$.variables[1].value',
        '$.variables[2].value',
        '$.variables[3].value',
      ]),
    );
  });

  it('only resolves references that cover the whole property value', () => {
    const result = validateDesignDocument({
      version: 1,
      variables: fourTypeVariables,
      children: [
        {
          id: 'embedded',
          type: 'text',
          text: 'Say $${--label-title}',
        },
        {
          id: 'escaped',
          type: 'text',
          text: '\\$${--label-title}',
        },
        {
          id: 'unknown-embedded',
          type: 'text',
          text: 'Hello $${--missing-label}',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.children[0]).toMatchObject({
        text: 'Say $${--label-title}',
      });
      expect(result.document.children[1]).toMatchObject({
        text: '\\$${--label-title}',
      });
    }
  });

  it('reports references to missing variables at the referencing property', () => {
    const error = errorAt(
      {
        version: 1,
        variables: [],
        children: [
          {
            id: 'rectangle',
            type: 'rectangle',
            width: '$${--missing-size}',
            height: 10,
          },
        ],
      },
      '$.children[0].width',
    );

    expect(error?.code).toBe('missing_variable');
    expect(error?.message).toContain('--missing-size');
  });

  it('reports reference type mismatches at the referencing property', () => {
    const errors = errorsOf({
      version: 1,
      variables: fourTypeVariables,
      children: [
        {
          id: 'wrong-color',
          type: 'text',
          text: '$${--color-brand}',
        },
        {
          id: 'wrong-fill',
          type: 'rectangle',
          width: 10,
          height: 10,
          fill: '$${--label-title}',
        },
      ],
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'variable_type_mismatch',
          path: '$.children[0].text',
        }),
        expect.objectContaining({
          code: 'variable_type_mismatch',
          path: '$.children[1].fill',
        }),
      ]),
    );
  });

  it('validates resolved values against the referencing property range', () => {
    const errors = errorsOf({
      version: 1,
      variables: [{ name: '--over-opacity', type: 'number', value: 1.5 }],
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 100,
          height: 100,
          gap: '$${--over-opacity}',
          opacity: '$${--over-opacity}',
        },
      ],
    });

    const invalid = errors.filter((error) => error.code === 'invalid_value');
    expect(invalid.map((error) => error.path)).toEqual([
      '$.children[0].opacity',
    ]);
    expect(errors.some((error) => error.path === '$.children[0].gap')).toBe(
      false,
    );
  });
});

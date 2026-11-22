import { describe, expect, it } from 'vitest';
import {
  getNodeInspector,
  isSystemAbsolutePath,
  nodeInspectorRegistry,
  parseDesignDocument,
  validateDesignDocument,
  type Diagnostic,
} from '../src/index';

const nestedDocument = () => ({
  version: 1,
  children: [
    {
      id: 'frame-main',
      type: 'frame',
      layout: 'vertical',
      gap: 12,
      padding: [24, 24, 24, 24],
      width: 640,
      height: 480,
      fill: '#ffffff',
      cornerRadius: 8,
      children: [
        {
          id: 'title',
          type: 'text',
          text: '标题',
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1.4,
          textAlign: 'left',
          textWrap: 'wrap',
          fill: '#111111',
          width: { mode: 'fill_container' },
        },
        {
          id: 'subtitle',
          type: 'text',
          text: '副标题',
          width: 320,
          height: { mode: 'fit_content', fallback: 24 },
        },
      ],
    },
  ],
});

function validate(input: unknown) {
  return validateDesignDocument(input);
}

function errorCodes(input: unknown): string[] {
  const result = validate(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function errors(input: unknown): Diagnostic[] {
  const result = validate(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected validation to fail');
  }
  return result.errors;
}

function findError(input: unknown, code: string): Diagnostic | undefined {
  return errors(input).find((error) => error.code === code);
}

describe('validateDesignDocument', () => {
  it('accepts a blank version 1 document and defaults variables to an empty object', () => {
    const result = validate({ version: 1, children: [] });

    expect(result).toEqual({
      ok: true,
      document: { version: 1, children: [], variables: {} },
    });
  });

  it('accepts a nested frame and text document from the documented contract', () => {
    const input = nestedDocument();
    const result = validate(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.children).toEqual(input.children);
      expect(result.document.variables).toEqual({});
    }
  });

  it('accepts an absolute file path from the current or another operating system', () => {
    for (const filePath of [
      '/tmp/design/empty.json',
      'C:\\Users\\designer\\empty.json',
      '\\\\server\\share\\empty.json',
    ]) {
      const result = validate({ version: 1, children: [], filePath });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.document.filePath).toBe(filePath);
      }
    }
  });

  it('accepts omitted variables and empty variable objects', () => {
    expect(validate({ version: 1, children: [] }).ok).toBe(true);
    expect(validate({ version: 1, children: [], variables: {} }).ok).toBe(true);
  });

  it('reports unparsable JSON with a structural diagnostic', () => {
    const result = parseDesignDocument('{ nope');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'invalid_json',
        path: '$',
      });
      expect(result.errors[0]?.message.length).toBeGreaterThan(0);
    }
  });

  it('parses valid JSON through the public entry', () => {
    const result = parseDesignDocument(JSON.stringify(nestedDocument()));

    expect(result.ok).toBe(true);
  });

  it('reports a missing version separately from an unsupported version', () => {
    expect(errorCodes({ children: [] })).toContain('missing_version');
    expect(errorCodes({ version: '1', children: [] })).toContain(
      'invalid_version',
    );
    expect(errorCodes({ version: 2, children: [] })).toContain(
      'unsupported_version',
    );
  });

  it('reports unknown node types', () => {
    const error = findError(
      {
        version: 1,
        children: [{ id: 'chart', type: 'chart' }],
      },
      'unknown_node_type',
    );

    expect(error?.path).toBe('$.children[0].type');
    expect(error?.message).toContain('chart');
  });

  it('reports unknown document and node fields', () => {
    const diagnostics = errors({
      version: 1,
      title: 'Document',
      children: [{ id: 'text-1', type: 'text', text: 'Hi', fontSize: 12 }],
      variables: {},
      filePath: '/tmp/design.json',
    });
    expect(diagnostics.some((error) => error.path === '$.title')).toBe(true);

    const nodeError = findError(
      {
        version: 1,
        children: [{ id: 'text-1', type: 'text', text: 'Hi', shadow: {} }],
      },
      'unknown_field',
    );
    expect(nodeError?.path).toBe('$.children[0].shadow');
  });

  it('reports illegal document structure', () => {
    expect(errorCodes(null)).toContain('invalid_structure');
    expect(errorCodes([])).toContain('invalid_structure');
    expect(errorCodes({ version: 1 })).toContain('invalid_structure');
    expect(errorCodes({ version: 1, children: {} })).toContain(
      'invalid_structure',
    );
    expect(errorCodes({ version: 1, children: ['text'] })).toContain(
      'invalid_structure',
    );
    expect(
      errorCodes({
        version: 1,
        children: [{ id: 'frame-1', type: 'frame', children: 'text' }],
      }),
    ).toContain('invalid_children');
  });

  it('reports missing, empty and duplicate element ids', () => {
    expect(
      errorCodes({ version: 1, children: [{ type: 'text', text: 'Hi' }] }),
    ).toContain('invalid_id');
    expect(
      errorCodes({
        version: 1,
        children: [{ id: '   ', type: 'text', text: 'Hi' }],
      }),
    ).toContain('invalid_id');
    expect(
      errorCodes({
        version: 1,
        children: [{ id: 3, type: 'text', text: 'Hi' }],
      }),
    ).toContain('invalid_id');

    const duplicate = findError(
      {
        version: 1,
        children: [
          {
            id: 'frame-1',
            type: 'frame',
            children: [
              { id: 'text-1', type: 'text', text: 'One' },
              { id: 'text-1', type: 'text', text: 'Two' },
            ],
          },
        ],
      },
      'duplicate_id',
    );
    expect(duplicate?.path).toBe('$.children[0].children[1].id');
    expect(duplicate?.message).toContain('text-1');
  });

  it('rejects children on leaf elements', () => {
    const error = findError(
      {
        version: 1,
        children: [
          {
            id: 'text-1',
            type: 'text',
            text: 'Hi',
            children: [{ id: 'text-2', type: 'text', text: 'Nested' }],
          },
        ],
      },
      'invalid_children',
    );

    expect(error?.path).toBe('$.children[0].children');
  });

  it('rejects relative and malformed file paths', () => {
    for (const filePath of ['design.json', './design.json', '', 42]) {
      const error = findError(
        { version: 1, children: [], filePath },
        'invalid_file_path',
      );
      expect(error?.path).toBe('$.filePath');
    }
  });

  it('reports invalid values for supported properties', () => {
    const diagnostics = errors({
      version: 1,
      children: [
        {
          id: 'frame-1',
          type: 'frame',
          layout: 'grid',
          gap: -4,
          padding: [1, 2, 3],
          width: { mode: 'grow', extra: true },
          opacity: 2,
          fill: 'red',
          rotation: Number.NaN,
        },
        { id: 'text-1', type: 'text' },
      ],
    });

    expect(diagnostics.map((error) => error.code)).toEqual(
      expect.arrayContaining(['invalid_value', 'missing_field']),
    );
    expect(diagnostics.every((error) => error.path.startsWith('$'))).toBe(true);
    expect(
      diagnostics.filter((error) => error.code === 'invalid_value').length,
    ).toBeGreaterThanOrEqual(7);
  });

  it('exposes the node inspector registry used for validation', () => {
    expect(nodeInspectorRegistry).toBeInstanceOf(Map);
    expect(getNodeInspector('frame')?.allowsChildren).toBe(true);
    expect(getNodeInspector('text')?.allowsChildren).toBe(false);
    expect(getNodeInspector('component')).toBeUndefined();
  });
});

describe('isSystemAbsolutePath', () => {
  it('recognizes posix, windows drive and UNC paths', () => {
    expect(isSystemAbsolutePath('/tmp/design.json')).toBe(true);
    expect(isSystemAbsolutePath('C:\\design.json')).toBe(true);
    expect(isSystemAbsolutePath('\\\\server\\share\\design.json')).toBe(true);
  });

  it('rejects relative paths and empty strings', () => {
    expect(isSystemAbsolutePath('design.json')).toBe(false);
    expect(isSystemAbsolutePath('./design.json')).toBe(false);
    expect(isSystemAbsolutePath('')).toBe(false);
  });
});

import {
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
} from '@design-ai/design-schema';
import { describe, expect, it } from 'vitest';
import {
  alignElement,
  findElement,
  findElementParent,
  frameAlignmentCell,
  frameAlignmentProps,
} from '../src/index';

function documentOf(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

function elementOf(document: DesignDocument, id: string): DesignElement {
  const element = findElement(document, id);
  if (element === undefined) {
    throw new Error(`No element for ${id}`);
  }
  return element;
}

describe('frameAlignmentProps', () => {
  it('maps the alignment matrix to justify and align values per direction', () => {
    expect(frameAlignmentProps('vertical', { column: 0, row: 0 })).toEqual({
      justifyContent: 'start',
      alignItems: 'start',
    });
    expect(frameAlignmentProps('vertical', { column: 2, row: 1 })).toEqual({
      justifyContent: 'center',
      alignItems: 'end',
    });
    expect(frameAlignmentProps('horizontal', { column: 2, row: 0 })).toEqual({
      justifyContent: 'end',
      alignItems: 'start',
    });
    expect(frameAlignmentProps('horizontal', { column: 1, row: 2 })).toEqual({
      justifyContent: 'center',
      alignItems: 'end',
    });
  });
});

describe('frameAlignmentCell', () => {
  it('derives the active matrix cell from the stored alignment', () => {
    expect(
      frameAlignmentCell('vertical', {
        justifyContent: 'center',
        alignItems: 'end',
      }),
    ).toEqual({ column: 2, row: 1 });
    expect(
      frameAlignmentCell('horizontal', {
        justifyContent: 'end',
        alignItems: 'start',
      }),
    ).toEqual({ column: 2, row: 0 });
    expect(frameAlignmentCell('vertical', {})).toEqual({ column: 0, row: 0 });
  });

  it('has no active cell when the main axis is distributed by space between or around', () => {
    expect(
      frameAlignmentCell('vertical', {
        justifyContent: 'space_between',
        alignItems: 'center',
      }),
    ).toBeUndefined();
    expect(
      frameAlignmentCell('horizontal', {
        justifyContent: 'space_around',
        alignItems: 'start',
      }),
    ).toBeUndefined();
  });
});

describe('findElementParent', () => {
  it('returns the containing frame and null for roots or unknown ids', () => {
    const document = documentOf({
      version: 1,
      children: [
        {
          id: 'board',
          type: 'frame',
          width: 300,
          height: 200,
          children: [
            {
              id: 'group',
              type: 'frame',
              width: 100,
              height: 100,
              children: [
                {
                  id: 'nested',
                  type: 'rectangle',
                  width: 10,
                  height: 10,
                },
              ],
            },
          ],
        },
        { id: 'root', type: 'text', text: 'Hi' },
      ],
    });

    expect(findElementParent(document, 'group')?.id).toBe('board');
    expect(findElementParent(document, 'nested')?.id).toBe('group');
    expect(findElementParent(document, 'board')).toBeNull();
    expect(findElementParent(document, 'root')).toBeNull();
    expect(findElementParent(document, 'missing')).toBeNull();
  });
});

describe('alignElement', () => {
  const board = () =>
    documentOf({
      version: 1,
      children: [
        {
          id: 'board',
          type: 'frame',
          layout: 'none',
          width: 200,
          height: 120,
          padding: [10, 20, 30, 40],
          children: [
            {
              id: 'child',
              type: 'rectangle',
              x: 5,
              y: 5,
              width: 50,
              height: 20,
            },
          ],
        },
      ],
    });

  it('aligns a free-positioned child against the padded parent content box', () => {
    const cases = [
      ['left', { x: 0 }],
      ['center', { x: 45 }],
      ['right', { x: 90 }],
      ['top', { y: 0 }],
      ['middle', { y: 30 }],
      ['bottom', { y: 60 }],
    ] as const;

    for (const [alignment, expected] of cases) {
      const updated = alignElement(board(), 'child', alignment);
      expect(elementOf(updated, 'child')).toMatchObject(expected);
    }
  });

  it('uses the measured size of auto-sized children', () => {
    const document = documentOf({
      version: 1,
      children: [
        {
          id: 'board',
          type: 'frame',
          layout: 'none',
          width: 100,
          height: 100,
          children: [
            {
              id: 'label',
              type: 'text',
              text: '标题',
              fontSize: 20,
            },
          ],
        },
      ],
    });

    const updated = alignElement(document, 'label', 'center');
    expect(elementOf(updated, 'label')).toMatchObject({ x: 30 });
  });

  it('leaves auto-layout children, roots and unknown ids unchanged', () => {
    const autoLayout = documentOf({
      version: 1,
      children: [
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 100,
          height: 100,
          children: [{ id: 'child', type: 'rectangle', width: 10, height: 10 }],
        },
      ],
    });

    expect(alignElement(autoLayout, 'child', 'right')).toBe(autoLayout);
    expect(alignElement(autoLayout, 'column', 'right')).toBe(autoLayout);
    expect(alignElement(autoLayout, 'missing', 'right')).toBe(autoLayout);
  });

  it('produces a document that still passes the version 1 contract', () => {
    const updated = alignElement(board(), 'child', 'bottom');
    expect(validateDesignDocument(updated).ok).toBe(true);
  });
});

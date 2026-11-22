import {
  validateDesignDocument,
  type DesignDocument,
  type FrameElement,
} from '@design-ai/design-schema';
import { describe, expect, it } from 'vitest';
import {
  addElement,
  createBlankDocument,
  createDefaultElement,
  createElementId,
  deleteElement,
  findElement,
  updateElement,
} from '../src/index';

function validate(document: DesignDocument): DesignDocument {
  const result = validateDesignDocument(document);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

describe('createBlankDocument', () => {
  it('creates an empty version 1 document that validates', () => {
    const document = createBlankDocument();

    expect(document).toEqual({ version: 1, children: [], variables: {} });
    expect(validate(document)).toEqual(document);
  });
});

describe('createElementId', () => {
  it('derives a unique id from the element type and existing ids', () => {
    const document = validate({
      version: 1,
      children: [
        { id: 'text-1', type: 'text', text: '一' },
        { id: 'text-3', type: 'text', text: '三' },
      ],
    });

    expect(createElementId(document, 'text')).toBe('text-4');
    expect(createElementId(document, 'frame')).toBe('frame-1');
  });
});

describe('createDefaultElement', () => {
  it('creates every supported element type as a valid element', () => {
    for (const type of [
      'frame',
      'rectangle',
      'ellipse',
      'text',
      'icon',
    ] as const) {
      const document = validate({
        version: 1,
        children: [createDefaultElement(type, `${type}-1`)],
      });

      expect(document.children[0]?.type).toBe(type);
    }
  });
});

describe('addElement', () => {
  it('appends a root element and preserves sibling order', () => {
    const document = createBlankDocument();
    const withTitle = addElement(
      document,
      null,
      createDefaultElement('text', 'title'),
    );
    const withFrame = addElement(
      withTitle,
      null,
      createDefaultElement('frame', 'container'),
    );

    expect(validate(withFrame).children.map((child) => child.id)).toEqual([
      'title',
      'container',
    ]);
  });

  it('appends a child to a frame and keeps existing children intact', () => {
    const document = validate({
      version: 1,
      children: [
        {
          id: 'container',
          type: 'frame',
          layout: 'vertical',
          width: 320,
          height: 240,
          children: [{ id: 'existing', type: 'text', text: '已有标题' }],
        },
      ],
    });

    const updated = addElement(
      document,
      'container',
      createDefaultElement('rectangle', 'block'),
    );
    const frame = updated.children[0] as FrameElement;

    expect(frame.children?.map((child) => child.id)).toEqual([
      'existing',
      'block',
    ]);
    expect(validate(updated).children[0]).toMatchObject({
      id: 'container',
      type: 'frame',
    });
  });

  it('rejects a parent that is missing or cannot own children', () => {
    const document = validate({
      version: 1,
      children: [
        { id: 'title', type: 'text', text: '标题' },
        { id: 'container', type: 'frame', width: 200, height: 100 },
      ],
    });

    expect(() =>
      addElement(document, 'missing', createDefaultElement('text', 'child')),
    ).toThrow(/missing/);
    expect(() =>
      addElement(document, 'title', createDefaultElement('text', 'child')),
    ).toThrow(/title/);
  });
});

describe('updateElement', () => {
  it('changes only the requested fields of the target element', () => {
    const document = validate({
      version: 1,
      children: [
        {
          id: 'container',
          type: 'frame',
          layout: 'vertical',
          width: 320,
          height: 240,
          gap: 8,
          fill: '#ffffff',
          children: [
            {
              id: 'title',
              type: 'text',
              text: '旧文案',
              fontSize: 16,
              fill: '#111111',
            },
            { id: 'other', type: 'text', text: '不动的文案' },
          ],
        },
      ],
    });

    const updated = updateElement(document, 'title', {
      text: '新文案',
      fill: '#3366ff',
    });
    const frame = updated.children[0] as FrameElement;

    expect(frame.gap).toBe(8);
    expect(frame.width).toBe(320);
    expect(frame.children?.[0]).toMatchObject({
      id: 'title',
      type: 'text',
      text: '新文案',
      fontSize: 16,
      fill: '#3366ff',
    });
    expect(frame.children?.[1]).toMatchObject({ text: '不动的文案' });
    expect(validate(updated).children[0]).toMatchObject({ gap: 8 });
  });

  it('does not change the document when the id is unknown', () => {
    const document = validate({
      version: 1,
      children: [{ id: 'title', type: 'text', text: '标题' }],
    });

    expect(updateElement(document, 'missing', { text: '新文案' })).toBe(
      document,
    );
  });
});

describe('deleteElement', () => {
  it('removes an element and preserves its siblings', () => {
    const document = validate({
      version: 1,
      children: [
        {
          id: 'container',
          type: 'frame',
          width: 320,
          height: 240,
          children: [
            { id: 'first', type: 'text', text: '一' },
            { id: 'second', type: 'text', text: '二' },
          ],
        },
      ],
    });

    const updated = deleteElement(document, 'first');

    expect(findElement(updated, 'first')).toBeUndefined();
    expect(
      (updated.children[0] as FrameElement).children?.map((child) => child.id),
    ).toEqual(['second']);
  });

  it('removes a container together with all descendants', () => {
    const document = validate({
      version: 1,
      children: [
        {
          id: 'container',
          type: 'frame',
          width: 320,
          height: 240,
          children: [
            {
              id: 'nested',
              type: 'frame',
              width: 200,
              height: 100,
              children: [{ id: 'deep', type: 'text', text: '深层' }],
            },
          ],
        },
        { id: 'keep', type: 'text', text: '保留' },
      ],
    });

    const updated = deleteElement(document, 'container');

    expect(updated.children.map((child) => child.id)).toEqual(['keep']);
    expect(findElement(updated, 'nested')).toBeUndefined();
    expect(findElement(updated, 'deep')).toBeUndefined();
    expect(validate(updated)).toEqual(updated);
  });
});

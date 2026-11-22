import {
  DESIGN_DOCUMENT_VERSION,
  type DesignDocument,
  type DesignElement,
  type ElementType,
} from '@design-ai/design-schema';

export type ElementPatch = Record<string, unknown>;

const NUMERIC_SUFFIX = /^[0-9]+$/;

/**
 * Creates the document used by the home page's new-design action.
 */
export function createBlankDocument(): DesignDocument {
  return {
    version: DESIGN_DOCUMENT_VERSION,
    children: [],
    variables: {},
  };
}

/**
 * Finds an element anywhere in the document tree.
 */
export function findElement(
  document: DesignDocument,
  id: string,
): DesignElement | undefined {
  const stack = [...document.children];
  while (stack.length > 0) {
    const element = stack.pop();
    if (element === undefined) {
      continue;
    }
    if (element.id === id) {
      return element;
    }
    if (element.type === 'frame') {
      stack.push(...(element.children ?? []));
    }
  }
  return undefined;
}

/**
 * Derives an id that is unique within the document by continuing after the
 * highest existing `<type>-<number>` suffix, for example `text-1` or `frame-3`.
 */
export function createElementId(
  document: DesignDocument,
  type: ElementType,
): string {
  const prefix = `${type}-`;
  let highest = 0;
  walk(document.children, (element) => {
    if (!element.id.startsWith(prefix)) {
      return;
    }
    const suffix = element.id.slice(prefix.length);
    if (!NUMERIC_SUFFIX.test(suffix)) {
      return;
    }
    highest = Math.max(highest, Number(suffix));
  });
  return `${prefix}${highest + 1}`;
}

/**
 * Builds the element inserted by the editor's create actions. Defaults keep
 * every type valid, including root text, which only needs measured content.
 */
export function createDefaultElement(
  type: ElementType,
  id: string,
): DesignElement {
  switch (type) {
    case 'frame':
      return {
        id,
        type,
        layout: 'vertical',
        width: 320,
        height: 240,
        padding: [16, 16, 16, 16],
        gap: 8,
        fill: '#ffffff',
        cornerRadius: 8,
        children: [],
      };
    case 'rectangle':
      return {
        id,
        type,
        width: 120,
        height: 80,
        fill: '#dbeafe',
        cornerRadius: 8,
      };
    case 'ellipse':
      return { id, type, width: 80, height: 80, fill: '#bfdbfe' };
    case 'text':
      return {
        id,
        type,
        text: '标题',
        fontSize: 24,
        fontWeight: 600,
        fill: '#1f2328',
      };
    case 'icon':
      return {
        id,
        type,
        library: 'lucide',
        icon: 'star',
        width: 24,
        height: 24,
        fill: '#1f2328',
      };
  }
}

/**
 * Appends an element to the document root (`parentId` is null) or to the
 * selected frame. Returns a new document; the source document is not mutated.
 */
export function addElement(
  document: DesignDocument,
  parentId: string | null,
  element: DesignElement,
): DesignDocument {
  if (parentId === null) {
    return { ...document, children: [...document.children, element] };
  }

  const parent = findElement(document, parentId);
  if (parent === undefined) {
    throw new Error(`找不到父元素 "${parentId}"`);
  }
  if (parent.type !== 'frame') {
    throw new Error(`元素 "${parentId}" 不是容器，不能包含子元素`);
  }

  return {
    ...document,
    children: mapElements(document.children, (candidate) => {
      if (candidate.id !== parentId || candidate.type !== 'frame') {
        return candidate;
      }
      return {
        ...candidate,
        children: [...(candidate.children ?? []), element],
      };
    }),
  };
}

/**
 * Merges a local patch into one element. Fields not present in the patch keep
 * their current value, and unrelated elements are returned unchanged.
 */
export function updateElement(
  document: DesignDocument,
  id: string,
  patch: ElementPatch,
): DesignDocument {
  if (findElement(document, id) === undefined) {
    return document;
  }

  return {
    ...document,
    children: mapElements(document.children, (element) =>
      element.id === id ? ({ ...element, ...patch } as DesignElement) : element,
    ),
  };
}

/**
 * Removes one element. Removing a frame also removes every descendant.
 */
export function deleteElement(
  document: DesignDocument,
  id: string,
): DesignDocument {
  return {
    ...document,
    children: removeElements(document.children, id),
  };
}

function removeElements(
  elements: readonly DesignElement[],
  id: string,
): DesignElement[] {
  return elements
    .filter((element) => element.id !== id)
    .map((element) =>
      element.type === 'frame' && element.children !== undefined
        ? { ...element, children: removeElements(element.children, id) }
        : element,
    );
}

function mapElements(
  elements: readonly DesignElement[],
  map: (element: DesignElement) => DesignElement,
): DesignElement[] {
  return elements.map((element) => {
    const mapped = map(element);
    if (mapped.type !== 'frame' || mapped.children === undefined) {
      return mapped;
    }
    return {
      ...mapped,
      children: mapElements(mapped.children, map),
    };
  });
}

function walk(
  elements: readonly DesignElement[],
  visit: (element: DesignElement) => void,
): void {
  for (const element of elements) {
    visit(element);
    if (element.type === 'frame' && element.children !== undefined) {
      walk(element.children, visit);
    }
  }
}

import type { DesignElement, ElementType } from '@design-ai/design-schema';

/** Display names shared by the layer tree and the properties panel. */
export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  frame: '容器',
  rectangle: '矩形',
  ellipse: '圆形',
  text: '文字',
  icon: '图标',
};

/**
 * Layer tree and canvas labels: an explicit name, then text content, then the
 * element id.
 */
export function elementLabel(element: DesignElement): string {
  if (element.name !== undefined && element.name.trim().length > 0) {
    return element.name;
  }
  if (element.type === 'text') {
    const text = element.textStyle.content.trim();
    return text.length === 0 ? element.id : text;
  }
  return element.id;
}

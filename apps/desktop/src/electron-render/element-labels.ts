import type { DesignElement, ElementType } from '@design-ai/design-schema';

/** Display names shared by the layer tree and the properties panel. */
export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  frame: '容器',
  rectangle: '矩形',
  ellipse: '圆形',
  text: '文字',
  icon: '图标',
};

/** Layer tree and canvas labels: text content when present, otherwise the id. */
export function elementLabel(element: DesignElement): string {
  if (element.type === 'text') {
    const text = element.text.trim();
    return text.length === 0 ? element.id : text;
  }
  return element.id;
}

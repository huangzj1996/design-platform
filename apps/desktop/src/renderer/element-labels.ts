import type { ElementType } from '@design-ai/design-schema';

/** Display names shared by the layer tree and the properties panel. */
export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  frame: '容器',
  rectangle: '矩形',
  ellipse: '圆形',
  text: '文字',
  icon: '图标',
};

import {
  findLayoutNode,
  layoutDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Dimension,
  type DimensionMode,
  type ElementType,
  type FrameElement,
  type FrameLayout,
  type FrameJustifyContent,
} from '@design-ai/design-schema';
import {
  findElement,
  findElementParent,
  frameAlignmentCell,
  frameAlignmentProps,
  type ElementAlignment,
  type ElementPatch,
} from '@design-ai/editor-core';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Circle,
  DiamondPlus,
  Download,
  Frame,
  LayoutDashboard,
  Plus,
  Sparkles,
  Square,
  Type,
} from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { useMemo } from 'react';
import { ELEMENT_TYPE_LABELS, elementLabel } from './element-labels';

export interface PropertiesPanelProps {
  document: DesignDocument | null;
  selectionId: string | null;
  onUpdate: (patch: ElementPatch) => void;
  onAlign: (alignment: ElementAlignment) => void;
  onAddChild: (type: ElementType) => void;
  onDelete: () => void;
}

const DEFAULT_PADDING: [number, number, number, number] = [0, 0, 0, 0];
const PADDING_LABELS = [
  '内边距上',
  '内边距右',
  '内边距下',
  '内边距左',
] as const;
const CHILD_TYPES: readonly ElementType[] = [
  'text',
  'rectangle',
  'ellipse',
  'icon',
  'frame',
];

const SECTION_CLASS =
  'flex flex-col gap-1.5 border-b border-[#E9E9E9] px-3.5 py-2';
const TITLE_CLASS = 'text-[12px] font-semibold text-[#333333]';
const CONTROL_CLASS =
  'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[#E3E3E3] bg-[#F8F8F8] px-2 text-[11px] text-[#8A8A8A]';
const INPUT_CLASS =
  'min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[#262626] outline-none';
const ICON_BUTTON_CLASS =
  'flex size-[30px] cursor-pointer items-center justify-center rounded-[5px] border border-[#E4E4E4] bg-[#F7F7F7] text-[#9CA3AF] transition-colors hover:bg-[#ECECEE] disabled:cursor-not-allowed disabled:text-[#D1D5DB]';
const SEGMENT_CLASS =
  'flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-md text-[11px] font-medium text-[#6E6E6E]';
const SEGMENT_ACTIVE_CLASS =
  'border border-[#DADADA] bg-white text-[#2F2F2F] shadow-[0_1px_2px_#00000014]';
const CHECKBOX_CLASS =
  'flex items-center gap-2 text-[11px] font-medium text-[#333333]';
const DISABLED_ACTION_CLASS =
  'flex h-[30px] w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-[#111111] text-[12px] font-semibold text-white opacity-40';

const ALIGNMENT_BUTTONS: ReadonlyArray<{
  alignment: ElementAlignment;
  label: string;
  icon: typeof AlignStartHorizontal;
}> = [
  { alignment: 'left', label: '左对齐', icon: AlignStartHorizontal },
  { alignment: 'center', label: '水平居中', icon: AlignCenterHorizontal },
  { alignment: 'right', label: '右对齐', icon: AlignEndHorizontal },
  { alignment: 'top', label: '顶部对齐', icon: AlignStartVertical },
  { alignment: 'middle', label: '垂直居中', icon: AlignCenterVertical },
  { alignment: 'bottom', label: '底部对齐', icon: AlignEndVertical },
];

const MATRIX_LABELS = [
  ['左上', '上中', '右上'],
  ['左中', '正中', '右中'],
  ['左下', '下中', '右下'],
] as const;
const MATRIX_KEYS = [
  ['matrix-top-left', 'matrix-top-center', 'matrix-top-right'],
  ['matrix-middle-left', 'matrix-center', 'matrix-middle-right'],
  ['matrix-bottom-left', 'matrix-bottom-center', 'matrix-bottom-right'],
] as const;

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : '#000000';
}

function numberValue(value: unknown): number | '' {
  return typeof value === 'number' ? value : '';
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type DimensionState = DimensionMode | 'fixed';

function dimensionMode(value: Dimension | undefined): DimensionState {
  return typeof value === 'object' && value !== null ? value.mode : 'fixed';
}

function dimensionDisplayValue(
  value: Dimension | undefined,
  resolved: number | undefined,
): number {
  if (typeof value === 'number') {
    return value;
  }
  if (resolved !== undefined) {
    return resolved;
  }
  return typeof value === 'object' && value !== null
    ? (value.fallback ?? 0)
    : 0;
}

function dimensionWithMode(
  current: Dimension | undefined,
  mode: DimensionMode,
  resolved: number | undefined,
): Dimension {
  const fallback =
    typeof current === 'object' && current !== null
      ? current.fallback
      : current;
  return { mode, fallback: fallback ?? resolved ?? 0 };
}

function fixedDimension(
  current: Dimension | undefined,
  resolved: number | undefined,
): number {
  if (resolved !== undefined) {
    return resolved;
  }
  if (typeof current === 'number') {
    return current;
  }
  return current?.fallback ?? 0;
}

interface NumberFieldProps {
  label: string;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number | undefined) => void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: NumberFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    if (input === '') {
      onChange(undefined);
      return;
    }
    const parsed = event.target.valueAsNumber;
    if (!Number.isFinite(parsed)) {
      return;
    }
    if (min !== undefined && parsed < min) {
      return;
    }
    if (max !== undefined && parsed > max) {
      return;
    }
    onChange(parsed);
  };

  return (
    <label className={CONTROL_CLASS}>
      <span className="shrink-0">{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={numberValue(value)}
        onChange={handleChange}
        className={INPUT_CLASS}
      />
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TextField({ label, value, onChange }: TextFieldProps) {
  return (
    <label className={CONTROL_CLASS}>
      <span className="shrink-0">{label}</span>
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}

interface CheckboxFieldProps {
  label: string;
  testId?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function CheckboxField({
  label,
  testId,
  checked,
  disabled = false,
  onChange,
}: CheckboxFieldProps) {
  return (
    <label className={`${CHECKBOX_CLASS} ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        aria-label={label}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 shrink-0 accent-[#0066FF]"
      />
      <span>{label}</span>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  return (
    <label className={CONTROL_CLASS}>
      <span className="shrink-0">{label}</span>
      <input
        type="color"
        aria-label={label}
        value={normalizeColor(value)}
        onChange={(event) => onChange(event.target.value)}
        className="h-5 w-full min-w-0 cursor-pointer bg-transparent p-0"
      />
    </label>
  );
}

function Section({
  title,
  testId,
  action,
  children,
}: {
  title: string;
  testId?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className={SECTION_CLASS}>
      <div className="flex h-[22px] items-center justify-between">
        <span className={TITLE_CLASS}>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function ElementTypeIcon({ element }: { element: DesignElement }) {
  const props = { size: 14, strokeWidth: 2 } as const;
  switch (element.type) {
    case 'frame':
      return <Frame {...props} />;
    case 'rectangle':
      return <Square {...props} />;
    case 'ellipse':
      return <Circle {...props} />;
    case 'text':
      return <Type {...props} />;
    case 'icon':
      return <Sparkles {...props} />;
  }
}

interface ElementFieldsProps<T extends DesignElement> {
  element: T;
  onUpdate: (patch: ElementPatch) => void;
}

function AlignmentSection({
  enabled,
  onAlign,
}: {
  enabled: boolean;
  onAlign: (alignment: ElementAlignment) => void;
}) {
  return (
    <Section title="对齐" testId="alignment-section">
      <div className="grid grid-cols-6 gap-1.5">
        {ALIGNMENT_BUTTONS.map(({ alignment, label, icon: Icon }) => (
          <button
            key={alignment}
            type="button"
            data-testid={`align-${alignment}`}
            aria-label={label}
            title={label}
            disabled={!enabled}
            onClick={() => onAlign(alignment)}
            className={ICON_BUTTON_CLASS}
          >
            <Icon size={15} strokeWidth={2} />
          </button>
        ))}
      </div>
    </Section>
  );
}

function PositionSection({
  element,
  layoutX,
  layoutY,
  computed,
  onUpdate,
}: ElementFieldsProps<DesignElement> & {
  layoutX: number;
  layoutY: number;
  computed: boolean;
}) {
  return (
    <Section title="位置" testId="position-section">
      <div className="flex gap-2">
        <NumberField
          label="X"
          value={computed ? layoutX : (element.x ?? 0)}
          disabled={computed}
          onChange={(value) => onUpdate({ x: value })}
        />
        <NumberField
          label="Y"
          value={computed ? layoutY : (element.y ?? 0)}
          disabled={computed}
          onChange={(value) => onUpdate({ y: value })}
        />
      </div>
      <div className="flex gap-2">
        <NumberField
          label="旋转"
          value={element.rotation ?? 0}
          onChange={(value) => onUpdate({ rotation: value })}
        />
      </div>
    </Section>
  );
}

function LayoutModeControl({
  layout,
  onUpdate,
}: {
  layout: FrameLayout;
  onUpdate: (patch: ElementPatch) => void;
}) {
  const modes: ReadonlyArray<{
    value: FrameLayout;
    label: string;
    testId: string;
    icon: typeof LayoutDashboard;
  }> = [
    {
      value: 'none',
      label: '自由布局',
      testId: 'layout-none',
      icon: LayoutDashboard,
    },
    {
      value: 'vertical',
      label: '纵向布局',
      testId: 'layout-vertical',
      icon: ArrowDown,
    },
    {
      value: 'horizontal',
      label: '横向布局',
      testId: 'layout-horizontal',
      icon: ArrowRight,
    },
  ];

  return (
    <div
      role="group"
      aria-label="布局"
      className="flex h-[34px] items-center gap-px rounded-lg bg-[#EDEDED] p-0.5"
    >
      {modes.map(({ value, label, testId, icon: Icon }) => {
        const active = layout === value;
        return (
          <button
            key={value}
            type="button"
            data-testid={testId}
            aria-label={label}
            title={label}
            aria-pressed={active}
            onClick={() => onUpdate({ layout: value })}
            className={`${SEGMENT_CLASS} ${
              active ? SEGMENT_ACTIVE_CLASS : 'cursor-pointer'
            }`}
          >
            <Icon size={15} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}

function GapControl({
  justifyContent,
  disabled,
  onUpdate,
}: {
  justifyContent: FrameJustifyContent;
  disabled: boolean;
  onUpdate: (patch: ElementPatch) => void;
}) {
  const distributed =
    justifyContent === 'space_between' || justifyContent === 'space_around';
  const options: ReadonlyArray<{
    value: 'fixed' | FrameJustifyContent;
    label: string;
    testId: string;
  }> = [
    { value: 'fixed', label: '固定间距', testId: 'gap-fixed' },
    { value: 'space_between', label: '两端分布', testId: 'gap-space-between' },
    { value: 'space_around', label: '环绕分布', testId: 'gap-space-around' },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {options.map(({ value, label, testId }) => {
        const checked =
          value === 'fixed' ? !distributed : justifyContent === value;
        return (
          <label key={value} className={CHECKBOX_CLASS}>
            <input
              type="radio"
              name="gap-distribution"
              aria-label={label}
              data-testid={testId}
              checked={checked}
              disabled={disabled}
              onChange={() =>
                onUpdate({
                  justifyContent: value === 'fixed' ? 'start' : value,
                })
              }
              className="size-3.5 accent-[#0066FF] disabled:cursor-not-allowed"
            />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

function FrameFields({ element, onUpdate }: ElementFieldsProps<FrameElement>) {
  const padding = element.padding ?? DEFAULT_PADDING;
  const layout = element.layout ?? 'horizontal';
  const autoLayout = layout !== 'none';
  const direction = layout === 'none' ? 'horizontal' : layout;
  const activeCell = autoLayout
    ? frameAlignmentCell(direction, element)
    : undefined;

  const setPadding = (index: number, value: number | undefined) => {
    if (value === undefined) {
      return;
    }
    const next = [...padding] as [number, number, number, number];
    next[index] = value;
    onUpdate({ padding: next });
  };

  return (
    <Section title="布局" testId="layout-section">
      <LayoutModeControl layout={layout} onUpdate={onUpdate} />

      <div className="grid grid-cols-[100px_1fr] gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium text-[#666666]">对齐</span>
          <div className="grid h-[69px] grid-cols-3 overflow-hidden rounded-lg border border-[#E3E3E3] bg-[#F8F8F8]">
            {MATRIX_KEYS.map((rowKeys, row) =>
              rowKeys.map((testId, column) => {
                const active =
                  activeCell?.row === row && activeCell.column === column;
                return (
                  <button
                    key={testId}
                    type="button"
                    data-testid={testId}
                    aria-label={`容器内${MATRIX_LABELS[row]?.[column] ?? ''}`}
                    aria-pressed={active}
                    disabled={!autoLayout}
                    onClick={() =>
                      onUpdate(
                        frameAlignmentProps(direction, {
                          column: column as 0 | 1 | 2,
                          row: row as 0 | 1 | 2,
                        }),
                      )
                    }
                    className="flex cursor-pointer items-center justify-center disabled:cursor-not-allowed"
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        active ? 'bg-[#0066FF]' : 'bg-[#C9CDD3]'
                      }`}
                    />
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[11px] font-medium text-[#666666]">间距</span>
          <GapControl
            justifyContent={element.justifyContent ?? 'start'}
            disabled={!autoLayout}
            onUpdate={onUpdate}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <NumberField
          label="间距"
          value={element.gap ?? 0}
          min={0}
          disabled={!autoLayout}
          onChange={(value) => onUpdate({ gap: value })}
        />
      </div>

      <div className="flex gap-2">
        {padding.slice(0, 2).map((value, index) => (
          <NumberField
            key={PADDING_LABELS[index]}
            label={PADDING_LABELS[index] ?? `内边距${index}`}
            value={value}
            min={0}
            onChange={(next) => setPadding(index, next)}
          />
        ))}
      </div>
      <div className="flex gap-2">
        {padding.slice(2).map((value, index) => (
          <NumberField
            key={PADDING_LABELS[index + 2]}
            label={PADDING_LABELS[index + 2] ?? `内边距${index + 2}`}
            value={value}
            min={0}
            onChange={(next) => setPadding(index + 2, next)}
          />
        ))}
      </div>

      <CheckboxField
        label="裁剪内容"
        testId="clip-content"
        checked={element.clipContent === true}
        onChange={(checked) =>
          onUpdate({ clipContent: checked ? true : undefined })
        }
      />
    </Section>
  );
}

function DimensionModeControls({
  element,
  resolvedWidth,
  resolvedHeight,
  onUpdate,
}: ElementFieldsProps<DesignElement> & {
  resolvedWidth: number | undefined;
  resolvedHeight: number | undefined;
}) {
  const setMode = (axis: 'width' | 'height', mode: DimensionMode | null) => {
    const current = element[axis];
    const resolved = axis === 'width' ? resolvedWidth : resolvedHeight;
    const next =
      mode === null
        ? fixedDimension(current, resolved)
        : dimensionWithMode(current, mode, resolved);
    onUpdate({ [axis]: next });
  };

  return (
    <>
      <div className="flex gap-2">
        <NumberField
          label="宽度"
          value={dimensionDisplayValue(element.width, resolvedWidth)}
          min={0}
          onChange={(value) => onUpdate({ width: value })}
        />
        <NumberField
          label="高度"
          value={dimensionDisplayValue(element.height, resolvedHeight)}
          min={0}
          onChange={(value) => onUpdate({ height: value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <CheckboxField
          label="填满宽度"
          testId="fill-width"
          checked={dimensionMode(element.width) === 'fill_container'}
          onChange={(checked) =>
            setMode('width', checked ? 'fill_container' : null)
          }
        />
        <CheckboxField
          label="填满高度"
          testId="fill-height"
          checked={dimensionMode(element.height) === 'fill_container'}
          onChange={(checked) =>
            setMode('height', checked ? 'fill_container' : null)
          }
        />
        <CheckboxField
          label="适应内容宽度"
          testId="hug-width"
          checked={dimensionMode(element.width) === 'fit_content'}
          onChange={(checked) =>
            setMode('width', checked ? 'fit_content' : null)
          }
        />
        <CheckboxField
          label="适应内容高度"
          testId="hug-height"
          checked={dimensionMode(element.height) === 'fit_content'}
          onChange={(checked) =>
            setMode('height', checked ? 'fit_content' : null)
          }
        />
      </div>
    </>
  );
}

function TextFields({
  element,
  onUpdate,
}: ElementFieldsProps<Extract<DesignElement, { type: 'text' }>>) {
  return (
    <Section title="文字" testId="text-section">
      <label className="flex flex-col gap-1 text-[11px] text-[#666666]">
        <span>文案</span>
        <textarea
          aria-label="文案"
          rows={3}
          value={element.text}
          onChange={(event) => onUpdate({ text: event.target.value })}
          className="resize-none rounded-lg border border-[#E3E3E3] bg-[#F8F8F8] px-2 py-1.5 text-[12px] text-[#262626] outline-none"
        />
      </label>
      <div className="flex gap-2">
        <NumberField
          label="字号"
          value={element.fontSize}
          min={1}
          onChange={(value) => onUpdate({ fontSize: value })}
        />
        <NumberField
          label="字重"
          value={element.fontWeight}
          min={1}
          onChange={(value) => onUpdate({ fontWeight: value })}
        />
      </div>
      <label className={CONTROL_CLASS}>
        <span className="shrink-0">对齐</span>
        <select
          aria-label="文字对齐"
          value={element.textAlign ?? 'left'}
          onChange={(event) => onUpdate({ textAlign: event.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[#262626] outline-none"
        >
          <option value="left">左对齐</option>
          <option value="center">居中</option>
          <option value="right">右对齐</option>
          <option value="justify">两端对齐</option>
        </select>
      </label>
    </Section>
  );
}

function IconFields({
  element,
  onUpdate,
}: ElementFieldsProps<Extract<DesignElement, { type: 'icon' }>>) {
  return (
    <Section title="图标" testId="icon-section">
      <TextField
        label="图标库"
        value={element.library}
        onChange={(value) => onUpdate({ library: value })}
      />
      <TextField
        label="图标名称"
        value={element.icon}
        onChange={(value) => onUpdate({ icon: value })}
      />
    </Section>
  );
}

function DisabledSections() {
  return (
    <>
      <Section
        title="效果"
        testId="effects-section"
        action={
          <button
            type="button"
            data-testid="effects-add"
            aria-label="添加效果（暂不可用）"
            title="添加效果（暂不可用）"
            disabled
            className="flex size-[18px] cursor-not-allowed items-center justify-center text-[#C2C3C9]"
          >
            <Plus size={14} />
          </button>
        }
      >
        <p className="text-[11px] text-[#9CA3AF]">暂不支持效果</p>
      </Section>

      <Section title="导出" testId="export-section">
        <div className="flex gap-2">
          <label className={`${CONTROL_CLASS} justify-between`}>
            <span className="shrink-0">倍率</span>
            <select
              aria-label="导出倍率"
              data-testid="export-scale"
              disabled
              defaultValue="2x"
              className="min-w-0 bg-transparent text-[12px] text-[#9CA3AF] outline-none"
            >
              <option value="2x">2x</option>
            </select>
          </label>
          <label className={`${CONTROL_CLASS} justify-between`}>
            <span className="shrink-0">格式</span>
            <select
              aria-label="导出格式"
              data-testid="export-format"
              disabled
              defaultValue="png"
              className="min-w-0 bg-transparent text-[12px] text-[#9CA3AF] outline-none"
            >
              <option value="png">PNG</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          data-testid="export-layer"
          disabled
          className={DISABLED_ACTION_CLASS}
        >
          <Download size={14} />
          导出图层
        </button>
      </Section>
    </>
  );
}

export function PropertiesPanel({
  document,
  selectionId,
  onUpdate,
  onAlign,
  onAddChild,
  onDelete,
}: PropertiesPanelProps) {
  const layout = useMemo(
    () => (document === null ? null : layoutDesignDocument(document)),
    [document],
  );
  const element =
    document === null || selectionId === null
      ? undefined
      : findElement(document, selectionId);

  if (document === null || element === undefined) {
    return (
      <aside className="properties-panel" data-testid="property-panel">
        <p className="panel-empty p-3.5">未选择元素</p>
      </aside>
    );
  }

  const layoutNode =
    layout === null ? undefined : findLayoutNode(layout, element.id);
  const parent = findElementParent(document, element.id);
  const parentFrame = parent?.type === 'frame' ? parent : null;
  const parentLayout = parentFrame?.layout ?? 'horizontal';
  const computedPosition = parentFrame !== null && parentLayout !== 'none';
  const canAlign = parentFrame !== null && parentLayout === 'none';
  const resolvedWidth = layoutNode?.box.width;
  const resolvedHeight = layoutNode?.box.height;

  return (
    <aside className="properties-panel" data-testid="property-panel">
      <div className="flex items-center justify-between gap-2 border-b border-[#E8E8E8] px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[#111111]">
          <ElementTypeIcon element={element} />
          <span className="truncate text-[13px] font-semibold">
            {element.type === 'text'
              ? elementLabel(element)
              : ELEMENT_TYPE_LABELS[element.type]}
          </span>
        </div>
        <code className="shrink-0 truncate text-[10px] text-[#8A8C93]">
          {element.id}
        </code>
      </div>

      <button
        type="button"
        data-testid="create-component"
        disabled
        className="flex h-6 cursor-not-allowed items-center gap-1.5 border-b border-[#E8E8E8] px-3.5 text-[12px] font-semibold text-[#C2C3C9]"
      >
        <DiamondPlus size={15} strokeWidth={2} />
        创建组件
      </button>

      <button
        type="button"
        data-testid="context-row"
        disabled
        className="flex h-11 w-full cursor-not-allowed items-center justify-between border-b border-[#E9E9E9] px-3.5 text-[12px] font-semibold text-[#C2C3C9]"
      >
        <span>Context</span>
        <ChevronDown size={14} />
      </button>

      <AlignmentSection enabled={canAlign} onAlign={onAlign} />

      <PositionSection
        element={element}
        layoutX={round(layoutNode?.box.x ?? 0)}
        layoutY={round(layoutNode?.box.y ?? 0)}
        computed={computedPosition}
        onUpdate={onUpdate}
      />

      {element.type === 'frame' ? (
        <FrameFields element={element} onUpdate={onUpdate} />
      ) : null}

      <Section title="尺寸" testId="dimensions-section">
        <DimensionModeControls
          element={element}
          resolvedWidth={resolvedWidth}
          resolvedHeight={resolvedHeight}
          onUpdate={onUpdate}
        />
      </Section>

      <Section title="外观" testId="appearance-section">
        <div className="flex gap-2">
          <NumberField
            label="不透明度"
            value={element.opacity}
            min={0}
            max={1}
            step={0.1}
            onChange={(value) => onUpdate({ opacity: value })}
          />
          <NumberField
            label="圆角"
            value={element.cornerRadius}
            min={0}
            onChange={(value) => onUpdate({ cornerRadius: value })}
          />
        </div>
      </Section>

      <Section title="填充" testId="fill-section">
        <div className="flex gap-2">
          <ColorField
            label="填充颜色"
            value={element.fill}
            onChange={(value) => onUpdate({ fill: value })}
          />
          <NumberField
            label="填充透明度"
            value={element.fillOpacity ?? 1}
            min={0}
            max={1}
            step={0.1}
            onChange={(value) => onUpdate({ fillOpacity: value })}
          />
        </div>
      </Section>

      <Section title="描边" testId="stroke-section">
        <div className="flex gap-2">
          <ColorField
            label="描边颜色"
            value={element.stroke}
            onChange={(value) => onUpdate({ stroke: value })}
          />
          <NumberField
            label="描边宽度"
            value={element.strokeWidth}
            min={0}
            onChange={(value) => onUpdate({ strokeWidth: value })}
          />
        </div>
      </Section>

      {element.type === 'text' ? (
        <TextFields element={element} onUpdate={onUpdate} />
      ) : null}
      {element.type === 'icon' ? (
        <IconFields element={element} onUpdate={onUpdate} />
      ) : null}

      <div className="border-b border-[#E9E9E9] px-3.5 py-2">
        <CheckboxField
          label="可见"
          checked={element.visible !== false}
          onChange={(checked) =>
            onUpdate({ visible: checked ? undefined : false })
          }
        />
      </div>

      <DisabledSections />

      {element.type === 'frame' ? (
        <div className="child-actions flex flex-col gap-2 border-b border-[#E9E9E9] px-3.5 py-2">
          <span className={TITLE_CLASS}>添加子元素</span>
          <div className="button-row flex flex-wrap gap-1.5">
            {CHILD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onAddChild(type)}
                className="cursor-pointer rounded-md border border-[#D0D7DE] bg-[#F6F8FA] px-2 py-1 text-[11px] text-[#1F2328]"
              >
                添加{ELEMENT_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="p-3.5">
        <button
          type="button"
          className="danger-button cursor-pointer rounded-md border border-[#FF8182] bg-[#FFF5F5] px-2.5 py-1.5 text-[13px] text-[#CF222E]"
          onClick={onDelete}
        >
          删除元素
        </button>
      </div>
    </aside>
  );
}

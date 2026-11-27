import {
  findLayoutNode,
  layoutDesignDocument,
  resolveVariableValue,
  type DesignDocument,
  type DesignElement,
  type DesignVariables,
  type ElementType,
} from '@design-ai/design-schema';
import {
  findElementParent,
  frameAlignmentCell,
  frameAlignmentProps,
  type ElementAlignment,
  type ElementPatch,
  type FrameAlignmentCell,
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
  Minus,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Sparkles,
  Square,
  Type,
} from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import { ELEMENT_TYPE_LABELS, elementLabel } from './element-labels';
import { InspectorScrollArea } from './InspectorScrollArea';

interface InspectorFieldsProps {
  document: DesignDocument;
  element: DesignElement;
  onUpdate: (patch: ElementPatch) => void;
  onAlign: (alignment: ElementAlignment) => void;
  onAddChild: (type: ElementType) => void;
  onDelete: () => void;
}

interface PropertiesPanelProps extends InspectorFieldsProps {
  expanded: boolean;
  onToggle: () => void;
}

type FrameElement = Extract<DesignElement, { type: 'frame' }>;
type TextElement = Extract<DesignElement, { type: 'text' }>;
type IconElement = Extract<DesignElement, { type: 'icon' }>;
type FillLayer = NonNullable<DesignElement['fill']>[number];
type FrameLayout = NonNullable<FrameElement['layout']>;
type FrameJustifyContent = NonNullable<FrameElement['justifyContent']>;
type DimensionMode = 'fixed' | 'fill_container' | 'fit_content';

const DEFAULT_PADDING: [number, number, number, number] = [0, 0, 0, 0];
const PADDING_ROWS = [
  [
    { index: 0, label: '内边距上' },
    { index: 1, label: '内边距右' },
  ],
  [
    { index: 2, label: '内边距下' },
    { index: 3, label: '内边距左' },
  ],
] as const;
const CHILD_TYPES: readonly ElementType[] = [
  'text',
  'rectangle',
  'ellipse',
  'icon',
  'frame',
];

const SECTION_CLASS =
  'flex shrink-0 flex-col gap-1.5 border-b border-[#E9E9E9] px-3.5 py-2.5';
const TITLE_CLASS = 'text-[12px] font-medium text-[#171717]';
const CONTROL_CLASS =
  'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[#E4E4E4] bg-[#F7F7F7] px-2 text-[11px] text-[#777777] focus-within:border-ring';
const INPUT_CLASS =
  'min-w-0 flex-1 appearance-none bg-transparent font-mono text-[12px] text-[#171717] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const ICON_BUTTON_CLASS =
  'flex h-[30px] min-w-0 cursor-pointer items-center justify-center rounded-[5px] border border-[#E4E4E4] bg-[#F7F7F7] text-[#747D89] transition-colors enabled:hover:bg-[#ECECEE] disabled:cursor-not-allowed disabled:text-[#9CA3AF]';
const SECTION_ACTION_CLASS =
  'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-[#777777] enabled:hover:bg-[#ECECEE] disabled:cursor-not-allowed';
const SEGMENT_CLASS =
  'flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-md text-[11px] font-medium text-[#6E6E6E]';
const SEGMENT_ACTIVE_CLASS =
  'border border-[#DADADA] bg-white text-[#2F2F2F] shadow-[0_1px_2px_#00000014]';
const CHECKBOX_CLASS =
  'flex items-center gap-2 text-[11px] font-medium text-[#333333]';
const DISABLED_ACTION_CLASS =
  'flex h-[30px] w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-[#111111] text-[12px] font-medium text-white';

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

interface AlignmentMatrixCell extends FrameAlignmentCell {
  label: string;
  testId: string;
}

const ALIGNMENT_MATRIX: readonly (readonly AlignmentMatrixCell[])[] = [
  [
    { row: 0, column: 0, label: '左上', testId: 'matrix-top-left' },
    { row: 0, column: 1, label: '上中', testId: 'matrix-top-center' },
    { row: 0, column: 2, label: '右上', testId: 'matrix-top-right' },
  ],
  [
    { row: 1, column: 0, label: '左中', testId: 'matrix-middle-left' },
    { row: 1, column: 1, label: '正中', testId: 'matrix-center' },
    { row: 1, column: 2, label: '右中', testId: 'matrix-middle-right' },
  ],
  [
    { row: 2, column: 0, label: '左下', testId: 'matrix-bottom-left' },
    { row: 2, column: 1, label: '下中', testId: 'matrix-bottom-center' },
    { row: 2, column: 2, label: '右下', testId: 'matrix-bottom-right' },
  ],
];

const LAYOUT_MODES: ReadonlyArray<{
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

const GAP_OPTIONS: ReadonlyArray<{
  value: 'fixed' | FrameJustifyContent;
  label: string;
  testId: string;
}> = [
  { value: 'fixed', label: '固定间距', testId: 'gap-fixed' },
  { value: 'space_between', label: '两端分布', testId: 'gap-space-between' },
  { value: 'space_around', label: '环绕分布', testId: 'gap-space-around' },
];

function normalizeColor(value: string | undefined): string {
  return value !== undefined && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : '#000000';
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function numericOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Resolves a coordinate declaration so bound positions show their value. */
function resolvedCoordinate(
  value: unknown,
  variables: Readonly<DesignVariables>,
): number {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'number' ? resolved : 0;
}

function dimensionMode(value: unknown): DimensionMode {
  return value === 'fill_container' || value === 'fit_content'
    ? value
    : 'fixed';
}

function dimensionDisplayValue(
  value: unknown,
  resolved: number | undefined,
): number {
  if (typeof value === 'number') {
    return value;
  }
  return resolved ?? 0;
}

function fixedDimension(
  current: unknown,
  resolved: number | undefined,
): number {
  return typeof current === 'number' ? current : (resolved ?? 0);
}

/** Normalizes the v2 scalar, two-value and four-value padding forms. */
function paddingTuple(
  padding: FrameElement['padding'],
): [number, number, number, number] {
  if (padding === undefined) {
    return DEFAULT_PADDING;
  }
  if (typeof padding === 'number') {
    return [padding, padding, padding, padding];
  }
  const [top, right] = padding;
  return padding.length === 2
    ? [numeric(top), numeric(right), numeric(top), numeric(right)]
    : [numeric(top), numeric(right), numeric(padding[2]), numeric(padding[3])];
}

function elementDimension(
  element: DesignElement,
  axis: 'width' | 'height',
): unknown {
  return element.type === 'text' ? element.textStyle[axis] : element[axis];
}

function colorFill(layers: readonly FillLayer[] | undefined) {
  return layers?.find((layer) => layer.type === 'color');
}

function withFillColor(
  layers: readonly FillLayer[] | undefined,
  color: string,
): FillLayer[] {
  const next = [...(layers ?? [])];
  const index = next.findIndex((layer) => layer.type === 'color');
  if (index < 0) {
    next.push({ type: 'color', color });
    return next;
  }
  const current = next[index];
  next[index] =
    current?.type === 'color' && current.opacity !== undefined
      ? { type: 'color', color, opacity: current.opacity }
      : { type: 'color', color };
  return next;
}

function withFillOpacity(
  layers: readonly FillLayer[] | undefined,
  opacity: number | undefined,
): FillLayer[] {
  const next = [...(layers ?? [])];
  const index = next.findIndex((layer) => layer.type === 'color');
  if (index < 0) {
    return next;
  }
  const current = next[index];
  if (current?.type !== 'color') {
    return next;
  }
  next[index] =
    opacity === undefined
      ? { type: 'color', color: current.color }
      : { type: 'color', color: current.color, opacity };
  return next;
}

function strokeColor(element: DesignElement): string | undefined {
  return colorFill(element.stroke?.fill)?.color;
}

function withStrokeColor(
  element: DesignElement,
  color: string,
): NonNullable<DesignElement['stroke']> {
  const stroke = element.stroke;
  if (stroke === undefined) {
    return { fill: [{ type: 'color', color }] };
  }
  return { ...stroke, fill: withFillColor(stroke.fill, color) };
}

interface NumberFieldProps {
  label: string;
  prefix?: ReactNode;
  suffix?: string;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled?: boolean;
  onChange: (value: number | undefined) => void;
}

function NumberField({
  label,
  prefix = label,
  suffix,
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
      {prefix === null ? null : (
        <span aria-hidden="true" className="shrink-0">
          {prefix}
        </span>
      )}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value ?? ''}
        onChange={handleChange}
        className={INPUT_CLASS}
      />
      {suffix ? (
        <span aria-hidden="true" className="font-mono text-[#171717]">
          {suffix}
        </span>
      ) : null}
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
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2">
      <input
        type="color"
        aria-label={label}
        value={normalizeColor(value)}
        onChange={(event) => onChange(event.target.value)}
        className="size-3.5 shrink-0 cursor-pointer rounded border border-[#D5D9E0] p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <span className="truncate font-mono text-[12px] text-[#171717]">
        {value ?? normalizeColor(value)}
      </span>
    </label>
  );
}

function Section({
  title,
  testId,
  action,
  children,
  divided = true,
}: {
  title: string;
  testId?: string;
  action?: ReactNode;
  children?: ReactNode;
  divided?: boolean;
}) {
  return (
    <section
      data-testid={testId}
      className={`${SECTION_CLASS} ${divided ? '' : 'border-b-0 pb-0'}`}
    >
      <div className="flex h-[18px] items-center justify-between">
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
  variables,
  layoutX,
  layoutY,
  computed,
  onUpdate,
}: ElementFieldsProps<DesignElement> & {
  variables: Readonly<DesignVariables>;
  layoutX: number;
  layoutY: number;
  computed: boolean;
}) {
  return (
    <Section title="位置" testId="position-section">
      <div className="flex gap-2">
        <NumberField
          label="X"
          value={computed ? layoutX : resolvedCoordinate(element.x, variables)}
          disabled={computed}
          onChange={(value) => onUpdate({ x: value })}
        />
        <NumberField
          label="Y"
          value={computed ? layoutY : resolvedCoordinate(element.y, variables)}
          disabled={computed}
          onChange={(value) => onUpdate({ y: value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="旋转"
          prefix="R"
          value={numeric(element.rotation)}
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
  return (
    <div
      role="group"
      aria-label="布局"
      className="flex h-[34px] items-center gap-px rounded-lg bg-[#EDEDED] p-0.5"
    >
      {LAYOUT_MODES.map(({ value, label, testId, icon: Icon }) => {
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
            className={
              active
                ? `${SEGMENT_CLASS} ${SEGMENT_ACTIVE_CLASS}`
                : SEGMENT_CLASS
            }
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
  gap,
  disabled,
  onUpdate,
}: {
  justifyContent: FrameJustifyContent;
  gap: number;
  disabled: boolean;
  onUpdate: (patch: ElementPatch) => void;
}) {
  const distributed =
    justifyContent === 'space_between' || justifyContent === 'space_around';

  return (
    <div className="flex flex-col gap-1">
      {GAP_OPTIONS.map(({ value, label, testId }) => {
        const checked =
          value === 'fixed' ? !distributed : justifyContent === value;
        return (
          <div key={value} className="flex min-h-4 items-center gap-2">
            <label className={CHECKBOX_CLASS}>
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
              <span className={value === 'fixed' ? 'sr-only' : undefined}>
                {label}
              </span>
            </label>
            {value === 'fixed' ? (
              <div className="w-[42px] [&>label]:h-6 [&_input]:text-center">
                <NumberField
                  label="间距"
                  prefix={null}
                  value={gap}
                  min={0}
                  disabled={disabled || distributed}
                  onChange={(next) => onUpdate({ gap: next })}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FrameFields({ element, onUpdate }: ElementFieldsProps<FrameElement>) {
  const [showIndividualPadding, setShowIndividualPadding] = useState(false);
  const padding = paddingTuple(element.padding);
  const layout = element.layout ?? 'horizontal';
  const autoLayout = layout !== 'none';
  const direction = layout === 'none' ? 'horizontal' : layout;
  const activeCell = autoLayout
    ? frameAlignmentCell(direction, element)
    : undefined;

  const setPadding = (index: 0 | 1 | 2 | 3, value: number | undefined) => {
    if (value === undefined) {
      return;
    }
    const next = [...padding] as [number, number, number, number];
    next[index] = value;
    onUpdate({ padding: next });
  };

  return (
    <Section
      title="弹性布局"
      testId="layout-section"
      divided={false}
      action={
        <LayoutDashboard
          aria-hidden="true"
          size={14}
          className="text-[#777777]"
        />
      }
    >
      <LayoutModeControl layout={layout} onUpdate={onUpdate} />

      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[#666666]">对齐</span>
          <div className="grid h-[69px] grid-cols-3 overflow-hidden rounded-lg border border-[#E3E3E3] bg-[#F8F8F8]">
            {ALIGNMENT_MATRIX.map((cells) =>
              cells.map(({ row, column, label, testId }) => {
                const active =
                  activeCell?.row === row && activeCell.column === column;
                return (
                  <button
                    key={testId}
                    type="button"
                    data-testid={testId}
                    aria-label={`容器内${label}`}
                    aria-pressed={active}
                    disabled={!autoLayout}
                    onClick={() =>
                      onUpdate(frameAlignmentProps(direction, { row, column }))
                    }
                    className="flex cursor-pointer items-center justify-center disabled:cursor-not-allowed"
                  >
                    <span
                      className={
                        active
                          ? 'size-1.5 rounded-full bg-[#0066FF]'
                          : 'size-[3px] rounded-full bg-[#C9CDD3]'
                      }
                    />
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-medium text-[#666666]">间距</span>
          <GapControl
            justifyContent={element.justifyContent ?? 'start'}
            gap={numeric(element.gap)}
            disabled={!autoLayout}
            onUpdate={onUpdate}
          />
        </div>
      </div>

      <div className="mt-0.5 flex items-center justify-between">
        <span className={TITLE_CLASS}>内边距</span>
        <button
          type="button"
          aria-label="分别设置四边内边距"
          data-testid="padding-settings"
          aria-expanded={showIndividualPadding}
          onClick={() => setShowIndividualPadding(!showIndividualPadding)}
          className={SECTION_ACTION_CLASS}
        >
          <Settings size={14} />
        </button>
      </div>
      <div className="flex gap-2">
        <NumberField
          label="水平内边距"
          prefix={<PanelRight size={13} />}
          value={padding[1] === padding[3] ? padding[1] : undefined}
          min={0}
          onChange={(value) => {
            if (value !== undefined)
              onUpdate({ padding: [padding[0], value, padding[2], value] });
          }}
        />
        <NumberField
          label="垂直内边距"
          prefix={<PanelRight size={13} className="rotate-90" />}
          value={padding[0] === padding[2] ? padding[0] : undefined}
          min={0}
          onChange={(value) => {
            if (value !== undefined)
              onUpdate({ padding: [value, padding[1], value, padding[3]] });
          }}
        />
      </div>

      {showIndividualPadding
        ? PADDING_ROWS.map((row) => (
            <div key={row[0].label} className="flex gap-2">
              {row.map(({ index, label }) => (
                <NumberField
                  key={label}
                  label={label}
                  value={padding[index]}
                  min={0}
                  onChange={(next) => setPadding(index, next)}
                />
              ))}
            </div>
          ))
        : null}
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
  const width = elementDimension(element, 'width');
  const height = elementDimension(element, 'height');

  const setDimension = (axis: 'width' | 'height', value: unknown) => {
    if (element.type === 'text') {
      onUpdate({
        textStyle: { ...element.textStyle, [axis]: value },
      });
      return;
    }
    onUpdate({ [axis]: value });
  };

  const setMode = (axis: 'width' | 'height', mode: DimensionMode | null) => {
    const current = elementDimension(element, axis);
    const resolved = axis === 'width' ? resolvedWidth : resolvedHeight;
    setDimension(
      axis,
      mode === null ? fixedDimension(current, resolved) : mode,
    );
  };

  return (
    <>
      <div className="flex gap-2">
        <NumberField
          label="宽度"
          prefix="W"
          value={dimensionDisplayValue(width, resolvedWidth)}
          min={0}
          onChange={(value) => setDimension('width', value)}
        />
        <NumberField
          label="高度"
          prefix="H"
          value={dimensionDisplayValue(height, resolvedHeight)}
          min={0}
          onChange={(value) => setDimension('height', value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <CheckboxField
          label="填满宽度"
          testId="fill-width"
          checked={dimensionMode(width) === 'fill_container'}
          onChange={(checked) =>
            setMode('width', checked ? 'fill_container' : null)
          }
        />
        <CheckboxField
          label="填满高度"
          testId="fill-height"
          checked={dimensionMode(height) === 'fill_container'}
          onChange={(checked) =>
            setMode('height', checked ? 'fill_container' : null)
          }
        />
        <CheckboxField
          label="适应内容宽度"
          testId="hug-width"
          checked={dimensionMode(width) === 'fit_content'}
          onChange={(checked) =>
            setMode('width', checked ? 'fit_content' : null)
          }
        />
        <CheckboxField
          label="适应内容高度"
          testId="hug-height"
          checked={dimensionMode(height) === 'fit_content'}
          onChange={(checked) =>
            setMode('height', checked ? 'fit_content' : null)
          }
        />
      </div>
    </>
  );
}

function TextFields({ element, onUpdate }: ElementFieldsProps<TextElement>) {
  const updateStyle = (patch: Partial<TextElement['textStyle']>) => {
    onUpdate({ textStyle: { ...element.textStyle, ...patch } });
  };

  return (
    <Section title="文字" testId="text-section">
      <label className="flex flex-col gap-1 text-[11px] text-[#666666]">
        <span>文案</span>
        <textarea
          aria-label="文案"
          rows={3}
          value={element.textStyle.content}
          onChange={(event) => updateStyle({ content: event.target.value })}
          className="resize-none rounded-lg border border-[#E3E3E3] bg-[#F8F8F8] px-2 py-1.5 text-[12px] text-[#262626] outline-none"
        />
      </label>
      <div className="flex gap-2">
        <NumberField
          label="字号"
          value={numericOrUndefined(element.textStyle.fontSize)}
          min={1}
          onChange={(value) => updateStyle({ fontSize: value })}
        />
        <NumberField
          label="字重"
          value={numericOrUndefined(element.textStyle.fontWeight)}
          min={1}
          onChange={(value) => updateStyle({ fontWeight: value })}
        />
      </div>
      <label className={CONTROL_CLASS}>
        <span className="shrink-0">对齐</span>
        <select
          aria-label="文字对齐"
          value={element.textStyle.textAlign ?? 'left'}
          onChange={(event) =>
            updateStyle({
              textAlign: event.target
                .value as TextElement['textStyle']['textAlign'],
            })
          }
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

function IconFields({ element, onUpdate }: ElementFieldsProps<IconElement>) {
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

function PercentField({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  prefix?: string;
}) {
  return (
    <NumberField
      label={label}
      prefix={prefix ?? null}
      suffix={prefix === undefined ? '%' : undefined}
      value={Number(((value ?? 1) * 100).toFixed(10))}
      min={0}
      max={100}
      step="any"
      onChange={(next) => onChange(next === undefined ? undefined : next / 100)}
    />
  );
}

function PaintSection({
  title,
  testId,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  testId: string;
  onAdd: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <Section
      title={title}
      testId={testId}
      action={
        <button
          type="button"
          aria-label={`添加${title}`}
          data-testid={`${testId}-add`}
          disabled={children !== null}
          onClick={onAdd}
          className={SECTION_ACTION_CLASS}
        >
          <Plus size={13} />
        </button>
      }
    >
      {children === null ? null : (
        <div className="flex items-center">
          <div className="flex h-8 min-w-0 flex-1 items-stretch rounded-lg border border-[#E4E4E4] bg-[#F7F7F7] focus-within:border-ring [&>label:last-child]:h-full [&>label:last-child]:max-w-[72px] [&>label:last-child]:rounded-none [&>label:last-child]:border-0 [&>label:last-child]:border-l">
            {children}
          </div>
          <button
            type="button"
            aria-label={`移除${title}`}
            onClick={onRemove}
            className={SECTION_ACTION_CLASS}
          >
            <Minus size={13} />
          </button>
        </div>
      )}
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
            className={SECTION_ACTION_CLASS}
          >
            <Plus size={14} />
          </button>
        }
      />

      <Section title="导出" testId="export-section">
        <div className="flex gap-2">
          <label className={CONTROL_CLASS}>
            <select
              aria-label="导出倍率"
              data-testid="export-scale"
              disabled
              defaultValue="2x"
              className="w-full cursor-not-allowed bg-transparent text-[12px] text-[#171717] outline-none"
            >
              <option value="2x">2x</option>
            </select>
          </label>
          <label className={CONTROL_CLASS}>
            <select
              aria-label="导出格式"
              data-testid="export-format"
              disabled
              defaultValue="png"
              className="w-full cursor-not-allowed bg-transparent text-[12px] text-[#171717] outline-none"
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

function ElementActions({
  element,
  onAddChild,
  onDelete,
}: Pick<PropertiesPanelProps, 'element' | 'onAddChild' | 'onDelete'>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-3.5 py-2.5">
      <button
        type="button"
        data-testid="element-actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between text-[12px] text-[#171717]"
      >
        元素操作
        <ChevronDown size={14} className={open ? 'rotate-180' : undefined} />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          {element.type === 'frame' ? (
            <div className="flex flex-wrap gap-1.5">
              {CHILD_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onAddChild(type);
                  }}
                  className="cursor-pointer rounded border border-border bg-background px-2 py-1 text-[11px]"
                >
                  添加{ELEMENT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="cursor-pointer self-start rounded px-1 py-0.5 text-[12px] text-destructive hover:bg-accent"
            onClick={onDelete}
          >
            删除元素
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InspectorFields({
  document,
  element,
  onUpdate,
  onAlign,
  onAddChild,
  onDelete,
}: InspectorFieldsProps) {
  const layout = useMemo(() => layoutDesignDocument(document), [document]);
  const layoutNode = findLayoutNode(layout, element.id);
  const parentFrame = findElementParent(document, element.id);
  const parentUsesAutoLayout =
    parentFrame !== null && (parentFrame.layout ?? 'horizontal') !== 'none';
  const canAlign = parentFrame !== null && !parentUsesAutoLayout;
  const resolvedWidth = layoutNode?.box.width;
  const resolvedHeight = layoutNode?.box.height;

  return (
    <>
      <button
        type="button"
        data-testid="create-component"
        disabled
        className="flex h-10 shrink-0 cursor-not-allowed items-start gap-1.5 border-b border-[#E8E8E8] px-3.5 pt-2 text-[12px] font-medium text-[#171717]"
      >
        <DiamondPlus size={15} strokeWidth={2} />
        创建组件
      </button>

      <button
        type="button"
        data-testid="context-row"
        disabled
        className="flex h-11 w-full shrink-0 cursor-not-allowed items-center justify-between border-b border-[#E9E9E9] px-3.5 text-[12px] font-medium text-[#171717]"
      >
        <span>Context</span>
        <ChevronDown size={14} />
      </button>

      <AlignmentSection enabled={canAlign} onAlign={onAlign} />

      <PositionSection
        element={element}
        variables={document.variables}
        layoutX={layoutNode?.box.x ?? 0}
        layoutY={layoutNode?.box.y ?? 0}
        computed={parentUsesAutoLayout}
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
        {element.type === 'frame' ? (
          <CheckboxField
            label="裁剪内容"
            testId="clip-content"
            checked={element.clip === true}
            onChange={(checked) =>
              onUpdate({ clip: checked ? true : undefined })
            }
          />
        ) : null}
      </Section>

      <Section title="外观" testId="appearance-section">
        <div className="flex gap-2">
          <PercentField
            label="不透明度"
            prefix="%"
            value={numericOrUndefined(element.opacity)}
            onChange={(value) => onUpdate({ opacity: value })}
          />
          <NumberField
            label="圆角"
            prefix={<Square size={13} />}
            value={numeric(element.cornerRadius)}
            min={0}
            onChange={(value) => onUpdate({ cornerRadius: value })}
          />
        </div>
      </Section>

      <PaintSection
        title="填充"
        testId="fill-section"
        onAdd={() => onUpdate({ fill: [{ type: 'color', color: '#f3f4f6' }] })}
        onRemove={() => onUpdate({ fill: undefined })}
      >
        {element.fill === undefined ? null : (
          <>
            <ColorField
              label="填充颜色"
              value={colorFill(element.fill)?.color}
              onChange={(value) =>
                onUpdate({ fill: withFillColor(element.fill, value) })
              }
            />
            <PercentField
              label="填充透明度"
              value={numericOrUndefined(colorFill(element.fill)?.opacity)}
              onChange={(value) =>
                onUpdate({ fill: withFillOpacity(element.fill, value) })
              }
            />
          </>
        )}
      </PaintSection>

      <PaintSection
        title="描边"
        testId="stroke-section"
        onAdd={() =>
          onUpdate({
            stroke: { fill: [{ type: 'color', color: '#000000' }], width: 1 },
          })
        }
        onRemove={() => onUpdate({ stroke: undefined })}
      >
        {element.stroke === undefined ? null : (
          <>
            <ColorField
              label="描边颜色"
              value={strokeColor(element)}
              onChange={(value) =>
                onUpdate({ stroke: withStrokeColor(element, value) })
              }
            />
            <NumberField
              label="描边宽度"
              prefix={null}
              value={numeric(element.stroke.width, 1)}
              min={0}
              onChange={(value) =>
                onUpdate({
                  stroke: { ...element.stroke, width: value },
                })
              }
            />
          </>
        )}
      </PaintSection>

      {element.type === 'text' ? (
        <TextFields element={element} onUpdate={onUpdate} />
      ) : null}
      {element.type === 'icon' ? (
        <IconFields element={element} onUpdate={onUpdate} />
      ) : null}

      <DisabledSections />
      <ElementActions
        key={element.id}
        element={element}
        onAddChild={onAddChild}
        onDelete={onDelete}
      />
    </>
  );
}

export function PropertiesPanel({
  expanded,
  onToggle,
  ...fields
}: PropertiesPanelProps) {
  const contentId = useId();
  const { element } = fields;
  const label = elementLabel(element);
  const toggleLabel = expanded ? '折叠属性面板' : '展开属性面板';
  const ToggleIcon = expanded ? PanelRightClose : PanelRightOpen;

  return (
    <aside
      aria-label="属性面板"
      className={`pointer-events-auto absolute top-1 right-2 z-20 flex w-[var(--inspector-width)] flex-col overflow-hidden rounded-lg border border-[#ECEDEF] ${expanded ? 'bottom-2 bg-white shadow-[0_4px_18px_#00000014]' : 'bg-[#FAFAFA]'}`}
      data-testid="property-panel"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 py-2 pr-2 pl-3.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[#111111] [&>svg]:shrink-0">
          <ElementTypeIcon element={element} />
          <span className="truncate text-[13px] font-semibold" title={label}>
            {label}
          </span>
        </div>
        <button
          type="button"
          aria-label={toggleLabel}
          aria-expanded={expanded}
          aria-controls={expanded ? contentId : undefined}
          title={toggleLabel}
          onClick={onToggle}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEDEF]"
        >
          <ToggleIcon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <InspectorScrollArea id={contentId}>
          <InspectorFields {...fields} />
        </InspectorScrollArea>
      ) : null}
    </aside>
  );
}

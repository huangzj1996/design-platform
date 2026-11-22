import { findElement, type ElementPatch } from '@design-ai/editor-core';
import type {
  DesignDocument,
  DesignElement,
  ElementType,
  FrameElement,
} from '@design-ai/design-schema';
import type { ChangeEvent } from 'react';
import { ELEMENT_TYPE_LABELS } from './element-labels';

export interface PropertiesPanelProps {
  document: DesignDocument | null;
  selectionId: string | null;
  onUpdate: (patch: ElementPatch) => void;
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

interface ElementFieldsProps<T extends DesignElement> {
  element: T;
  onUpdate: (patch: ElementPatch) => void;
}

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : '#000000';
}

function numberValue(value: unknown): number | '' {
  return typeof value === 'number' ? value : '';
}

interface NumberFieldProps {
  label: string;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | undefined) => void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
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
    <label className="property-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={numberValue(value)}
        onChange={handleChange}
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
    <label className="property-field">
      <span>{label}</span>
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function CommonFields({
  element,
  onUpdate,
}: ElementFieldsProps<DesignElement>) {
  return (
    <>
      <label className="property-field">
        <span>填充颜色</span>
        <input
          type="color"
          aria-label="填充颜色"
          value={normalizeColor(element.fill)}
          onChange={(event) => onUpdate({ fill: event.target.value })}
        />
      </label>
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
    </>
  );
}

function SizeFields({ element, onUpdate }: ElementFieldsProps<DesignElement>) {
  return (
    <>
      <NumberField
        label="宽度"
        value={element.width}
        min={0}
        onChange={(value) => onUpdate({ width: value })}
      />
      <NumberField
        label="高度"
        value={element.height}
        min={0}
        onChange={(value) => onUpdate({ height: value })}
      />
    </>
  );
}

function TextFields({
  element,
  onUpdate,
}: ElementFieldsProps<Extract<DesignElement, { type: 'text' }>>) {
  return (
    <>
      <label className="property-field property-field-wide">
        <span>文案</span>
        <textarea
          aria-label="文案"
          rows={3}
          value={element.text}
          onChange={(event) => onUpdate({ text: event.target.value })}
        />
      </label>
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
      <label className="property-field">
        <span>对齐</span>
        <select
          aria-label="文字对齐"
          value={element.textAlign ?? 'left'}
          onChange={(event) => onUpdate({ textAlign: event.target.value })}
        >
          <option value="left">左对齐</option>
          <option value="center">居中</option>
          <option value="right">右对齐</option>
          <option value="justify">两端对齐</option>
        </select>
      </label>
    </>
  );
}

function FrameFields({ element, onUpdate }: ElementFieldsProps<FrameElement>) {
  const padding = element.padding ?? DEFAULT_PADDING;

  const setPadding = (index: number, value: number | undefined) => {
    if (value === undefined) {
      return;
    }
    const next = [...padding] as [number, number, number, number];
    next[index] = value;
    onUpdate({ padding: next });
  };

  return (
    <>
      <label className="property-field">
        <span>布局</span>
        <select
          aria-label="布局"
          value={element.layout ?? 'horizontal'}
          onChange={(event) => onUpdate({ layout: event.target.value })}
        >
          <option value="horizontal">横排</option>
          <option value="vertical">竖排</option>
          <option value="none">自由定位</option>
        </select>
      </label>
      <NumberField
        label="间距"
        value={element.gap}
        min={0}
        onChange={(value) => onUpdate({ gap: value })}
      />
      {padding.map((value, index) => (
        <NumberField
          key={PADDING_LABELS[index]}
          label={PADDING_LABELS[index] ?? `内边距${index}`}
          value={value}
          min={0}
          onChange={(next) => setPadding(index, next)}
        />
      ))}
    </>
  );
}

function IconFields({
  element,
  onUpdate,
}: ElementFieldsProps<Extract<DesignElement, { type: 'icon' }>>) {
  return (
    <>
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
    </>
  );
}

export function PropertiesPanel({
  document,
  selectionId,
  onUpdate,
  onAddChild,
  onDelete,
}: PropertiesPanelProps) {
  const element =
    document === null || selectionId === null
      ? undefined
      : findElement(document, selectionId);

  if (element === undefined) {
    return (
      <aside className="properties-panel" data-testid="property-panel">
        <h2>属性</h2>
        <p className="panel-empty">未选择元素</p>
      </aside>
    );
  }

  return (
    <aside className="properties-panel" data-testid="property-panel">
      <h2>属性</h2>
      <p className="property-summary">
        <span className="layer-type">{ELEMENT_TYPE_LABELS[element.type]}</span>
        <code>{element.id}</code>
      </p>

      <div className="property-fields">
        {element.type === 'text' ? (
          <TextFields element={element} onUpdate={onUpdate} />
        ) : null}
        {element.type === 'frame' ? (
          <FrameFields element={element} onUpdate={onUpdate} />
        ) : null}
        {element.type === 'icon' ? (
          <IconFields element={element} onUpdate={onUpdate} />
        ) : null}

        <SizeFields element={element} onUpdate={onUpdate} />
        <CommonFields element={element} onUpdate={onUpdate} />

        <label className="property-field property-field-inline">
          <span>可见</span>
          <input
            type="checkbox"
            aria-label="可见"
            checked={element.visible !== false}
            onChange={(event) => {
              const visible = event.target.checked;
              onUpdate({ visible: visible ? undefined : false });
            }}
          />
        </label>
      </div>

      {element.type === 'frame' ? (
        <div className="child-actions">
          <h3>添加子元素</h3>
          <div className="button-row">
            {CHILD_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => onAddChild(type)}>
                添加{ELEMENT_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button type="button" className="danger-button" onClick={onDelete}>
        删除元素
      </button>
    </aside>
  );
}

import type { ElementType } from '@design-ai/design-schema';
import {
  ChevronDown,
  Circle,
  Frame,
  Hand,
  MousePointer2,
  Sparkles,
  Square,
  Triangle,
  Type,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

export type CanvasTool = 'pointer' | 'hand';

export interface CanvasToolbarProps {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onCreate: (type: ElementType) => void;
}

const RAIL_BUTTON =
  'flex h-7 w-full cursor-pointer items-center justify-center rounded-lg text-[#242424] transition-colors hover:bg-[#F7F8FA]';
const ACTIVE_BUTTON =
  'border border-[#E5E7EB] bg-[#F7F8FA] shadow-[0_1px_4px_#1118270D]';

interface ToolButtonProps {
  /** Present for mode buttons; omitted by one-shot creation actions. */
  active?: boolean;
  label: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({
  active,
  label,
  testId,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={`${RAIL_BUTTON} ${active ? ACTIVE_BUTTON : ''}`}
    >
      {children}
    </button>
  );
}

interface ShapeMenuItem {
  /** Null for the unsupported polygon entry, which renders disabled. */
  type: ElementType | null;
  label: string;
  testId: string;
  icon: ReactNode;
}

const SHAPE_MENU_ITEMS: readonly ShapeMenuItem[] = [
  {
    type: 'rectangle',
    label: '矩形',
    testId: 'shape-rectangle',
    icon: <Square size={18} strokeWidth={2} />,
  },
  {
    type: 'ellipse',
    label: '椭圆',
    testId: 'shape-ellipse',
    icon: <Circle size={18} strokeWidth={2} />,
  },
  {
    type: null,
    label: '多边形',
    testId: 'shape-polygon',
    icon: <Triangle size={18} strokeWidth={2} />,
  },
  {
    type: 'icon',
    label: '图标',
    testId: 'shape-icon',
    icon: <Sparkles size={18} strokeWidth={2} />,
  },
];

/**
 * Floating canvas tool rail from the Pencil editor reference. Shape buttons
 * create through the shared default-element action; the chevron opens the
 * shape menu, where the unsupported polygon entry stays disabled.
 */
export function CanvasToolbar({
  tool,
  onToolChange,
  onCreate,
}: CanvasToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const create = (type: ElementType) => {
    setMenuOpen(false);
    onCreate(type);
  };

  return (
    <div className="absolute top-1/2 left-3 z-10 -translate-y-1/2">
      <div className="relative">
        <div
          data-testid="tool-rail"
          className="flex w-11 flex-col gap-1.5 rounded-2xl border border-[#E5E7EB] bg-white px-1.5 py-2 shadow-[0_4px_16px_#11182712]"
        >
          <ToolButton
            active={tool === 'pointer'}
            label="选择工具"
            testId="tool-pointer"
            onClick={() => {
              setMenuOpen(false);
              onToolChange('pointer');
            }}
          >
            <MousePointer2 size={16} strokeWidth={2} />
          </ToolButton>
          <ToolButton
            label="矩形工具"
            testId="tool-rectangle"
            onClick={() => create('rectangle')}
          >
            <Square size={16} strokeWidth={2} />
          </ToolButton>
          <button
            type="button"
            aria-label="形状菜单"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="形状菜单"
            data-testid="tool-expand"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-4 w-full cursor-pointer items-center justify-center rounded-md text-[#242424] transition-colors hover:bg-[#F7F8FA]"
          >
            <ChevronDown
              size={14}
              strokeWidth={2}
              className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <ToolButton
            label="文字工具"
            testId="tool-text"
            onClick={() => create('text')}
          >
            <Type size={16} strokeWidth={2} />
          </ToolButton>
          <ToolButton
            label="容器工具"
            testId="tool-frame"
            onClick={() => create('frame')}
          >
            <Frame size={16} strokeWidth={2} />
          </ToolButton>
          <ToolButton
            active={tool === 'hand'}
            label="手形工具"
            testId="tool-hand"
            onClick={() => {
              setMenuOpen(false);
              onToolChange('hand');
            }}
          >
            <Hand size={16} strokeWidth={2} />
          </ToolButton>
        </div>

        {menuOpen ? (
          <div
            role="menu"
            aria-label="形状"
            data-testid="shape-menu"
            className="absolute top-[76px] left-[49px] flex w-[180px] flex-col gap-1.5 rounded-[18px] border border-[#E7E9EE] bg-white p-4 shadow-[0_8px_28px_#00000012]"
          >
            {SHAPE_MENU_ITEMS.map((item) => (
              <button
                key={item.testId}
                type="button"
                role="menuitem"
                disabled={item.type === null}
                data-testid={item.testId}
                onClick={() => {
                  if (item.type !== null) {
                    create(item.type);
                  }
                }}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-1 text-left text-[14px] text-[#26272B] transition-colors hover:bg-[#F6F6F6] disabled:cursor-not-allowed disabled:text-[#C2C3C9]"
              >
                <span className="flex shrink-0 items-center text-[#7A808D] group-disabled:text-[#C2C3C9]">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

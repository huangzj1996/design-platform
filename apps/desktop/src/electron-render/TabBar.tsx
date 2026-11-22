import { Folder, House, LoaderCircle, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { HOME_TAB_ID, type ProjectTab } from './workspace';

export interface TabBarProps {
  activeTabId: string;
  projects: ProjectTab[];
  /** An open or create request is in flight; the add action waits. */
  busy: boolean;
  onSelectHome: () => void;
  onSelectProject: (projectId: string) => void;
  onCreate: () => void;
}

interface TabButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  unsaved?: boolean;
  onClick: () => void;
}

function TabButton({
  active,
  icon,
  label,
  unsaved = false,
  onClick,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-6 max-w-[220px] cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-[#EDEEF0] text-[#1A1A1A]'
          : 'text-[#9A9AA2] hover:bg-[#F4F4F5]'
      }`}
    >
      <span
        className={`flex shrink-0 items-center ${
          active ? 'text-[#6E6E76]' : 'text-[#9A9AA2]'
        }`}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {unsaved ? (
        <span
          aria-label="有未保存的修改"
          data-testid="tab-unsaved"
          className="size-1.5 shrink-0 rounded-full bg-[#C2C3C9]"
        />
      ) : null}
    </button>
  );
}

/** Shared top tab bar for the home page and every open design. */
export function TabBar({
  activeTabId,
  projects,
  busy,
  onSelectHome,
  onSelectProject,
  onCreate,
}: TabBarProps) {
  return (
    <nav
      data-testid="tab-bar"
      className="flex h-8 items-center rounded-2xl border border-[#ECEDEF] bg-white px-1.5 shadow-[0_1px_3px_#0000000F]"
    >
      <div
        role="tablist"
        aria-label="项目标签"
        className="flex items-center gap-0.5"
      >
        <TabButton
          active={activeTabId === HOME_TAB_ID}
          icon={<House size={14} strokeWidth={2} />}
          label="主页"
          onClick={onSelectHome}
        />
        {projects.map((project) => (
          <TabButton
            key={project.id}
            active={activeTabId === project.id}
            icon={<Folder size={13} strokeWidth={2} />}
            label={project.label}
            unsaved={
              project.state.dirty || project.state.saveStatus === 'error'
            }
            onClick={() => onSelectProject(project.id)}
          />
        ))}
      </div>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#E7E8EA]" />
      <button
        type="button"
        aria-label="新建设计稿"
        title="新建设计稿"
        data-testid="tab-create"
        disabled={busy}
        onClick={onCreate}
        className="flex h-6 cursor-pointer items-center rounded-lg px-2 text-[#9A9AA2] transition-colors hover:bg-[#F4F4F5] hover:text-[#1A1A1A] disabled:cursor-progress disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : (
          <Plus size={14} strokeWidth={2} />
        )}
      </button>
    </nav>
  );
}

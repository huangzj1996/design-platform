import {
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  List,
  LoaderCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { projectFileName, projectPath, type ProjectTab } from './workspace';

type BrowseCategory = 'files' | 'recent';
type ViewMode = 'grid' | 'list';

export interface HomeProps {
  projects: ProjectTab[];
  opening: boolean;
  creating: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onSelectProject: (projectId: string) => void;
}

interface CategoryTabProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function categoryTabClassName(active: boolean, disabled: boolean): string {
  if (active) {
    return 'cursor-pointer bg-[#E7E8EB] font-medium text-[#1A1A1A]';
  }
  if (disabled) {
    return 'cursor-not-allowed text-[#C2C3C9]';
  }
  return 'cursor-pointer text-[#8A8C93] hover:bg-[#EDEEF0]';
}

function CategoryTab({
  label,
  active = false,
  disabled = false,
  onClick,
}: CategoryTabProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[30px] items-center rounded-[10px] px-3 text-[13px] transition-colors ${categoryTabClassName(
        active,
        disabled,
      )}`}
    >
      {label}
    </button>
  );
}

interface ViewButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ViewButton({ label, active, onClick, children }: ViewButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-6 w-7 cursor-pointer items-center justify-center rounded-[7px] transition-colors ${
        active
          ? 'bg-[#E7E8EB] text-[#1A1A1A]'
          : 'text-[#9A9AA2] hover:text-[#1A1A1A]'
      }`}
    >
      {children}
    </button>
  );
}

interface EmptyStateProps {
  opening: boolean;
  creating: boolean;
  onOpen: () => void;
  onCreate: () => void;
}

function EmptyState({ opening, creating, onOpen, onCreate }: EmptyStateProps) {
  const busy = opening || creating;
  return (
    <section
      data-testid="home-empty"
      className="grid min-h-0 flex-1 place-items-center py-8"
    >
      <div className="w-full max-w-[560px] rounded-[14px] border border-[#ECEDEF] bg-white px-10 py-12 text-center shadow-[0_1px_2px_#00000008]">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#F6F6F6] text-[#9A9AA2]">
          <FilePlus2 size={24} strokeWidth={1.8} />
        </div>
        <h1 className="mt-6 text-[20px] font-semibold text-[#1A1A1A]">
          还没有设计稿
        </h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[13px] leading-6 text-[#8A8C93]">
          打开 JSON 设计稿、导入 Pencil
          设计稿，或新建一份空白设计稿，开始你的设计。
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            type="button"
            data-testid="home-open"
            disabled={busy}
            onClick={onOpen}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#1A1A1A] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-progress disabled:opacity-60"
          >
            {opening ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : null}
            {opening ? '正在打开…' : '打开设计稿'}
          </button>
          <button
            type="button"
            data-testid="home-create"
            disabled={busy}
            onClick={onCreate}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#E7E8EA] bg-white px-4 text-[13px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#F6F6F6] disabled:cursor-progress disabled:opacity-60"
          >
            {creating ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : null}
            {creating ? '正在新建…' : '新建设计稿'}
          </button>
        </div>
        <button
          type="button"
          data-testid="home-import"
          disabled={busy}
          onClick={onOpen}
          className="mt-4 cursor-pointer text-[12px] text-[#8A8C93] underline-offset-4 transition-colors hover:text-[#1A1A1A] hover:underline disabled:cursor-progress disabled:opacity-60"
        >
          导入 Pencil 设计稿
        </button>
      </div>
    </section>
  );
}

interface ProjectListProps {
  projects: ProjectTab[];
  view: ViewMode;
  opening: boolean;
  onOpen: () => void;
  onSelectProject: (projectId: string) => void;
}

function ProjectList({
  projects,
  view,
  opening,
  onOpen,
  onSelectProject,
}: ProjectListProps) {
  return (
    <section aria-label="打开的项目" className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-[#1A1A1A]">打开的项目</h1>
        <button
          type="button"
          data-testid="home-open"
          disabled={opening}
          onClick={onOpen}
          className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#1A1A1A] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-progress disabled:opacity-60"
        >
          {opening ? <LoaderCircle size={14} className="animate-spin" /> : null}
          {opening ? '正在打开…' : '打开设计稿'}
        </button>
      </div>
      <div
        className={
          view === 'grid'
            ? 'mt-4 grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4'
            : 'mt-4 flex flex-col gap-2'
        }
      >
        {projects.map((project) => {
          const name = projectFileName(project) ?? project.label;
          const detail = projectPath(project) ?? '尚未保存';
          return (
            <button
              key={project.id}
              type="button"
              data-testid="home-project"
              data-project-id={project.id}
              onClick={() => onSelectProject(project.id)}
              className={`group cursor-pointer border border-[#ECEDEF] bg-white text-left transition-colors hover:border-[#D8DADD] ${
                view === 'grid'
                  ? 'rounded-[14px] p-3'
                  : 'flex items-center gap-4 rounded-[12px] px-4 py-3'
              }`}
            >
              <span
                className={`flex items-center justify-center bg-[#F7F8F9] text-[#A0A2A8] ${
                  view === 'grid'
                    ? 'h-[104px] w-full rounded-[10px]'
                    : 'size-10 shrink-0 rounded-[8px]'
                }`}
              >
                <FolderOpen
                  size={view === 'grid' ? 22 : 16}
                  strokeWidth={1.6}
                />
              </span>
              <span
                className={`block ${
                  view === 'grid' ? 'mt-3' : 'min-w-0 flex-1'
                }`}
              >
                <span className="block truncate text-[13px] font-semibold text-[#1A1A1A]">
                  {name}
                </span>
                <span className="mt-1 block truncate text-[12px] text-[#9A9AA2]">
                  {detail}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Home page shell: browse controls, empty state or open projects. */
export function Home({
  projects,
  opening,
  creating,
  onOpen,
  onCreate,
  onSelectProject,
}: HomeProps) {
  const [category, setCategory] = useState<BrowseCategory>('recent');
  const [view, setView] = useState<ViewMode>('grid');

  return (
    <main
      data-testid="home"
      className="flex min-h-0 flex-1 flex-col gap-[22px] bg-[#F6F6F6] px-8 py-7"
    >
      <div className="flex h-8 shrink-0 items-center justify-between">
        <div
          role="group"
          aria-label="浏览范围"
          className="flex items-center gap-1"
        >
          <CategoryTab
            label="文件"
            active={category === 'files'}
            onClick={() => setCategory('files')}
          />
          <CategoryTab
            label="最近使用"
            active={category === 'recent'}
            onClick={() => setCategory('recent')}
          />
          <CategoryTab label="草稿" disabled />
          <CategoryTab label="设计系统" disabled />
        </div>
        <div
          role="group"
          aria-label="视图"
          className="flex items-center gap-[2px] rounded-[10px] bg-white p-[3px]"
        >
          <ViewButton
            label="网格视图"
            active={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <LayoutGrid size={14} strokeWidth={2} />
          </ViewButton>
          <ViewButton
            label="列表视图"
            active={view === 'list'}
            onClick={() => setView('list')}
          >
            <List size={14} strokeWidth={2} />
          </ViewButton>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          opening={opening}
          creating={creating}
          onOpen={onOpen}
          onCreate={onCreate}
        />
      ) : (
        <ProjectList
          projects={projects}
          view={view}
          opening={opening}
          onOpen={onOpen}
          onSelectProject={onSelectProject}
        />
      )}
    </main>
  );
}

import {
  FilePlus2,
  Folder,
  LayoutGrid,
  List,
  LoaderCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { SessionProject } from '../electron-preload/contract';
import {
  formatOpenedAt,
  sortRecords,
  splitFilePath,
  type BrowseCategory,
} from './home-records';

type ViewMode = 'grid' | 'list';

export interface HomeProps {
  /** Designs the user can reopen, most recently opened first. */
  records: SessionProject[];
  opening: boolean;
  creating: boolean;
  onOpen: () => void;
  onCreate: () => void;
  onOpenRecord: (filePath: string) => void;
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

/** Decorative page thumbnails standing in for a file preview. */
function FilePreview() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[214px] w-full shrink-0 overflow-hidden bg-[#F7F8F9]"
    >
      <span className="absolute left-1/2 top-1/2 block h-[170px] w-[278px] -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-0 top-0 block h-[92px] w-[150px] rounded-[6px] bg-white" />
        <span className="absolute left-[12px] top-[12px] block h-[6px] w-[52px] rounded-[3px] bg-[#D8DADE]" />
        <span className="absolute left-[12px] top-[24px] block h-[4px] w-[88px] rounded-[2px] bg-[#EDEEF0]" />
        <span className="absolute left-[162px] top-0 block h-[92px] w-[116px] rounded-[6px] bg-white" />
        <span className="absolute left-[174px] top-[12px] block h-[6px] w-[52px] rounded-[3px] bg-[#D8DADE]" />
        <span className="absolute left-[174px] top-[24px] block h-[4px] w-[88px] rounded-[2px] bg-[#EDEEF0]" />
        <span className="absolute left-0 top-[104px] block h-[66px] w-[124px] rounded-[6px] bg-white" />
        <span className="absolute left-[12px] top-[116px] block h-[6px] w-[52px] rounded-[3px] bg-[#D8DADE]" />
        <span className="absolute left-[12px] top-[128px] block h-[4px] w-[88px] rounded-[2px] bg-[#EDEEF0]" />
        <span className="absolute left-[136px] top-[104px] block h-[66px] w-[60px] rounded-[6px] bg-white" />
        <span className="absolute left-[144px] top-[112px] block h-[50px] w-[44px] rounded-[4px] bg-[#111111]" />
      </span>
    </span>
  );
}

interface RecordMetaProps {
  record: SessionProject;
  now: Date;
}

/** File name, directory and last open time shared by both views. */
function RecordMeta({ record, now }: RecordMetaProps) {
  const { directory, fileName } = splitFilePath(record.filePath);
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <Folder
          aria-hidden="true"
          size={13}
          strokeWidth={1.8}
          className="shrink-0 text-[#A0A2A8]"
        />
        {directory === null ? null : (
          <span className="truncate text-[12px] text-[#9A9AA2]">
            {directory} /
          </span>
        )}
        <span className="truncate text-[13px] font-semibold text-[#1A1A1A]">
          {fileName}
        </span>
      </span>
      <span className="text-[12px] text-[#9A9AA2]">
        打开于 {formatOpenedAt(record.openedAt, now)}
      </span>
    </>
  );
}

interface RecordCardProps {
  record: SessionProject;
  view: ViewMode;
  now: Date;
  busy: boolean;
  onOpenRecord: (filePath: string) => void;
}

function RecordCard({
  record,
  view,
  now,
  busy,
  onOpenRecord,
}: RecordCardProps) {
  return (
    <button
      type="button"
      data-testid="home-project"
      data-file-path={record.filePath}
      title={record.filePath}
      disabled={busy}
      onClick={() => onOpenRecord(record.filePath)}
      className={`min-w-0 cursor-pointer border border-[#ECEDEF] bg-white text-left transition-colors hover:border-[#D8DADD] disabled:cursor-progress disabled:opacity-60 ${
        view === 'grid'
          ? 'flex h-[300px] flex-col overflow-hidden rounded-[14px]'
          : 'flex items-center gap-4 rounded-[12px] px-4 py-3'
      }`}
    >
      {view === 'grid' ? (
        <FilePreview />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[#F7F8F9] text-[#A0A2A8]"
        >
          <Folder size={16} strokeWidth={1.6} />
        </span>
      )}
      <span
        className={
          view === 'grid'
            ? 'flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-3.5'
            : 'flex min-w-0 flex-1 flex-col gap-1'
        }
      >
        <RecordMeta record={record} now={now} />
      </span>
    </button>
  );
}

interface RecordListProps {
  records: SessionProject[];
  view: ViewMode;
  now: Date;
  busy: boolean;
  onOpenRecord: (filePath: string) => void;
}

function RecordList({
  records,
  view,
  now,
  busy,
  onOpenRecord,
}: RecordListProps) {
  return (
    <section
      aria-label="设计稿记录"
      className="min-h-0 flex-1 overflow-auto"
      data-testid="home-records"
    >
      <div
        className={
          view === 'grid'
            ? 'grid grid-cols-2 content-start gap-5 lg:grid-cols-3 2xl:grid-cols-4'
            : 'flex flex-col gap-2'
        }
      >
        {records.map((record) => (
          <RecordCard
            key={record.filePath}
            record={record}
            view={view}
            now={now}
            busy={busy}
            onOpenRecord={onOpenRecord}
          />
        ))}
      </div>
    </section>
  );
}

/** Home page shell: browse controls and the actual design records. */
export function Home({
  records,
  opening,
  creating,
  onOpen,
  onCreate,
  onOpenRecord,
}: HomeProps) {
  const [category, setCategory] = useState<BrowseCategory>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const busy = opening || creating;
  const now = new Date();
  const sorted = sortRecords(records, category);

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="home-open"
            disabled={busy}
            onClick={onOpen}
            className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#1A1A1A] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#333333] disabled:cursor-progress disabled:opacity-60"
          >
            {opening ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : null}
            {opening ? '正在打开…' : '打开设计稿'}
          </button>
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
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          opening={opening}
          creating={creating}
          onOpen={onOpen}
          onCreate={onCreate}
        />
      ) : (
        <RecordList
          records={sorted}
          view={view}
          now={now}
          busy={busy}
          onOpenRecord={onOpenRecord}
        />
      )}
    </main>
  );
}

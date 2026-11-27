import { ArrowUp, ChevronDown, Zap } from 'lucide-react';

export function PromptDock() {
  return (
    <section
      aria-label="提示词面板"
      className="flex h-[105px] shrink-0 flex-col justify-between rounded-2xl border border-[#ECECEE] bg-white p-2.5 shadow-[0_6px_24px_#00000012]"
    >
      <textarea
        aria-label="设计提示词"
        placeholder="Design anything..."
        className="min-h-0 w-full flex-1 resize-none rounded-sm bg-transparent text-sm text-[#1A1A1A] placeholder:text-[#6C6C72]"
      />
      <div className="mt-2 flex h-6 shrink-0 items-center justify-between">
        <button
          type="button"
          disabled
          aria-label="加速 6 倍"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#FF8B1F]"
        >
          <Zap size={14} strokeWidth={1.5} aria-hidden="true" />
          6x
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-label="选择模型，当前为 GPT 5.5"
            className="inline-flex items-center gap-1.5 text-xs font-light text-[#5E5F67]"
          >
            GPT 5.5
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled
            aria-label="发送提示词"
            className="flex size-[22px] items-center justify-center rounded-full bg-[#F1F2F4] text-[#B7B8BF]"
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

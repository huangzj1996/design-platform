# Coding Standards

## 仓库结构

- `apps/desktop` 是 Electron Forge 和 Vite 桌面应用。复用现有的进程入口和模块边界。
- 优先复用 `packages/design-schema` 和 `packages/editor-core` 已有的类型与行为，保持工作区调用方兼容。
- 探索代码前查阅 `AGENTS.md`、`docs/agents/domain.md` 和 `GLOSSARY.md`。涉及工单时遵循 `docs/agents/issue-tracker.md` 与 `docs/agents/triage-labels.md`。

## 格式与验证

- 使用仓库配置的 Prettier 和 ESLint。桌面包使用它自己的 Oxlint 和 Oxfmt 配置。
- 在工作区根目录用 `pnpm typecheck` 检查类型，用 `pnpm lint` 检查代码。运行受影响包已有的相关测试，并记录检查结果。
- 依据工单验收标准审查变更，保留与工单无关的行为。提交使用现有的 `fix:`、`feat:` 或 `chore:` 风格。

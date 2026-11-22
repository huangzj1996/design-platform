# 仓库指南

## 项目结构

- `apps/desktop` ：基于 Electron Forge 和 Vite 的桌面应用。
- `packages/design-schema` ：
- `packages/editor-core` ：

## UI 原型

实现或修改 UI 前，必须使用 Pencil MCP 读取 `design-ai.pen` 中对应的画板，并依据原型实现。

## Agent skills

### Issue tracker

读取、创建或更新工单前，参阅 `docs/agents/issue-tracker.md`。工单使用 GitHub Issues。

### Triage labels

评估工单或更新分诊状态时，参阅 `docs/agents/triage-labels.md`。

### Domain docs

探索代码或讨论领域概念前，参阅 `docs/agents/domain.md`。本仓库采用单上下文布局。

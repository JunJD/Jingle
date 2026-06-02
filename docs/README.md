# Openwork 文档分类

这个目录里的文档先按用途分类，不移动原文件，避免破坏已有相对链接。

## 调研类

用于方向判断、方案选型、产品/技术差距分析、上线前审计。

| 文档 | 用途 |
|---|---|
| [ai-launcher-intent-recognition-research.md](./ai-launcher-intent-recognition-research.md) | Electron 端侧 AI 启动器意图识别模型选型、推理栈、微调和落地调研 |
| [openwork-native-readiness-audit.md](./openwork-native-readiness-audit.md) | Openwork 原生化上线条件、P1/P2 风险和修复分组审计 |
| [windows-support-gap-audit.md](./windows-support-gap-audit.md) | Windows 支持现状、缺口和优先补齐路径审计 |
| [model-provider-design.md](./model-provider-design.md) | 模型 provider 设计调研与方案说明 |
| [product-narrative.md](./product-narrative.md) | 产品叙事、定位和体验方向背景 |
| [personal-agent-memory-product-plan.md](./personal-agent-memory-product-plan.md) | 个人 Agent 记忆 V1 产品方案：定位、范围、设置、交互和验收 |
| [personal-agent-memory-technical-overview.md](./personal-agent-memory-technical-overview.md) | 个人 Agent 记忆 V1 技术概要：边界、middleware、数据模型、UI 状态和验证 |
| [ag-ui-thread-projection-architecture.md](./ag-ui-thread-projection-architecture.md) | AG UI thread projection 架构调研与方案说明 |
| [renderer-external-store-architecture.md](./renderer-external-store-architecture.md) | renderer external store 架构方案说明 |
| [extension-hitl-experience-architecture.md](./extension-hitl-experience-architecture.md) | Extension HITL 体验优化架构方案：schema form、confirmation、editable approval 和 CopilotKit 借鉴 |
| [extension-hitl-experience-detailed-design-cn.md](./extension-hitl-experience-detailed-design-cn.md) | Extension HITL 体验优化中文详设：协议、状态机、UI、main 侧校验、分期和验收 |
| [extension-external-install-packaging-research-cn.md](./extension-external-install-packaging-research-cn.md) | Extension 外部安装、外部打包、pkg/Node SEA 取舍和 Openwork 推荐落地方案 |

## 约束类

用于任务执行过程中的边界约束、迁移计划、实现顺序、验证方式和调试流程。

| 文档 | 用途 |
|---|---|
| [task-parallelization-and-conflict-plan.md](./task-parallelization-and-conflict-plan.md) | 并行任务拆分、冲突边界、Paperclip 任务树和验收口径 |
| [engineering-boundaries.md](./engineering-boundaries.md) | 工程边界、模块职责和实现约束 |
| [runtime-invariants.md](./runtime-invariants.md) | 运行时不变量和执行过程必须保持的系统约束 |
| [extension-runtime-migration-plan.md](./extension-runtime-migration-plan.md) | extension runtime 迁移执行计划 |
| [tsyringe-migration-roadmap.md](./tsyringe-migration-roadmap.md) | tsyringe 迁移路线和执行约束 |
| [history-shell-store-roadmap.md](./history-shell-store-roadmap.md) | history shell store 后续演进路线 |
| [history-shell-store-cleanups.md](./history-shell-store-cleanups.md) | history shell store 清理任务和执行顺序 |
| [artifact-tab-roadmap.md](./artifact-tab-roadmap.md) | artifact tab 演进计划 |
| [openwork-electron-debugging.md](./openwork-electron-debugging.md) | Electron 调试流程和本地验证约束 |

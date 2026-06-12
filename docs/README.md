# Openwork 文档索引

这个目录按用途索引当前仍有维护价值的文档。已经被现有架构取代的旧路线图不保留在索引里，避免后续实现继续跟着旧概念走。

## 新开发者阅读顺序

首次接手 Openwork extension/runtime 时，按下面顺序读，不需要依赖历史 issue 或会议上下文：

1. [engineering-boundaries.md](./engineering-boundaries.md) 和 [runtime-invariants.md](./runtime-invariants.md)：先建立模块边界、依赖方向和运行时不变量。
2. [extension-package-contract.md](./extension-package-contract.md)：理解 built-in / installable extension package 应该暴露哪些入口，以及宿主如何检查边界。
3. [extension-runtime-migration-plan.md](./extension-runtime-migration-plan.md)：理解 launcher command runtime 的当前主路径、代码入口和验收方式。
4. [extension-connector-runtime-design.md](./extension-connector-runtime-design.md)：理解 command、AI capability、connection、`@extension` 和 `loadExtension` 如何共用同一套连接语义。
5. [extension-migration-transform-architecture-cn.md](./extension-migration-transform-architecture-cn.md)：理解 Raycast extension 迁移器的 transform pipeline、生成物和验收矩阵。
6. [raycast-notion-dependency-migration-preview.md](./raycast-notion-dependency-migration-preview.md)：只在维护 Notion 或迁移器时阅读，重点看正式 `installable-extensions/notion` 状态和历史 preview 证据的边界。

读完前五篇，应该能回答三件事：一个 extension package 的事实来源在哪里，command 和 AI tool 为什么共享 connection，以及迁移脚本生成的 package 需要通过哪些 contract 检查。

## 当前工程合同

这些文档是改代码时优先对齐的主文档。

| 文档 | 用途 |
|---|---|
| [engineering-boundaries.md](./engineering-boundaries.md) | 工程边界、模块职责、依赖方向和实现约束 |
| [runtime-invariants.md](./runtime-invariants.md) | 运行时不变量和执行过程必须保持的系统约束 |
| [extension-package-contract.md](./extension-package-contract.md) | built-in / installable extension package 的目录、manifest/main/runtime/runtime-metadata/tools 边界 |
| [extension-runtime-migration-plan.md](./extension-runtime-migration-plan.md) | extension command runtime 迁移执行计划和验收口径 |
| [extension-migration-transform-architecture-cn.md](./extension-migration-transform-architecture-cn.md) | Raycast extension 迁移脚本的 transform 分层、fixtures 和生成物验收 |
| [raycast-notion-dependency-migration-preview.md](./raycast-notion-dependency-migration-preview.md) | Notion 迁移状态、正式 `installable-extensions/notion` 入口和历史 preview 兼容记录 |
| [extension-auth-connection-architecture-cn.md](./extension-auth-connection-architecture-cn.md) | extension connection/auth 长期架构和 OAuth 缺口 |
| [extension-connector-runtime-design.md](./extension-connector-runtime-design.md) | command、AI capability、connection、`@extension` / `loadExtension` 的统一运行时边界 |

## Extension 运行时与体验

| 文档 | 用途 |
|---|---|
| [extension-runtime-architecture-research-cn.md](./extension-runtime-architecture-research-cn.md) | extension runtime 隔离、remote rendering、搜索生命周期和外部包参考 |
| [extension-external-install-packaging-research-cn.md](./extension-external-install-packaging-research-cn.md) | Extension 外部安装、外部打包、pkg/Node SEA 取舍和 Openwork 推荐落地方案 |
| [extension-hitl-experience-architecture.md](./extension-hitl-experience-architecture.md) | Extension HITL 体验优化架构方案：schema form、confirmation、editable approval 和 CopilotKit 借鉴 |
| [extension-hitl-experience-detailed-design-cn.md](./extension-hitl-experience-detailed-design-cn.md) | Extension HITL 中文详设：协议、状态机、UI、main 侧校验、分期和验收 |

## 产品与市场调研

| 文档 | 用途 |
|---|---|
| [product-narrative.md](./product-narrative.md) | 产品叙事、定位和体验方向背景 |
| [harness-engineering-dimensions-research-cn.md](./harness-engineering-dimensions-research-cn.md) | Harness 工程维度、Raycast 交互层和 delegated work 的产品判断 |
| [ai-launcher-intent-recognition-research.md](./ai-launcher-intent-recognition-research.md) | Electron 端侧 AI 启动器意图识别模型选型、推理栈、微调和落地调研 |
| [model-provider-design.md](./model-provider-design.md) | 模型 provider 设计调研与方案说明 |
| [openwork-ui-upgrade-research.md](./openwork-ui-upgrade-research.md) | Openwork UI 升级方向调研 |
| [launch/openwork-launch-thread-cn.md](./launch/openwork-launch-thread-cn.md) | Openwork launch thread 中文稿 |
| [launch/raycast-experience-independent-thought-cn.md](./launch/raycast-experience-independent-thought-cn.md) | Raycast 体验、Openwork harness 定位和独立产品判断 |
| [launch/raycast-v2-windows-rewrite-research-cn.md](./launch/raycast-v2-windows-rewrite-research-cn.md) | Raycast V2 Windows rewrite 调研 |

## 桌面与运行质量

| 文档 | 用途 |
|---|---|
| [openwork-native-readiness-audit.md](./openwork-native-readiness-audit.md) | Openwork 原生化上线条件、P1/P2 风险和修复分组审计 |
| [windows-support-gap-audit.md](./windows-support-gap-audit.md) | Windows 支持现状、缺口和优先补齐路径审计 |
| [openwork-electron-debugging.md](./openwork-electron-debugging.md) | Electron 调试流程和本地验证约束 |
| [openwork-electron-size-performance-optimization.md](./openwork-electron-size-performance-optimization.md) | Electron 包体、启动和运行性能优化记录 |
| [launcher-ui-audit-harness.md](./launcher-ui-audit-harness.md) | Launcher UI 运行时样式审计：Electron/CDP、computed style、DOM 密度和截图指标 |

## Agent、Renderer 与状态

| 文档 | 用途 |
|---|---|
| [renderer-external-store-architecture.md](./renderer-external-store-architecture.md) | renderer external store 架构方案说明 |
| [ai-launcher-streaming-performance-boundaries-cn.md](./ai-launcher-streaming-performance-boundaries-cn.md) | AI launcher 流式渲染性能边界、单向数据流、projection/viewport/tool selector owner 和后续改造验收口径 |
| [agent-activity-runtime-to-ui-cn.md](./agent-activity-runtime-to-ui-cn.md) | Agent activity 从 runtime event、shared state、view projection 到 UI 结构和动效封装的链路说明 |
| [messages-perceived-waiting-upgrade-plan-cn.md](./messages-perceived-waiting-upgrade-plan-cn.md) | Messages 感知等待改造方案：首 token 前、thinking、tool、approval 和 final handoff 的用户感受 |

## 记忆、路线图与执行约束

| 文档 | 用途 |
|---|---|
| [personal-agent-memory-product-plan.md](./personal-agent-memory-product-plan.md) | 个人 Agent 记忆 V1 产品方案：定位、范围、设置、交互和验收 |
| [personal-agent-memory-technical-overview.md](./personal-agent-memory-technical-overview.md) | 个人 Agent 记忆 V1 技术概要：边界、middleware、数据模型、UI 状态和验证 |
| [personal-agent-memory-implementation-article.md](./personal-agent-memory-implementation-article.md) | 个人 Agent 记忆实现文章稿 |
| [task-parallelization-and-conflict-plan.md](./task-parallelization-and-conflict-plan.md) | 并行任务拆分、冲突边界、Paperclip 任务树和验收口径 |
| [tsyringe-migration-roadmap.md](./tsyringe-migration-roadmap.md) | tsyringe 迁移路线和执行约束 |
| [artifact-tab-roadmap.md](./artifact-tab-roadmap.md) | artifact tab 演进计划 |

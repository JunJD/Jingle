# Openwork 文档索引

[English docs index](./README.md)

这个索引按生产发布前的用途重新分类文档。分类只说明“现在该怎么读”，不等于所有旧文档都已经重写完成。

状态说明：

- `current`：可以作为当前实现或当前流程的入口，但仍应在改代码前核对相关路径。
- `refresh`：主题重要，但内容需要按当前代码重写或压缩后才能作为生产发布入口。
- `archive`：历史、调研、路线图或内容背景，不应作为当前实现合同。
- `content`：发布、叙事、文章或素材，不是用户帮助或开发合同。

## 新开发者阅读顺序

首次接手 Openwork/Jingle 时，先从代码事实和生产治理开始，不要直接从历史调研文档推断当前实现：

1. [production-readiness/README.md](./production-readiness/README.md)：生产发布治理入口。
2. [production-readiness/production-feature-inventory.md](./production-readiness/production-feature-inventory.md)：当前功能、用户入口、owner 路径和发布缺口。
3. [dev/README-cn.md](./dev/README-cn.md)、[dev/validation-matrix-cn.md](./dev/validation-matrix-cn.md) 和 [dev/release-runbook-cn.md](./dev/release-runbook-cn.md)：当前开发、验证和发布入口。
4. [engineering-boundaries.md](./engineering-boundaries.md) 和 [runtime-invariants.md](./runtime-invariants.md)：工程边界和运行时不变量，当前仍有参考价值，但生产前需要刷新。
5. [dev/extension-development-cn.md](./dev/extension-development-cn.md)、[extension-package-contract.md](./extension-package-contract.md) 和 [installable-extension-dev-guide-cn.md](./installable-extension-dev-guide-cn.md)：extension package 合同和安装型 extension 开发入口。
6. [agent-activity-runtime-to-ui-cn.md](./agent-activity-runtime-to-ui-cn.md) 与 [ai-launcher-streaming-performance-boundaries-cn.md](./ai-launcher-streaming-performance-boundaries-cn.md)：agent runtime -> renderer projection -> UI 的当前边界说明。
7. [openwork-electron-debugging.md](./openwork-electron-debugging.md)、[macos-dev-preview-install.md](./macos-dev-preview-install.md) 和 [openwork-electron-size-performance-optimization.md](./openwork-electron-size-performance-optimization.md)：调试、预览安装和打包质量入口。

迁移、Raycast 对照、旧 proposal 和 launch 文案不要作为当前实现合同；它们集中放在下面的历史/内容区。

## 生产发布治理

| 状态    | 文档                                                                                                                           | 用途                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| current | [production-readiness/README.md](./production-readiness/README.md)                                                             | 生产发布治理入口                            |
| current | [production-readiness/production-feature-inventory.md](./production-readiness/production-feature-inventory.md)                 | 当前功能盘点、入口、owner、风险             |
| current | [production-readiness/documentation-audit.md](./production-readiness/documentation-audit.md)                                   | 文档 keep / rewrite / archive / delete 审计 |
| current | [production-readiness/code-classification-governance.md](./production-readiness/code-classification-governance.md)             | product/dev/test/docs/archive 分类边界      |
| current | [production-readiness/help-center-information-architecture.md](./production-readiness/help-center-information-architecture.md) | 帮助中心信息架构                            |
| current | [production-readiness/blog-topics-and-outlines.md](./production-readiness/blog-topics-and-outlines.md)                         | 发布内容选题和大纲                          |
| current | [production-readiness/execution-waves.md](./production-readiness/execution-waves.md)                                           | 四波最小批次执行计划                        |

## 用户帮助入口

帮助中心是用户入口；历史调研文档不要当作用户帮助。

| 状态    | 文档                                                                                                                           | 用途                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| current | [help/README-cn.md](./help/README-cn.md)                                                                                       | 用户帮助中心入口                            |
| current | [help/getting-started/install-and-open-cn.md](./help/getting-started/install-and-open-cn.md)                                   | 安装、打开和 first setup                    |
| current | [help/getting-started/configure-a-model-cn.md](./help/getting-started/configure-a-model-cn.md)                                 | Settings -> Models 配置模型                 |
| current | [help/getting-started/first-agent-run-cn.md](./help/getting-started/first-agent-run-cn.md)                                     | 第一次 agent run                            |
| current | [help/core-concepts/workspace-cn.md](./help/core-concepts/workspace-cn.md)                                                     | workspace 本地信任边界                      |
| current | [help/core-concepts/permission-modes-cn.md](./help/core-concepts/permission-modes-cn.md)                                       | permission modes 和 approval cards          |
| current | [help/extensions/overview-cn.md](./help/extensions/overview-cn.md)                                                             | extension 用户入口、连接和 AI capabilities  |
| current | [help/logs-and-diagnostics/find-logs-cn.md](./help/logs-and-diagnostics/find-logs-cn.md)                                       | 本地日志位置和分享前 redaction              |
| current | [help/faq-cn.md](./help/faq-cn.md)                                                                                             | 常见问题                                    |
| current | [macos-dev-preview-install.md](./macos-dev-preview-install.md)                                                                 | macOS unsigned / 未 notarize 预览包安装说明 |
| current | [production-readiness/help-center-information-architecture.md](./production-readiness/help-center-information-architecture.md) | 帮助中心后续信息架构，不是用户最终阅读入口  |

## 当前工程合同与开发入口

这些文档是当前开发入口或工程合同，但其中一部分需要在生产发布前刷新成更短、更可验证的版本。

| 状态    | 文档                                                                                                   | 用途                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| current | [dev/README-cn.md](./dev/README-cn.md)                                                                 | 当前开发入口、owner 路径和质量门禁选择                                 |
| current | [dev/validation-matrix-cn.md](./dev/validation-matrix-cn.md)                                           | BDD、node tests、guardrails、build/package 命令矩阵                    |
| current | [dev/release-runbook-cn.md](./dev/release-runbook-cn.md)                                               | npm release、desktop release 和本地打包 runbook                        |
| current | [dev/extension-development-cn.md](./dev/extension-development-cn.md)                                   | extension 源码根、build/dev 命令、guardrail 覆盖和边界                 |
| refresh | [engineering-boundaries.md](./engineering-boundaries.md)                                               | 工程边界、模块职责、依赖方向和实现约束                                 |
| refresh | [runtime-invariants.md](./runtime-invariants.md)                                                       | 运行时不变量和执行过程必须保持的系统约束                               |
| refresh | [extension-package-contract.md](./extension-package-contract.md)                                       | built-in / bundled installable / user installed extension package 合同 |
| current | [extension-migration-transform-architecture-cn.md](./extension-migration-transform-architecture-cn.md) | extension 迁移脚本 transform 分层、fixtures 和生成物验收               |
| refresh | [installable-extension-dev-guide-cn.md](./installable-extension-dev-guide-cn.md)                       | 安装型 extension 外部源码包结构、build/dev 命令和调试路径              |
| current | [renderer-external-store-architecture.md](./renderer-external-store-architecture.md)                   | renderer external store 架构说明                                       |
| refresh | [thread-lifecycle-contract-cn.md](./thread-lifecycle-contract-cn.md)                                   | thread 生命周期、fork、HITL 和恢复合同草案                             |
| refresh | [model-provider-design.md](./model-provider-design.md)                                                 | 模型 provider 当前实现说明，需要按当前 registry/adapters 刷新          |
| current | [openwork-electron-debugging.md](./openwork-electron-debugging.md)                                     | Electron 调试流程和本地验证约束                                        |
| current | [launcher-ui-audit-harness.md](./launcher-ui-audit-harness.md)                                         | Launcher UI 运行时样式审计入口                                         |

## Agent、Renderer 与状态

| 状态    | 文档                                                                                                       | 用途                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| current | [agent-activity-runtime-to-ui-cn.md](./agent-activity-runtime-to-ui-cn.md)                                 | Agent activity 从 runtime event、shared state、view projection 到 UI 的链路说明 |
| current | [agent-event-state-trace-final-cn.md](./agent-event-state-trace-final-cn.md)                               | Agent event / state / trace 设计背景                                            |
| current | [ai-launcher-streaming-performance-boundaries-cn.md](./ai-launcher-streaming-performance-boundaries-cn.md) | AI launcher 流式渲染性能边界和禁回归说明                                        |
| archive | [messages-perceived-waiting-upgrade-plan-cn.md](./messages-perceived-waiting-upgrade-plan-cn.md)           | Messages 感知等待改造方案，作为 UX 历史计划保留                                 |
| archive | [artifact-tab-roadmap.md](./artifact-tab-roadmap.md)                                                       | Artifact tab 演进路线图                                                         |

## Extension、连接与迁移

| 状态    | 文档                                                                                                         | 用途                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| refresh | [extension-auth-connection-architecture-cn.md](./extension-auth-connection-architecture-cn.md)               | extension auth / connection 长期架构，需要压缩成当前合同和用户 setup 文档         |
| refresh | [extension-connector-runtime-design.md](./extension-connector-runtime-design.md)                             | command、AI capability、connection、`@extension` / `loadExtension` 统一运行时边界 |
| archive | [extension-runtime-architecture-research-cn.md](./extension-runtime-architecture-research-cn.md)             | extension runtime 隔离、remote rendering、外部参考调研                            |
| archive | [extension-external-install-packaging-research-cn.md](./extension-external-install-packaging-research-cn.md) | 外部安装和外部打包调研                                                            |
| archive | [extension-runtime-migration-plan.md](./extension-runtime-migration-plan.md)                                 | extension command runtime 迁移计划                                                |
| archive | [installable-extension-runtime-v1-proposal-cn.md](./installable-extension-runtime-v1-proposal-cn.md)         | Installable Extension Runtime V1 历史方案                                         |
| archive | [extension-hitl-experience-architecture.md](./extension-hitl-experience-architecture.md)                     | Extension HITL 体验 proposal                                                      |
| archive | [extension-hitl-experience-detailed-design-cn.md](./extension-hitl-experience-detailed-design-cn.md)         | Extension HITL 中文详设                                                           |
| archive | [raycast-notion-dependency-migration-preview.md](./raycast-notion-dependency-migration-preview.md)           | Notion 迁移状态和 Raycast dependency 历史证据                                     |

## 桌面、原生能力与运行质量

| 状态    | 文档                                                                                                       | 用途                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| refresh | [openwork-native-readiness-audit.md](./openwork-native-readiness-audit.md)                                 | 原生化上线条件和风险审计，需要按当前代码刷新                            |
| refresh | [windows-support-gap-audit.md](./windows-support-gap-audit.md)                                             | Windows 支持缺口审计，需要按当前 package/workflow/native extension 刷新 |
| current | [launcher-window-snap-overlay-architecture-cn.md](./launcher-window-snap-overlay-architecture-cn.md)       | Launcher 拖拽吸附线和窗口行为说明                                       |
| current | [openwork-electron-size-performance-optimization.md](./openwork-electron-size-performance-optimization.md) | Electron 包体、启动和运行性能优化记录                                   |

## 记忆与产品方案

| 状态    | 文档                                                                                                 | 用途                                        |
| ------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| refresh | [personal-agent-memory-product-plan.md](./personal-agent-memory-product-plan.md)                     | 个人 Agent 记忆产品方案，需要拆出用户帮助页 |
| refresh | [personal-agent-memory-technical-overview.md](./personal-agent-memory-technical-overview.md)         | 个人 Agent 记忆技术概要，需要按当前路径刷新 |
| content | [personal-agent-memory-implementation-article.md](./personal-agent-memory-implementation-article.md) | 个人 Agent 记忆实现文章稿                   |

## 产品、市场与内容资产

这些文档可以服务发布内容、产品判断或文章素材，但不要作为当前开发合同。

| 状态    | 文档                                                                                                         | 用途                                       |
| ------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| content | [product-narrative.md](./product-narrative.md)                                                               | 产品叙事、定位和体验方向背景               |
| content | [blog-drafts/README-cn.md](./blog-drafts/README-cn.md)                                                       | 生产发布 blog drafts 入口                  |
| content | [blog-drafts/product-launch-introduction-cn.md](./blog-drafts/product-launch-introduction-cn.md)             | 产品发布介绍草稿                           |
| content | [blog-drafts/launcher-to-agent-workflow-cn.md](./blog-drafts/launcher-to-agent-workflow-cn.md)               | 从 launcher 到 agent workflow 产品设计草稿 |
| content | [blog-drafts/local-first-agent-workspace-cn.md](./blog-drafts/local-first-agent-workspace-cn.md)             | 本地优先 agent workspace 草稿              |
| content | [blog-drafts/extension-runtime-design-cn.md](./blog-drafts/extension-runtime-design-cn.md)                   | Extension/runtime 设计草稿                 |
| content | [blog-drafts/production-logs-and-diagnostics-cn.md](./blog-drafts/production-logs-and-diagnostics-cn.md)     | 生产级日志与诊断草稿                       |
| content | [launch/openwork-launch-thread-cn.md](./launch/openwork-launch-thread-cn.md)                                 | Openwork launch thread 中文稿              |
| content | [launch/raycast-experience-independent-thought-cn.md](./launch/raycast-experience-independent-thought-cn.md) | Raycast / Openwork 产品判断文章            |
| archive | [launch/raycast-v2-windows-rewrite-research-cn.md](./launch/raycast-v2-windows-rewrite-research-cn.md)       | Raycast V2 Windows rewrite 外部调研        |
| archive | [harness-engineering-dimensions-research-cn.md](./harness-engineering-dimensions-research-cn.md)             | Harness 工程维度产品研究                   |
| archive | [ai-launcher-intent-recognition-research.md](./ai-launcher-intent-recognition-research.md)                   | 端侧 AI 启动器意图识别调研                 |
| archive | [openwork-ui-upgrade-research.md](./openwork-ui-upgrade-research.md)                                         | UI 升级方向调研                            |
| archive | [codex-desktop-openwork-agent-harness-gap-cn.md](./codex-desktop-openwork-agent-harness-gap-cn.md)           | Codex Desktop 与 Openwork harness 差异研究 |
| archive | [codex-launcher-ai-chrome-path-map-cn.md](./codex-launcher-ai-chrome-path-map-cn.md)                         | Codex 风格 launcher AI chrome path map     |
| archive | [codex-launcher-pinned-session-window-plan-cn.md](./codex-launcher-pinned-session-window-plan-cn.md)         | Codex 风格会话钉出窗口方案                 |
| archive | [codex-turn-diff-research-cn.md](./codex-turn-diff-research-cn.md)                                           | Codex turn diff / edited files 调研        |
| archive | [task-parallelization-and-conflict-plan.md](./task-parallelization-and-conflict-plan.md)                     | 并行任务拆分与冲突边界交付                 |
| archive | [tsyringe-migration-roadmap.md](./tsyringe-migration-roadmap.md)                                             | tsyringe 迁移路线图                        |
| archive | [openwork-project-share.pptx](./openwork-project-share.pptx)                                                 | 历史分享 deck                              |

## 维护规则

- 新增用户帮助时放入 `docs/help`，并从本索引的“用户帮助入口”链接。
- 新增开发合同或 runbook 时先说明 owner 路径、验证方式和失败语义。
- 新增发布文章或市场内容时放入内容区，不要混入用户帮助或工程合同。
- 旧 proposal / research 可以保留，但必须标为 `archive`，避免误导生产发布。
- 文档中出现脚本、workflow 或代码路径时，先用 `package.json`、`.github/workflows` 和 `rg --files` 复核。

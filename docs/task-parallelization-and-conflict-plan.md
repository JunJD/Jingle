# 并行任务拆分与冲突边界交付

日期：2026-04-28

## 目标

把两个大方向拆成可并行调研、可合并实现的任务组：

1. Electron 端侧 AI 启动器意图识别。
2. Openwork 原生化上线体检与修复。

原则：

- 只读调研可以并行。
- 同一边界、同一文件、同一状态链的实现必须合并。
- 涉及 launcher / extension / ai-core 的改动先定义模块职责、输入输出、状态归属、依赖方向和失败语义。

## 当前交付物

| 交付物 | 文件 |
|---|---|
| AI 模型选型与落地方案 | `docs/ai-launcher-intent-recognition-research.md` |
| Openwork 原生化上线体检 | `docs/openwork-native-readiness-audit.md` |
| 并行任务拆分与冲突边界 | `docs/task-parallelization-and-conflict-plan.md` |

## 推荐 Paperclip 任务树

### 父任务 A：端侧 AI 启动器意图识别

目标：

完成 vivo OriginOS 原子岛式文本拖拽/剪贴板/输入意图识别能力的端侧技术方案。

子任务：

| 子任务 | 类型 | 可并行 | 产出 |
|---|---|---|---|
| A1 模型选型调研 | 只读调研 | 是 | 候选/排除清单、授权、体积 |
| A2 前端推理栈调研 | 只读调研 | 是 | ONNX Runtime Web/Transformers.js 对比 |
| A3 规则抽取方案 | 设计 | 是 | URL/手机/邮箱/时间/地址/航班/快递/淘口令抽取规范 |
| A4 多任务模型 PoC | 实现 | 否 | 训练、导出、q8 ONNX、benchmark |
| A5 Electron Worker 集成 PoC | 实现 | 可与 A4 串行衔接 | Worker 推理、调度、离线资源加载 |
| A6 插件匹配协议 | 设计/实现 | 与 extension 边界合并 | intent/entity 到 extension command 的契约 |

实现冲突：

- A5 会碰 `src/renderer/src/launcher-shell/**`、`src/renderer/src/ai-core/**`、preload API。
- A6 会碰 `src/extensions/**`、`src/extension-runtime/**`、`src/renderer/src/extension-host/**`。
- A5/A6 不应分给两个实现者并行写，需要先合并设计。

### 父任务 B：Openwork 原生化上线

目标：

除 AI 和 extension 外，把桌面端基础体验、安全边界、跨平台和发布链路推到 beta 上线态。

子任务：

| 子任务 | 类型 | 可并行 | 产出 |
|---|---|---|---|
| B1 首启数据库与启动失败体验 | 实现 | 可与 B3 并行，但共享启动验证 | 新用户目录可首启 |
| B2 桌面打包发布链路 | 实现 | 与 B1 有 `package.json` 冲突 | installer/sign/notarize artifact |
| B3 Electron 安全边界 | 实现 | 不宜拆散 | preload 最小暴露、IPC schema、外链收口 |
| B4 原生窗口体验 | 实现 | 可与 B3 并行 | 窗口状态、focus、activate、multi-display |
| B5 UI/可访问性 polish | 实现 | 可与 B4 并行但可能视觉冲突 | Tab/focus、空状态、设置页 |
| B6 Windows launcher 能力补齐 | 实现 | 可单独并行 | file search、browser history、clipboard files |

实现冲突：

- B1/B2 都会改 `package.json` 和启动/资源路径，建议一个任务组处理。
- B3 所有 IPC/preload/外链必须集中处理，否则容易出现半收口状态。
- B4/B5 都可能碰窗口和全局 CSS，需约定视觉职责。
- B6 与 AI 启动器的剪贴板/launcher 输入集成有潜在冲突，AI 进入实现前要同步。

## 合并边界建议

### 必须合并做的边界

1. `launcher-shell + ai-core + plugin matcher`

原因：

- 输入文本、剪贴板上下文、AI 识别结果、插件匹配都属于同一状态链。
- 不能从根组件向下大量 prop drilling。
- 应由 launcher intelligence host 或局部 store/context 收口。

2. `preload + IPC + external links`

原因：

- 安全边界需要一次性定义白名单。
- typed API 和 main controller schema 要一起演进。

3. `首启 DB + packaged resources + installer`

原因：

- 开发环境和 packaged 环境路径不同。
- 首启迁移必须在真实安装包里验证。

### 可以并行做的边界

1. AI 模型调研和本地上线体检。
2. 规则抽取设计和 ONNX Worker 原型。
3. Windows file search 和主窗口状态持久化。
4. UI 空状态 polish 和数据库首启修复。

## 推荐执行顺序

### 第 1 阶段：决策与 PoC

1. 完成 AI benchmark PoC。
2. 确认 `<=20ms` 是否真实可达。
3. 如果不可达，产品策略改为规则即时 + AI 异步建议。
4. 同时修 Openwork P1 中最小安全/首启问题。

### 第 2 阶段：基础上线

1. 首启数据库迁移。
2. workspace 路径边界修复。
3. 外链收口。
4. 移除通用 ipcRenderer。
5. BDD smoke。

### 第 3 阶段：原生体验

1. 窗口状态持久化。
2. Tab/focus 修复。
3. 空状态落地。
4. Windows launcher 缺口。

### 第 4 阶段：AI 启动器产品化

1. Worker 推理常驻。
2. 规则层与模型层融合。
3. 插件匹配协议。
4. 隐私/离线验证。
5. 跨平台性能报告。

## 验收口径

AI 任务验收：

- 模型文件 <=50MB，目标 <=30MB。
- 离线启动不访问网络。
- 短文本 warm p95 有实测数据。
- 内存增量有实测数据。
- intent/entity 准确率有 dev set 指标。
- 插件匹配有可执行 demo。

Openwork 上线验收：

- 空 `OPENWORK_HOME` 首启通过。
- `npm run typecheck` 通过。
- `npm run check:guardrails` 通过。
- `npm run test:node` 通过。
- BDD smoke 通过。
- macOS/Windows/Linux 至少各有一次安装包手测记录。


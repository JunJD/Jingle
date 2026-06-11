# Openwork Codex Instructions

## React 状态约束

- 不要在 `useEffect` 的 effect body 里同步调用 `setState` 来派生另一个 React 状态；这会触发 `react-hooks/set-state-in-effect`，也容易造成级联渲染。
- 不要在 render 阶段通过读写 `ref.current` 来驱动渲染状态；这会触发 `react-hooks/refs`。
- 如果一个状态只是另一个状态的投影，优先直接推导；如果需要延迟、节流、过渡或和异步流程对齐，把状态机收口到 hook / 事件处理函数 / effect 的异步回调里，而不是在 effect 里同步回写。

## Agent 工作状态与派生投影边界

- 能影响任务继续、恢复、审批、取消和可检查结果的，属于核心工作状态；例如 runtime run state、checkpoint、HITL request、artifact、diff 和最终 durable status。核心状态写入必须短、稳、失败清晰，不要被非核心后处理拖慢或吞错。
- 只影响搜索、展示、排序、摘要、标题、历史整理的，属于派生投影；例如 message search index、thread summary、展示缓存和 launcher 搜索投影。派生投影可以异步、可重试、可重建，并且应有可观察的失败信号。
- 不要把派生投影同步绑死在 checkpoint / HITL / runtime 主写入路径里。保存工作现场是产品地基，搜索目录是历史检索投影；投影失败不应导致核心 agent 工作无法保存、恢复或继续。
- 当必须在同一入口触发核心写入和投影更新时，先定义状态归属、依赖方向和失败语义：核心写入成功后再调度投影；投影可以落后，但不能反向决定核心状态是否成立。

## 数据到渲染的职责边界

- Openwork 的 agent runtime、schema、projection 和 renderer 是同一个系统内的链路；默认假设我们能修正上游数据和契约，不要在下游用大量 fallback 把契约问题包装成“看起来能用”的 UI。
- runtime 只写真实工作事实；runtime state 只保存可恢复、可控制、可检查的事实；renderer projection 负责把事实派生为视图结构；React component 只保存展开/收起、hover、输入草稿等纯 UI local state。每层只做本层该做的事，不跨层补状态。
- schema/registry 层缺字段、缺 renderer、缺 presentation 时，应优先暴露为清晰错误或不可渲染状态，并补齐真实 owner 的契约；不要悄悄退回 raw tool name、空文案、猜测文案或重复 source of truth。
- review 涉及 event/state/view/ui 时，必须检查是否存在不必要兜底、字符串反推结构、重复事实源、UI-only core state、跨层 prop drilling 和 renderer/schema 职责混杂。发现后优先收敛边界，而不是继续加兼容层。

## BDD 测试约定

- 仓库里涉及用户可见工作流、跨进程协作、窗口生命周期、IPC 契约时，优先考虑使用 `bdd-test-engineer` 思路补行为测试；测试目标是验证用户行为和系统边界，不是重复实现细节。
- 期待写 BDD 的时机：
  - 修复一个用户可复现的问题，且问题能用“给定/当/那么”稳定表达。
  - 新增一个关键桌面工作流，例如主窗口、启动器、设置页、扩展入口、线程/审批流切换。
  - 修改 main/preload/renderer 之间的协作边界，单元测试不足以覆盖真实风险。
  - 调整启动流程、持久化目录、数据库初始化、窗口创建与路由注入。
- 不期待为了纯函数、小型映射、样式微调、实现细节重构而强行写 BDD；这类改动优先单元测试或类型约束。
- BDD 场景要保持小而稳，优先覆盖“能否启动 / 能否进入页面 / 能否完成关键动作 / 是否写入正确状态”这类高价值结果。
- BDD 测试默认必须隔离本机状态，不能污染真实用户目录；当前仓库统一通过 `OPENWORK_HOME` 为测试注入临时数据目录。
- 写 BDD 时，先定义边界：测哪个窗口、哪个入口、哪个用户动作、哪个可观察结果；禁止把多个不相干行为揉进一个长场景。

## 个人记忆存储边界

- 个人 Agent 记忆默认本地优先。长期记忆、纠正记录、工作区上下文记忆和 pending memory suggestion 的第一存储位置应在本机 `OPENWORK_HOME` 之下，由用户明确可见、可编辑、可删除。
- 未来即使引入服务器同步，也只能作为显式开启的同步层或备份层，不应改变本地记忆作为主权源的产品语义；用户必须能关闭同步，并理解哪些记忆留在本地、哪些被同步。
- 不要把本地 Prisma/SQLite 存储和文件型规则存储混为一种东西。二者都在本机，但性质不同：Prisma/SQLite 适合结构化、可查询、可审计的产品数据；`AGENTS.md` 或规则文件适合可读、可版本控制、可跨 agent 共享的指令和约束。
- 个人记忆 V1 应优先使用本地结构化存储承载用户可控记忆对象，再在 agent runtime 中生成短的上下文包。不要为了“以后可能上云”提前把本地写路径抽象成远端优先服务。
- 如果后续需要把部分记忆迁移到服务器，迁移方案必须保留本地副本、来源标记、同步状态和删除语义，不能让远端状态反向覆盖用户本地明确编辑过的记忆。

## 依赖与打包约束

- 默认要求 `main / preload / renderer` 构建产物可被 Vite/Rollup tree-shaking；新增运行时依赖时，优先选择 ESM、按需导出的包，避免引入整包副作用重的库。
- 删除功能、替换 UI 方案或统一基础库后，必须同步移除未使用依赖，不能把“也许以后会用”留在 `package.json` 里。
- 涉及前端运行时依赖增删时，至少执行一次 `npm run audit:frontend-packages`，再结合全仓 `rg` 复核，不要只凭局部 import 判断。
- 涉及打包链路或运行时依赖调整时，至少验证 `npm run typecheck`；如果改动可能影响产物装配或 bundle 行为，再补跑 `npm run build`。
- 通用 UI icon 库当前统一为 `lucide-react`。没有明确产品理由时，不要引入第二套通用 icon 库；品牌或 provider logo 这类专用图形应收口为局部 SVG 组件，而不是再加一套图标依赖。

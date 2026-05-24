# 个人 Agent 记忆技术概要

## 目标

实现一个本地优先、可见、可控、可插拔的 Openwork 记忆与上下文系统。

V1 不继续直接使用 DeepAgents 的文件型 `createMemoryMiddleware` 作为 Openwork 的 memory 抽象。它的命名和 Openwork 产品语义冲突：当前实现读取的是规则文件和 instruction source，但用户理解的“记忆”是长期个人事实、偏好和纠正记录。

V1 推荐新增一个 Openwork 自己维护的统一 middleware：

```ts
createOpenworkMemoryMiddleware(...)
```

它统一负责运行时上下文注入，但底层来源必须分区：

- `soul.md`：全局身份、产品气质、长期原则。
- `AGENTS.md` / 工作区规则：可读、可版本控制、可跨 agent 共享的指令和约束。
- 结构化个人记忆：用户确认过的偏好、工作区上下文、纠正记录。
- pending suggestion：等待用户确认，不能进入运行时 prompt。

## 调研结论

主流 Agent 框架对“记忆 + 可插拔运行时”的做法基本一致：

- LangChain JS 使用 `createMiddleware` 承载 agent 生命周期 hook，支持 `beforeAgent`、`beforeModel`、`afterModel`、`afterAgent` 以及 `wrapModelCall`、`wrapToolCall`，适合做 prompt 注入、工具拦截、状态记录。
- Deep Agents 本身是 middleware 化的 agent harness，内置 filesystem、subagent、summarization、skills、memory 等 middleware，并允许传入自定义 middleware。
- OpenAI Agents SDK 把会话记忆抽象成可替换 `Session`，同一个 agent 可切换本地内存、SQLite、Redis、OpenAI Conversations 等实现。
- OpenAI sandbox agent memory 区分 conversation session memory 和长期 agent memory，并支持 read-only / generate-only 运行方式，适合借鉴到 root agent 与 subagent 的读写差异。
- Vercel AI SDK 的 language model middleware 也采用 wrap 模型调用的方式，把 guardrails、RAG、cache、logging 做成模型无关增强。

对 Openwork 的结论：

- 运行时应该继续走 LangChain/DeepAgents middleware 机制。
- Openwork 不应该暴露或延续 DeepAgents `createMemoryMiddleware` 的产品语义。
- `AgentConfig.memorySources` 不再保留；V1 的文件型上下文只来自 `soul.md` 和 `AGENTS.md`。
- V1 可以先停用 DeepAgents `createMemoryMiddleware`，用 `createOpenworkMemoryMiddleware` 统一注入 `soul.md`、规则文件和结构化个人记忆。

## 最佳实践校验

Openwork 方案与当前主流实践的对应关系：

| 实践结论 | Openwork V1 对应设计 |
|---|---|
| 记忆要可见、可编辑、可删除 | Memory tab 管理 `AgentMemory`，回答后展示 included memories |
| 自动记忆容易误伤，需要用户控制 | Agent 只能创建 `AgentMemorySuggestion`，接受后才进入 active memory |
| 文件规则和个人偏好不能混淆 | `soul.md` / `AGENTS.md` 走 file provider，个人事实走 Prisma |
| 长期记忆需要作用域 | `scope=global/workspace`，renderer 提交 workspace claim，工作区 authority 由 main 校准 |
| 运行时上下文要可审计 | run metadata 保存 `OpenworkMemoryContextPack` 快照 |
| resume 不能漂移 | resume 复用原 run 的 context pack，不重新读取 |
| 子任务不应扩大写入权 | subagent read-only，不暴露 suggestion tool |

实践反馈中最常见的问题是“Agent 自以为记住了，但用户不知道记住了什么”。V1 的应对是：候选记忆、active memory、included memory 三个状态都要能在 UI 上看见。

普通记忆确认是异步产品流，不是运行时 HITL 中断。HITL 只和高风险工具行为相关，例如修改文件型上下文或保存敏感信息。

参考来源：

- [LangChain JS Custom Middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/custom)
- [Deep Agents Customization](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [Deep Agents Long-term Memory](https://docs.langchain.com/oss/javascript/deepagents/long-term-memory)
- [OpenAI Agents JS Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)
- [OpenAI Agents Sandbox Memory](https://openai.github.io/openai-agents-python/sandbox/memory/)
- [Vercel AI SDK Language Model Middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware)
- [Claude Code Sessions](https://code.claude.com/docs/en/how-claude-code-works)
- [OpenAI Codex CLI issue: resume cwd drift](https://github.com/openai/codex/issues/4791)
- [Rovo Dev CLI Sessions](https://support.atlassian.com/rovo/docs/manage-sessions-in-rovo-dev-cli/)
- [Gemini CLI Commands](https://google-gemini.github.io/gemini-cli/docs/cli/commands.html)
- [Kiro CLI Steering](https://kiro.dev/docs/cli/steering)
- [VS Code Copilot Custom Instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- [Continue Rules](https://docs.continue.dev/customize/deep-dives/rules)

## 当前问题

Openwork 当前 runtime 已经是 middleware 栈：

- `src/main/agent/runtime.ts` 使用 `createAgent({ middleware: [...] })`。
- 共享栈已有 `todoListMiddleware`、`createFilesystemMiddleware`、`createSummarizationMiddleware`、`createSkillsMiddleware`、DeepAgents `createMemoryMiddleware`。
- root agent 额外挂载 `createTitleMiddleware`、desktop automation、extension source、guardrail、tool approval。
- subagent 复用共享栈，并追加只读 guardrail。

当前 `createMemoryMiddleware` 读取的是：

- `OPENWORK_HOME/AGENTS.md`
- `<workspace>/.openwork/AGENTS.md`

这些不是同一种 memory。它们至少包含两类东西：

- 规则和 instruction source：`AGENTS.md`、工作区规则、未来的 `soul.md`。
- 产品记忆：用户确认过的偏好、纠正记录、工作区上下文。

如果继续把它们都叫 memory，会带来三个问题：

- UI 难解释：用户不知道“记忆”到底是偏好、规则文件还是 agent 人设。
- 写入权限混乱：结构化个人记忆需要 pending confirmation，规则文件不应该被 agent 静默改写。
- 运行时不可审计：回答用了哪条个人记忆，不能从一个混合 prompt 里可靠反推。

## 推荐架构

V1 采用一个统一 runtime middleware，多个来源 provider。

```text
createOpenworkMemoryMiddleware
  ├─ SoulProvider                -> soul.md
  ├─ RuleFileProvider            -> AGENTS.md / workspace rules
  ├─ StructuredMemoryProvider    -> Prisma AgentMemory
  └─ SuggestionTool              -> pending memory suggestion
```

middleware 负责把这些来源组合成一次运行的 `OpenworkMemoryContextPack`，并按固定 section 注入 prompt。

关键原则：

- 运行时统一注入，用户体验上是一个“Openwork context / memory”能力。
- 存储和权限分区，不能把规则文件、soul、个人事实混成同一张表。
- pending suggestion 不进入 prompt。
- root agent 可以建议记忆，subagent 默认 read-only。
- `resume` 复用原 run 的 context pack，不重新读取来源。

## 来源分层

| 来源 | 建议路径/存储 | 作用域 | 可由 Agent 写入 | 是否进入 prompt | UI 入口 |
|---|---|---|---:|---:|---|
| Soul | `OPENWORK_HOME/soul.md`，可选 `<workspace>/.openwork/soul.md` | 全局 / 当前工作区 | 否 | 是 | 后续单独入口 |
| Rules | `OPENWORK_HOME/AGENTS.md`，`<workspace>/.openwork/AGENTS.md` | 全局 / 当前工作区 | 否 | 是 | 规则/高级设置 |
| Instruction sources | 用户配置的外部规则文件路径 | 全局 | 否 | 是 | 设置页来源管理 |
| Structured memories | Prisma/SQLite `AgentMemory` | 全局 / 当前工作区 | 只能通过确认流 | 是 | Memory tab |
| Pending suggestions | Prisma/SQLite `AgentMemorySuggestion` | 全局 / 当前工作区 | 可创建候选 | 否 | Pending memories |

说明：

- `soul.md` 不是个人事实记忆，更像 Openwork 或用户定义的长期“人格/原则层”。它可以和规则文件一样走文件存储，因为它需要可读、可编辑、可迁移。
- `AGENTS.md` 继续是工程规则和执行约束，不和个人偏好事实表合并。
- 结构化个人记忆仍然用 Prisma/SQLite，因为它需要查询、审计、状态、确认流和 included memory 记录。

## 模块边界

| 层 | 职责 | 建议文件 |
|---|---|---|
| Shared types | 定义来源类型、记忆类型、IPC 参数、context pack | `src/shared/openwork-memory.ts` |
| Workspace identity | 规范化工作区路径、生成 workspace key、校验 resume 工作区 | `src/main/workspace/identity.ts` 或 `src/main/openwork-memory/workspace-identity.ts` |
| File providers | 读取 `soul.md`、`AGENTS.md`、用户配置的 instruction sources | `src/main/openwork-memory/file-providers.ts` |
| DB access | 读写 Prisma 结构化记忆表 | `src/main/db/agent-memory.ts` |
| Main service | 工作区归属、provider 编排、确认流、context pack 构建 | `src/main/openwork-memory/service.ts` |
| Runtime middleware | prompt 注入、候选记忆工具、included ids 收集 | `src/main/openwork-memory/middleware.ts` |
| Main controller | 注册 IPC channel，不放业务逻辑 | `src/main/openwork-memory/controller.ts` |
| Preload API | 暴露 `window.api.memory` | `src/preload/api/memory.ts` |
| Renderer UI | 设置页 Memory tab、回答后审核卡、included memories 展示、composer 状态 | `src/renderer/src/settings/MemoryTab.tsx`、`src/renderer/src/components/chat/*` |
| Agent integration | run 快照、runtime 参数传递、完成后持久化 included memories | `src/main/agent/service.ts`、`src/main/agent/runtime.ts` |

依赖方向保持单向：renderer -> preload -> main controller -> main service -> db/file providers。renderer 可以提交当前交互的 workspace claim，但不能把 claim 直接变成持久化归属；工作区 authority 由 main 根据线程 metadata、run snapshot、当前窗口 workspace 和规范化路径计算。

## Workspace Identity

工作区归属是 main process 的领域规则。renderer 的职责是表达用户当前交互现场，main 的职责是把这个现场校准成可持久化、可 resume、可审计的 workspace identity。

V1 不引入 project 概念，只定义单 workspace identity：

```ts
export interface OpenworkWorkspaceIdentity {
  workspaceKey: string
  canonicalWorkspacePath: string
  displayName: string
  gitRoot?: string
  worktreeRoot?: string
}
```

renderer 可以在 IPC 中传递 workspace claim：

```ts
export interface OpenworkWorkspaceClaim {
  threadId?: string
  workspaceKey?: string
  canonicalWorkspacePath?: string
  source: "composer" | "settings" | "memory_review" | "resume"
  observedAt: number
}
```

这个类型只表达“用户操作发生时前端看到的 workspace 状态”。它不能直接写入 `AgentMemory.workspaceKey`、run metadata 或工具 workdir。

生成规则：

1. main 从 thread metadata 或当前窗口选中的 workspace path 读取原始路径。
2. 使用 `realpath` / `resolve` 得到 `canonicalWorkspacePath`。
3. 如果目录在 git worktree 中，记录 `gitRoot` 和 `worktreeRoot`，但 V1 的 `workspaceKey` 仍使用 `canonicalWorkspacePath`。
4. `workspaceKey` 只由 main 生成并写入 thread/run metadata、结构化记忆和 context snapshot。
5. 如果 renderer 传了 workspace claim，main 必须与 thread/run/current window identity 比较；一致则继续，不一致则返回可恢复的 mismatch 状态。

选择 `canonicalWorkspacePath` 作为 V1 key 的原因：

- 当前产品还没有 project 概念。
- path key 与本地优先存储一致，最容易解释和排查。
- git repo、worktree、monorepo 的合并语义会影响记忆共享范围，不能提前替用户决定。

未来如果引入 project，需要新增显式迁移：

```text
workspaceKey(path) -> projectKey(user-defined project)
```

不要在 V1 里通过 git root 暗中合并多个 worktree 的记忆。

### Workspace Claim Resolution

所有会影响工作区记忆或 resume 的 IPC 都走同一个解析流程：

```text
renderer workspace claim
  -> controller schema parse
  -> service load thread/run/current window identity
  -> normalize path and compute main-resolved identity
  -> compare claim when present
  -> write/query with main-resolved identity only
```

返回状态建议：

```ts
export type WorkspaceClaimResolution =
  | { kind: "resolved"; identity: OpenworkWorkspaceIdentity }
  | {
      kind: "mismatch"
      claim: OpenworkWorkspaceClaim
      resolved: OpenworkWorkspaceIdentity
      reason: "stale_renderer_state" | "thread_workspace_changed" | "resume_original_differs"
    }
```

处理规则：

- claim 缺失：main 使用 thread/current window identity 继续，并把 resolved identity 返回给 UI。
- claim 一致：正常执行。
- claim 不一致：不写入结构化记忆，不清空 pending suggestion，不启动 resume；返回 mismatch 给 UI 选择或刷新。
- suggestion accept/reject 必须同时校验 suggestion 的 `threadId`、`runId/sourceRunId`、source workspace 和用户选择的保存目标，不能只凭 `suggestionId` 修改。
- list/read 接口可以使用 claim 决定“当前 workspace tab”的展示语义，但查询范围仍由 main-resolved identity 限定。

## Resume Workspace Policy

run resume 必须校验当前 workspace 与原 run workspace。

建议新增：

```ts
export type ResumeWorkspaceDecision =
  | { kind: "resume"; workspace: OpenworkWorkspaceIdentity }
  | { kind: "needs_user_choice"; original: OpenworkWorkspaceIdentity; current: OpenworkWorkspaceIdentity }
  | { kind: "missing_original"; originalPath: string }
```

策略：

| 场景 | 行为 |
|---|---|
| current `workspaceKey` 与 run snapshot 相同 | 直接 resume |
| current path 不同，但用户选择“回到原工作区” | 切换 workspace 后 resume |
| current path 不同，用户选择“在当前工作区 fork” | 新建 thread/run，重新构建 context pack |
| current path 不同，用户选择“只查看历史” | 打开 transcript，不执行 agent run |
| 原 workspace 不存在 | 提示 relocate / fork / view history，不静默恢复 |

resume 原 run 时不能重新绑定 workspace。否则同一个 run 的工具权限、规则文件、结构化记忆和 inclusion 记录会同时指向两个工作区。

实现要求：

- `AgentService.resume` 从 run metadata 读取 `workspaceKey`、`canonicalWorkspacePath` 和 frozen context pack。
- resume 前由 main 计算 current workspace identity 并比较。
- 不一致时返回可恢复的业务错误或状态，让 renderer 展示选择面板。
- 用户选择 fork 时调用 invoke 路径，新 run 使用当前 workspace 重新构建 context pack。
- 用户选择 view history 时不创建 run，不暴露工具。

## Context Pack

运行时只传短上下文包，不传完整记忆库或原始文件集合。

```ts
export type OpenworkMemorySectionKind =
  | "soul"
  | "rules"
  | "instruction_source"
  | "about_me"
  | "workspace_context"
  | "correction"

export interface OpenworkMemoryContextItem {
  id: string
  kind: OpenworkMemorySectionKind
  scope: "global" | "workspace"
  sourceType: "file" | "structured"
  sourceLabel: string
  content: string
  structuredMemoryId?: string
}

export interface OpenworkMemoryContextPack {
  generatedAt: number
  workspaceKey: string
  canonicalWorkspacePath: string
  items: OpenworkMemoryContextItem[]
}
```

默认限制：

- `soul`：全局 1 个，工作区 1 个。
- `rules`：全局 1 个，工作区 1 个。
- `instruction_source`：最多 8 个来源。
- `about_me` 最多 12 条。
- `workspace_context` 最多 16 条。
- `correction` 最多 12 条。

V1 不做 embedding 检索。结构化记忆排序使用确定性规则：更近更新的 active 记忆优先。文件来源按固定优先级和路径顺序读取。

## 记忆读取模型

读取发生在 run 开始时，由 `OpenworkMemoryService.buildContextPack` 一次性完成。middleware 不直接查库，也不在多次 model call 之间重新读取。

读取输入：

- `threadId`
- `runId`
- `workspaceIdentity`
- `temporaryMode`
- 用户 memory 设置

读取步骤：

1. 如果 `temporaryMode=true` 或用户关闭 memory，返回 `contextPack=null`。
2. 读取文件型上下文：
   - `OPENWORK_HOME/soul.md`
   - `<workspace>/.openwork/soul.md`
   - `OPENWORK_HOME/AGENTS.md`
   - `<workspace>/.openwork/AGENTS.md`
   - `instructionSources`
3. 查询结构化记忆：
   - `status=active`
   - `scope=global` 或 `scope=workspace AND workspaceKey=workspaceIdentity.workspaceKey`
   - 类型限定为 `about_me`、`workspace_context`、`correction`
4. 按固定上限和排序规则构建 `OpenworkMemoryContextPack`。
5. 将 context pack 写入 run metadata。

结构化记忆读取上限：

| 类型 | 上限 | 排序 |
|---|---:|---|
| `about_me` | 12 | `updatedAt desc` |
| `workspace_context` | 16 | `updatedAt desc` |
| `correction` | 12 | `updatedAt desc` |

V1 不按当前用户消息做语义召回，避免 embedding、召回解释和误召回复杂度。后续如果引入检索，应只在 active memory 集合内做 rerank，不能直接扫描聊天历史。

## Context Snapshot

run metadata 必须保存 frozen context snapshot，而不是只保存 memory id 列表。

最低要求：

```ts
export interface OpenworkMemoryContextSnapshot {
  generatedAt: number
  workspaceKey: string
  canonicalWorkspacePath: string
  temporaryMode: boolean
  items: OpenworkMemoryContextItem[]
}
```

规则：

- invoke 时构建一次 snapshot 并写入 run metadata。
- resume 原 run 时直接使用 snapshot，不重新读文件、不重新查 active memory。
- snapshot 中的 file item 保存当时进入 prompt 的内容；后续文件变化不影响原 run resume。
- snapshot 中的 structured memory item 保存当时进入 prompt 的内容；后续编辑、归档、删除不影响原 run resume。
- 如果 snapshot 缺失，resume 应降级为需要用户选择：重新开始 / fork / 只查看历史，而不是静默重建。

这样才能保证同一个 run 的 prompt、inclusion 展示和审计结果可解释。

## 记忆写入模型

结构化个人记忆的写入分为三步：

```text
trigger
  -> AgentMemorySuggestion(pending)
  -> user accepts / edits / rejects
  -> AgentMemory(active)
```

写入触发只产生候选，不产生 active memory。

候选记忆要区分两个 workspace：

- `sourceWorkspace`：候选产生时的 thread/run workspace。它解释“这条候选从哪里来”。
- `targetWorkspace`：用户接受时选择保存到哪里。默认等于 `sourceWorkspace`；用户可以显式改成当前 workspace 或 global。

用户在候选产生后切换 workspace 不是错误。错误只发生在用户选择保存到当前 workspace 时，renderer 提交的 current workspace claim 与 main 重新计算出的 current workspace 不一致。

允许触发：

- 用户显式说“记住……”。
- 用户纠正可复用偏好或判断。
- 用户确认当前工作区长期事实。
- 同类纠正重复出现。

禁止触发：

- 当前任务指令。
- 临时表达偏好。
- 普通聊天事实、链接、热点。
- repo 中可实时读取的实现事实，除非用户声明为长期上下文。
- secrets、tokens、隐私身份信息。
- `soul.md`、`AGENTS.md`、规则文件内容。

用户接受后才写入 `AgentMemory`。接受发生在 run 结束后或设置页中，不改变当前 run 的 context pack；新记忆从下一次 run 开始参与读取。

## 记忆颗粒度

结构化个人记忆的原子单位是一条可独立使用的短事实或偏好，不是聊天摘要。

每条 active memory 必须满足：

- 单一意图：只表达一个偏好、事实或纠正。
- 明确作用域：`global` 或当前 `workspaceKey`。
- 可脱离聊天上下文理解。
- 可被用户单独编辑或删除。
- 适合放入 prompt，不需要再二次总结。

推荐长度：一到两句话。超过两句话时，优先拆成多条记忆或不要保存。

示例：

| 类型 | 好的颗粒度 | 需要拆分或拒绝 |
|---|---|---|
| `about_me` | 用户偏好中文回复。 | 用户的完整沟通风格总结。 |
| `about_me` | 用户反感无必要的防御性编程。 | 用户所有工程偏好合集。 |
| `workspace_context` | 当前工作区使用 Electron + React + Prisma。 | 当前工作区技术栈、路线图和任务历史合集。 |
| `correction` | 做需求澄清时先确认目标对象和记忆边界。 | 上一次需求分歧的完整聊天复盘。 |

重复候选处理：

- 相同 `type + scope + content` 的 pending suggestion 不重复创建。
- 与 active memory 语义相同但内容更精确时，生成“更新候选”，用户接受后更新原 memory，而不是创建新 memory。
- 与 active memory 冲突时，生成“冲突候选”，UI 显示旧值和新值，由用户决定保留、替换或拒绝。

## Middleware 接口

建议让 runtime 返回一个小插件对象，而不是只返回 middleware 实例。

```ts
export interface OpenworkMemoryRuntime {
  middleware: unknown
  getIncludedStructuredMemoryIds(): string[]
}

export interface CreateOpenworkMemoryMiddlewareOptions {
  mode: "root" | "subagent"
  threadId: string
  runId: string
  workspaceIdentity: OpenworkWorkspaceIdentity
  contextPack: OpenworkMemoryContextPack | null
  temporaryMode: boolean
  service: OpenworkMemoryService
}
```

实现形态：

```ts
export function createOpenworkMemoryMiddleware(
  options: CreateOpenworkMemoryMiddlewareOptions
): OpenworkMemoryRuntime {
  const includedStructuredMemoryIds = new Set<string>()

  const tools = options.mode === "root" && !options.temporaryMode
    ? [createSuggestPersonalMemoryTool(options)]
    : []

  const middleware = createMiddleware({
    name: "openworkMemory",
    tools,
    wrapModelCall: async (request, handler) => {
      if (!options.contextPack || options.temporaryMode) {
        return handler(request)
      }

      for (const item of options.contextPack.items) {
        if (item.structuredMemoryId) {
          includedStructuredMemoryIds.add(item.structuredMemoryId)
        }
      }

      return handler({
        ...request,
        systemPrompt: appendOpenworkMemorySection(
          request.systemPrompt,
          options.contextPack
        )
      })
    }
  })

  return {
    middleware,
    getIncludedStructuredMemoryIds: () => Array.from(includedStructuredMemoryIds)
  }
}
```

V1 不要求在 middleware 内部重新查询数据库或文件。middleware 只消费 run 开始时冻结的 context pack，保证 resume 和多次 model call 的上下文稳定。

## Runtime 栈位置

在 `src/main/agent/runtime.ts` 中替换 DeepAgents 文件型 memory middleware：

```ts
// remove from shared stack
createMemoryMiddleware({
  backend,
  sources: memorySources,
  addCacheControl: model instanceof ChatAnthropic
})

// add Openwork-owned middleware
openworkMemoryRuntime.middleware
```

推荐插入位置：

1. `createSkillsMiddleware` 之后。
2. extension source guide 之前。
3. guardrail 和 tool approval 之前。

原因：

- `soul.md`、`AGENTS.md`、个人记忆都需要在模型调用前进入 prompt。
- Openwork 自己控制 section 顺序和来源标记。
- extension source guide 仍可根据本次绑定源追加工具说明。
- guardrail 和 approval 继续包住所有工具调用，包括 `suggest_personal_memory`。

root agent：

```ts
function createRootAgentLoopMiddleware() {
  const openworkMemory = createOpenworkMemoryMiddleware({
    mode: "root",
    ...
  })

  return [
    ...createSharedAgentLoopMiddleware("root"),
    openworkMemory.middleware,
    createTitleMiddleware(),
    createDesktopAutomationToolsMiddleware(),
    extensionSourceRuntime.middleware,
    createGuardrailMiddleware(...),
    createToolApprovalMiddleware(...)
  ] as const
}
```

subagent：

```ts
function createSubagentAgentLoopMiddleware() {
  return [
    ...createSharedAgentLoopMiddleware("subagent"),
    createOpenworkMemoryMiddleware({ mode: "subagent", ... }).middleware,
    createSubagentReadOnlyGuardrailMiddleware(...)
  ] as const
}
```

如果子 agent 读完整上下文会造成噪音，可以在 V1 先让 subagent 只读 `rules` 和 `workspace_context`，不读 `about_me`、`correction`、`soul`。但不要让 subagent 生成 pending suggestion。默认建议是 subagent read-only。

## Prompt 注入

统一 middleware 注入一个 Openwork-owned section，并在内部按来源分区。

建议结构：

```text
Openwork memory and context:

Soul:
- ...

Rules:
- Source: Global AGENTS.md
  ...
- Source: Workspace AGENTS.md
  ...

Personal memory:
- About me:
  - ...
- Current workspace:
  - ...
- Corrections:
  - ...

Use this section as background context. Current user messages override memory and context when they conflict. Do not claim a pending memory is saved until the user confirms it.
```

空 section 不输出。临时模式不输出整个 Openwork memory section。

section 优先级：

1. 当前用户消息。
2. 安全和权限约束。
3. 临时模式。
4. 系统 prompt。
5. Openwork memory and context。

在 `Openwork memory and context` 内部，`soul` 和 `rules` 是指令性上下文，结构化个人记忆是背景事实。发生冲突时，当前用户消息优先，必要时建议用户更新记忆。

## 数据模型

Prisma 作为结构化个人记忆的唯一权威存储。不要用文件存储个人记忆事实，也不要把结构化记忆塞进文件型上下文来源。

建议新增三张表。

### AgentMemory

| 字段 | 类型 | 说明 |
|---|---|---|
| `memoryId` | String | 主键 |
| `type` | String | `about_me` / `workspace_context` / `correction` |
| `scope` | String | `global` / `workspace` |
| `workspaceKey` | String? | `scope=workspace` 时必填，由 main 计算 |
| `content` | String | 写入 prompt 的短文本 |
| `status` | String | `active` / `archived` |
| `source` | String | `user` / `agent_suggestion` |
| `createdAt` | BigInt | 毫秒时间戳 |
| `updatedAt` | BigInt | 毫秒时间戳 |
| `lastIncludedAt` | BigInt? | 最近一次被放入上下文包的时间 |
| `metadata` | String? | JSON，保存来源 run/thread 等低频信息 |

索引：

- `(type, status, updatedAt)`
- `(scope, workspaceKey, status, updatedAt)`

### AgentMemorySuggestion

| 字段 | 类型 | 说明 |
|---|---|---|
| `suggestionId` | String | 主键 |
| `type` | String | 候选记忆类型 |
| `scope` | String | 候选作用范围 |
| `sourceWorkspaceKey` | String? | 候选产生时的工作区归属，由 main 计算 |
| `workspaceKey` | String? | 兼容字段；新实现优先使用 `sourceWorkspaceKey` |
| `content` | String | 候选内容 |
| `reason` | String? | Agent 建议保存的原因 |
| `reviewPayload` | String? | JSON，保存候选依据、来源片段、风险标记 |
| `decision` | String? | JSON，保存用户最终决策和编辑后的内容 |
| `status` | String | `pending` / `accepted` / `rejected` |
| `threadId` | String? | 来源线程 |
| `sourceRunId` | String? | 来源运行 |
| `createdAt` | BigInt | 毫秒时间戳 |
| `updatedAt` | BigInt | 毫秒时间戳 |
| `resolvedAt` | BigInt? | 用户处理时间 |

这张表是记忆候选队列，不是运行时中断队列。

### AgentMemoryInclusion

| 字段 | 类型 | 说明 |
|---|---|---|
| `inclusionId` | String | 主键 |
| `memoryId` | String | 被注入上下文的结构化记忆 |
| `threadId` | String | 来源线程 |
| `runId` | String | 来源运行 |
| `createdAt` | BigInt | 毫秒时间戳 |

`AgentMemoryInclusion` 只记录结构化个人记忆被放入本次 prompt。它不声称模型实际引用了这条记忆。文件来源可以从 run metadata 的 context pack 中查看，不进入 inclusion 表。

V1 不预留 `serverId`、`syncState` 等同步字段。未来同步应作为显式迁移增加，而不是提前污染本地模型。

## 配置命名

`AgentConfig.memorySources` 直接移除，不做兼容迁移。

原因：

- 当前产品仍在架构调整期，没有线上历史配置负担。
- `memorySources` 这个名字会和结构化个人记忆冲突。
- V1 不需要任意外部 instruction source；文件型上下文只保留明确的 `soul.md` 和 `AGENTS.md`。

当前 `AgentConfig` 只保留：

```ts
export interface AgentConfig {
  desktopAutomationAllowlist: string[]
  skillSources: string[]
  locale: AppLocale
}
```

## 读取链路

`AgentService.invoke` 是快照构建点，`OpenworkMemoryMiddleware.wrapModelCall` 是注入点。

建议顺序：

1. `AgentService.invoke` 读取 thread metadata。
2. main process 计算 `OpenworkWorkspaceIdentity`。
3. `beginAgentRun` 创建 run。
4. 未开启临时模式时调用 `OpenworkMemoryService.buildContextPack`：
   - 读取 `soul.md`。
   - 读取全局和当前工作区 `AGENTS.md`。
   - 读取 `instructionSources`。
   - 查询结构化个人记忆。
5. 把完整 `OpenworkMemoryContextSnapshot` 写入 run metadata。
6. `createAgentRuntime` 创建 `createOpenworkMemoryMiddleware`。
7. 每次 model call 由 middleware 追加 `Openwork memory and context` section。
8. run 完成后 `AgentService` 读取 `openworkMemoryRuntime.getIncludedStructuredMemoryIds()`，写入 `AgentMemoryInclusion` 并更新 `lastIncludedAt`。

`resume` 不重新构建上下文。它必须先校验 workspace identity，再从原 run metadata 读取 `OpenworkMemoryContextSnapshot` 创建 middleware，保证同一次 run 的上下文一致。

## 写入链路

写入必须经过用户确认。middleware 只能创建 pending suggestion，不能直接创建 active memory，也不能改写 `soul.md` 或 `AGENTS.md`。

候选记忆生成规则：

| 场景 | 是否允许生成 suggestion | 原因 |
|---|---:|---|
| 用户显式说“记住……” | 是 | 用户主动授权长期保存 |
| 用户纠正可复用偏好或判断 | 是 | 可降低同类错误重复出现 |
| 用户确认当前工作区长期事实 | 是 | 作用域明确，后续可复用 |
| 同类纠正重复出现 | 是 | 可建议保存为 correction |
| 当前任务指令 | 否 | 只属于当前 run |
| 临时表达偏好 | 否 | 不稳定 |
| 普通聊天事实、链接、热点 | 否 | 未来复用价值不明确 |
| repo 中可实时读取的实现事实 | 默认否 | 容易过期，除非用户声明为长期上下文 |
| secrets、tokens、隐私身份信息 | 否 | 不应进入长期记忆 |
| `soul.md`、`AGENTS.md`、规则文件内容 | 否 | 属于文件型上下文，不属于结构化个人记忆 |

### 用户主动写

用户说“记住……”时，Agent 可调用 `suggest_personal_memory` 工具。工具创建 `AgentMemorySuggestion`，renderer 展示确认卡，用户接受后由设置 API 转成 `AgentMemory`。

工具创建 suggestion 时只记录 source scope/source workspace，不决定最终 target workspace。最终 target 在 `memory:acceptSuggestion` 里由用户选择和 main 校准共同决定。

### Agent 建议写

Agent 在被纠正或发现稳定偏好时可以调用同一个工具。建议必须包含：

- `type`
- `scope`
- `content`
- `reason`

工具返回“已加入待确认记忆”，不声称已经记住。

候选被用户接受后才写入 `AgentMemory`。生效时间为下一次 run 开始时；当前 run 的 `OpenworkMemoryContextPack` 不动态更新。

### 文件型上下文修改

`soul.md`、`AGENTS.md`、instruction sources 的修改不走 `suggest_personal_memory`。

如果未来要支持修改：

- 必须作为独立编辑文件操作。
- 必须展示 diff。
- 必须经过用户确认。
- 不得由记忆 suggestion 流程静默改写。

## UI 状态与 IPC

记忆 UI 分三类数据读取，避免一个大接口一次性返回所有内容。

IPC 约束：

- list 接口可以接收筛选条件和 workspace claim，但不能接收任意 `workspaceKey` 来扩大读取范围。
- 创建、编辑 active workspace memory 时，renderer 传 `scope: "workspace"` 和当前 workspace claim；实际 `workspaceKey` 由 main 从 thread/run/current workspace identity 填入。
- 接受 pending suggestion 时，renderer 必须传保存目标：`source_workspace`、`current_workspace` 或 `global`。`source_workspace` 使用 suggestion 记录的 source identity；`current_workspace` 使用 main-resolved current identity；`global` 不写 `workspaceKey`。
- 回答后 `MemoryReviewCard` 使用 `threadId` / `runId` 查询来源候选，不允许前端用 workspace 参数拼装查询。
- 设置页的 `Current workspace` tab 由 main 返回当前 workspace identity 后查询。
- controller 只做 schema 解析和身份派发，归属判断放在 service。

建议 IPC：

| API | 用途 |
|---|---|
| `memory:getSettings` | 读取 `Use memory`、`Ask before saving`、`Show included memories` |
| `memory:setSettings` | 更新记忆设置 |
| `memory:listMemories` | 设置页按类型、作用域、查询词列出 active/archived memory |
| `memory:updateMemory` | 编辑一条 active memory |
| `memory:archiveMemory` | 归档一条 active memory |
| `memory:deleteMemory` | 永久删除一条 memory |
| `memory:listSuggestions` | 设置页和回答后卡片读取 pending suggestions |
| `memory:acceptSuggestion` | 接受或编辑后接受候选 |
| `memory:rejectSuggestion` | 拒绝候选 |
| `memory:listIncludedMemoriesForRun` | 回答后展示本次注入上下文的 memories |
| `memory:listContextSources` | 展示 `soul.md`、`AGENTS.md`、instruction sources 的来源和路径 |
| `memory:getCurrentWorkspaceIdentity` | 设置页展示当前工作区归属，只读 |
| `agent:resume` | 不一致时返回 workspace mismatch 状态，由 UI 展示选择 |
| `agent:forkFromRun` | 用户选择在当前工作区 fork 时创建新 run |

Renderer 组件建议：

| 组件 | 位置 | 说明 |
|---|---|---|
| `MemoryStatusChip` | chat composer footer | 展示 `Memory on` / `Temporary` / `Memory off`，打开 run 级 popover |
| `MemoryReviewCard` | assistant turn footer | 展示单条 pending suggestion 的接受、编辑、拒绝 |
| `IncludedMemoriesDisclosure` | assistant turn footer | 折叠展示本次注入上下文的 active memory |
| `MemoryTab` | settings | 管理 active memory、pending suggestions、context sources |
| `MemoryRow` | settings | 单条 active memory 的编辑、归档、删除 |
| `MemorySuggestionRow` | settings | 单条 pending suggestion 的审核 |
| `ContextSourceRow` | settings | 展示 `soul.md`、`AGENTS.md`、instruction sources |

普通 pending suggestion 不进入现有 `pendingApproval` / `ComposerApprovalPrompt`。现有 HITL 仍用于工具审批和真正需要阻塞的高风险行为。记忆审核是异步产品流：

```text
run finishes
  -> UI reads pending suggestions for run
  -> MemoryReviewCard renders below assistant turn
  -> user accepts / edits / rejects
  -> active memory affects next run
```

回答后卡片和设置页操作都必须支持本地即时反馈：接受、拒绝、归档后先更新本地行状态，再等 IPC 成功；失败时在原卡片/行内展示错误。

workspace 差异和 claim mismatch 的 UI 行为：

- `MemoryReviewCard`：如果 source workspace 与当前 workspace 不同，不移除卡片，不改变 suggestion 状态；卡片内同时显示 source/current，并让用户选择保存到 source、current 或 global。
- 只有保存到 current workspace 时才校验 current workspace claim；不一致时返回 mismatch，卡片保留并提示刷新。
- `MemoryTab`：保留用户当前 tab，刷新当前 workspace chip，并重新请求 main-resolved 列表。
- `Resume`：展示原 run workspace 和当前 workspace，等待用户选择；在选择前不得调用实际 resume。
- controller/service 返回 typed mismatch，不使用普通 throw message 让 renderer 猜错误类型。

## 交互验收

V1 UI 完成时必须满足：

- composer 能清楚显示当前 run 是否使用记忆。
- 用户能在发送前切换当前 run 为 temporary。
- assistant 回答后能看到本次注入上下文的 active memory 数量，并可展开查看。
- assistant 回答后若产生候选记忆，用户能在原位置接受、编辑、拒绝。
- 设置页 Memory tab 能管理 pending、about me、current workspace、corrections、context sources。
- `soul.md`、`AGENTS.md`、instruction sources 只作为 context sources 展示，不出现在结构化个人记忆列表。
- 普通记忆审核不会阻塞 run，也不会占用 composer approval UI。
- 高风险文件型上下文修改仍走同步确认或 diff 审核。

## 临时模式

临时模式是 run-level 参数，建议扩展 `AgentInvokeParams` 和 `window.api.agent.invoke`：

```ts
temporaryMode?: boolean
```

开启后：

- `contextPack` 为 `null`。
- middleware 不注入 Openwork memory section。
- middleware 不暴露 `suggest_personal_memory` 工具。
- 不展示 included memories。
- run metadata 记录 `memoryTemporaryMode: true`，便于排查。

## 验证

实现时至少覆盖：

- `OpenworkMemoryService.buildContextPack` 单元测试：文件来源顺序、结构化记忆过滤、工作区隔离、数量上限。
- workspace identity 单元测试：路径规范化、matching claim 可通过、stale claim 返回 mismatch、workspace memory 只能绑定 main-resolved thread/current workspace。
- `createOpenworkMemoryMiddleware` 单元测试：普通模式注入 prompt，临时模式不注入，subagent 不暴露写工具。
- IPC schema 测试：renderer 可以传 claim，但不能通过 claim 伪造其他工作区写入。
- suggestion 操作测试：accept/reject 必须校验 suggestion 的 thread/run/source workspace 和保存目标；用户切换 workspace 后可以处理旧候选，但不能静默保存到错误 workspace。
- `AgentService.invoke` 测试：普通运行写入快照并把 included structured ids 落到 `AgentMemoryInclusion`。
- `AgentService.resume` 测试：同工作区复用原 run 快照；不同工作区返回 mismatch；fork 重新构建当前工作区 context pack。
- BDD 场景：使用临时 `OPENWORK_HOME` 启动，用户接受一条记忆后，下一次同工作区运行可见，其他工作区不可见。
- BDD 场景：用户在工作区 A 创建 session，再切到工作区 B resume，UI 必须要求回到 A、fork、只查看历史或取消。

文档、纯 UI 文案或无行为变化的整理不需要强行补 BDD。

## 实施顺序

1. 增加 shared types：`OpenworkMemoryContextPack`、结构化记忆类型、配置类型。
2. 增加 Prisma migration：`AgentMemory`、`AgentMemorySuggestion`、`AgentMemoryInclusion`。
3. 删除 `AgentConfig.memorySources` 和设置页 `Memory Sources` 入口。
4. 实现 file providers：`soul.md`、`AGENTS.md`。
5. 实现 workspace identity 计算和 workspace claim resolution；memory IPC 接收 claim，但写入只使用 main-resolved `workspaceKey`。
6. 实现 `OpenworkMemoryService.buildContextPack`。
7. 实现 frozen `OpenworkMemoryContextSnapshot`。
8. 实现 `createOpenworkMemoryMiddleware`，替换 DeepAgents `createMemoryMiddleware`。
9. 在 `AgentService.invoke/resume` 接入 run 快照和 workspace mismatch 检查。
10. 增加 `suggest_personal_memory` 工具，只写 pending suggestion。
11. 在设置页增加 Memory tab 和 pending queue。
12. 在回答 UI 展示 included memories。
13. 增加临时模式 run 参数。
14. 补测试和基础验收。

每一步都保持可运行，不把 UI、DB、runtime 三层压成一次大改。

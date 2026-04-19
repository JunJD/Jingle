# Extension Middleware 实现方案（中文版）

## 背景

OpenWork 需要一个 extension 系统，同时支持 **UI 命令**（给员工用）和 **Skills**（给 AI agent 用）。目标是让 extension 的功能可以通过三种接口访问：

1. **UI 接口** - 员工通过 launcher UI 触发命令
2. **Agent 接口** - AI agent 通过 middleware 调用工具
3. **CLI 接口** - 从终端调用命令（未来）

目前 OpenWork 有原生 extension（GitHub、Todo List、Translate、Apple Reminders），但只支持 UI 命令。我们需要扩展这个系统，让它也支持 agent 工具，同时保持现有的 UI 功能。

**核心需求：**
- UI 和 Agent 接口共享同样的业务逻辑
- Extension 声明 actions，带 Zod schema（给 agent tool calling 用）
- 凭证通过现有的 preference 系统管理
- 遵循现有的 deepagents middleware 模式
- 避免 SuperCmd 的运行时编译问题（用构建时编译）

**为什么要做这个改动：**
- 让 AI agent 可以使用 extension 功能（比如"创建一个 GitHub issue"）
- 统一 UI 和 agent 能力（skill-era 思维，不是 tool-era）
- 为外部 extension 生态打基础

## 架构概览

```
Extension 结构：
├── manifest.ts          # 元数据、命令、偏好设置、actions
├── actions.ts           # 业务逻辑（UI 和 Agent 共享）
├── main.ts             # 后端入口（RPC service）
└── renderer.ts         # UI 组件

调用流程：
UI → IPC → Action Handler → 业务逻辑
Agent → Middleware → Action Handler → 业务逻辑
```

## 实现方案

### 1. 扩展 Extension Manifest 格式

**文件：** `src/shared/native-extensions.ts`

在 manifest schema 中添加 `actions` 字段：

```typescript
interface NativeExtensionAction {
  name: string                    // 比如 "create-issue"
  title: string                   // 比如 "Create Issue"
  description: string             // 给 agent tool 的描述
  schema: z.ZodSchema            // 输入验证 schema
  requiresCredentials?: boolean   // 默认：true
}

interface NativeExtensionManifest {
  // ... 现有字段
  actions?: NativeExtensionAction[]
}
```

### 2. 创建 Action 定义模式

**文件：** `src/extensions/github/actions.ts`（新文件）

定义 actions 和 handlers：

```typescript
import { z } from "zod"

export const createIssueAction = {
  name: "create-issue",
  title: "Create Issue",
  description: "在仓库中创建一个新的 GitHub issue",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional(),
    labels: z.array(z.string()).optional()
  }),
  requiresCredentials: true,
  
  handler: async (context: ActionContext) => {
    const { input, credentials, workspacePath } = context
    const { accessToken } = credentials
    
    // 业务逻辑
    const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `token ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        labels: input.labels
      })
    })
    
    const issue = await response.json()
    return {
      success: true,
      issueNumber: issue.number,
      url: issue.html_url
    }
  }
}

export const githubActions = [createIssueAction]
```

**类型定义：**

```typescript
interface ActionContext {
  input: unknown              // 已通过 schema 验证
  credentials: Record<string, string>  // 从 preferences 获取
  workspacePath: string
  threadId: string
}

interface ActionHandler {
  (context: ActionContext): Promise<unknown>
}
```

### 3. 实现 Extension Middleware

**文件：** `src/main/agent/extension-middleware.ts`（新文件）

创建 middleware，将 extension actions 注册为 tools：

```typescript
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { nativeExtensionManifests } from "../../extensions"
import { nativeExtensionActions } from "../../extensions/actions"
import { getExtensionPreferences } from "../preferences"

export function createExtensionMiddleware(props: {
  threadId: string
  workspacePath: string
}) {
  const tools = []
  
  // 加载所有 extensions 和它们的 actions
  for (const manifest of nativeExtensionManifests) {
    const actions = nativeExtensionActions.get(manifest.name)
    if (!actions) continue
    
    for (const action of actions) {
      const toolName = `${manifest.name}_${action.name}`
      
      tools.push(
        tool(
          async (input, runtime: ToolRuntime) => {
            // 从 preferences 获取凭证
            let credentials = {}
            if (action.requiresCredentials !== false) {
              const prefs = await getExtensionPreferences(manifest.name)
              credentials = prefs
            }
            
            // 调用 action handler
            const result = await action.handler({
              input,
              credentials,
              workspacePath: props.workspacePath,
              threadId: props.threadId
            })
            
            return JSON.stringify(result)
          },
          {
            name: toolName,
            description: action.description,
            schema: action.schema
          }
        )
      )
    }
  }
  
  return createMiddleware({
    name: "extensionMiddleware",
    tools
  })
}
```

### 4. 在 Extension Index 中注册 Actions

**文件：** `src/extensions/actions.ts`（新文件）

所有 extension actions 的中央注册表：

```typescript
import { githubActions } from "./github/actions"
import { todoListActions } from "./todo-list/actions"
// ... 其他 extensions

export const nativeExtensionActions = new Map([
  ["github", githubActions],
  ["todo-list", todoListActions]
])
```

### 5. 将 Middleware 集成到 Agent Runtime

**文件：** `src/main/agent/runtime.ts`

在 middleware stack 中添加 extension middleware：

```typescript
import { createExtensionMiddleware } from "./extension-middleware"

function createSharedAgentLoopMiddleware() {
  return [
    todoListMiddleware(),
    createFilesystemMiddleware({ backend, systemPrompt: filesystemSystemPrompt }),
    createArtifactToolsMiddleware({ threadId, workspacePath }),
    createWebToolsMiddleware(),
    createExtensionMiddleware({ threadId, workspacePath }), // 新增
    createSummarizationMiddleware({ model, backend }),
    // ... 其余 middleware
  ] as const
}
```

### 6. 添加 IPC Handler 用于 Action 调用

**文件：** `src/main/native-extensions/controller.ts`

添加 IPC handler 让 UI 可以调用 actions：

```typescript
ipcMain.handle("nativeExtensions:invokeAction", async (_event, request: {
  extensionName: string
  actionName: string
  input: unknown
}) => {
  const { extensionName, actionName, input } = request
  
  // 获取 action 定义
  const actions = nativeExtensionActions.get(extensionName)
  const action = actions?.find(a => a.name === actionName)
  if (!action) {
    throw new Error(`在 extension ${extensionName} 中找不到 action ${actionName}`)
  }
  
  // 验证输入
  const validatedInput = action.schema.parse(input)
  
  // 获取凭证
  const credentials = await getExtensionPreferences(extensionName)
  
  // 调用 handler
  return await action.handler({
    input: validatedInput,
    credentials,
    workspacePath: getCurrentWorkspacePath(),
    threadId: getCurrentThreadId()
  })
})
```

### 7. 更新 GitHub Extension 作为示例

**需要修改的文件：**
- `src/extensions/github/manifest.ts` - 添加 actions 数组
- `src/extensions/github/actions.ts` - 创建并添加 createIssueAction
- `src/extensions/github/renderer.ts` - 使用 invokeAction IPC 给 UI 用

**Manifest 更新示例：**

```typescript
import { createIssueAction } from "./actions"

export const githubManifest = defineNativeExtensionManifest({
  name: "github",
  title: "GitHub",
  capabilities: ["navigation", "surface"],
  preferences: [
    { name: "accessToken", type: "password", required: true }
  ],
  commands: [
    { name: "my-issues", mode: "view", title: "My Issues" },
    { name: "create-issue", mode: "view", title: "Create Issue" }
  ],
  actions: [createIssueAction] // 新增
})
```

## 关键文件

- `src/shared/native-extensions.ts` - 类型定义
- `src/main/agent/extension-middleware.ts` - Middleware 实现
- `src/extensions/actions.ts` - Action 注册表
- `src/extensions/github/actions.ts` - 示例 action 定义
- `src/main/agent/runtime.ts` - Middleware 集成
- `src/main/native-extensions/controller.ts` - IPC handlers

## 验证方案

### 1. 单元测试
- 测试 action schema 验证
- 测试凭证获取
- 测试 action handler 执行
- 测试 middleware tool 注册

### 2. 集成测试
- 测试 agent 通过 middleware 调用 extension tool
- 测试 UI 通过 IPC 调用 extension action
- 测试凭证流程端到端

### 3. 手动测试
1. 启动配置了 GitHub extension 的 OpenWork
2. 测试 UI：使用 launcher 创建一个 GitHub issue
3. 测试 Agent：让 agent "在 owner/repo 中创建一个标题为 'Test' 的 GitHub issue"
4. 验证两种方式都创建了同样的 issue
5. 检查凭证是否正确获取
6. 验证缺少凭证时的错误处理

### 4. BDD 测试（如果适用）
- Feature: Extension actions 可被 agents 访问
- Scenario: Agent 创建 GitHub issue
- Given: GitHub extension 配置了有效的 token
- When: Agent 调用 github_create-issue tool
- Then: Issue 被创建并返回 URL

## 未来增强

1. **CLI 接口** - 添加 CLI 命令来调用 actions
2. **外部 Extensions** - 支持加载 .openwork 包
3. **Action 组合** - 允许 actions 调用其他 actions
4. **流式结果** - 支持长时间运行的 actions 的流式输出
5. **Action 审批** - 对敏感 actions 进行 HITL 审批
6. **Deeplink 支持** - `openwork://extensions/github/create-issue`

## 注意事项

- 这个设计避免了 SuperCmd 的运行时编译问题，使用构建时编译
- Actions 是静态注册的，不是动态加载的
- 凭证使用现有的安全存储（Electron safeStorage）
- 遵循 artifact-tools-middleware.ts 的现有 middleware 模式
- 保持与现有 UI-only extensions 的向后兼容性

## 核心优势

### 1. 统一的业务逻辑
UI 和 Agent 调用同样的 action handler，避免代码重复，确保行为一致。

### 2. 类型安全
使用 Zod schema 进行输入验证，TypeScript 类型检查，减少运行时错误。

### 3. 安全的凭证管理
复用现有的 Electron safeStorage 加密存储，不需要重新实现。

### 4. 可扩展性
新增 extension 只需要：
- 定义 actions.ts
- 在 manifest 中声明
- 在 actions.ts 注册

### 5. 遵循现有模式
完全遵循 deepagents 的 middleware 模式，不引入新的概念。

## 实现顺序建议

1. **第一步**：扩展类型定义（native-extensions.ts）
2. **第二步**：创建 GitHub extension 的 actions.ts 作为示例
3. **第三步**：实现 extension-middleware.ts
4. **第四步**：创建 actions 注册表（extensions/actions.ts）
5. **第五步**：集成到 runtime.ts
6. **第六步**：添加 IPC handler
7. **第七步**：更新 GitHub extension 的 manifest 和 renderer
8. **第八步**：编写测试
9. **第九步**：手动验证

## 示例：完整的调用流程

### Agent 调用流程

```
1. Agent 决定调用 github_create-issue tool
2. LangChain 调用 extensionMiddleware 中注册的 tool
3. Tool 从 preferences 获取 GitHub accessToken
4. Tool 调用 createIssueAction.handler()
5. Handler 调用 GitHub API
6. 返回结果给 Agent
```

### UI 调用流程

```
1. 用户在 launcher 中点击 "Create Issue"
2. Renderer 调用 IPC: nativeExtensions:invokeAction
3. Controller 找到 createIssueAction
4. Controller 验证输入（Zod schema）
5. Controller 获取凭证
6. Controller 调用 createIssueAction.handler()
7. Handler 调用 GitHub API
8. 返回结果给 UI
```

两种流程都调用同样的 `createIssueAction.handler()`，确保行为一致。

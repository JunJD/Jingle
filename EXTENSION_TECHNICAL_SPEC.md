# OpenWork Extension System 技术规范

## 文档概述

**文档版本**: 1.0  
**创建日期**: 2026-04-19  
**目标读者**: 开发团队、架构师  
**相关文档**: EXTENSION_MIDDLEWARE_PLAN_CN.md, SUPERCMD_ANALYSIS.md

## 1. 系统概述

### 1.1 目标

OpenWork Extension System 旨在提供一个统一的扩展机制，让第三方服务（GitHub、Salesforce、Jira 等）的功能可以通过三种接口访问：

1. **UI 接口** - 员工通过图形界面操作
2. **Agent 接口** - AI agent 通过工具调用
3. **CLI 接口** - 命令行脚本调用（未来）

### 1.2 核心原则

- **Skill-era 思维**：Extension 提供完整的能力（带上下文和指导），而不是零散的工具函数
- **统一业务逻辑**：UI 和 Agent 调用同样的代码，避免重复和不一致
- **构建时编译**：避免运行时编译的复杂性和安全风险
- **类型安全**：全程 TypeScript + Zod schema 验证
- **安全优先**：凭证加密存储，敏感操作需要审批

### 1.3 与现有系统的关系

```
OpenWork 架构层次：
┌─────────────────────────────────────────┐
│  UI Layer (Electron Renderer)          │
│  - Launcher                             │
│  - Extension Commands                   │
└─────────────────────────────────────────┘
           ↓ IPC
┌─────────────────────────────────────────┐
│  Main Process                           │
│  - Extension Controller                 │
│  - Preference Manager                   │
│  - Agent Runtime                        │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  Extension Layer (本次新增)             │
│  - Extension Middleware                 │
│  - Action Registry                      │
│  - Action Handlers                      │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  External Services                      │
│  - GitHub API                           │
│  - Salesforce API                       │
│  - Jira API                             │
└─────────────────────────────────────────┘
```

## 2. 架构设计

### 2.1 Extension 结构

每个 extension 包含以下文件：

```
src/extensions/github/
├── manifest.ts          # Extension 元数据
├── actions.ts           # Action 定义和业务逻辑
├── main.ts             # 后端入口（可选 RPC service）
├── renderer.ts         # UI 入口
└── src/
    ├── components/     # React 组件
    └── utils/          # 工具函数
```

### 2.2 核心概念

#### 2.2.1 Action

Action 是 extension 暴露的最小功能单元，包含：

- **name**: 唯一标识符（如 `create-issue`）
- **title**: 人类可读的标题（如 "Create Issue"）
- **description**: 给 AI agent 的描述（用于 tool calling）
- **schema**: Zod schema，定义输入参数
- **handler**: 异步函数，执行业务逻辑
- **requiresCredentials**: 是否需要凭证（默认 true）

#### 2.2.2 Action Context

每个 action handler 接收一个 context 对象：

```typescript
interface ActionContext {
  input: unknown              // 已通过 schema 验证的输入
  credentials: Record<string, string>  // 从 preferences 获取的凭证
  workspacePath: string       // 当前工作区路径
  threadId: string           // 当前对话线程 ID
}
```

#### 2.2.3 Extension Middleware

Middleware 是连接 extension 和 agent runtime 的桥梁：

- 加载所有 extensions 的 actions
- 将每个 action 注册为 LangChain tool
- 处理凭证获取和验证
- 调用 action handler 并返回结果

### 2.3 调用流程

#### 2.3.1 Agent 调用流程

```
┌─────────┐
│ Agent   │ "创建一个 GitHub issue"
└────┬────┘
     │
     ↓ LangChain tool calling
┌─────────────────────┐
│ Extension Middleware│
│ - github_create-issue tool
└────┬────────────────┘
     │
     ↓ 获取凭证
┌─────────────────────┐
│ Preference Manager  │
│ - getExtensionPreferences("github")
└────┬────────────────┘
     │
     ↓ 调用 handler
┌─────────────────────┐
│ Action Handler      │
│ - createIssueAction.handler()
└────┬────────────────┘
     │
     ↓ HTTP 请求
┌─────────────────────┐
│ GitHub API          │
└─────────────────────┘
```

#### 2.3.2 UI 调用流程

```
┌─────────┐
│ UI      │ 用户点击 "Create Issue"
└────┬────┘
     │
     ↓ IPC
┌─────────────────────┐
│ Extension Controller│
│ - nativeExtensions:invokeAction
└────┬────────────────┘
     │
     ↓ 查找 action
┌─────────────────────┐
│ Action Registry     │
│ - nativeExtensionActions.get("github")
└────┬────────────────┘
     │
     ↓ 验证输入 + 获取凭证
┌─────────────────────┐
│ Action Handler      │
│ - createIssueAction.handler()
└────┬────────────────┘
     │
     ↓ HTTP 请求
┌─────────────────────┐
│ GitHub API          │
└─────────────────────┘
```

## 3. 数据模型

### 3.1 类型定义

```typescript
// ActionContext - Action handler 的输入
interface ActionContext {
  input: unknown
  credentials: Record<string, string>
  workspacePath: string
  threadId: string
}

// NativeExtensionAction - Action 定义
interface NativeExtensionAction {
  name: string
  title: string
  description: string
  schema: z.ZodSchema
  requiresCredentials?: boolean
  handler: (context: ActionContext) => Promise<unknown>
}

// NativeExtensionPackageManifest - Extension 元数据
interface NativeExtensionPackageManifest {
  name: string
  title: string
  description?: string
  capabilities: LauncherCommandOwnerCapability[]
  commands: NativeExtensionCommandManifest[]
  preferences?: NativeExtensionPreferenceSchema[]
  actions?: NativeExtensionAction[]  // 新增
  rpcMethods?: string[]
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
}
```

### 3.2 Schema 示例

以 GitHub create-issue action 为例：

```typescript
const createIssueSchema = z.object({
  owner: z.string().describe("仓库所有者（用户名或组织名）"),
  repo: z.string().describe("仓库名称"),
  title: z.string().describe("Issue 标题"),
  body: z.string().optional().describe("Issue 正文（Markdown 格式）"),
  labels: z.array(z.string()).optional().describe("标签列表"),
  assignees: z.array(z.string()).optional().describe("指派给的用户列表"),
  milestone: z.number().optional().describe("里程碑编号")
})
```

### 3.3 凭证存储

凭证通过 Electron 的 `safeStorage` API 加密存储：

```typescript
// 存储位置
~/.openwork/
├── settings.json          # 非敏感配置
└── secrets.json           # 加密的凭证

// secrets.json 结构
{
  "nativeExtensionSecrets": {
    "github": {
      "accessToken": "base64_encrypted_value"
    },
    "salesforce": {
      "clientId": "base64_encrypted_value",
      "clientSecret": "base64_encrypted_value"
    }
  }
}
```

## 4. 关键组件实现

### 4.1 Extension Middleware

**文件**: `src/main/agent/extension-middleware.ts`

**职责**:
- 加载所有 extensions 的 actions
- 为每个 action 创建 LangChain tool
- 处理凭证获取
- 调用 action handler

**关键代码**:

```typescript
export function createExtensionMiddleware(props: {
  threadId: string
  workspacePath: string
}) {
  const tools = []
  
  for (const manifest of nativeExtensionManifests) {
    const actions = nativeExtensionActions.get(manifest.name)
    if (!actions) continue
    
    for (const action of actions) {
      const toolName = `${manifest.name}_${action.name}`
      
      tools.push(
        tool(
          async (input, runtime: ToolRuntime) => {
            // 获取凭证
            let credentials = {}
            if (action.requiresCredentials !== false) {
              const prefs = await getExtensionPreferences(manifest.name)
              credentials = prefs
            }
            
            // 调用 handler
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

### 4.2 Action Registry

**文件**: `src/extensions/actions.ts`

**职责**:
- 中央注册所有 extensions 的 actions
- 提供统一的查找接口

**关键代码**:

```typescript
import { githubActions } from "./github/actions"
import { todoListActions } from "./todo-list/actions"
import { translateActions } from "./translate/actions"

export const nativeExtensionActions = new Map([
  ["github", githubActions],
  ["todo-list", todoListActions],
  ["translate", translateActions]
])
```

### 4.3 IPC Handler

**文件**: `src/main/native-extensions/controller.ts`

**职责**:
- 处理 UI 的 action 调用请求
- 验证输入
- 获取凭证
- 调用 action handler

**关键代码**:

```typescript
ipcMain.handle("nativeExtensions:invokeAction", async (_event, request: {
  extensionName: string
  actionName: string
  input: unknown
}) => {
  const { extensionName, actionName, input } = request
  
  // 查找 action
  const actions = nativeExtensionActions.get(extensionName)
  const action = actions?.find(a => a.name === actionName)
  if (!action) {
    throw new Error(`Action ${actionName} not found in extension ${extensionName}`)
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

## 5. 示例：GitHub Extension

### 5.1 Action 定义

**文件**: `src/extensions/github/actions.ts`

```typescript
import { z } from "zod"
import type { ActionContext, NativeExtensionAction } from "../../shared/native-extensions"

const createIssueSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  title: z.string(),
  body: z.string().optional(),
  labels: z.array(z.string()).optional()
})

export const createIssueAction: NativeExtensionAction = {
  name: "create-issue",
  title: "Create Issue",
  description: "Create a new GitHub issue in a repository",
  schema: createIssueSchema,
  requiresCredentials: true,
  
  handler: async (context: ActionContext) => {
    const { input, credentials } = context
    const { accessToken } = credentials
    const { owner, repo, title, body, labels } = input as z.infer<typeof createIssueSchema>
    
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          "Authorization": `token ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github.v3+json"
        },
        body: JSON.stringify({ title, body, labels })
      }
    )
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(`GitHub API error: ${error.message}`)
    }
    
    const issue = await response.json()
    return {
      success: true,
      issueNumber: issue.number,
      url: issue.html_url,
      title: issue.title
    }
  }
}

export const githubActions = [createIssueAction]
```

### 5.2 Manifest 更新

**文件**: `src/extensions/github/manifest.ts`

```typescript
import { defineNativeExtensionManifest } from "../../shared/native-extensions"
import { createIssueAction } from "./actions"

export const githubManifest = defineNativeExtensionManifest({
  name: "github",
  title: "GitHub",
  description: "Manage GitHub repositories, issues, and pull requests",
  capabilities: ["navigation", "surface"],
  preferences: [
    {
      name: "accessToken",
      type: "password",
      required: true,
      title: "Personal Access Token",
      description: "GitHub personal access token with repo scope"
    }
  ],
  commands: [
    { name: "my-issues", mode: "view", title: "My Issues" },
    { name: "create-issue", mode: "view", title: "Create Issue" }
  ],
  actions: [createIssueAction]  // 新增
})
```

## 6. 错误处理

### 6.1 错误类型

```typescript
// 凭证缺失
class MissingCredentialsError extends Error {
  constructor(extensionName: string, requiredFields: string[]) {
    super(`Extension ${extensionName} requires: ${requiredFields.join(", ")}`)
    this.name = "MissingCredentialsError"
  }
}

// 输入验证失败
class ValidationError extends Error {
  constructor(message: string, public issues: z.ZodIssue[]) {
    super(message)
    this.name = "ValidationError"
  }
}

// API 调用失败
class ExternalAPIError extends Error {
  constructor(
    public service: string,
    public statusCode: number,
    message: string
  ) {
    super(`${service} API error (${statusCode}): ${message}`)
    this.name = "ExternalAPIError"
  }
}
```

### 6.2 错误处理流程

```typescript
// 在 action handler 中
try {
  const result = await action.handler(context)
  return { success: true, data: result }
} catch (error) {
  if (error instanceof z.ZodError) {
    return {
      success: false,
      error: "Invalid input",
      details: error.issues
    }
  }
  
  if (error instanceof MissingCredentialsError) {
    return {
      success: false,
      error: "Missing credentials",
      message: error.message
    }
  }
  
  // 其他错误
  return {
    success: false,
    error: "Action failed",
    message: error.message
  }
}
```

## 7. 性能考虑

### 7.1 凭证缓存

```typescript
// 避免每次调用都读取加密文件
const credentialsCache = new Map<string, {
  credentials: Record<string, string>
  timestamp: number
}>()

const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

async function getExtensionPreferences(extensionName: string) {
  const cached = credentialsCache.get(extensionName)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.credentials
  }
  
  const credentials = await loadCredentialsFromDisk(extensionName)
  credentialsCache.set(extensionName, {
    credentials,
    timestamp: Date.now()
  })
  
  return credentials
}
```

### 7.2 Tool 注册优化

```typescript
// 只在 runtime 初始化时注册一次，不是每次调用都注册
let middlewareInstance: ReturnType<typeof createExtensionMiddleware> | null = null

export function getExtensionMiddleware(props: {
  threadId: string
  workspacePath: string
}) {
  if (!middlewareInstance) {
    middlewareInstance = createExtensionMiddleware(props)
  }
  return middlewareInstance
}
```

## 8. 安全考虑

### 8.1 凭证安全

- 使用 Electron `safeStorage` API 加密存储
- 凭证只在 main process 中访问，不传递给 renderer
- 支持凭证过期和刷新机制

### 8.2 输入验证

- 所有输入必须通过 Zod schema 验证
- 防止 SQL injection、XSS 等攻击
- 限制输入长度和格式

### 8.3 敏感操作审批

```typescript
// 未来可以添加 HITL 审批
const deleteRepositoryAction: NativeExtensionAction = {
  name: "delete-repository",
  title: "Delete Repository",
  description: "Delete a GitHub repository (requires approval)",
  schema: deleteRepoSchema,
  requiresApproval: true,  // 新增字段
  handler: async (context) => {
    // 实现删除逻辑
  }
}
```

## 9. 测试策略

### 9.1 单元测试

```typescript
describe("createIssueAction", () => {
  it("should validate input schema", () => {
    const invalidInput = { owner: "test" } // 缺少 repo 和 title
    expect(() => createIssueAction.schema.parse(invalidInput)).toThrow()
  })
  
  it("should call GitHub API with correct parameters", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ number: 123, html_url: "https://..." })
    })
    global.fetch = mockFetch
    
    const result = await createIssueAction.handler({
      input: { owner: "test", repo: "repo", title: "Test" },
      credentials: { accessToken: "token" },
      workspacePath: "/path",
      threadId: "thread-1"
    })
    
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/test/repo/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "token token"
        })
      })
    )
  })
})
```

### 9.2 集成测试

```typescript
describe("Extension Middleware Integration", () => {
  it("should register GitHub actions as tools", () => {
    const middleware = createExtensionMiddleware({
      threadId: "test-thread",
      workspacePath: "/test"
    })
    
    const tools = middleware.tools
    expect(tools).toContainEqual(
      expect.objectContaining({
        name: "github_create-issue"
      })
    )
  })
  
  it("should call action handler when tool is invoked", async () => {
    // 测试完整的调用流程
  })
})
```

### 9.3 E2E 测试

```typescript
describe("GitHub Extension E2E", () => {
  it("should create issue via UI", async () => {
    // 1. 启动 app
    // 2. 配置 GitHub token
    // 3. 打开 Create Issue 命令
    // 4. 填写表单
    // 5. 提交
    // 6. 验证 issue 创建成功
  })
  
  it("should create issue via Agent", async () => {
    // 1. 启动 agent runtime
    // 2. 发送消息："创建一个 GitHub issue"
    // 3. Agent 调用 github_create-issue tool
    // 4. 验证 issue 创建成功
  })
})
```

## 10. 部署和发布

### 10.1 构建流程

```bash
# 1. 编译 TypeScript
npm run build

# 2. 验证 extension manifests
npm run validate:extensions

# 3. 运行测试
npm run test

# 4. 打包 Electron app
npm run package
```

### 10.2 版本兼容性

```typescript
// Extension manifest 支持版本声明
interface NativeExtensionPackageManifest {
  // ... 其他字段
  minOpenWorkVersion?: string  // 最低支持的 OpenWork 版本
  maxOpenWorkVersion?: string  // 最高支持的 OpenWork 版本
}
```

## 11. 未来扩展

### 11.1 外部 Extension 支持

```typescript
// 支持加载 .openwork 包
interface ExternalExtensionPackage {
  manifest: NativeExtensionPackageManifest
  actions: NativeExtensionAction[]
  bundle: string  // 编译后的 JS bundle
}

async function loadExternalExtension(packagePath: string) {
  const pkg = await readExtensionPackage(packagePath)
  validateExtensionPackage(pkg)
  registerExtension(pkg)
}
```

### 11.2 CLI 接口

```bash
# 从命令行调用 extension action
openwork extension github create-issue \
  --owner anthropics \
  --repo openwork \
  --title "Bug report" \
  --body "Description..."
```

### 11.3 Deeplink 支持

```typescript
// 支持 deeplink 调用
// openwork://extensions/github/create-issue?owner=test&repo=repo&title=Test

app.on("open-url", (event, url) => {
  const parsed = parseDeeplink(url)
  if (parsed.type === "extension-action") {
    invokeExtensionAction(
      parsed.extensionName,
      parsed.actionName,
      parsed.params
    )
  }
})
```

## 12. 参考资料

- [LangChain Middleware 文档](https://js.langchain.com/docs/concepts/middleware)
- [Zod Schema 文档](https://zod.dev/)
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- [GitHub REST API](https://docs.github.com/en/rest)
- SuperCmd 源码分析：SUPERCMD_ANALYSIS.md

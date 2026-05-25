# Extension Connector Runtime Design

## 结论

Openwork 当前 extension 的问题不是 GitHub token 读取的局部 bug，而是缺少一个明确的 `connection/auth` 层。

正确边界应该是：

```txt
Extension package
  declares commands, AI capability, tools, preferences, connection

Connection resolver
  owns account/auth status, secrets, public config, connection errors

Runtime surfaces
  launcher command, @ mention, loadExtension, callExtensionTool
  all consume the same resolved connection
```

也就是说，GitHub token 不应该属于 `github:my-issues` command，也不应该只属于 AI source。它应该属于 `github` extension 的 connection。Command 和 AI tool 都从同一个 connection-backed execution context 里拿连接状态。

## 外部参考

### Raycast

Raycast 的 manifest 把 `commands`、`tools`、`preferences`、`ai.instructions` 放在同一个 extension package 里：

- `commands` 是 launcher 入口。
- `tools` 是 AI 可调用函数。
- `ai.instructions` 是 extension 被 AI 使用时注入的整体说明。
- `preferences` 可以是 extension 级，也可以是 command 级。Required preferences 会阻止 command 打开，直到用户补齐设置。

这说明 Raycast 没有把 command 和 AI 拆成两个账号体系。它们共享 extension package 的配置语义，只是在不同宿主运行。

GitHub Raycast extension 是最直接的例子：同一个 package 同时声明大量 commands、AI tools、`ai.instructions` 和 GitHub token preference。

Raycast 还提供 OAuth API。它的关键不是“URL scheme 本身就是 auth”，而是 OAuth 授权完成后通过 redirect method 回到 Raycast extension：

- `OAuth.RedirectMethod.Web`: provider redirect 到 `https://raycast.com/redirect?...`，再回到 Raycast。
- `OAuth.RedirectMethod.App`: provider redirect 到 `raycast://oauth?...`。
- `OAuth.RedirectMethod.AppURI`: provider redirect 到 `com.raycast:/oauth?...`，这是 Google 这类 native app OAuth 常见的 URI-style scheme。

Openwork 需要借鉴这层能力：connection auth 声明里要能表达“这个 OAuth provider 用哪种 redirect/callback 回来”，而不是只表达 token 字段。

参考：

- https://developers.raycast.com/information/manifest
- https://developers.raycast.com/api-reference/preferences
- https://developers.raycast.com/api-reference/oauth
- https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions
- https://developers.raycast.com/ai/create-an-ai-extension
- https://raw.githubusercontent.com/raycast/extensions/main/extensions/github/package.json
- https://raw.githubusercontent.com/raycast/extensions/main/extensions/notion/package.json

### SuperCmd

SuperCmd 值得参考的是 extension command 接入 launcher 的方式，不是 auth 存储方式。

本地参考：

- `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/commands.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-preferences-store.ts`

关键点：

- `discoverInstalledExtensionCommands()` 扫描每个 extension 的 `package.json`，把 `pkg.commands[]` 展平成 launcher 可搜索的 command。
- command metadata 保留 `extName`、`cmdName`、mode、arguments、keywords、icon。
- `getInstalledExtensionsSettingsSchema()` 同时暴露 extension preferences 和 command preferences 给 Settings。
- `getExtensionBundle(extName, cmdName)` 运行 command 时合并 extension preferences 和 command preferences。

SuperCmd 的价值是 command ingestion：

```txt
extension manifest commands
  -> ExtensionCommandInfo[]
  -> launcher CommandInfo[]
  -> runExtension(extName, cmdName)
```

但它的 preference store 是普通 JSON，不适合直接作为 Openwork 的安全 auth 设计。Openwork 应该保留 main-side secure secret store，把 SuperCmd 的 command 接入模式和 Openwork 的 connection resolver 分开。

### Craft Agents OSS

Craft 值得参考的是 Source 的 agent runtime 形态，不是它的全部文件夹模型。

本地参考：

- `/Users/junjieding/dingjunjie_dev/2026_03/craft-agents-oss/packages/shared/src/sources/types.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/craft-agents-oss/packages/shared/src/sources/server-builder.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/craft-agents-oss/packages/shared/src/agent/core/source-manager.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/craft-agents-oss/packages/shared/src/mentions/index.ts`

关键点：

- Source 是 agent 可见的数据/工具能力，不是简单 command。
- `SourceServerBuilder` 只负责从 source config + 已解析 credentials 构建 MCP/API server。它不自己读取 credentials。
- `SourceManager` 区分 intended active 和 actually active：UI 可以显示某个 source 被选中，但如果 auth/server build 失败，tools 仍然不可用。
- Source guide 是使用说明，tools 是可执行能力。Guide 可以存在于 missing auth 状态，但 tools 不能暴露。

这个分离对 Openwork 很关键：

```txt
selected/mentioned extension
  != connected
  != tools available
```

### ChatGPT / Claude connector 趋势

市场产品在往 connector/app 方向收敛：先有一个可管理的连接，再在 chat、deep research、tools、sync 等不同场景消费这个连接。

参考：

- ChatGPT connectors/apps: https://help.openai.com/en/articles/11487775/
- ChatGPT apps with sync: https://help.openai.com/en/articles/10847137-chatgpt-synced-connectors
- Claude remote MCP connectors: https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp
- Claude MCP connector API: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector

可借鉴的不是完整产品形态，而是一个原则：

```txt
Account connection is a first-class product/runtime object.
Tools, chat, research, and UI commands consume that object.
```

## 当前 Openwork 状态

当前 manifest 大致是这样：

```ts
export const githubManifest = defineNativeExtensionManifest({
  preferences: [
    { name: "accessToken", type: "password" },
    { name: "apiBaseUrl", type: "text" },
    { name: "defaultSearchTerms", type: "text" },
    { name: "numberOfResults", type: "text" }
  ],
  commands: [
    { name: "my-issues", mode: "view", preferences: [...] }
  ],
  aiCapability: {
    id: "github",
    requiredPreferenceNames: ["accessToken"],
    publicPreferenceNames: ["apiBaseUrl"],
    instructions: [...],
    guide: "...",
    toolNames: [...]
  }
})
```

代码落点：

- `src/shared/native-extensions.ts` 定义 extension manifest、command、aiCapability、preferences。
- `src/extensions/sources.ts` 用 `requiredPreferenceNames` + resolved preferences 推导 AI auth status。
- `src/main/preferences.ts` 同时有 `extensionSecrets` 和 `commandSecrets`，并且现在有 legacy command scoped password fallback。
- `src/main/extension-tools/executor.ts` 运行 AI tools 时传 `extensionPreferences`。
- `src/main/native-extensions/service.ts` 运行 command 时读 extension/command preferences。

当前问题是：auth 被塞在 `preferences` 里，AI 和 command 分别从 preferences 推导连接状态。只要 command-scoped token、extension-scoped token、AI snapshot、@ refs 任何一处不同步，就会出现“command 能用，AI 说未连接”。

## 目标边界

### Extension

Extension 是能力包，声明它能提供什么：

```txt
commands
AI capability
tools
settings schema
connection declaration
runtime services
```

Extension 不直接代表一个账号，也不直接代表一个 agent source。

### Command

Command 是人用的 launcher 入口。

它应该消费：

```txt
extension manifest
resolved connection
extension public preferences
command preferences
runtime capabilities
```

Command 不应该拥有 extension 级 token。

### AI Capability

AI Capability 是 agent 可加载的能力入口。

它应该消费：

```txt
instructions
guide
tool definitions
resolved connection status
public config snapshot
permission mode
```

AI Capability 不应该自己定义 auth 体系。它最多声明“我需要哪个 connection”。

### Connection

Connection 是账号/auth 的唯一归属。

它应该拥有：

```txt
provider
auth type
secret names
public preference names
status
missing reasons
connection error
```

它不拥有 command UI，也不拥有 AI tool 逻辑。

### Source

在 Openwork 里，Source 这个词只应该保留为 agent-facing loaded capability 的产品语言。

它不应该再作为核心数据模型引入 `SourceProfile` / `RunSourceBinding` / `profile` 主通路。当前更合适的主对象是：

```txt
ResolvedExtensionAiCapability
ResolvedExtensionConnection
ResolvedExtensionExecutionContext
```

## 建议 manifest

先做单 connection，不引入 profile/multi-account。

```ts
interface NativeExtensionConnectionManifest {
  id: "default"
  provider: "github" | "notion" | "apple-reminders" | string
  title: string
  auth: NativeExtensionConnectionAuthManifest
  publicPreferenceNames?: string[]
  connectGuide?: string
}

type NativeExtensionConnectionAuthManifest =
  | {
      type: "none"
      secretNames?: []
    }
  | {
      type: "personalAccessToken" | "apiKey"
      secretNames: string[]
    }
  | {
      type: "oauth"
      authorizationUrl: string
      clientId: string
      redirect: NativeExtensionOAuthRedirectManifest
      scopes: string[]
      secretNames: ["accessToken", "refreshToken"]
      tokenUrl: string
    }

type NativeExtensionOAuthRedirectManifest =
  | {
      method: "web"
      redirectUrl: string
    }
  | {
      method: "app-scheme"
      scheme: "openwork"
      callbackPath: "/oauth"
    }
  | {
      method: "app-uri"
      uriScheme: "com.openwork"
      callbackPath: "/oauth"
    }
```

GitHub 目标形态：

```ts
export const githubManifest = defineNativeExtensionManifest({
  name: "github",
  title: "GitHub",
  connection: {
    id: "default",
    provider: "github",
    title: "GitHub",
    auth: {
      type: "personalAccessToken",
      secretNames: ["accessToken"]
    },
    publicPreferenceNames: ["apiBaseUrl"],
    connectGuide:
      "Connect GitHub with a personal access token before reading or modifying repositories, issues, pull requests, notifications, or workflow runs."
  },
  preferences: [
    {
      name: "apiBaseUrl",
      type: "text",
      default: "https://api.github.com"
    },
    {
      name: "defaultSearchTerms",
      type: "text",
      default: ""
    },
    {
      name: "numberOfResults",
      type: "text",
      default: "25"
    }
  ],
  commands: [
    {
      name: "my-issues",
      mode: "view",
      preferences: [
        { name: "showCreated", type: "checkbox", default: true },
        { name: "showAssigned", type: "checkbox", default: true }
      ]
    }
  ],
  aiCapability: {
    id: "github",
    connectionId: "default",
    instructions: [...],
    guide: "...",
    toolNames: [...]
  }
})
```

OAuth 形态应该长这样：

```ts
export const notionManifest = defineNativeExtensionManifest({
  name: "notion",
  connection: {
    id: "default",
    provider: "notion",
    title: "Notion",
    auth: {
      type: "oauth",
      authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
      clientId: "...",
      redirect: {
        method: "app-scheme",
        scheme: "openwork",
        callbackPath: "/oauth"
      },
      scopes: [],
      secretNames: ["accessToken", "refreshToken"],
      tokenUrl: "https://api.notion.com/v1/oauth/token"
    },
    publicPreferenceNames: ["apiBaseUrl"]
  }
})
```

兼容期可以保留：

```ts
aiCapability.requiredPreferenceNames
```

但它应该只是 adapter：

```txt
old requiredPreferenceNames
  -> synthesized connection.auth.secretNames
```

主通路不能再依赖它。

## Connection Context

这里不是新增一个并列的 `extension-runtime`。仓库里已经有 `src/main/services/extension-runtime`，它负责启动和管理 extension command/UI session：

- `ExtensionRuntimeManager` 管 foreground/run-once/ambient session。
- `ExtensionRuntimeLaunchContext` 是 command session 的启动输入。
- `DefaultExtensionRuntimeHostCapabilities` 给 runtime process 提供 preferences、RPC、settings、clipboard、AI 等宿主能力。

这里要新增的是 main-side connection resolver。它给现有 `extension-runtime`、native extension service 和 AI tool executor 提供同一个连接上下文。

```ts
type ExtensionConnectionStatus =
  | "connected"
  | "missing"
  | "failed"
  | "unsupported"

interface ResolvedExtensionConnection {
  extensionName: string
  connectionId: string
  provider: string
  status: ExtensionConnectionStatus
  publicConfig: Record<string, unknown>
  missingSecretNames: string[]
  error?: string
}

interface ResolvedExtensionExecutionContext {
  extensionName: string
  connection: ResolvedExtensionConnection
  extensionPreferences: Record<string, unknown>
  commandPreferences?: Record<string, unknown>
}
```

它和现有 runtime 的关系是：

```txt
resolveExtensionExecutionContext(extensionName, commandName?)
  -> ExtensionRuntimeLaunchContext
  -> ExtensionRuntimeManager.startForeground/runOnce()
  -> runtime process host requests

resolveExtensionExecutionContext(extensionName)
  -> ExtensionToolExecutor
  -> extension AI tool handler

resolveExtensionExecutionContext(extensionName)
  -> invokeNativeExtension()
  -> native extension main service
```

Secret values 只由 main-side resolver 解析。当前 Openwork native extension runtime 仍需要把 secret 放进 `extensionPreferences` 给已存在 command/service/tool 消费，但这个对象必须由 connection resolver 生成，不能让 command 和 AI 各自读 store、各自判断连接状态。后续接 third-party Raycast-compatible command 时，再按宿主能力收紧 renderer 侧 secret 传递方式。

## 执行路径

### Settings 连接

```txt
manifest.connection
  -> Settings render connection form
  -> for PAT/API key: setExtensionConnectionSecret(extensionName, secretName)
  -> for OAuth: start auth request, receive redirect callback, exchange code for token set
  -> secure secret store
  -> emit connection/preferences changed
```

公共配置仍然走 preferences：

```txt
apiBaseUrl, numberOfResults, defaultSearchTerms
```

密钥配置走 connection secrets：

```txt
accessToken, refreshToken, apiKey
```

OAuth redirect 入口属于 app/main 层，而不是 command 或 AI tool：

```txt
openwork://oauth?extension=notion&state=...
  -> main deep-link handler
  -> validate state/code challenge
  -> exchange authorization code
  -> persist token set in connection secrets
  -> mark connection connected
```

这一步需要和 `loadExtension` 分开看。`loadExtension` 是 agent 能力加载；OAuth redirect 是用户连接账号的回调。

### Launcher command

```txt
run command github/my-issues
  -> resolveExtensionExecutionContext("github", "my-issues")
  -> connection.status === connected
  -> build ExtensionRuntimeLaunchContext from execution context
  -> existing extension-runtime starts command session
  -> command service calls GitHub
```

如果 connection missing，command 应该显示连接提示，而不是自己再去读 `github:my-issues.accessToken`。

### @ mention

`@github` 不应该绕过 load path 直接塞 tools。它应该在 run 开始时 preload extension，但进入的是同一个 loaded extension session。

```txt
refs include github
  -> resolveExtensionAiCapability("github")
  -> resolveExtensionConnection("github")
  -> loadedExtensions.add(github)
  -> if connected expose tools
  -> if missing inject guide/instructions but no tools
```

这样 `@github` 和模型主动 `loadExtension("github")` 的结果一致。

### 无 @ 自动加载

```txt
base catalog contains lightweight extension list
  -> model calls loadExtension("github")
  -> same resolver as @ mention
  -> same loaded extension session
```

catalog 可以告诉模型有哪些 extension 可加载，但不能把所有 tools 都提前暴露。

### AI tool call

```txt
callExtensionTool(ext__github__listMyIssues)
  -> binding lookup
  -> resolveExtensionExecutionContext("github")
  -> if connected, handler receives connection-backed context
  -> if missing/failed, return structured tool error
```

工具可见性和执行期都要看同一个 connection。只在加载时判断不够，因为用户可能在 run 中断后修改 Settings。

## 状态语义

```txt
connected
  Secret/config exists and this extension can expose tools.

missing
  User has not connected required auth. Inject instructions/guide, do not expose tools.

failed
  Auth exists but validation/build failed. Inject issue guidance, do not expose tools.

unsupported
  Platform unsupported. Do not expose command or tools for this host.
```

对 Apple Reminders：

```txt
connection.auth.type = "none"
supportedPlatforms = ["darwin"]
```

它不是“无 auth 就 missing”，而是本地系统能力。平台不支持时是 `unsupported`。

## 迁移计划

### Phase 1: 加 connection manifest，不改变 UI

- 在 `NativeExtensionPackageManifest` 增加 `connection?: NativeExtensionConnectionManifest`。
- GitHub/Notion 先声明 `connection`。
- Apple Reminders 声明 `auth.type = "none"` 和 darwin 白名单。
- 保留 `aiCapability.requiredPreferenceNames`，但改成兼容层。

### Phase 2: 新增 shared connection resolver

新增 main-side resolver，例如：

```txt
src/main/native-extensions/connection-resolver.ts
```

它负责：

- 读取 manifest connection。
- 读取 extension public preferences。
- 读取 extension secrets。
- 兼容读取 legacy command-scoped password。
- 返回 `ResolvedExtensionExecutionContext`。

legacy command-scoped password fallback 必须只在 resolver 里使用，`getResolvedNativeExtensionPreferenceRecord` 不再把旧 command token 伪装成 extension preference。

### Phase 3: AI source 改走 connection

`src/extensions/sources.ts` 不再直接用 `requiredPreferenceNames` 判断 auth。

新路径：

```txt
resolveNativeExtensionAiCapability
  -> getConnection(extensionName)
  -> authStatus = connection.status
  -> publicConfig = connection.publicConfig
```

验收重点：

- `@github` 和 `loadExtension("github")` 的 auth status 一致。
- missing auth 仍有 instructions/guide。
- connected auth 才暴露 tools。
- 空 refs 不读取无关 extension 连接。

### Phase 4: 现有 extension-runtime 改走 connection

现有 `extension-runtime` 不能绕开 connection resolver。具体落点是：

```txt
DefaultExtensionRuntimeHostCapabilities.getExtensionPreferences()
DefaultExtensionRuntimeHostCapabilities.getCommandPreferences()
DefaultExtensionRuntimeHostCapabilities.invokeNativeExtension()
ExtensionRuntimeLaunchContext
```

这些入口应该由 `ResolvedExtensionExecutionContext` 提供数据，而不是直接只拿 resolved preference record。

GitHub command 和 GitHub AI tool 必须看到同一个 `connection.status`。

### Phase 5: tool executor 改走 execution context

`ExtensionToolExecutor` 现在把 `extensionPreferences` 传给 handler。目标是传：

```ts
{
  connection,
  extensionPreferences,
  commandPreferences
}
```

工具 handler 需要 token 时，从 connection-backed main context 获取，而不是从普通 preferences 里猜。

当前第一步落地为：`ExtensionToolExecutor` 接收 resolver 返回的 execution context，并把 `connection` 与 resolver-backed `extensionPreferences` 传给 handler。

### Phase 6: SuperCmd-style command ingestion

等 auth 主通路稳定后，再补 GitHub/Notion commands：

```txt
Raycast package.json
  -> Openwork native manifest commands
  -> launcher command list
  -> existing extension-runtime launch context
```

Notion 当前没有 commands，所以它不是 auth 先修就完整。它需要复刻 Raycast Notion 的 command surface，例如 search page、quick capture、add text to page、create database page。

## 验收用例

必须覆盖这些行为：

1. GitHub token 只在 extension connection 设置一次，`My Issues` command 和 AI `listMyIssues` 都显示 connected。
2. 只有 legacy `github:my-issues` token 时，resolver 能读到并返回 connected，同时给出可迁移路径。
3. GitHub missing auth 时，AI capability 有 instructions/guide，但没有 tools。
4. GitHub connected auth 时，只暴露 manifest 当前 `toolNames` 中存在的 tools。
5. `@github` preload 和 `loadExtension("github")` 进入同一个 loaded extension session。
6. Apple Reminders 在 darwin 可用，在非 darwin 是 unsupported，不是 missing auth。
7. Notion 加 command 后，command 和 AI tool 共享同一个 Notion connection。

## 不做什么

- 不恢复 `SourceProfile` 作为核心概念。
- 不把 token 继续放在 command preference 作为新主通路。
- 不让 AI source 和 command 各自判断连接状态。
- 不为了未来多账号提前引入 profile/multi-account。
- 不把 routing 做成主能力层。`@extension` 和 `loadExtension` 是同一能力的两条入口，不是两套系统。

## 下一步代码落点

最小正确改动顺序：

1. 增加 `NativeExtensionConnectionManifest` 类型和 manifest 校验。
2. 给 GitHub/Notion/Apple Reminders 补 `connection` 字段。
3. 新增 `resolveNativeExtensionExecutionContext`。
4. 让 `resolveNativeExtensionAiCapabilitiesForRefs` 消费 resolver 返回的 connection status。
5. 让现有 `extension-runtime` host capabilities、native command invoke 和 `ExtensionToolExecutor` 消费同一个 execution context。
6. 把 legacy command-scoped password fallback 从 `preferences.ts` 下沉到 connection resolver，并加迁移测试。

这一步之后，GitHub “command 能打开但 AI 说未连接”应该从架构上消失，因为它们不再有两套 auth 判断路径。

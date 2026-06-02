# Extension Connector Runtime Design

本文面向维护 extension command、AI capability、connection 和 agent tool runtime 的开发者。它定义当前 Openwork extension 的连接归属、加载路径和失败语义，避免 command 与 AI tool 各自维护一套 auth 判断。

## 核心结论

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

## 当前运行时状态

当前 GitHub / Notion / Apple Reminders 已经从“preferences 推导 auth”推进到 connection 主通路。

GitHub manifest 的关键形态是：

```ts
export const githubManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    id: "github",
    requiredPreferenceNames: ["accessToken"],
    publicPreferenceNames: ["apiBaseUrl"],
    instructions: [...],
    guide: "...",
    toolNames: [...]
  },
  connection: {
    auth: {
      secretNames: ["accessToken"],
      type: "personalAccessToken"
    },
    id: "default",
    provider: "github",
    publicPreferenceNames: ["apiBaseUrl"],
    title: "GitHub"
  }
})
```

代码落点：

- `src/shared/native-extensions.ts` 定义 `NativeExtensionConnectionManifest`、`NativeExtensionResolvedConnection` 和 `NativeExtensionExecutionContext`。
- `src/main/native-extensions/connection-resolver.ts` 是 connection 主通路，负责读取 extension preferences/secrets、provider extension preferences、legacy command-scoped password fallback，并返回 execution context。
- `src/extensions/sources.ts` 在传入 `getConnection` 时用 resolved connection 计算 AI auth status；`requiredPreferenceNames` 只保留为没有 resolver 输入时的兼容推导。
- `src/main/native-extensions/service.ts` 和 `src/main/services/native-extensions/index.ts` 运行 command/service 时走 `resolveNativeExtensionExecutionContext`。
- `src/main/extension-tools/executor.ts` 和 `src/main/extension-tools/permission.ts` 运行 AI tools / 审批时接收同一份 execution context。

因此，GitHub “command 能用但 AI 说未连接”不应该再通过两套 auth 判断复现；如果复现，应优先查 connection resolver 的输入、legacy fallback 或调用点是否没有传 `getConnection` / `getExtensionExecutionContext`。

仍然存在的缺口：

- `aiCapability.requiredPreferenceNames` 还存在兼容意义，不能再作为新主通路设计依据。
- OAuth manifest 类型已经存在，但主进程 OAuth flow、token exchange、refresh/revoke、state/PKCE 存储还没有完整落地。
- runtime command/service 仍通过 resolver-backed `extensionPreferences` 消费 secret，后续接第三方包时需要继续收紧 secret 暴露面。
- `connection.status` 的 richer states 还没有完全展开，当前主要覆盖 connected/missing，OAuth 上线后再补 expired/revoked/scope-missing 等状态。

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

AI Capability 不应该自己定义 auth 体系。它最多声明所需的 connection。

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

## 当前 manifest 合同

当前只做单 connection，不引入 profile/multi-account。

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

GitHub 当前形态：

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

Notion 当前使用 integration token，因此 `auth.type` 是 `apiKey`。OAuth 形态后续应该长这样：

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

兼容期仍保留：

```ts
aiCapability.requiredPreferenceNames
```

但它只是 adapter：

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

## 已完成与剩余缺口

已经落地：

1. `NativeExtensionPackageManifest` 支持 `connection?: NativeExtensionConnectionManifest` 并做 manifest 校验。
2. GitHub / Notion / Apple Reminders 已声明 `connection`；Apple Reminders 是 `auth.type = "none"` + darwin 白名单，GitHub 是 personal access token，Notion 是 integration token。
3. `src/main/native-extensions/connection-resolver.ts` 已作为 shared resolver，返回 `NativeExtensionExecutionContext`。
4. `src/extensions/sources.ts` 在 agent runtime 传入 `getConnection` 时走 resolved connection，missing auth 仍注入 instructions/guide，connected 才暴露 tools。
5. native command/service 和 extension AI tool executor 已消费 execution context，command 与 AI tool 不再各自判断连接状态。
6. legacy command-scoped password fallback 已下沉到 connection resolver。

剩余缺口：

1. OAuth / Connected Account 仍是长期能力，尚未实现完整主流程。
2. `requiredPreferenceNames` 仍作为兼容字段存在，后续新增 extension 不应依赖它表达主 connection。
3. 第三方外部安装包接入后，需要继续收紧 secret 到 extension runtime 的传递方式。
4. `loadExtension` 和 `@extension` 已经是同一能力的两条入口，但后续回归仍要同时覆盖显式 mention 与模型主动加载，避免只修一边。

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

## 后续演进点

后续不再从 `SourceProfile` 或 command-scoped token 方向扩展。后续演进围绕三件事推进：

1. OAuth / Connected Account：补主进程 OAuth flow、callback、token exchange、refresh/revoke 和状态语义。
2. 外部安装包：让 install artifact 也能声明 connection，并由同一个 resolver 解析。
3. 回归验证：同时覆盖 Settings 保存 token、launcher command、`@extension` preload、`loadExtension`、`callExtensionTool` 五条路径。

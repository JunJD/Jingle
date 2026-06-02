# Extension Auth / Connection 长期架构设计

日期：2026-05-30

## 目标

Openwork 的 extension 需要稳定支持三类鉴权：

1. 不需要鉴权的本地能力；
2. 用户手动填入的 API key / personal access token；
3. 由宿主统一接管的 OAuth / Connected Account 登录。

短期 Notion 可以继续使用 integration token。长期不能让每个 extension 自己手写浏览器跳转、callback、token exchange 和 token 存储。鉴权必须成为宿主能力，而不是 extension workaround。

本文面向没有参与过前面对话的人，解释当前状态、Raycast / SuperCmd / jingle-web 的参考价值，以及 Openwork 应该如何演进。

## 当前状态

Openwork 已经有一部分 connection 基础设施：

- `src/shared/native-extensions.ts` 定义了 `NativeExtensionConnectionManifest`，并已经包含 `auth.type: "none" | "apiKey" | "personalAccessToken" | "oauth"`。
- `src/main/native-extensions/connection-resolver.ts` 会把 extension preference、provider extension preference、legacy command-scoped secret 合并成 runtime 执行上下文。
- `@openwork/extension-api` 提供 `getConnectionSecret(name)`，extension-utils 可以用它读取 `accessToken`。
- `packages/extension-utils/src/index.ts` 已经有 `withAccessToken`，并补了 `OAuthService.getAccessToken()`、`OAuthService.authorize()` 和 `getAccessToken(service)` 的兼容入口。
- `openExtensionPreferences()` / `openCommandPreferences()` 已经能把用户带到设置页。

当前已经真正落地的是前两类：

```txt
none
  -> Apple Reminders 这类本地能力，不需要用户登录。

apiKey / personalAccessToken
  -> Notion 使用 apiKey。
  -> GitHub 使用 personalAccessToken。
  -> 用户在 extension settings 填 token。
  -> Openwork 通过 password preference / secrets store 保存。
  -> runtime 通过 connection secret 读取 accessToken。
```

当前没有真正落地的是第三类：

```txt
oauth / Connected Account
  -> manifest 类型已经存在。
  -> jingle-web callback/docs 基础已经存在。
  -> 主进程 OAuth 登录、callback 校验、token exchange、refresh、revoke 还没有实现。
```

因此，当前还有明确缺口：

- `auth.type: "oauth"` 只是 manifest 类型，还没有完整主流程。
- `@openwork/extension-api` 里的 `OAuth.PKCEClient` 目前只是构造形状，不负责授权请求、token 读写或 callback。
- connection status 当前主要是 `missing` / `connected`，没有 `expired`、`revoked`、`scope-missing` 这类 OAuth 真实状态。
- token 交换、refresh、revoke、state 校验、PKCE verifier 存储还没有主进程 owner。

因此，当前可接受的产品语义是：

```txt
Notion V1
  -> 用户在设置页填 accessToken
  -> Openwork 安全存储 password preference
  -> extension-utils 从 connection secret 取 token
```

这足够支撑当前迁移和内部使用，但不等于已经支持公开 OAuth 登录。

## 外部参考

### Raycast

Raycast 不是只提供一种鉴权方式，而是让 extension 按场景选择：

- manifest preferences：`password` / `textfield` / `dropdown` 等，由 `getPreferenceValues()` 读取。
- settings helpers：`openExtensionPreferences()` / `openCommandPreferences()`，用于缺配置时跳转设置。
- OAuth PKCE：`OAuth.PKCEClient` 负责 authorization request、authorize、set/get/remove tokens。
- `@raycast/utils`：`OAuthService`、`withAccessToken`、`getAccessToken` 提供更高层的 token gating 和 UI。

Raycast 给 Openwork 的核心启发是：extension 作者写的是声明和调用，登录流程属于平台。

### SuperCmd

SuperCmd 本地实现更像完整兼容层：

- renderer 里有 `PKCEClientCompat` 和 `OAuthServiceCore`。
- `withAccessToken` 能显示 Sign in UI。
- 主进程通过 `supercmd:` deep link 接收 OAuth callback。
- token 存在主进程 safe-storage vault，`oauth-tokens.json` 只作为 provider index。
- preload 暴露 `oauthGetToken` / `oauthSetToken` / `oauthLogout` 等 IPC。

SuperCmd 证明了完整 flow 需要这些部件，但 Openwork 不应该照搬它把 extension runtime 放到 renderer 的执行模型。Openwork 应保留当前更清晰的边界：

```txt
extension runtime process
  -> host capability request
  -> main process owns auth flow
  -> secure storage
  -> renderer only displays connection UI
```

### jingle-web

`/Users/junjieding/dingjunjie_dev/2026_03/jingle-web` 已经提供：

- 产品站；
- `/docs/oauth`，实际文案已经转成 Connections 架构说明；
- `/callback`，接收 `code`、`state`、`error` 参数并展示 callback payload。

jingle-web 可以作为公开 redirect / fallback 页面，但它不是完整 OAuth server。它当前不做：

- state 校验；
- authorization code exchange；
- client secret 管理；
- refresh token 持久化；
- revoke。

所以发布 jingle-web 有价值，但只能解决“provider 需要一个 HTTPS redirect URL / 用户看到 callback landing”的问题。真正连接完成仍应由 Openwork 主进程或一个明确的后端服务完成。

## 长期架构原则

### 1. Extension 只声明连接需求

extension manifest 应声明连接，而不是实现连接流程：

```ts
connection: {
  id: "notion",
  provider: "notion",
  title: "Notion",
  auth: {
    type: "oauth",
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientId: "...",
    scopes: [],
    secretNames: ["accessToken"],
    redirect: {
      method: "web",
      redirectUrl: "https://jingle.example.com/callback"
    }
  },
  publicPreferenceNames: ["apiBaseUrl"]
}
```

extension runtime 只调用：

```ts
const token = getConnectionSecret("accessToken")
```

或者：

```ts
export default withAccessToken(service)(Command)
```

### 2. 主进程 owns token lifecycle

主进程应拥有：

- provider registry；
- authorization URL 构建；
- `state` / PKCE verifier 生成和持久化；
- callback 解析和验证；
- token exchange；
- refresh；
- revoke / logout；
- secure storage；
- connection status 计算。

renderer 不应该持有 client secret，也不应该直接 exchange token。

### 3. jingle-web 是公开回调和文档入口

jingle-web 的合理定位：

```txt
provider browser callback
  -> jingle-web /callback
  -> 显示连接结果或 deep link 回 Openwork
  -> Openwork 主进程完成 state 校验和 token exchange
```

如果某个 provider 不支持自定义 app scheme，只允许 HTTPS redirect，jingle-web 就是必要的 redirect endpoint。

如果 provider 支持 app scheme 或 loopback redirect，Openwork 可以直接接 callback，jingle-web 只作为 fallback 和文档。

### 4. token 不进入普通 preference

普通 preference 可以保存非敏感配置，例如 base URL、默认数据库、打开方式。token、refresh token、client secret 不应进入 settings store、logs、renderer state 或 extension-visible preference object。

Openwork 当前 password preference 已经用 secrets store 处理。OAuth token 还需要单独的 connection credential store，建议和普通 preference 区分：

```txt
OPENWORK_HOME
  settings
    nativeExtensionPreferences        # 非敏感配置
  secrets
    nativeExtensionSecrets            # 当前 password preference
    connectionCredentials             # OAuth / connected account tokens
```

## 目标模块边界

建议新增或收口这些模块：

```txt
src/shared/native-extensions.ts
  connection manifest / status / provider contract types

src/main/native-extensions/connection-resolver.ts
  只负责把 manifest + stored credential 解析为 execution context

src/main/native-extensions/connection-service.ts
  connect / refresh / revoke / resolve status

src/main/native-extensions/oauth-flow.ts
  state / PKCE / authorization URL / token exchange

src/main/native-extensions/connection-credentials-store.ts
  secure credential persistence

src/main/settings-window-routing/service.ts
  打开 extension settings / connection panel

packages/extension-api/src/extension-runtime/sdk/oauth.ts
  只暴露 extension author API facade，不自己拥有 token

packages/extension-utils
  withAccessToken / OAuthService / getAccessToken compatibility helpers
```

依赖方向必须保持：

```txt
extension code
  -> extension runtime SDK
  -> host capability request
  -> main connection service
  -> secure store / browser / callback
```

不能变成：

```txt
extension code
  -> renderer localStorage / window.electron
  -> ad hoc token exchange
```

## 用户流程

### 手动 token

```txt
用户打开 Notion command
  -> extension 缺 accessToken
  -> withAccessToken 显示 Connection Required
  -> 用户点击 Open Extension Settings
  -> 设置页填写 token
  -> token 进入 secure secret store
  -> command 重试后 connected
```

### OAuth

```txt
用户打开 Notion command
  -> connection status = missing
  -> renderer 显示 Connect Notion
  -> main connection-service 创建 auth session
  -> 打开 provider authorization URL
  -> provider redirect 到 jingle-web /callback 或 app scheme
  -> Openwork 收到 callback
  -> 校验 state / PKCE
  -> exchange code
  -> secure store 写入 credential
  -> connection status = connected
  -> command 继续执行
```

### Logout / revoke

```txt
用户在 settings 点击 Disconnect
  -> main revoke provider token（如果 provider 支持）
  -> 删除本地 credential
  -> 广播 connection changed
  -> runtime 下次读取 status = missing
```

## Connection status

长期应把状态扩展为：

```ts
type NativeExtensionConnectionStatus =
  | "connected"
  | "missing"
  | "expired"
  | "revoked"
  | "scope-missing"
  | "failed"
  | "unsupported"
```

当前 `missing / connected` 足够 token V1，但 OAuth 需要更细：

- `expired`：access token 过期，refresh 失败或待 refresh；
- `revoked`：provider 返回 revoked / invalid_grant；
- `scope-missing`：token 存在但权限不够；
- `failed`：网络、token exchange、provider 错误；
- `unsupported`：manifest 声明了宿主还没支持的 redirect / provider 形态。

## Notion 配置方案

### 短期：Internal Integration Token

不用发布 jingle-web。

1. 在 Notion developer portal 创建 internal integration。
2. 复制 internal integration token。
3. 在 Openwork Notion extension settings 里填写 `accessToken`。
4. 在 Notion workspace 中把需要访问的 page / database share 给 integration。

这是当前最稳方案。

### 长期：Public OAuth Integration

需要先有公开 HTTPS callback。

1. 发布 jingle-web。
2. 记录公开 callback URL，例如：

```txt
https://jingle.example.com/callback
```

3. 在 Notion developer portal 创建 public integration。
4. Redirect URI 填上面的 callback URL。
5. Openwork manifest 使用 `auth.type: "oauth"`。
6. 主进程实现 OAuth flow：
   - 生成 state；
   - 如果 provider 支持 PKCE，生成 code verifier / challenge；
   - 打开 Notion authorization URL；
   - 接收 callback；
   - 校验 state；
   - exchange code；
   - 安全存储 access token；
   - 更新 connection status。

注意：如果 token exchange 需要 client secret，client secret 不能放进 extension renderer，也不能写进公开 package。应由主进程安全读取本地配置，或由受控后端完成 exchange。

## 与当前暂存区的关系

当前暂存的 `extension-utils` auth 批次属于短期兼容层：

- `OAuthService.getAccessToken()` 从 Openwork connection secret 取 token；
- `OAuthService.authorize()` 复用 `getAccessToken()`；
- `getAccessToken(service)` 支持 generic service；
- `withAccessToken` 缺 token 时显示设置入口。

这批不实现交互式 OAuth。它应该提交，因为它让迁移包和 Notion V1 先能稳定运行。

长期 OAuth 不应在这批里继续扩展，应该另起一个 connection service 批次。

## 分阶段落地

### Phase 0：当前短期方案

- 保持 Notion 使用 internal integration token。
- 提交 extension-utils auth 兼容层。
- 保持 `openExtensionPreferences()` 作为缺 token 的恢复入口。

验收：

- 缺 token 的 view command 不 crash；
- UI 显示 Connection Required；
- 点击设置入口能进入 extension settings；
- 填 token 后 command / AI tool 能拿到 `getConnectionSecret("accessToken")`。

### Phase 1：Connection Service 骨架

- 新增 `connection-service.ts`。
- 新增 `connection-credentials-store.ts`。
- connection resolver 改为读取 connection credential，而不是只读 preference。
- settings 页显示 connection status。

验收：

- apiKey / personalAccessToken 仍兼容；
- provider extension secret inheritance 不退化；
- settings 能显示 connected / missing。

### Phase 2：OAuth Session 与 Callback

- 新增 auth session：`state`、provider、extension、redirect、PKCE verifier。
- 支持 app scheme / web callback。
- jingle-web `/callback` 用于 web redirect fallback。
- Openwork 能接 callback 并恢复 pending session。

验收：

- callback state 不匹配会失败；
- session 过期会失败；
- 成功 callback 后 connection status 变 connected。

### Phase 3：Provider Token Exchange

- 实现 Notion provider exchange。
- 明确 client secret 来源：本地安全配置或受控后端。
- token 写入 secure credential store。
- extension runtime 仍只看到 `accessToken` secret。

验收：

- Notion public OAuth 能完成登录；
- token 不出现在普通 settings、logs、renderer state；
- disconnect 能删除 credential。

### Phase 4：Refresh / Revoke / Scope

- 支持 refresh token 的 provider 做 refresh。
- 支持 revoke。
- 支持 scope 校验和 `scope-missing`。

验收：

- 过期 token 可刷新；
- revoke 后 command 进入 missing/revoked 状态；
- 权限不足时给出可操作提示。

## 不做什么

短期不要做这些事：

- 不把 OAuth token 放到 extension preference 明文里；
- 不让 extension command 自己 exchange code；
- 不把 client secret 打包进 extension；
- 不让 renderer localStorage 成为 token 主存储；
- 不为了 Notion 先复制一套 provider-specific hack 到 command 文件。

## 推荐下一步

1. 先提交当前 extension-utils auth 兼容层。
2. 发布 jingle-web 作为公开 callback/docs 基础，但不要宣称 OAuth 已完成。
3. 开一个独立任务做 `connection-service` 骨架。
4. Notion public OAuth 等 connection service 骨架完成后再接。

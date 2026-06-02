# Notion Extension 迁移状态与迁移器验收说明

日期：2026-05-25

源输入版本：

- Openwork：`7c13b83`
- Raycast extensions：`38f0f9e5`
- Raycast extension 路径：`extensions/notion`

## 文档用途

本文面向维护正式 Notion extension 和迁移器的开发者，回答四个问题：

1. 当前生产 Notion extension 的入口、身份和边界是什么。
2. 从源 Notion extension 迁移时，哪些业务依赖可以直接复用，哪些 runtime API 必须走 Openwork facade。
3. 迁移器生成的 package 需要满足哪些 command、AI tools、runtime metadata 和 package contract。
4. 历史 `notion-generated` preview 验证了哪些语义，以及这些语义如何被吸收到正式 `extensions/notion`。

当前生产入口只有正式 `extensions/notion`。`notion-generated` 只作为历史 preview 证据出现，不是新的开发入口，也不应重新接入 registry。

## 核心结论

Raycast Notion 不能直接复制源码完成迁移。它的 `package.json` 里有 8 个运行时依赖，但真正的难点不只是 npm 包，而是 Raycast 自己的运行时协议：

- `@raycast/api`
- `@raycast/utils`
- OAuth
- 本地存储
- 表单
- 列表分页
- toast
- quicklink
- 剪贴板
- app picker preference
- 命令窗口行为

工程原则：

1. Notion 是完整迁移目标，非 `@raycast/*` 的业务依赖可以直接复用，不需要为了“少装包”而重写成熟逻辑。
2. `@notionhq/client`、`@tryfabric/martian`、`notion-to-md`、`date-fns` 应作为 Notion package 的业务依赖保留，用来承接 Notion API helper、Markdown 转换、页面 Markdown 输出和日期格式化逻辑。
3. `@mozilla/readability` 和 `linkedom` 只服务 `quick-capture`。当前 `quick-capture` 已进入 Openwork Notion 包，所以这两个依赖也已经作为 Notion package 依赖保留。
4. 源 extension 里的 `@raycast/*` 不一刀切禁止，但只能作为迁移输入识别，不能成为 Openwork 产物命名。原则是：
   - 绑定源 runtime 的 API 不应直接作为最终运行时依赖，需要 Openwork facade/adapter。
   - 如果存在纯工具函数或可独立使用的工具包，可以先用，后面再替换也可以。
5. Openwork 生成代码和新包命名不要出现 Raycast 字眼。迁移脚本可以识别 `@raycast/api` / `@raycast/utils`，但输出应改写到 Openwork 自己的 extension author API。
6. UI commands 阶段要逐步做 Openwork facade，映射到 Openwork runtime SDK。第一批应该覆盖 `List`、`Detail`、`Form`、`Action`、`ActionPanel`、`Icon`、`Image`、preferences、navigation、clipboard、storage、`useCachedPromise`。

## 当前生产状态

生产入口只保留正式 `extensions/notion`。`notion-generated` 不再是 bundled extension，不进入 manifest/main/runtime/runtime-metadata registry，也不会出现在 launcher、settings、menu-bar 或 AI capability 列表里。

正式入口：

- `extensions/notion` 是迁移后的正式 Notion package，extension id、title、runtime metadata、AI capability、settings schema 都固定为 `notion`。
- 旧手写版 `src/extensions/notion/*` 没有直接删除，已备份到 ignored 本地目录 `.ignored-extensions/notion-handwritten/`，用于必要时人工对照。
- 旧预览包 `extensions/notion-generated` 已移到 ignored 本地目录 `.ignored-extensions/notion-generated-preview/`，只作为本机历史对照，不再被 workspace、registry 或测试主路径消费。
- 旧 `openwork://extensions/notion-generated/<command>` quicklink 会通过 registry 提供的 quicklink alias，在 repository 读写边界和 launcher quicklink provider 中归一化为正式 `notion` 链接，shared quicklink parser 只消费 alias 配置并保留 `launchContext` 不变。
- settings schema 只暴露 `notion`，`notion-generated` 会被当作未知 native extension 拒绝。
- AI runtime 只消费正式 `notion` 的 manifest/tool surface；`notion-generated` 不再暴露 AI tools。
- 真实 Electron/CDP 已验证：Settings schema 只包含 `notion`；launcher 搜索 `notion` 显示正式 Notion 四个 command；legacy `notion-generated` quicklink 经 IPC 读取后会持久化迁移为正式 `notion` quicklink，并通过 launcher quicklinks provider 打开 `notion/create-database-page`。

正式 `notion` 已验证成立：

- `search-page`、`create-database-page`、`add-text-to-page`、`quick-capture` 已进入正式 `notion` manifest/runtime。
- `search-page` 覆盖搜索、详情预览、recent/pinned storage、quicklink、桌面 app 打开、数据库列表、属性编辑、归档确认、从数据库列表 push 创建页面。
- `create-database-page` 覆盖 schema 加载、clipboard 预填、页面创建、关系字段、显式 `false` checkbox、quicklink 创建。
- `add-text-to-page` 覆盖 markdown append、关闭 launcher、toast 反馈。
- `quick-capture` 覆盖 URL 抽取、AI 摘要、quicklink launch context 默认值。
- 四个 view command 在缺少 `accessToken` 时都会渲染一致的连接提示，并提供打开 extension settings 的 action。
- 正式 `notion` AI tools 覆盖 search/read/write、page markdown、分页 block 读取、Raycast-compatible aliases 和 Notion property wrappers；旧 RPC/service 测试已移除，AI 工具直接走 `main/tools.ts` 的 Notion client/domain helper。
- 正式 `extensions/notion` 已移除旧 RPC surface：manifest 不再声明 `rpc` capability/runtimeCapability/rpcMethods，`main.ts` 不再导出 service，旧 `main/service.ts`、`main/client.ts`、`src/runtime-client.ts` 和旧 RPC contracts 已删除。
- 正式 `extensions/notion` 已把身份集中到 package 级 `identity.ts`，并固定为正式 `notion` identity：manifest/runtime metadata、AI tool host request id、runtime quicklink URL 都指向正式 `notion`。
- 迁移器生成 Openwork package 时也会输出 package 级 `identity.ts`，并让 manifest、runtime metadata、AI tool host request id 走同一份 identity；重新生成 Notion 包不会再把 extension id/title/provider/subject 散落回多个文件。
- 迁移器生成 Openwork package 时会优先使用 Openwork 已验证依赖版本，避免把 Raycast 源包里的旧版本漂到正式 extension package。
- `npm run check:extensions` 已把 extension package 的入口形态纳入验收：正式包必须自带文件入口 `manifest.ts`、`runtime.ts`、`runtime-metadata.ts`、`main.ts`，目录入口 `main/`、`src/`、`assets/`，并在 `package.json` 声明 `"type": "module"`、`"main": "./main.ts"`、`"types": "./manifest.ts"`；迁移器生成包没有源 assets 时会输出 `assets/.gitkeep`，并且 symlink 形态的 generated package 也会被 package boundary 检查扫到。
- extension runtime SDK 的 imperative context 已通过共享 runtime slot 和 Node `AsyncLocalStorage` 收口：host 与 package facade 即使用不同 module specifier 加载 SDK，也能读到同一个 active context；并发 async tool/runtime run 会隔离各自 context。
- 正式 `notion` 的连接设置验收已补：BDD 通过真实 preload IPC 验证 settings schema 只暴露正式 `notion`、拒绝 `notion-generated`、保存 `accessToken` 后公开读取仍脱敏且重启保留公开配置；node 测试验证 Settings 保存的 token 会被 main-side runtime host 和 AI capability 通过同一 connection 解析为 connected。

验收命令：

```bash
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/github-notion-ai-tools.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/notion-ai-migration-tools.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/notion-runtime-search-page.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/extension-runtime-registry.test.ts tests/node/launcher-search-page-store.test.ts tests/node/launcher-search-quicklinks.test.ts tests/node/native-extension-preferences.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/raycast-ai-migration-preview.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.node.json scripts/check-native-extensions.mjs
./node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/node/native-extension-preferences.test.ts
npm run test:bdd:target -- --tags @native-extensions
./node_modules/.bin/tsc --noEmit -p extensions/notion/tsconfig.check.json --pretty false
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false --pretty false
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false --pretty false
npm run check:guardrails
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9335
```

剩余产品缺口：

- facade 覆盖仍按 Notion 真实使用面补齐，不承诺完整 Raycast runtime 兼容。
- 交互式 Notion OAuth 授权仍是后续产品能力；当前正式 Notion V1 走 integration token / connection secret。

## Monorepo Package 方向

短期不做 extension install、marketplace、用户安装目录，也不做动态下载更新。短期目标是先把 bundled extension 做成 monorepo package 形态：

```txt
extensions/
  apple-reminders/
  github/
  notion/

packages/
  extension-api/
  extension-utils/
  extension-migration/

src/extensions/
  registry.ts
  main-registry.ts
  runtime-registry.ts
  runtime-metadata-registry.ts
  sources.ts
  source-mentions.ts
```

边界含义：

- `extensions/<name>` 是 extension package 本身，承载 manifest、commands、AI tools、business helpers、assets。
- `packages/extension-api` 是 Openwork extension 作者 API，承载 `List`、`Detail`、`Form`、`Action`、`ActionPanel`、`Icon`、`Color`、`Image`、navigation、clipboard、storage 等。
- `packages/extension-utils` 是 Openwork extension 常用 hooks/utils，承载 `useCachedPromise`、`usePromise`、`useFetch`、`useForm`、`FormValidation`、`useLocalStorage` 等。
- `packages/extension-migration` 是迁移工具和代码生成器。
- `src/extensions` 是 Openwork 宿主层 registry / loader / AI capability resolver，不再承载具体 extension package 源码。

第一波迁移后，Apple Reminders、GitHub、Notion 这类具体 extension package 应落在 `extensions/<name>`。`src/extensions` 保留为显式 bundled registry/loader 层，并临时承载尚未迁出的旧内置 extension；不引入自动扫描和 install 系统。

## 命名约束

Openwork 产物命名不要出现 Raycast 字眼。允许在迁移文档、迁移脚本的 source analysis、runtime compatibility report 里引用源 import 名称，但生成后的运行时代码、package 名、目录名、public API 名称都应该是 Openwork 自己的名字。

建议映射：

| 源 import        | Openwork 目标                                          |
| ---------------- | ------------------------------------------------------ |
| `@raycast/api`   | `@openwork/extension-api` 或 monorepo 内等价 package   |
| `@raycast/utils` | `@openwork/extension-utils` 或 monorepo 内等价 package |

生成代码禁止：

- `import ... from "@raycast/api"`
- `import ... from "@raycast/utils"`
- `raycast` 作为 preference 枚举值、默认值或 public manifest 字符串
- `raycast://` scheme
- `*.raycast.com` OAuth proxy URL
- 新建 `raycast-api`、`raycast-utils`、`raycast-compat` 这类目录或包名

迁移脚本可以在内部保留 source mapping，例如：

```txt
source import: @raycast/api
target import: @openwork/extension-api
```

这样可以利用 Raycast extension 生态的代码结构，但不会把 Openwork 的 public surface 命名成另一个产品。

## SuperCmd 参考价值

隔壁 SuperCmd（隔壁路径有最新版本） 是一个更接近“完整复刻 Raycast extension runtime”的参考实现。它对 Openwork 有参考价值，但不能照搬命名。

本地观察：

- `package.json` 直接依赖 `@raycast/api@^1.104.5`。
- 没有直接在 package 里声明 `@raycast/utils`。
- runtime 里会拦截 `@raycast/api` 和 `@raycast/utils`。
- 第三方依赖安装时会过滤 `@raycast/*`，由运行时 shim 提供。
- shim 覆盖面很大，包含 UI、hooks、clipboard、storage、toast、OAuth、AI、window/app helpers。

SuperCmd 可借鉴的是 API 覆盖优先级，不是命名方式。对 Notion 迁移最有用的覆盖面是：

| 能力组            | 代表 API                                                               | Openwork 迁移优先级           |
| ----------------- | ---------------------------------------------------------------------- | ----------------------------- |
| 基础 UI           | `List`、`Detail`、`Form`、`Action`、`ActionPanel`                      | P0                            |
| 图标和展示        | `Icon`、`Color`、`Image`、`Keyboard`                                   | P0                            |
| 数据 hooks        | `useCachedPromise`、`usePromise`、`useFetch`                           | P0                            |
| 表单 hooks        | `useForm`、`FormValidation`                                            | P0                            |
| 偏好设置          | `getPreferenceValues`、command preferences                             | P0                            |
| storage           | `LocalStorage`、`Cache`、`useLocalStorage`                             | P1                            |
| clipboard         | `Clipboard.copy`、`Clipboard.readText`                                 | P1                            |
| feedback          | `showToast`、`Toast`、`showHUD`、`showFailureToast`                    | P1                            |
| navigation/window | `useNavigation`、`closeMainWindow`、`popToRoot`、`launchCommand`       | P1                            |
| auth              | `OAuth`、`OAuthService`、`withAccessToken`                             | P1/P2，取决于 connection 设计 |
| system helpers    | `open`、`getApplications`、`getSelectedText`、`getSelectedFinderItems` | P2                            |
| advanced UI       | `Grid`、`MenuBarExtra`                                                 | P2                            |
| product-specific  | quicklink、AI helper、browser extension helper                         | 暂缓                          |

对 Notion 第一轮迁移，Openwork 不需要追求 SuperCmd 那种完整覆盖。先覆盖 Notion `search-page`、`create-database-page`、`add-text-to-page` 必需的 API，后续再按 command 扩展。

## Raycast Notion 的运行时依赖

来自 Raycast Notion `package.json`：

| 依赖                   | 在 Raycast Notion 里的用途                                                                                                              | Openwork 当前平替                                                                                                                                                                                                                     | 是否新增依赖                        | 迁移决策                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@raycast/api`         | UI 组件、Icon/Image/Color、preferences、OAuth、storage、clipboard、toast、navigation/window API、open external/app、快捷键、quicklink。 | 部分有平替。`@openwork/extension-api` 已承载 `List`、`Detail`、`Form`、`Action`、`ActionPanel`、`MenuBarExtra`、navigation、settings、clipboard write、shell open external、preferences/storage runtime facade。 | 不建议直接新增为最终 runtime 依赖。 | 这是源 runtime 绑定包，不是普通工具包。应该映射到 Openwork facade/adapter。短期迁移脚本可以把 import 指向 Openwork author API，而不是真实 `@raycast/api`。                                               |
| `@raycast/utils`       | `withAccessToken`、`OAuthService`、`useCachedPromise`、`useForm`、`FormValidation`。                                                    | 部分有平替。Openwork 有 connection/preferences 处理 auth，但没有直接兼容 `withAccessToken`、`OAuthService`、`useCachedPromise`、`useForm`。                                                                                           | 可分拆判断。                        | 里面有 runtime 绑定能力，也可能有纯工具。`withAccessToken`/`OAuthService` 应映射 Openwork connection；`useCachedPromise`/`useForm` 可以先实现 facade。若后续确认某个纯 helper 可独立运行，可以临时复用。 |
| `@notionhq/client`     | Notion 官方 client、类型、分页 helper、错误识别。                                                                                       | 已作为正式 `notion` package 依赖使用；旧 preview 仅保留 ignored 本地备份，不进入生产入口。                                                                                                                                           | 已新增。                            | 正式 UI command 和 AI tools 已走同一套 Notion client/domain helper，减少 API 漂移。                                                                                                                       |
| `@tryfabric/martian`   | Markdown 转 Notion blocks/rich text，用在创建、追加、属性编辑等流程。                                                                   | 已作为正式 `notion` package 依赖使用；旧 preview 仅保留 ignored 本地备份，不进入生产入口。                                                                                                                                           | 已新增。                            | 完整迁移需要保留 Markdown 转 Notion blocks/rich text 的行为，直接复用比重写更合理。                                                                                                                      |
| `notion-to-md`         | Notion blocks 转 Markdown，用于页面预览和内容输出。                                                                                     | 已作为正式 `notion` package 依赖使用；旧 preview 仅保留 ignored 本地备份，不进入生产入口。                                                                                                                                           | 已新增。                            | 页面预览和 AI 读取都需要可读 Markdown，不再保留 raw blocks POC 语义。                                                                                                                                     |
| `date-fns`             | 日期格式化、相对时间、时区/日期调整。                                                                                                   | 已作为正式 `notion` package 依赖使用；旧 preview 仅保留 ignored 本地备份，不进入生产入口。                                                                                                                                           | 已新增。                            | 为完整迁移保留 Raycast 日期行为，后续如果要减依赖，再评估替换为 `Intl`。                                                                                                                                 |
| `@mozilla/readability` | 在 `quick-capture` 中从网页提取正文。                                                                                                   | 已作为 Notion package 直接依赖使用。                                                                                                                                                                                                  | 已新增。                            | `quick-capture` 已进入 Openwork Notion 包，继续直接复用。                                                                                                                                                |
| `linkedom`             | 给 `Readability` 解析 HTML。                                                                                                            | 已作为 Notion package 直接依赖使用。                                                                                                                                                                                                  | 已新增。                            | 同上。                                                                                                                                                                                                   |

当前 Openwork 安装状态：

| 依赖                   | 是否在 Openwork `package.json` 中 | 当前源码是否使用           |
| ---------------------- | --------------------------------- | -------------------------- |
| `@raycast/api`         | 否                                | 否                         |
| `@raycast/utils`       | 否                                | 否                         |
| `@notionhq/client`     | 是，`^5.22.0`                     | 否                         |
| `@tryfabric/martian`   | 是，`^1.2.4`                      | 否                         |
| `notion-to-md`         | 是，`^3.1.9`                      | 否                         |
| `date-fns`             | 是，`^4.3.0`                      | 否                         |
| `@mozilla/readability` | 是，`^0.6.0`                      | 是，Notion `quick-capture` |
| `linkedom`             | 是，`^0.18.12`                    | 是，Notion `quick-capture` |

## 源码证据

对 `extensions/notion/src` 做 `git grep` 后可以确认：

- `@raycast/api` 被 UI commands、components、hooks、Notion helpers、`openPage` 广泛使用。
- `@raycast/utils` 被 6 个 Raycast AI tools 通过 `withAccessToken` 使用；UI command 的列表和表单也用了 `useCachedPromise`、`useForm`、`FormValidation`。
- `@notionhq/client` 用在 Notion API helpers：`oauth.ts`、database/page helpers、user helpers，以及 Notion API endpoint 类型。
- `@tryfabric/martian` 用在 `add-text-to-page.tsx`、database/page 创建 helper、property 转换。
- `notion-to-md` 用在 `utils/notion/page/index.ts`，负责页面内容转 Markdown。
- `date-fns` 用在页面/list UI、日期 block、日期 property helper。
- `@mozilla/readability` 和 `linkedom` 只出现在 `quick-capture.tsx`。

## Openwork 能力映射

### 已有或接近可用的能力

Openwork runtime SDK 目前已有这些对应能力：

| 源 API 能力                                                                                    | Openwork 对应能力                                                                              |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `List`、`List.Item`、`List.Section`、`List.EmptyView`、基础 dropdown                           | `@openwork/extension-api` 的 package-owned SDK                                                 |
| `Detail`、metadata label/link/tag list                                                         | `@openwork/extension-api`，已支持 `Detail.Metadata.Link` target 保留和 `Detail.Metadata.TagList.Item` child item 序列化 |
| `Form`、text field、text area、checkbox、dropdown、message、separator                          | `@openwork/extension-api`                                                                      |
| `Action`、`ActionPanel`、`ActionPanel.Submenu`、`Action.OpenInBrowser`、`Action.CopyToClipboard`、`Action.SubmitForm` | `@openwork/extension-api`，runtime snapshot 已保留 submenu 层级 |
| navigation push/pop/go home/open command/hide launcher                                         | `@openwork/extension-api`                                                                      |
| extension storage state                                                                        | `@openwork/extension-api` 的 `useExtensionStorageState`                                        |
| command preferences                                                                            | `useNativeCommandPreferences`                                                                  |
| 写剪贴板                                                                                       | `@openwork/extension-api`                                                                      |
| 打开外部 URL                                                                                   | `@openwork/extension-api`                                                                      |
| 打开 extension settings                                                                        | `@openwork/extension-api`                                                                      |
| menu bar command surface                                                                       | `@openwork/extension-api`                                                                      |

### 缺失或不完整的能力

这些能力如果不补，迁移脚本就不能生成可运行的 UI command：

| Raycast 能力                                          | Openwork 当前状态                                                                                                                                                                               | 需要补什么                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Icon`、`Color`、`Image` enum/object 兼容             | 基础 facade 已补，支持 Notion 当前使用的 icon 名、`Color.ColorLike`、`Image.Mask.Circle`、image-like object、字符串 icon source，并在 renderer 解析 package-relative asset source。             | 更完整的 Raycast icon set 后续按迁移报错继续补。                                                                |
| `useCachedPromise`                                    | 基础 helper 已补，支持 loading/error、`mutate`、`revalidate`、pagination、`execute`、`keepPreviousData`、`initialData`、`onData`、`onError`、`onWillExecute` 和 Raycast 风格 `abortable.current`。 | failure toast 已拆到 `showFailureToast` helper；其它更细的 Raycast utility 语义后续按真实迁移需要继续补。        |
| `useFetch`                                            | 基础 helper 已补，支持 JSON/text parse、`mapResult`、pagination URL loader、`mutate` optimistic update、`initialData`、`onData`、`onError`、`onWillExecute` 和默认 failure toast。               | Cache、retry、advanced HTTP option 等更细 Raycast utils 语义后续按真实迁移需要继续补。                          |
| `useForm`、`FormValidation`                           | 基础 helper 已补，当前 Notion 表单已可用；runtime 已支持 `Form.Dropdown onSearchTextChange`，可在表单里搜索 Notion page 后更新选项；`focus(key)` 会通过 field `autoFocus` 进入 renderer。       | 复杂 field reset、async validation、Raycast 更完整 form contract 后续按真实迁移需要补。                         |
| `withAccessToken`、`OAuthService`、`OAuth.PKCEClient` | facade 仍保留迁移输入兼容：`withAccessToken` 可从 Openwork connection secret 取 `accessToken`，`OAuthService` / `OAuth.PKCEClient` 只作为通用迁移面存在。正式 `notion` 已收敛为 `notionConnection` + `getNotionClient()`，不再在 Notion 包源码中保留 OAuth 命名。 | 交互式 OAuth 授权仍是后续产品能力；Notion V1 明确走 integration token / connection secret。                    |
| `showToast`、`Toast`                                  | 已补 Raycast 风格 SDK facade 和 `toast` runtime host capability；foreground runtime 会把 toast 转发到 owning renderer，在当前 runtime surface 上以轻量 toast 展示；toast action 会保留 title、shortcut，并通过 `toast.action.execute` 回调。AI tool runner 里 toast side effect 仍收敛为 no-op 成功。 | 更完整的 toast 队列、全局 notification center 或 undo 类产品语义后续按需要补。                                 |
| `showFailureToast`                                    | 已在 `@openwork/extension-utils` 中补 Raycast utils helper，映射到 `showToast({ style: Toast.Style.Failure })`，并由 runtime toast SDK 测试覆盖。                                                  | 更完整的 failure toast option 语义后续按真实迁移需要继续补。                                                    |
| `LocalStorage`、`Cache`                               | `LocalStorage` imperative facade 已补，走 extension 级 storage scope；`useLocalStorage` 已在 `@openwork/extension-utils` 中补齐。`Cache` 已补 Raycast 同步 CRUD / namespace / subscribe，并在 extension runtime 中按 extension + namespace 持久化到本地 cache 文件。 | 更完整的 cache 容量治理、清理入口和诊断 UI 后续按真实使用再补。                                                 |
| `Clipboard.readText`、`Clipboard.copy`                | text read/write facade 已补，走 runtime `clipboard` capability；`Clipboard.copy` / `Action.CopyToClipboard` 会保留 `{ html, text }`，支持 Notion formatted URL。                                | 文件、图片等更高级 clipboard 形态后续按真实迁移需要继续补。                                                    |
| `closeMainWindow`、`PopToRootType`                    | 已补 Raycast 风格 facade，`closeMainWindow()` 映射到 runtime navigation `hide-launcher`。                                                                                                       | `PopToRootType` 目前只保留迁移兼容语义，不改变 Openwork navigation stack。                                      |
| `launchCommand`、`LaunchType`                         | 已补 Raycast 风格 facade，映射到 runtime `navigation.openCommand`；支持当前 extension 默认打开、显式 `extensionName`、`arguments`、`context -> launchContext`、`fallbackText` 和 user initiated 显示 launcher。 | `ownerOrAuthorName` 只作为迁移兼容字段保留，不做安装源/商店路由推断。                                           |
| `open` / app picker 指定打开目标                      | runtime shell request 已支持 `application` target，host 会在 macOS 上通过 Launch Services 指定 app 打开 URL；未指定 app 时仍走原有 external URL/scheme 流程。                                   | Windows/Linux 指定 app 打开 URL 的产品语义后续按真实需求补。                                                    |
| `Action.CreateQuicklink`                              | 已补 facade、`Action.CreateQuicklink.Props["quicklink"]` 类型路径和 `quicklinks` runtime host capability；quicklink 会注册到本地 quicklink 存储，并进入 launcher search。迁移脚本会把源 `raycast://extensions/<owner>/<source-extension>/<command>` 重写为目标 `openwork://extensions/<target-extension>/<command>`，避免 `notion-generated` quicklink 打开旧包。 | 已补最小管理闭环：主进程 quicklink service 支持 list/update/remove，preload 暴露 `extensionQuicklinks` API，Settings 增加 Quicklinks 页，可重命名和删除 extension 创建的 quicklink。 |
| `ActionPanel.Submenu`                                 | runtime action snapshot 已保留 submenu children，renderer action overlay 支持进入/返回子菜单；直接 action 执行仍使用叶子 action id，快捷键匹配会递归到子 action。                              | 更完整的 submenu 搜索/面包屑样式后续按产品体验继续补。                                                          |
| `Keyboard.Shortcut` 展示和触发兼容                    | runtime action snapshot 已保留结构化 shortcut，renderer action controller 已把 Raycast `cmd/ctrl/opt/shift` 映射到 Openwork shortcut chord，并支持直接按 action shortcut 执行动作。            | 更完整的 shortcut 冲突提示和用户自定义覆盖后续再补。                                                            |
| `List` 的 `pagination`、`filtering` 和 `throttle` props | `pagination` 已补到 runtime list surface；Raycast object filtering 会按远程 filtering 处理，renderer 在 query pending/loading 时禁用旧结果 action，避免搜索尚未同步就执行旧项；`throttle` 会进入 runtime snapshot，并由 renderer 对用户输入做短延迟合并发送。 | 更细的 Raycast filtering 行为、可配置 throttle 时间等后续按源码使用继续补。                                    |
| `Form.DatePicker`、tag picker、多选类控件             | `DatePicker`、`DatePicker.Type.DateTime`、`TagPicker`、`Action.SubmitForm onSubmit(values)`、`Form.DatePicker.isFullDay` 已补到 runtime SDK；SubmitForm 会合并 renderer 本地未确认值和 runtime 原始 form values，避免 DatePicker 被降级成展示字符串。 | relation/user 等更复杂 property 选择器、完整 Raycast 日期交互语义后续按完整 Notion command 继续补。             |
| `Form` 的 `autoFocus` / `enableMarkdown` / `storeValue` | `autoFocus` 已从 SDK props 透传到 form field snapshot 和 renderer 控件；`enableMarkdown` 已对 TextArea 做协议透传和 renderer 语义标记；`storeValue` 已对 Form field 和 List.Dropdown 接入 command-scoped storage，支持初始值回灌和 change 后写回。 | 完整 markdown editor、Raycast 更细的 storeValue key 兼容语义后续按真实迁移需要继续补。                          |

## 按迁移阶段做依赖决策

### 阶段 1：AI Capability 和 AI Tools

目标：

- `package.json ai.instructions`
- `package.json tools[]`
- `src/tools/*.ts` 的输入语义和工具行为

依赖状态：

- 已新增：`@notionhq/client`、`@tryfabric/martian`、`notion-to-md`、`date-fns`。
- 已随 `quick-capture` 新增：`@mozilla/readability`、`linkedom`。

建议：

- 正式 `notion` 已使用 `@notionhq/client`、`@tryfabric/martian`、`notion-to-md` 这条迁移路径，不再扩大旧手写 HTTP adapter。
- AI tools 已切到 package 内 `main/tools.ts` 的 Notion client/domain helper，UI commands 和 AI tools 共享同一批 Notion property wrapper 与 Markdown 语义。
- Markdown 输入/输出相关工具继续复用 `@tryfabric/martian` 和 `notion-to-md`，避免 POC 里的简化行为固化。

### 阶段 2：基础 UI Commands

目标 commands：

- `search-page`
- `create-database-page`
- `add-text-to-page`

需要新增依赖：

- 继续使用阶段 1 已新增的 `@notionhq/client`、`@tryfabric/martian`、`notion-to-md`、`date-fns`
- 不直接新增真实 `@raycast/api` 作为最终 runtime 依赖
- `@raycast/utils` 按具体 helper 判断：runtime/auth 绑定能力做 facade；纯工具如果确认可独立运行，可以短期复用

需要补的 Openwork SDK/facade：

- Openwork author API facade：`List`、`Detail`、`Form`、`Action`、`ActionPanel`、`Icon`、`Image`、`Color`
- `useCachedPromise` 进阶兼容：当前已覆盖 pagination、`execute`、`keepPreviousData`、abortable、initial data、onData/onError；failure toast 已由 `showFailureToast` helper 承接。
- `useForm` 进阶兼容：复杂 reset、async validation、更完整 item props contract；`Form.Dropdown onSearchTextChange` 和 `focus(key)` 已有 runtime 闭环
- 更完整的 toast 队列/全局通知语义
- clipboard 高级形态和 open 行为映射

### 阶段 3：完整 Notion Command 对齐

额外目标：

- `quick-capture`
- 网页正文提取
- recent/pinned pages
- database property 可见性/排序偏好
- relation/user property 编辑
- app-picker open target
- quicklinks

需要保留依赖：

- `@mozilla/readability`
- `linkedom`
- 继续复用 `@notionhq/client`、`@tryfabric/martian`、`notion-to-md`、`date-fns`

需要补的 Openwork 产品/runtime 能力：

- extension notification center / toast 队列
- Cache 清理入口和诊断 UI
- relation/user 等更复杂 Form controls
- List pagination
- app open target，或明确只支持 browser fallback
- quicklink 产品决策

## 对迁移脚本的要求

有用的迁移脚本不应该一开始就复制所有文件，而应该分层输出迁移计划和转换结果。

推荐脚本流程：

1. 读取 Raycast `package.json`。
2. 输出依赖报告：
   - package dependency
   - 源码 import 位置
   - Openwork 是否有等价能力
   - 新增依赖 / adapter / rewrite 决策
3. 从 Raycast `ai` 和 `tools` 输出 `manifest.aiCapability` 草案。
4. 从 `src/tools/*.ts` 输出 AI tool skeleton：
   - Raycast kebab-case tool name -> Openwork camelCase tool name
   - TypeScript `Input` type -> zod schema 草案
   - `confirmation` export -> `ExtensionToolDefinition.approval.confirmation`
   - `withAccessToken` -> Openwork connection secret/runtime SDK context
5. 在 facade 能力不足时，只输出 UI command migration warnings。
6. 只有当所需 facade 覆盖足够时，才生成 UI command 代码。

迁移脚本的最小输出应该包括：

- `manifest.patch.json` 或 generated manifest fragment
- `tools.preview.ts` 或结构化 tool skeleton JSON
- `dependency-report.md`
- `runtime-compatibility.json`，按文件和 import/member 分组记录 runtime compatibility；其中 `blockingIssues` 才代表当前迁移阻塞，`compatibilityNotes` 只是 adapter/degradation/migration 说明
- `unsupported-apis.json`，作为旧迁移检查的兼容别名继续输出，内容与 `runtime-compatibility.json` 一致

当前迁移器已经进一步输出 `openwork-package/` 形态：

- `manifest.ts`
- `main.ts`
- `main/tools.ts`
- `runtime.ts`
- `runtime-metadata.ts`
- `src/**/*.ts(x)` 迁移源码
- `src/<command>.meta.ts`，仅用于有 viewport 的 `view` command
- 必要时生成 `src/<command>.tsx` wrapper，把 Raycast 的 `src/index.tsx` 等入口收口成 Openwork 规范 command 文件
- `assets/`；源包无 assets 时输出 `assets/.gitkeep`
- `types.d.ts`
- `tsconfig.check.json`

这个产物现在已经不只是依赖预览。它开始接近正式 extension package contract：`view` command 有同名 `.meta.ts`，manifest 从 `.meta.ts` 引用 viewport；`view`、`menu-bar`、`no-view` 都会进入 runtime command contract；`migrated-source` 下 runtime 静态 import `./src/<command>`，其中 `no-view` 会把 source function 接到 `run`；shell host entry 只保留可加载占位，不编译迁移源码，也不暴露 AI tools。生成 runtime 依赖 SDK 的懒 preference proxy 支持 Raycast 顶层 preference 读取，AI tools 通过 `main/tools.ts` 调用迁移后的 source tool module。

迁移器支持把源包名和目标 Openwork extension id 分离：

```bash
node scripts/preview-raycast-ai-migration.mjs \
  --git-repo /tmp/raycast-extensions-openwork-notion \
  --extension-path extensions/notion \
  --target-extension-id notion-generated \
  --target-extension-title "Notion Generated" \
  --out-dir /tmp/openwork-official-raycast-notion-generated-migration
```

这个命令形态曾用于把官方 Raycast Notion 迁移产物作为 `notion-generated` 并行接入，避免预览包和正式 `notion` extension 抢同一个 manifest id。当前生产状态只保留正式 `extensions/notion`；旧 preview 产物只保留在 `.ignored-extensions/notion-generated-preview/` 作为本机历史对照，不再进入 registry。

## 当前 Notion 迁移风险

- Raycast Notion 使用 Notion `data_sources` API。正式 `notion` 已切到官方 client 路径，后续风险主要是 Notion API version 演进和 Openwork facade 覆盖是否继续跟得上。
- 正式 `notion` 已吸收迁移包的 `@tryfabric/martian` Markdown 转 block 语义，不再保留旧简单 paragraph conversion。
- 正式 `notion` 已吸收迁移包的 `notion-to-md` 页面 Markdown 输出语义，不再保留旧 raw-block page content 输出。
- Openwork Settings 当前用 internal integration token 可以跑；Raycast OAuth account flow 是另一个产品功能。
- 完整 UI 对齐需要 Openwork Form/List surface 能力继续扩展。
- 正式 `notion` 已接管通用 Notion launcher 入口：`搜索 notion 页面`、`新建 notion 页面`、`保存 URL 到 notion`、`追加内容到 notion 页面` 会路由到正式包；`notion quick capture` + 空格会解析到正式 `notion/quick-capture`。
- 旧 `notion-generated` 预览包已经退出生产 registry；遗留 generated quicklink URL 会归一化到正式 `notion`，但不会再产生新的 generated launcher/settings 入口。
- 生成包通过 `withAccessToken(notionConnection)`、`getConnectionSecret` 和 `getNotionClient()` 支持 internal integration token 初始化；交互式 OAuth 授权仍未接入 Openwork 产品流程。

## 历史 Preview 验证记录

迁移器和正式 Notion 的关系如下：

说明：下面的 `notion-generated` 条目是历史 preview package 的迁移证据，只用于说明哪些 Raycast Notion 语义已经被验证并吸收到正式 `extensions/notion`；当前生产入口仍只有正式 `notion`。

- fixture 迁移报告、依赖映射、runtime compatibility report 正确生成。
- `Action.CreateQuicklink` 会推导 `quicklinks` runtime capability，并生成可注册 quicklink 的 runtime action。
- `Action.CopyToClipboard`、`Action.Paste`、`Action.OpenInBrowser` 也会推导对应的 `clipboard` / `shell` runtime capability，避免迁移源码只使用 action 组件而没有显式 import `Clipboard` / `open` 时生成漏权限 manifest。
- `launchCommand` 和 `showHUD` 会分别推导 `navigation` / `toast` runtime capability，避免迁移源码只使用 helper import 时生成漏权限 manifest。
- Raycast 的 `openExtensionPreferences` / `openCommandPreferences` 已作为 `@openwork/extension-api` settings facade 别名支持，迁移器会把它们归到 `settings` runtime capability。
- `getSelectedText` 不再作为降级能力，而是先读 `LaunchProps.fallbackText`，再走 runtime host selected-text 请求。
- 生成 runtime 使用静态 import command source；SDK 的 `getPreferenceValues()` 支持顶层懒 preference proxy，避免 Raycast 源码里的顶层 preference 对象在 runtime context 建立前读取失败，也避免 React lazy 首帧空 surface 竞态。
- 迁移器新增 Notion-style package contract 回归：从 fixture 重新生成 `openwork-package` 后，会同时验证 runtime 静态 import、`oauth.ts` 的 `getConnectionSecret("accessToken")` 懒 token、quicklink 目标 id 重写、Notion property wrapper 修正、runtime-metadata key command alias，并跑生成包自己的 `tsconfig.check.json`。
- 生成 `src/<command>.meta.ts`，并让正式包 `manifest.ts` 引用这些 viewport。
- 迁移器新增 command mode contract 回归：Apple Reminders fixture 覆盖 `view` / `menu-bar` / `no-view`，并在 `migrated-source` / `shell` 两种 host entry 下验证 manifest、runtime、runtime-metadata、tools 和 source import 的组合。`no-view` 不允许生成 `run: async () => {}`；已迁移源码必须接到 `run`，shell 占位必须显式 `not wired`。
- 新增 `npm run check:extension-migration` 作为迁移回归入口，聚合 migration harness、live extension package contract、Raycast preview fixture 和真实 GitHub / Apple Reminders source smoke。
- Raycast 单入口 command 可以生成 `src/<command>.tsx` wrapper，满足 Openwork command 文件 contract。
- 生成 package 已覆盖 registry-level 验证：实际 import `manifest/main/runtime/runtime-metadata` 后可通过 `validateNativeExtensionRegistry`。
- 生成 package 已覆盖 target id/title override：可以生成 `fixture-generated` 这类并行 extension，同时 connection provider 仍保留源包名。
- 官方 Raycast Notion 迁移产物已经晋升为正式 `extensions/notion`，manifest/main/runtime/runtime-metadata 四件套由正式包被宿主消费。
- 旧 `notion-generated` 已退出生产 registry，不再复用连接、不再暴露 AI capability；历史 quicklink 通过兼容层迁到正式 `notion`。
- extension AI tool name 已显式处理带连字符的 capability id，相关能力保留为迁移器对其它并行预览 id 的通用兼容，不再用于生产 Notion。
- 生成 AI tool handler 能在 `runWithExtensionRuntimeSdk` 中动态 import 迁移后的 tool module。
- Notion-style tool 初始化链已覆盖：迁移器会把 `oauth.ts` 顶层 `getPreferenceValues` + module-level `getNotionClient()` 改成 `getConnectionSecret("accessToken")` 懒加载，避免 import 阶段读取 runtime preference。
- 生成 UI command 已覆盖 runtime smoke：迁移后的 command 能在 Openwork runtime 中渲染 `Form`，并触发 `useCachedPromise`、`useForm`、`LocalStorage`、`Clipboard.readText`、带 action shortcut 的 `showToast`、`closeMainWindow` 对应的 host 请求；foreground runtime toast 已可转发到 renderer 展示并回调 `toast.action.execute`。
- `notion-generated` 的真实 runtime smoke 已覆盖：`search-page` 使用迁移后的 `@notionhq/client` 拉取 search/users，渲染 List；点击 `Preview Page` 后拉取 blocks、渲染 Detail，并写入 extension-scoped `RECENT_PAGES` storage。
- `notion-generated` 的 `search-page` 已进一步覆盖 recent/pinned pages：从 extension-scoped `PINNED_PAGES` / `RECENT_PAGES` 恢复页面，并通过 `Pin Page` / `Unpin Page` action 写回 `PINNED_PAGES`。
- `notion-generated` 的 database list 已覆盖真实 runtime smoke：搜索 data source 后进入 database list，读取 `DATABASES_VIEWS` 中的 visible properties，通过官方 client query data source，渲染 multi-select/status/people accessories，并在 Detail 的 `Show Metadata` action 后展示 tag-list metadata。
- `notion-generated` 的 database list quick edit 已覆盖真实 runtime smoke：通过 `Set Status` action 调用官方 client `pages.update`，写入 status property，并刷新列表 accessories。
- `notion-generated` 的 database view form 已覆盖真实 runtime smoke：`Set View Type` 现在沿用当前 data source id 读取 schema、保存 `DATABASES_VIEWS` kanban 配置，并按保存后的 view name/status section 渲染列表。
- `notion-generated` 的 database visible properties action 已覆盖真实 runtime smoke：`Show/Hide Properties` 会写回 `DATABASES_VIEWS.properties`，并刷新列表可见 accessory。
- `notion-generated` 的 multi-select/people quick edit 已覆盖真实 runtime smoke：`Set Tags` 会用 Notion update 参数所需的 `{ id }` 形态写入 multi_select，`Set Assignee` 会用 users 列表解析当前 people reference 名称并写入 people 更新。
- `notion-generated` 的 checkbox/select/date quick edit 已覆盖真实 runtime smoke：`Check Blocked`、`Set Priority`、`Set Due -> Now` 都会从列表 action 调用官方 client `pages.update`，并生成对应的 checkbox/select/date property patch。
- `notion-generated` 的 delete/archive action 已覆盖真实 runtime smoke：`Delete Page` 和 `Delete Database` 都会先走 `confirmAlert`，再分别调用 Notion `pages.update({ archived: true })` / `dataSources.update({ in_trash: true })`，并等待删除完成后刷新 recent storage 和列表。
- `notion-generated` 的 app picker/open target 已覆盖真实 runtime smoke：`Open in App` 会把 `open_in` application preference 传到 runtime shell request，并保留 `notion://` scheme allowlist；main host 会把 app target 传到 macOS Launch Services。
- `notion-generated` 迁移来的 action shortcut 已接入 renderer action controller：`Keyboard.Shortcut.Common.*` 会从 runtime snapshot 转成 launcher shortcut chord，既显示在 action panel，也能直接触发对应 action。
- `notion-generated` 迁移来的 `ActionPanel.Submenu` 已接入 runtime snapshot 和 renderer action overlay：`Edit Property -> Set Status/Tags/Assignee/Due`、`Show/Hide Properties` 等动作不再被拍平成普通分组，仍通过叶子 action id 执行。
- `notion-generated` 迁移来的 `Detail.Metadata.Link` 已接入 runtime snapshot：页面详情中的 URL/email/phone metadata 不再在 SDK 层丢失 `target`；renderer 对 http/https/mailto/tel target 呈现为可点击外链。
- `notion-generated` 迁移来的表单 `autoFocus` / `enableMarkdown` 已做最小 runtime 协议闭环：snapshot 保留字段，renderer 将 `autoFocus` 传到底层 form 控件，并把 markdown textarea 标记为 markdown 语义；完整 markdown 编辑器不是当前迁移阻塞项。
- `notion-generated` 迁移来的 `storeValue` 已补 runtime SDK 闭环：Form field 和 List.Dropdown 走 command-scoped storage，空初始值会回灌旧值，用户修改后会写回；数据库列表排序已覆盖从 `list-dropdown` 恢复 `created_time` 并写入 Notion query sort。
- 迁移器现在会从 `Form.* storeValue` / `List.Dropdown storeValue` 推导 manifest `runtimeCapabilities: ["storage"]`，避免只用了 Raycast `storeValue`、但没有显式 `LocalStorage` import 的 command 迁移后运行时缺 storage 权限。
- `notion-generated` 的 `add-text-to-page` 已覆盖真实 runtime smoke：通过 `LaunchProps.arguments.text` 预填表单，提交后把 Markdown 转成 Notion blocks，通过官方 client append 到页面，并触发 toast 与 `closeMainWindow`。
- `notion-generated` 的 `create-database-page` 已覆盖真实 runtime smoke：加载 data source schema、读取剪贴板预填 title、提交 Notion `pages.create`，并触发 toast 与 `closeMainWindow`。
- `notion-generated` 的 `create-database-page` 已进一步覆盖 property 排序和 relation/people/multi-select：读取 `DATABASES_VIEWS.create_properties` 控制表单字段顺序，relation property 通过相关 data source query 生成 TagPicker 选项，并在提交时生成 Notion `relation` / `people` / `multi_select` property wrappers。
- `notion-generated` 的 `create-database-page` 已覆盖显式 false checkbox 值：表单 property 收集不再用 truthy 过滤，`Blocked=false` 会进入 Notion `pages.create` payload。
- `notion-generated` 从 database list 通过 `Action.Push` 打开的 `CreatePageForm` 已覆盖真实 runtime smoke：提交成功后会调用顶层取得的 `pop()` 回到上一层 database list，不再在 submit callback 内调用 React hook。
- `notion-generated` 的 `quick-capture` 已覆盖真实 runtime smoke：通过 `LaunchProps.fallbackText` 读取选中文本 URL，fetch 页面 HTML，经 `linkedom` + `@mozilla/readability` 抽取正文，再用 `@tryfabric/martian` 转 Notion blocks 并通过官方 client append 到页面。
- `notion-generated` 的 `quick-capture` 已覆盖 AI summary 分支：`Summarize Page with AI` 会通过 `AI.ask` runtime host capability 生成摘要，再把摘要作为 Markdown 内容 append 到目标 Notion 页面，验证迁移包的 `ai` capability 不是只停留在 manifest 声明。
- launcher 的 use-with fallback 入口已补齐：use-with 命令项会把当前 query 同时写入 `seedQuery` 和 `LaunchProps.fallbackText`，因此 `quick-capture` 这类 Raycast 风格 `getSelectedText()` command 可以从用户当前输入拿到 URL，而不只依赖 explicit launch props。
- 正式 `notion` 的 launcher runtime metadata 已覆盖第一批自然语言入口：`搜索 notion 页面` 命中 `Search Notion`，`新建 notion 页面` 命中 `Create Page`，`追加内容到 notion 页面` 命中 `Add Text to Page`，包含 URL 的 capture query 会把 URL 传入 `LaunchProps.fallbackText`；精确 command alias 也已覆盖，`notion quick capture` + 空格会直接解析到正式 `notion/quick-capture`。
- `notion-generated` 的 launcher runtime metadata 已退出生产 registry；用户可见 launcher 只消费正式 `notion`。
- 正式 `notion/search-page` 已吸收迁移包的 `primaryAction` command preference：默认保持 `Open in Notion`，也可以切成 `Preview in Openwork` 作为主动作。
- 正式 `notion/create-database-page` 已吸收迁移包的 `useClipboard` 和 `closeAfterCreate` command preferences：可以用剪贴板预填 title/content，并在创建成功后隐藏 Openwork。
- 正式 `notion/add-text-to-page` 已吸收迁移包的 `LaunchProps.arguments.text`：从 launcher、quicklink 或其它 runtime 入口传入的 Markdown 文本会预填到内容 textarea，textarea 也保留 markdown 语义。
- 正式 `notion/add-text-to-page` 已吸收迁移包的提交完成语义：独立 command 成功追加后会隐藏 Openwork；从页面详情或搜索结果嵌入打开的 append flow 会停留在成功详情页，方便继续操作当前 Notion 页面。
- 正式 `notion/quick-capture` 已吸收迁移包的 quicklink launch context 和提交完成语义：quicklink 可携带默认 capture mode 和目标页面/数据源，打开后直接使用 `LaunchProps.fallbackText` 预填 URL，并通过 Notion client/domain helper 写入目标；提交成功后会隐藏 Openwork，`Action.CreateQuicklink` 注册的链接也指向正式 `notion/quick-capture`。
- 正式 `notion/quick-capture` 已吸收迁移包的 URL capture 数据形态：Bookmark Link 模式会向 Notion 写入 `bookmark` block，而不是把 URL 当普通 Markdown 文本；目标是 data source 时也会创建带 bookmark block 的新页面，并用捕获 URL/页面标题作为新页面标题。
- 正式 `notion/quick-capture` 已补 AI Summary 真实 runtime smoke：抓取 URL 正文后通过 `AI.ask` 生成摘要，再通过 Notion client/domain helper append 到目标页面；这和 `notion-generated` 的 AI summary 分支形成对照，避免只验证 generated 包而正式包语义退化。
- 正式 `notion/create-database-page` 已吸收迁移包的 configured quicklink launch context：表单可注册指向正式命令的 quicklink，恢复 data source、title、content、date divider 和已支持 property defaults，并兼容 generated 的 `defaults.database` / `property::title::title`。
- 正式 `notion/create-database-page` 已兼容迁移包的 generated property defaults key：`property::<type>::<id>` 会在 data source schema 到位后按 property id 映射到正式表单的 property name，并参与提交 payload。
- 正式 `notion/create-database-page` 已补 `people` / `relation` property 的完整创建通路：generated quicklink defaults 可按 property id 提交，手动表单也会加载 Notion users 和 relation 目标 data source 页面作为 TagPicker 选项，提交 payload 生成 Notion `people` / `relation` wrappers。
- 正式 `notion/create-database-page` 的 AI tool schema 已同步支持 `people` / `relation` property 输入，AI 与 runtime command 走同一批 Notion property wrapper 生成逻辑。
- 正式 `notion/create-database-page` 已补创建成功后的页面操作入口：成功 Detail 可直接 `Open in Notion`、`Open in Browser` 和 `Copy Page URL`，其中 Browser action 复用正式包的 HTTPS/default-browser 语义。
- 正式 `notion/create-database-page` 已兼容迁移包的 `visiblePropIds`：quicklink 可以携带可见 property id 列表，正式表单按 schema id 过滤展示字段；隐藏字段的 quicklink defaults 仍会按 generated 语义参与提交。
- 正式 `notion/create-database-page` 已吸收迁移包的创建表单字段显示/排序能力：普通入口复用 `search-page` 的 data source view state，可在表单 action 中 Show/Hide Properties 和 Change Properties Order；quicklink 的 `visiblePropIds` 仍优先锁定当前 quicklink 字段集。
- 正式 `notion` 的重复表单选择已吸收迁移包的 `storeValue` 语义：`add-text-to-page` 记住目标页、prepend、date divider；`create-database-page` 记住 data source 和 date divider；`quick-capture` 记住 capture mode、destination、date divider。
- 正式 `notion/create-database-page` 的 property 值协议已继续贴近迁移包：DatePicker 值会在提交时规范成 Notion date string；`select` / `status` / `multi_select` 均按 Notion option id 写入，而不是按 option name 写入，避免同名 option 或名称变化导致错写。
- 正式 `notion/search-page` 的页面详情已吸收迁移包的页面 URL 操作入口：Detail 内提供 `Append Content to Page`、`Copy Page URL` 和 `Paste Page URL`，Paste 通过 runtime clipboard host capability 执行。
- 正式 `notion/search-page` 的页面 URL 操作已吸收迁移包的 formatted/title copy：搜索结果、data source 页面列表和 Detail 都提供 `Copy Formatted URL` 和 `Copy Page Title`，formatted copy 会通过 runtime clipboard host capability 写入 `{ html, text }`。
- 正式 `notion/search-page` 已吸收迁移包的显式打开入口：搜索结果、data source 页面列表和 Detail 都同时提供 `Open in Notion` 与 `Open in Browser`；当 `open_in` 偏好是 Notion app 时，Browser action 会保持 HTTPS 并交给默认浏览器，避免只激活 Notion app。
- 正式 `notion/search-page` 的页面详情已吸收迁移包的 metadata 开关：默认保留正文预览，`Show Metadata` 可展开 Type、Page ID、Updated、Blocks 以及已知 Notion property metadata，包含 checkbox、select/multi-select、people、relation、email、phone 和 URL。
- 正式 `notion/search-page` 的页面 summary/detail 已补 Notion created_by 和 last_edited_by：runtime/AI summary 会保留 creator/editor，页面详情 metadata 可显示用户名称和头像。
- 正式 `notion/search-page` 已补 relation property 的读侧 summary：data source 页面列表 accessory、properties-in-preview Markdown 和 Detail metadata 都会显示关联 page id；暂不额外查询 relation page 标题，避免浏览页引入额外 fan-out。
- 正式 `notion/search-page` 的 data source 页面 quick edit 已补 `date` 和 `people` property：Edit Property 菜单可把日期设为当前时间或清空，也可添加/移除 Notion user，并通过 Notion client/domain helper 写入 Notion。
- 正式 `notion/search-page` 的 data source 页面列表已吸收迁移包的创建入口：进入 data source 后可以从列表 root action 或空列表态直接 `Create New Page`，并把当前 data source 作为创建页表单默认目标。
- 正式 `notion` 已吸收迁移包的 `properties_in_page_previews` extension preference：开启后页面 Detail 会把已知 Notion property summary 渲染到 Markdown 预览顶部，不额外增加页面详情请求。
- 正式 `notion/search-page` 已吸收迁移包的页面 quicklink action：搜索结果、data source 页面和 Detail 都能注册 page quicklink，链接会按 `open_in` 偏好生成 `notion://` 或原始 HTTPS URL。
- 迁移器生成的 `runtime-metadata.ts` 已能从 manifest command 名称、标题和描述生成第一批 launcher intent metadata，并生成精确 command alias 的 `resolveCommand`；生成代码保持自包含，不依赖 `@shared/launcher` 宿主 helper。
- `notion-generated` 的 AI 页面读取已补齐 Markdown 语义：`getPage` 返回 `{ blockCount, content, pageId, status }`，`getPageMarkdown` 返回 `{ blockCount, markdown, pageId, status }`，并通过 `page_size=100` + `start_cursor` 读取完整分页 blocks。
- `notion-generated` 的 AI tool 面已补到和正式 `notion` 兼容：除 `searchPages/getPage/getPageMarkdown/addToPage/createPage/getDatabases/searchDatabase` 外，也暴露 `retrievePage/listBlockChildren/retrieveDataSource/queryDataSource/createDatabasePage`；read aliases 走 Notion client endpoint，write aliases 支持 date divider、prepend 和创建页 property wrappers。这样后续把 generated UI 迁入正式 `notion` 时，AI 侧不会因为工具名减少而退化。
- 迁移器生成的 AI tool runner 已改成 tool-safe host context：`toast.show` 和 `navigation.hide-launcher` 在 AI tool 路径中以 no-op 成功返回，避免迁移代码的 UI side effect 让工具崩溃；其它 host capability 仍显式返回 unavailable，防止工具静默获得 UI-only 能力。
- 迁移报告已同步这个 tool-safe 语义：`src/tools/*` 里的 `showToast` 不再被标记为 blocking adapter，因为生成的 AI tool runner 会把 toast side effect 收敛为 no-op 成功。
- `notion-generated` 缺少 `accessToken` 时已覆盖真实 runtime smoke：UI command 通过 `withAccessToken` 渲染连接提示和 “Open Extension Settings” action，不再在 React render 阶段 throw 导致 runtime 子进程退出；AI/tool function 路径仍保持缺 token throw。
- 正式 `notion` 入口已补真实 BDD UI 验收：Launcher 搜索 `notion` 打开正式 `Search Pages` command，未连接时渲染 `Connection Required` 空状态，并通过 `Open Extension Settings` 进入正式 `notion` 设置页。
- 迁移器已经针对 Notion property value 做当前 Notion API 形态修正：`title/rich_text/number/date/select/status/multi_select/relation/people` 都会生成 Notion `pages.create` 需要的 property wrapper，而不是 Raycast 源码里偏旧的 raw value。
- `@openwork/extension-utils` 的 `useCachedPromise` 初始 loading 语义已对齐 Raycast 风格，避免异步首屏还没加载完时误触发空数据逻辑。
- `@openwork/extension-utils` 的 `useCachedPromise` 进阶语义已覆盖：`initialData`、`onData`、`onError`、`onWillExecute`、Raycast 风格 `abortable.current`，以及 pagination request 的 `page` / `lastItem`。
- `@openwork/extension-utils` 的 `useFetch` 已覆盖基础 Raycast utils 语义：JSON/text response、`mapResult`、pagination URL loader、`initialData`、callbacks、optimistic `mutate` 和默认 failure toast。
- `@openwork/extension-utils` 的 `showFailureToast` 已覆盖基础 Raycast utils 语义：Error/string 会转成 failure toast message，自定义 `title/message` 会保留。
- `@openwork/extension-api` 的 `showHUD` 已覆盖 Raycast 基础用法，当前映射为 success toast；`Icon.Upload` 已进入 runtime icon facade 和迁移预检支持表。
- `@openwork/extension-api` 的 `Cache` 已补 Raycast 同步 CRUD / namespace / subscribe 基础形态，并在 extension runtime 中按 extension + namespace 持久化到本地 cache 文件；迁移预检不再把 `Cache` 标记为 degradation note。
- `@openwork/extension-api` 的 `launchCommand` / `LaunchType` 已补 Raycast 基础形态，迁移代码可以通过 runtime navigation 打开同 extension 或显式 extension command，并透传 `arguments` / `launchContext` / `fallbackText`。
- 当前官方 Notion preview artifact 的工具输入 schema 已是 `high`：包括 `getDatabases` 这类无输入工具也会生成 `z.object({})`，不再被误判为 schema 风险。
- 当前官方 Notion preview artifact 和正式 `notion` 的 AI tool handlers 已脱离迁移期 `src/tools/*`：`searchPages`、`getPage`、`getPageMarkdown`、`addToPage`、`createPage` 及其 confirmation 都在 `main/tools.ts` 直接走 Notion client/domain helper。RPC/service cutover 策略已落地：正式包不再把旧 RPC service 迁回运行路径。
- 当前官方 Notion preview artifact 的 runtime compatibility 汇总为：`blockingIssues: 0`、`adapterNotes: 0`、`blockingAdapters: 0`、`unsupportedImports: 0`、`unsupportedMembers: 0`；剩余 `migrationNotes: 2`，集中在交互式授权产品语义说明，tool handler 迁移评分已是 `high`。
- 官方 Raycast Notion 迁移产物可以通过生成包自己的 `tsconfig.check.json`，并在 symlink 到 `extensions/<id>` 后通过 `validateNativeExtensionPackageBoundaries`。
- 生成包 package 依赖版本现在按 Openwork 标准版本收口，而不是默认继承源 Raycast extension 版本；这让 migration artifact 更接近可替换的正式 package contract。

## 维护原则

正式 Notion package 依赖这些业务包：

- `@notionhq/client`
- `@tryfabric/martian`
- `notion-to-md`
- `date-fns`

`quick-capture` 依赖这些网页抽取包：

- `@mozilla/readability`
- `linkedom`

源 `@raycast/*` import 的策略：

- 不要把绑定 Raycast runtime 的 `@raycast/api` 当成普通依赖直接运行。
- `@raycast/api` 应通过 Openwork facade/adapter 平替，生成代码不保留该 import。
- `@raycast/utils` 逐项判断：`withAccessToken` 这类 auth/runtime 绑定能力走 Openwork connection；`OAuthService` / `OAuth.PKCEClient` 只保留为通用迁移 facade，不进入 Notion 生成包源码。如果后续发现有纯工具函数可独立使用，可以先用，之后再替换。

后续工程动作：

1. 继续按正式 `extensions/notion` 往下跑未覆盖 command/action，优先补真实 smoke 暴露的 facade 缺口，而不是提前追完整 Raycast runtime。
2. 继续收敛 package contract：优先让新增 extension 可以复用 Notion 这条 manifest/runtime/main/tools/settings 结构，而不是在 `src/extensions` 里写特例。
3. 如果后续还需要 preview 对照，应放在 fixture 或 ignored 本地目录中，不能重新接入生产 registry。

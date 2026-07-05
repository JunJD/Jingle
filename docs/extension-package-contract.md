# Jingle Extension Package Contract

## 目的

Jingle extension package 必须能独立表达 manifest、runtime、main service、metadata 和 assets。宿主可以改变发现和装载方式，但 extension 本身的 command、AI tools 和 manifest 语义不应依赖宿主私有实现。

```txt
extension package
  -> manifest
  -> runtime entry
  -> main entry
  -> runtime metadata
  -> package assets
```

## 包结构

最小包结构是：

```txt
installable-extensions/<extension>/
  manifest.ts
  runtime.ts
  runtime-metadata.ts
  main.ts
  main/
  src/
  assets/
```

`src/extensions` 是宿主侧 registry/loader 层，不是 extension package 的默认源码根。新增 extension 应落在 `installable-extensions/<extension>`。

Installable extension 可以把同样结构放进独立 package。package 级 manifest 可以来自 `manifest.ts`、生成后的 `manifest.json`，或 `jingle.extension.json`。无论物理格式怎么变，宿主消费的结构必须保持一致。

## 入口职责

### Manifest

`manifest` 是 extension 的事实来源。它声明 extension 能提供什么，但不直接执行能力。

它应该包含：

- extension identity：`name`、`title`、`description`、`icon`
- platform policy：`supportedPlatforms`
- commands：人用 launcher 入口，包括 `view`、`no-view`、`menu-bar`
- preferences：extension 级和 command 级配置 schema
- connection：账号、auth、secret、public config 的声明
- AI capability：`instructions`、`guide`、`toolNames`、`toolDisplays`、`mention`
- runtime capabilities：`storage`、`clipboard`、`shell`、`navigation`、`rpc` 等宿主能力声明
- assets：只允许引用 package 内 `assets/...`

Manifest 不应该包含运行时状态、已解析 token、用户当前连接状态或 command execution result。

### Runtime Entry

`runtime.ts` 是人用 command 的 package-level runtime entry。它只负责把 manifest 里的 command 名称映射到 command component 或 no-view runner。

所有 launcher-facing command mode 都应有明确 runtime 入口：

- `view`：manifest `runtime.viewport` 描述窗口尺寸，`runtime.ts` 暴露 `Component`。
- `menu-bar`：manifest `runtime` 可以是空对象，`runtime.ts` 暴露 `Component`，由 ambient menu-bar runtime session 驱动。
- `no-view`：manifest `runtime` 可以是空对象，`runtime.ts` 暴露 `run`，不能用空函数假装可执行。

当前形态：

```ts
export const exampleRuntime = defineNativeExtensionRuntime({
  extensionName: "example",
  commands: {
    "open-item": {
      Component: OpenItem,
      mode: "view"
    },
    "quick-add": {
      mode: "no-view",
      run: runQuickAdd
    },
    "menu-bar": {
      Component: MenuBar,
      mode: "menu-bar"
    }
  }
})
```

Runtime entry 可以 import 本 extension 包内的 command 代码和 public extension SDK。它不能 import renderer、main、preload、ai-core 或 model provider 的私有实现。

### Main Entry

`main.ts` 是宿主 main process 可调用的 extension 服务入口，负责注册 AI tools、RPC services 或 main-only helpers。

Main entry 消费的是已解析的 execution context：

```txt
resolved connection
extension public preferences
command preferences when relevant
host capabilities allowed by manifest
tool input
```

它不应该自己扫描全局 settings，也不应该绕过 connection resolver 读取 secret。Command 和 AI tools 必须共享同一个 extension connection 语义。它的相对 import 闭包不能回拉 `runtime.ts`、`runtime-metadata.ts` 或 UI component module；main entry 应保持为 main-process/AI tools 边界。

### Runtime Metadata

`runtime-metadata.ts` 放 renderer 可以安全读取并可经 IPC 投影的 JSON-safe 静态展示信息，例如 command aliases、keywords、placeholder、argument hints 和 launcher result metadata。

它不能 import runtime command module，也不能持有 callback、function search adapter、storage、token 或其他运行时状态。它的相对 import 闭包也不能触达 `runtime.ts`、`main.ts`、`main/**` 或 UI component module；launcher 搜索消费这层时，只能拿到可序列化 metadata。`buildIntentItems` / `resolveCommand` 这类函数型搜索能力必须作为单独 adapter 设计，不能进入 installable metadata 或 IPC catalog projection。

### Assets

Assets 归 extension package 所有。Manifest、runtime metadata 和 runtime snapshot 只能引用 package-relative asset path，例如：

```txt
assets/icon.png
assets/notion-logo.svg
```

禁止引用 app 私有资源路径或机器绝对路径。

## 依赖边界

Extension package 允许依赖：

- Jingle public extension SDK 和 facade
- Jingle public package 暴露的 shared types
- package 内相对路径
- package 声明的 npm 依赖

Extension package 禁止依赖：

- `src/main/**` 私有实现
- `src/renderer/**` 私有实现
- `src/preload/**` 私有实现
- `src/renderer/src/ai-core/**`
- launcher 私有组件
- monorepo-only alias，例如 `@shared/*`
- 未声明的宿主全局对象

如果 extension 需要剪贴板、storage、shell、navigation、RPC、AI 或 auth，它必须在 manifest 声明对应 capability，由宿主在 runtime 边界校验。

`make extensions` 会检查 bundled `installable-extensions/<extension>` package 的最小包形态和 import 边界：

- package 目录名必须和 `package.json` 的 Jingle package name 对齐：`installable-extensions/<extension>` 必须声明 `"name": "@jingle/extension-<extension>"`。
- package 入口 identity 必须和目录名对齐：`manifest.ts` 的 `name`、`runtime.ts` 的 `extensionName`、`runtime-metadata.ts` 的 `extensionName` 都必须解析为同一个 `<extension>`。
- package 必须声明 `"type": "module"`、`"main": "./main.ts"`、`"types": "./manifest.ts"`。
- package 必须提供文件入口 `manifest.ts`、`runtime.ts`、`runtime-metadata.ts`、`main.ts`。
- package 必须提供目录入口 `main/`、`src/`、`assets/`。
- manifest/command 里声明的字符串 icon 必须是 package-relative `assets/...` 路径，且文件必须存在于该 extension package 内。
- 如果 package 声明了 `runtime-metadata.ts.commands`，那么 `manifest.ts` 里声明了 `runtime` 的 command、`runtime.ts` 的 `commands`、`runtime-metadata.ts` 的 `commands` 必须按同一 command name 顺序对齐。
- manifest 里声明了 `runtime` 的 `view` command 必须在 `runtime.ts` 中有 `Component`；`menu-bar` command 必须有 `Component`；`no-view` command 必须有 `run`。
- `runtime-metadata.ts` 的 package 内相对 import 闭包不能触达 `runtime.ts`、`main.ts`、`main/**` 或 `.tsx/.jsx` UI component module。
- `main.ts` 的 package 内相对 import 闭包不能触达 `runtime.ts`、`runtime-metadata.ts` 或 `.tsx/.jsx` UI component module。
- 如果 manifest 声明了非空 `aiCapability.toolNames`，`main.ts` 必须通过 `defineNativeExtensionMain({ tools })` 注册对应 AI tools；AI capability 不能只停留在 manifest。
- 如果 `main.ts` 通过 `defineNativeExtensionMain({ service })` 暴露 main-process service，manifest 必须显式声明 RPC capability 或 `rpcMethods`；service 不能变成隐式宿主入口。
- `installable-extensions/<extension>` 可以是真实目录，也可以是指向 package 目录的 symlink；两种形态都必须被同一套边界检查覆盖。
- package 内相对 import 不能跳出自己的 extension 根目录。
- runtime/source 文件不能直接 import Node built-ins、Electron 或宿主私有 alias。
- main entry 和 `main/**` 可以使用 main-process-only API，但仍必须通过 package 自己声明的 dependency/peerDependency 表达依赖。
- 第三方依赖必须出现在该 extension package 的 `dependencies` 或 `peerDependencies` 中，不能隐式吃根应用依赖。
- Extension package 不能声明或 import 其他 launcher runtime 绑定包。需要宿主能力时，应使用 Jingle public extension SDK 或 package 自己声明的依赖。

## AI Capability Contract

AI capability 是 agent 可加载的能力入口，不是 command 的副本，也不是独立账号体系。

它应该表达：

- 什么时候应该使用这个 extension
- 当前能力的限制和失败语义
- 哪些 tools 可以暴露给 agent
- tools 的展示名和描述
- missing auth 时仍可注入的 guide/instructions

它不应该表达：

- UI command 的 React 实现
- command 私有状态
- 单独的 AI token 读取逻辑
- profile 或 multi-account 主通路

运行时语义是：

```txt
@mention or loadExtension
  -> resolve selected extension
  -> resolve extension connection
  -> inject instructions and guide
  -> expose tools only when connection is connected
```

如果未连接，agent 可以知道 extension 存在，也可以解释如何连接，但不能调用工具。

## 当前聚合点

Built-in extension 当前仍通过 build-time registry 聚合：

- `src/extensions/index.ts`
- `src/extensions/main.ts`
- `src/extensions/runtime-packages.ts`
- `src/extensions/runtime-metadata-packages.ts`

这些 registry 是 built-in 装配细节，不是 extension package 应该依赖的 API。Installable extension 由 `jingle.extension.json` 进入 installed provider，再经 registry service 投影给 main/preload/renderer。每个 package 暴露的 manifest、runtime entry、main entry 和 JSON-safe runtime metadata contract 应保持一致。

## 验证门槛

涉及 extension package contract 的改动至少应通过：

```bash
make extensions
make check
```

如果改动包含前端运行时依赖增删，还需要运行当前前端依赖审计脚本：

```bash
node scripts/audit-frontend-package-relations.mjs --root . --frontend src/renderer/src
```

# Openwork Installable Extension Runtime V1 方案

日期：2026-06-11

基线：`origin/v3.0.0` @ `39557d80ffc29db0b968308a7ce2740cc5f7e89d`。

本文是 standalone 方案文档。它只依赖当前仓库代码事实、本地 SuperCmd 对照实现、Raycast / VS Code / Electron 官方文档，不依赖任何聊天上下文。

## 0. 执行摘要

结论：好做，但不是“小补丁”。Openwork 的 extension 基础建设已经接近外部包形态，真正缺的是“安装态运行时基础设施”。

V1 应做四件事：

1. 把当前静态 extension arrays 收口成 `BuiltInExtensionProvider`。
2. 新增 `InstalledExtensionProvider`，从 `OPENWORK_HOME/extensions` 读取 artifact descriptor。
3. 新增 `ExtensionRegistryService`，统一给 launcher、Settings、runtime、AI tools、assets 提供 registry view。
4. 让 `utilityProcess` runtime 根据 host 传入的 `ExtensionRuntimePackageRef` 加载 installed runtime module。

明确不做三件事：

1. 不做 marketplace、远程下载、自动更新。
2. 不让 renderer 执行 installed extension JavaScript。
3. 不为 installed extension 另造一套 SDK / renderer / AI tool path。

最小可验证路径：

```txt
built-in registry provider
  -> installed descriptor reader
  -> registry-backed launcher/settings/catalog
  -> runtime dynamic module loader
  -> AI main module trusted proof
  -> main worker isolation
```

当前实现状态（2026-06-11 更新）：

- 已落地：`src/main/extensions/registry/*`，包含 built-in provider、installed provider、descriptor parser、registry service、main module loader。
- 已落地：`packages/extension-cli`，提供 package 归属的 `openwork-extension build/dev` CLI；根目录脚本只做开发期转发。
- 已接入：main-side Settings schema、RPC invocation、asset resolver、OAuth / connection resolver、agent AI tools/catalog、menu-bar runtime、utilityProcess runtime launch 都通过 `getDefaultExtensionRegistryService()`。
- 已验证：Apple Reminders、Figma Files、GitHub、Notion 已从 built-in 静态 manifest/main/runtime/runtime-metadata registry 移出，并可由 CLI 构造成 trusted installed package 后被 provider 发现、加载 runtime module。
- 已接入：renderer launcher command owner 和 source mention 可以从 main/preload 暴露的 catalog projection 构造，不再需要 renderer 为 installed package 读取 filesystem 或 module path。
- 仍未做：installed package 的函数型 launcher search resolver 还没有 renderer-safe ABI。函数型 `buildIntentItems` / `resolveCommand` 已从 installable runtime metadata 契约剥离；当前只投影 aliases、keywords、placeholder、argument hints 等 JSON-safe metadata。下一波需要决定 installed extension 的搜索增强是继续声明式化，还是由 runtime/main 侧提供 query provider。

Raycast CLI 对照结论：

- Raycast 的开发者 CLI 以 extension 目录为工作单元，提供 build / develop / lint / publish 等命令。
- Openwork 当前先落 `build` 和 `dev`：`build` 生成 installable package descriptor + bundled runtime/main modules；`dev` 先 build，再 watch 源码重建。
- `publish`、远程 marketplace、签名和自动更新不进入本轮。

## 1. 目标

本方案定义 Openwork 如何支持“外部安装进来的 extension”。

V1 的目标不是 marketplace，而是让一个符合 Openwork extension 契约的包离开 app 源码树后，仍然可以被安装、索引、加载和运行。

验收目标：

- extension 可以安装到 `OPENWORK_HOME/extensions`。
- installed extension 可以出现在 launcher 搜索和 Settings。
- installed extension 的 `view`、`menu-bar`、`no-view` command 可以通过现有 extension runtime 运行。
- installed extension 的 AI capability 可以进入 extension catalog，并通过 `loadExtension` / `callExtensionTool` 使用。
- installed extension 的 assets 由宿主解析和暴露，renderer 不读取安装目录。

一句话版本：

```txt
把当前编译期静态 extension registry
改成 built-in provider + installed provider 合并出来的 host-owned registry。
```

## 2. 非目标

V1 不做以下内容：

- 不做 marketplace。
- 不做远程下载、自动更新和回滚。
- 不做签名公钥体系。
- 不做跨 extension dependency。
- 不做多个版本同时启用。
- 不让 renderer 执行外部 extension JavaScript。
- 不把普通 extension 打成独立 executable。
- 不为每个 extension 携带一份 React runtime。
- 不改变现有 command surface snapshot 渲染协议。

这些能力以后可以做，但不应进入第一阶段，否则会掩盖最核心的问题：当前 extension package contract 能否支持外部安装态。

## 3. 术语

### Extension Package

一个 extension 的发布单元。它包含 manifest、runtime entry、main entry、runtime metadata 和 assets。

### Built-in Extension

随 Openwork app 一起发布的静态 extension。当前 `extensions/image-generation` 和 `src/extensions/*` 下保留的是 built-in 静态 extension；`installable-extensions/apple-reminders`、`installable-extensions/figma-files`、`installable-extensions/github`、`installable-extensions/notion` 是随仓库开发和发布的 trusted installed package 样本，不再走 built-in 静态 registry。

### Installed Extension

用户安装到本机 `OPENWORK_HOME/extensions` 下的 extension。它不在 app 源码树里，也不通过 `src/extensions/*.ts` 静态 import 进入宿主。

### Extension Registry

宿主侧统一的 extension 索引服务。它合并 built-in extension 和 installed extension，向 launcher、Settings、AI runtime、asset resolver、extension runtime 提供一致视图。

### Runtime Entry

extension 提供给人用 command 的入口。它负责把 command name 映射到 `view` / `menu-bar` component 或 `no-view` runner。

### Main Entry

extension 提供给宿主 main-side 能力的入口。它负责 AI tools、RPC service 或 main-only helper。

### Runtime Process

Openwork 用 Electron `utilityProcess` 启动的 extension command 执行环境。extension command code 在这里运行，再被转换成 renderer 可显示的 snapshot。

## 4. 当前代码事实

Openwork 已经有完整的 extension package 语义。当前 built-in extension 仍保留静态聚合；trusted installed package 已经通过 descriptor 进入 registry service，再由 main/preload/renderer 和 runtime loader 消费。

### 4.1 已有契约

作者 API 边界：

- `packages/extension-api/README.md`
- `packages/extension-api/src/extensions/runtime-contract.ts`

当前已定义：

- `defineNativeExtensionManifest`
- `defineNativeExtensionRuntime`
- `defineNativeExtensionRuntimeMetadata`
- `defineNativeExtensionMain`
- `ExtensionToolDefinition`
- extension runtime SDK

核心 shared contract：

- `src/shared/native-extensions.ts`
- `src/shared/extension-runtime-protocol.ts`
- `src/shared/extension-sources.ts`

这些文件已经覆盖：

- manifest
- command
- preferences
- connection / OAuth
- AI capability
- AI tools
- runtime capability
- runtime surface snapshot

### 4.2 已有 runtime

当前 command runtime 链路：

```txt
src/main/services/extension-runtime/utility-process-launcher.ts
  -> utilityProcess.fork(extension-runtime-entry.js)

src/extension-runtime/entry.ts
  -> load runtime package from host-provided built-in or installed module ref
  -> execute no-view run or render React Component
  -> create ExtensionSurfaceSnapshot
  -> post snapshot back to main

renderer
  -> render host-owned surface
  -> send runtime events back
```

这个方向应保留。

关键边界：

- extension command code 在 `utilityProcess` 中运行。
- renderer 不 import extension command module。
- renderer 只显示 `ExtensionSurfaceSnapshot`。
- host capabilities 通过 `extension-runtime-protocol` 请求。

### 4.3 当前缺口

当前 built-in extension 仍保留编译期静态 import，但宿主消费入口已经收口到 registry service：

- `src/extensions/index.ts` 静态聚合 built-in manifests。
- `src/extensions/main.ts` 静态聚合 built-in main definitions。
- `src/extensions/runtime-packages.ts` 静态聚合 built-in runtime packages。
- `src/extensions/runtime-metadata-packages.ts` 静态聚合 built-in runtime metadata。
- installed package 由 `openwork.extension.json` descriptor 进入 `InstalledExtensionProvider`。
- renderer launcher 只消费 main/preload 投影的 catalog projection。
- utility process runtime 由 host 传入 built-in ref 或 installed module ref 后加载。

因此，当前 extension 实际状态是：

```txt
package contract 已经像外部包
主链路已能发现和加载 trusted installed package
但第三方安全模型、dev reload、函数型 search provider 仍未完成
```

后续要补的是第三方 trust/capability 边界、dev reload 机制和 runtime/query search ABI，不是重写 renderer、SDK 或 command UI protocol。

### 4.4 证据索引

这组证据用于约束后续实现边界：哪些代码已经是 public contract，哪些代码只是当前 built-in registry 的静态装配方式。

| 证据                                                                                                                  | 位置                                                                                                             | 结论                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@openwork/extension-api` 已声明自己是 bundled 和 future installable extensions 的 public boundary                    | `packages/extension-api/README.md:1-10`                                                                          | 外部 extension 只能依赖 author API，不能 import `src/main`、`src/renderer`、`@shared`、`@extensions` 内部路径。        |
| runtime package contract 已经抽象成 `NativeExtensionRuntimePackage`，command entry 包含 `view`、`menu-bar`、`no-view` | `packages/extension-api/src/extensions/runtime-contract.ts:1-58`                                                 | V1 不需要重新设计 command mode；runtime package 已经可以由 host 传入 built-in ref 或 installed module ref 加载。       |
| manifest 已承载 command、preferences、connection、AI capability、runtime capabilities 和 assets                       | `packages/extension-api/src/shared/native-extensions.ts:199-235`                                                 | installed extension 的 descriptor 应引用现有 manifest contract，而不是再造一份 manifest。                              |
| main entry 已经定义为 `service?: NativeExtensionService` 和 `tools?: ExtensionToolDefinition[]`                       | `packages/extension-api/src/shared/native-extensions.ts:251-254`                                                 | AI tools / main-side 能力有现成入口；V1 需要补 main module loading 和 worker 边界。                                    |
| manifest / main validation 已经存在                                                                                   | `packages/extension-api/src/shared/native-extensions.ts:567-620`                                                 | installed provider 应复用现有校验，不应在下游 UI 用 fallback 隐藏坏 manifest。                                         |
| built-in manifest 现在由静态 import 数组聚合                                                                          | `src/extensions/index.ts:1-29`                                                                                   | 要引入 `BuiltInExtensionProvider` 包装当前数组，避免直接让所有消费方继续依赖静态 registry。                            |
| built-in main definitions 现在由静态 import map 聚合                                                                  | `src/extensions/main.ts:1-36`                                                                                    | main-side tool registry 的输入应从 registry service 来，而不是继续只读 built-in map。                                  |
| built-in runtime package 现在由静态 import 数组聚合                                                                   | `src/extensions/runtime-packages.ts:1-17`                                                                        | 这只代表 built-in runtime；installed runtime 由 registry descriptor 指向 module。                                      |
| runtime command lookup 可查静态 `nativeExtensionRuntimePackages` 生成的 map                                           | `src/extensions/runtime.ts:7-33`                                                                                 | 该 helper 仅覆盖 built-in；`src/extension-runtime/entry.ts` 已改为根据 host 传入的 module ref import runtime package。 |
| command runtime 已经在 `utilityProcess` 内执行，并通过 host protocol 发送 snapshot                                    | `src/main/services/extension-runtime/utility-process-launcher.ts:11-25`、`src/extension-runtime/entry.ts:94-188` | 运行外部 extension 不应回退到 renderer eval；应沿用 utilityProcess 和 snapshot 协议。                                  |
| foreground runtime session 生命周期在 main process 管理                                                               | `src/main/services/extension-runtime/runtime-manager.ts:219-229`                                                 | installed runtime loader 应由 main 派发 module ref，不应让 renderer 参与路径解析。                                     |
| extension tool registry 已经按 extension name 注册 tools，并校验 unknown / duplicate                                  | `src/main/extension-tools/registry.ts:45-68`                                                                     | installed extension tools 应进入同一个 registry，不应另起一套 AI tool 执行路径。                                       |
| native extension tool registry 现在从 manifests + main definitions 生成                                               | `src/main/extension-tools/native-extension-tools.ts:7-23`                                                        | registry service 需要同时提供 manifests 和 main definitions/module refs。                                              |
| AI capability helper 仍保留静态 `nativeExtensionManifests` 默认 registry                                             | `src/extensions/sources.ts:44-88`、`src/extensions/sources.ts:474-485`                                           | installed extension 主路应使用 `*FromManifests` helper 并传入 registry-backed manifest list，避免消费静态默认 registry。 |
| registry-level validation 已经检查 manifest、main、runtime、metadata、asset、command 对齐                             | `src/main/native-extensions/validation.ts:99-180`                                                                | installed provider 的第一批测试应复用这套 validation，补 asset roots / package roots。                                 |
| agent runtime 从 native-extension service 获取 manifest 和 main definitions 后创建 tool registry                      | `src/main/agent/runtime.ts:211-228`、`src/main/services/native-extensions/index.ts:92-133`                       | AI tools 已能消费 registry-backed installed package；普通第三方 main module 仍需要 worker/sandbox 边界。              |
| agent service 通过 registry-backed manifest list 调用 `@extensions/sources` 的 `*FromManifests` helper                | `src/main/agent/service.ts:537-609`、`src/extensions/sources.ts:96-180`                                          | capability hydration 已能接 installed manifest，但 source helper 的静态默认 registry 不能继续作为 installed 主入口。  |
| 仓库已有研究已经确认 artifact 应包含 manifest、runtime entry、main entry、runtime metadata 和 assets                  | `docs/extension-runtime-architecture-research-cn.md:153-188`                                                     | V1 应收敛 installable artifact contract，不推翻已有 package contract。                                                 |
| 仓库已有研究已经确认 extension state / lifecycle / renderer 边界                                                      | `docs/extension-runtime-architecture-research-cn.md:196-210`                                                     | 保留当前主方向：extension owns state and callbacks，main owns lifecycle and capabilities，renderer owns presentation。 |
| 迁移预览文档要求新增 extension 复用 Notion 的 manifest / runtime / main / tools / settings 结构                       | `docs/raycast-notion-dependency-migration-preview.md:541-544`                                                    | installed extension V1 应让外部包走同一结构，而不是为 installed extension 另造形态。                                   |

外部对照证据：

| 对照                      | 位置                                                                                                   | 可借鉴                                                                                       | 不复制                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| SuperCmd build runner     | `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts:641-803`、`:1137-1168` | 安装/首次运行前 build、业务依赖 bundle、React / host API external、运行时读取预构建 bundle。 | 多层 on-demand fallback 和 renderer 侧假 require 不应进入 Openwork V1。                                                       |
| SuperCmd renderer runtime | `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/ExtensionView.tsx:3563-4010`       | 证明外部 extension 需要共享 host React 实例。                                                | `new Function` 执行 extension bundle、renderer fakeRequire、未知模块 proxy/noop fallback 都不适合作为 Openwork 长期 runtime。 |
| Raycast                   | `Lifecycle`、`Manifest`、`List`、`How Raycast API Extensions Work` 官方文档                            | manifest-first、command modes、preferences、extension lifecycle。                            | Raycast 私有 runtime 和 `@raycast/api` 不能直接作为 Openwork runtime 依赖。                                                   |
| VS Code                   | `Extension Host`、`Web Extensions`、`Activation Events`、`Contribution Points` 官方文档                | extension host 与 UI host 分离、contribution points 可索引、按环境选择 runtime。             | VS Code 的完整 activation graph 和 marketplace governance 不进入 V1。                                                         |
| Electron                  | `utilityProcess` 官方文档                                                                              | utility process 适合承载独立 JS runtime service。                                            | 不因此把所有 main tools 都塞进同一个长期共享 process；AI tool worker 仍要单独定义生命周期。                                   |

## 5. 目标架构

目标架构：

```txt
                    ┌─────────────────────────┐
                    │ BuiltInExtensionProvider│
                    └───────────┬─────────────┘
                                │
                                ▼
┌────────────────────┐   ┌──────────────────────┐
│InstalledExtension  │   │ ExtensionRegistry     │
│Provider            ├──►│ Service               │
└────────────────────┘   └──────────┬───────────┘
                                    │
        ┌───────────────────────────┼────────────────────────────┐
        ▼                           ▼                            ▼
 launcher / settings          extension runtime             agent / AI tools
 manifests + metadata         runtime module path           main module / tools
```

运行时方向：

```txt
launcher opens extension command
  -> main asks ExtensionRegistryService for package + runtime module
  -> utilityProcess starts extension-runtime-entry.js
  -> runtime entry imports installed package runtime module
  -> validates extensionName / commandName / mode
  -> executes command
  -> emits ExtensionSurfaceSnapshot
  -> renderer displays host-owned UI
```

AI tools 方向：

```txt
agent asks for extension
  -> ExtensionRegistryService lists AI capability
  -> loadExtension returns guide + tool schema
  -> callExtensionTool resolves tool binding
  -> ExtensionMainWorker imports main module
  -> tool executes with resolved connection/preferences
  -> result returns through existing extension tool output contract
```

## 6. Extension Artifact Contract

V1 使用解压目录作为最小安装形态。后续可以把同样结构打包成 `.owext`。

目录结构：

```txt
OPENWORK_HOME/extensions/<extension-id>/<version>/
  openwork.extension.json
  manifest.json
  runtime-metadata.json
  dist/
    runtime.mjs
    main.mjs
  assets/
```

`openwork.extension.json`：

```json
{
  "schemaVersion": 1,
  "id": "github",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "manifest": "./manifest.json",
  "runtimeMetadata": "./runtime-metadata.json",
  "runtime": "./dist/runtime.mjs",
  "main": "./dist/main.mjs",
  "assets": "./assets",
  "platforms": ["darwin", "linux", "win32"]
}
```

规则：

- 所有路径必须是 package-relative path。
- 所有路径解析后必须留在 package root 内。
- `manifest.json` 必须符合 `NativeExtensionPackageManifest`。
- `runtime-metadata.json` 必须符合 `NativeExtensionRuntimePackageMetadata`。
- `dist/runtime.mjs` 必须 export 一个 `NativeExtensionRuntimePackage`。
- `dist/main.mjs` 必须 export 一个 `NativeExtensionMainDefinition`。
- `manifest.name`、runtime `extensionName`、runtime metadata `extensionName`、descriptor `id` 必须一致。
- command mode 必须在 manifest 和 runtime entry 中一致。

依赖规则：

- `react`、`react/jsx-runtime`、`@openwork/extension-api` 由 host 提供。
- extension 业务依赖默认 bundle 到 `dist/runtime.mjs` 或 `dist/main.mjs`。
- 不允许 runtime bundle import app 私有路径，例如 `src/main/**`、`src/renderer/**`、`@shared/*`、`@extensions/*`。
- Node built-ins、native addon、postinstall、动态 require 不进入 V1 默认支持范围。

React 要求：

extension runtime command 会使用 React hooks。runtime bundle 不能自带另一份 React，否则容易破坏 reconciler 的 hook/runtime 实例一致性。因此 React 必须是 host-provided external。

## 7. Registry Contract

新增 normalized package descriptor：

```ts
interface ExtensionPackageDescriptor {
  id: string
  version: string
  source: "built-in" | "installed"
  rootDir: string
  enabled: boolean
  manifest: NativeExtensionPackageManifest
  runtimeMetadata: NativeExtensionRuntimePackageMetadata | null
  runtimeModulePath: string | null
  mainModulePath: string | null
  assetsDir: string
  errors: ExtensionPackageError[]
}
```

错误结构：

```ts
interface ExtensionPackageError {
  code:
    | "descriptor_missing"
    | "descriptor_invalid"
    | "manifest_invalid"
    | "runtime_metadata_invalid"
    | "runtime_missing"
    | "main_missing"
    | "platform_unsupported"
    | "api_version_unsupported"
    | "asset_path_invalid"
  message: string
}
```

Registry service：

```ts
interface ExtensionRegistryService {
  listPackages(): ExtensionPackageDescriptor[]
  listEnabledPackages(platform: string): ExtensionPackageDescriptor[]
  listManifests(platform: string): NativeExtensionPackageManifest[]
  getPackage(extensionName: string): ExtensionPackageDescriptor | null
  getRuntimePackageRef(extensionName: string): ExtensionRuntimePackageRef | null
  getMainPackageRef(extensionName: string): ExtensionMainPackageRef | null
  resolveAsset(extensionName: string, assetPath: string): string
}
```

`ExtensionRuntimePackageRef`：

```ts
type ExtensionRuntimePackageRef =
  | {
      extensionName: string
      kind: "built-in"
      version: string
    }
  | {
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }
```

`ExtensionMainPackageRef`：

```ts
type ExtensionMainPackageRef =
  | {
      definition: NativeExtensionMainDefinition
      extensionName: string
      kind: "in-memory"
      version: string
    }
  | {
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }
```

## 8. Provider Design

### 8.1 BuiltInExtensionProvider

职责：

- 包装当前静态 registry。
- 不改变现有 built-in extension 行为。
- 给 registry service 提供和 installed provider 一样的 descriptor。

输入：

- `nativeExtensionManifests`
- `nativeExtensionMainDefinitions`
- `nativeExtensionRuntimePackages`
- `nativeExtensionRuntimeMetadataPackages`

输出：

- `ExtensionPackageDescriptor[]`

### 8.2 InstalledExtensionProvider

职责：

- 扫描 `OPENWORK_HOME/extensions`。
- 读取 `openwork.extension.json`。
- 校验 manifest、runtime metadata、runtime module、main module 和 assets root。
- 只把可用能力暴露给 registry。

输入：

- `OPENWORK_HOME/extensions`

输出：

- `ExtensionPackageDescriptor[]`

失败处理：

- provider 不能抛出全局异常导致所有 extension 不可用。
- 单个 extension 失败只影响该 extension。
- 失败必须记录到 descriptor errors，并暴露给 Settings。

## 9. Runtime Loading

当前 `src/extension-runtime/entry.ts` 接收 host start message 中的 runtime package ref，再加载 built-in runtime package 或 installed module。

V1 改成 host start message 携带 runtime package ref：

```ts
interface ExtensionRuntimeStartRequest {
  context: ExtensionRuntimeLaunchContext
  runtime: ExtensionRuntimePackageRef
}
```

runtime process 行为：

1. 接收 start request。
2. 如果 `runtime.kind === "built-in"`，使用当前 bundled runtime lookup。
3. 如果 `runtime.kind === "module"`，`import(runtime.modulePath)` 并读取 exported runtime package。
4. 校验 `runtimePackage.extensionName === context.extensionName`。
5. 查找 `context.commandName`。
6. 校验 command mode。
7. 执行 `no-view.run(...)` 或渲染 `Component`。
8. 按现有协议发送 `ready`、`surface`、`error`。

失败语义：

- module import 失败：session error，code `runtime_module_load_failed`。
- extensionName 不一致：session error，code `runtime_module_identity_mismatch`。
- command 不存在：session error，code `runtime_command_missing`。
- mode 不一致：session error，code `runtime_command_mode_mismatch`。
- command 执行失败：session error，code `runtime_command_failed`。

这些错误应进入现有 runtime error channel，并在 UI 上呈现为 extension runtime failure，而不是静默回到空页面。

## 10. Main Tools Loading

V1 分两步做。

### V1a：Trusted Local Proof

用于验证 package contract 和 registry 通路。

行为：

- built-in extension 保持现状。
- installed extension 的 main module 可以在 main process dynamic import。
- 只支持本地开发 / trusted extension。
- 明确标记为过渡实现。

### V1b：ExtensionMainWorker

用于第三方 extension。

行为：

```txt
callExtensionTool
  -> registry resolves main module ref
  -> ExtensionMainWorker imports dist/main.mjs
  -> handler executes with resolved extension execution context
  -> result returns to ExtensionToolExecutor
```

失败语义：

- main module missing：AI capability 可展示，但 tools 不注册为 callable。
- main module import failed：tools 不注册，Settings 显示 load error。
- tool missing：`loadExtension` 不列出该 tool，不能在调用时 fallback 猜测。
- tool handler failed：按现有 tool failure path 返回。

## 11. AI Capability Loading

AI capability 仍来自 manifest。

Installed extension 主路不应从静态 `nativeExtensionManifests` 派生，而应从 registry-backed manifest list 派生。当前 agent service 已通过 native-extension service 获取 manifest list，再调用 `@extensions/sources` 的 `*FromManifests` helper；`@extensions/sources` 内部保留的静态默认 registry 只能作为 built-in/helper 兼容点，不能作为 installed package 的 source of truth。

保持现有边界：

```txt
catalog
  -> lightweight extension capability summary

loadExtension(extensionName)
  -> full guide + tool schema + tool display

callExtensionTool(extensionName, toolName, args)
  -> execute registered extension tool
```

规则：

- 未连接 extension 可以出现在 catalog。
- 未连接 extension 不能注册 callable tools。
- main module 失败时，tools 不可调用。
- tool output 继续走 extension-owned output declaration，再由 host 映射到 presentation / artifact。

## 12. Asset Loading

当前 asset URL 形态可以保留，但解析必须改成 registry-backed。

流程：

```txt
openwork-extension-asset://github/assets/icon.svg
  -> ExtensionRegistryService.resolveAsset("github", "assets/icon.svg")
  -> verify resolved path under descriptor.assetsDir
  -> serve file
```

规则：

- renderer 永远不接触真实安装路径。
- asset path 必须是 package-relative path。
- 不能允许 `..` 跳出 assets root。
- unknown extension 或 missing asset 返回明确错误。

## 13. Settings and Install State

Settings 需要展示两类状态：

- installed extension 是否 enabled。
- installed extension 是否有 package errors。

最小数据：

```ts
interface InstalledExtensionSettingsView {
  id: string
  version: string
  source: "built-in" | "installed"
  enabled: boolean
  title: LocalizedTextValue
  description?: LocalizedTextValue
  commands: NativeExtensionCommandSettingsSchema[]
  preferences: NativeExtensionPreferenceSchema[]
  errors: ExtensionPackageError[]
}
```

V1 不要求在 Settings 内完成下载和安装。可以先支持本地目录安装后展示。

## 14. 分阶段实施

### Phase 1：Registry Service，不改变行为

目标：

- 新增 `ExtensionRegistryService`。
- 新增 `BuiltInExtensionProvider`。
- 当前静态 arrays / maps 由 provider 包装。
- 对外行为保持不变。

改动点：

- `src/extensions/index.ts`
- `src/extensions/main.ts`
- `src/extensions/runtime-packages.ts`
- `src/extensions/runtime-metadata-packages.ts`
- `src/extensions/runtime.ts`

验收：

```bash
npm run check:extensions
npm run check:guardrails
npm run typecheck:node
npm run typecheck:web
```

### Phase 2：Installed Descriptor Reader

目标：

- 定义 `openwork.extension.json` schema。
- 新增 `InstalledExtensionProvider`。
- 支持从临时测试目录读取 installed extension。
- package errors 可被 Settings 查询。

验收：

```bash
npm run test:node:target -- tests/node/extension-runtime-registry.test.ts
npm run check:extensions
```

### Phase 3：Runtime Dynamic Loader

目标：

- runtime start message 携带 `ExtensionRuntimeModuleRef`。
- `src/extension-runtime/entry.ts` 支持 dynamic import installed runtime module。
- 一个 fixture installed extension 可以启动 `view` 和 `no-view` command。

验收：

```bash
npm run test:node:target -- tests/node/extension-runtime-manager.test.ts tests/node/extension-runtime-registry.test.ts
npm run typecheck:node
npm run typecheck:web
```

### Phase 4：AI / Main Entry Loading

目标：

- AI capability registry 从 `ExtensionRegistryService` 派生。
- installed extension 的 `dist/main.mjs` 可以注册 tools。
- 先完成 trusted local proof，再迁移到 worker。

验收：

```bash
npm run test:node:target -- tests/node/extension-source-tools.test.ts tests/node/apple-reminders-source-tools.test.ts
npm run check:guardrails
```

### Phase 5：Artifact Build Proof

目标：

- 从一个现有 built-in extension 生成 installable artifact。
- artifact 安装到临时 `OPENWORK_HOME/extensions`。
- 测试证明它不依赖 app source tree 也能被 registry 发现。

建议样本：

- `apple-reminders`：集成度最高，可验证 command + RPC + AI tools。
- `translate`：较小，可验证最小 command runtime。

## 15. 验收标准

V1 完成时，至少应能证明：

1. built-in extension 行为不变。
2. installed extension manifest 能进入 registry。
3. installed extension command 能进入 launcher。
4. installed extension settings schema 能进入 Settings。
5. installed extension runtime command 能通过 `utilityProcess` 启动。
6. renderer 没有 import installed extension code。
7. installed extension AI capability 能进入 catalog。
8. 未连接或 main module 失败时，tools 不会被注册为 callable。
9. asset path 由 registry 安全解析。
10. package load failure 在 Settings 或 runtime error 中可见。

## 16. 外部参考结论

### Raycast

可借鉴：

- manifest 声明 extension / command。
- command mode：`view`、`no-view`、`menu-bar`。
- preferences / arguments / lifecycle 是 host 可理解的结构。

不直接复制：

- Raycast 私有 runtime。
- 以 Raycast compatibility 为中心的 API 形态。

参考：

- [Raycast Lifecycle](https://developers.raycast.com/information/lifecycle)
- [Raycast Manifest](https://developers.raycast.com/information/manifest)
- [Raycast List](https://developers.raycast.com/api-reference/user-interface/list)
- [How Raycast API Extensions Work](https://www.raycast.com/blog/how-raycast-api-extensions-work)

### SuperCmd

可借鉴：

- 安装时 build。
- 运行时读取预构建 bundle。
- 业务依赖 bundle，host API / React external。

不直接复制：

- renderer `new Function(...)` 执行 extension bundle。
- renderer fake require 作为长期 extension host。

本地参考：

- `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts`
- `/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/ExtensionView.tsx`

### VS Code

可借鉴：

- extension host 与 UI host 分离。
- contribution points 是静态可索引契约。
- runtime 可以按环境切换，但 API contract 稳定。

参考：

- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [VS Code Activation Events](https://code.visualstudio.com/api/references/activation-events)
- [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points)

### Electron utilityProcess

Openwork 当前选择 `utilityProcess` 合理。V1 应补 installed module loader，不应退回 renderer execution。

参考：

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

## 17. 可复用代码草案

本节不是最终实现，但接口和文件边界可以直接作为 Phase 1 / Phase 2 的起点。

### 17.1 建议文件边界

```txt
src/main/extensions/registry/
  types.ts
  built-in-provider.ts
  installed-provider.ts
  service.ts
  descriptor-schema.ts

src/shared/extension-runtime-protocol.ts
  ExtensionRuntimePackageRef

src/shared/installed-extensions.ts
  shared settings/install-state view types only

src/extension-runtime/runtime-package-loader.ts
  resolves ExtensionRuntimePackageRef inside utilityProcess

tests/node/extension-registry-service.test.ts
tests/node/installed-extension-provider.test.ts
tests/node/extension-runtime-package-loader.test.ts
```

边界说明：

- `src/main/extensions/registry/*` 属于 main process。它可以读取文件系统、动态 import main module、解析安装目录。
- `ExtensionRuntimePackageRef` 放在 `src/shared/extension-runtime-protocol.ts`，因为 main process 和 utilityProcess 都要理解 runtime start message。
- `src/shared/installed-extensions.ts` 只放 renderer / preload 需要展示的数据结构，不放文件系统路径和 module path。
- `src/extension-runtime/runtime-package-loader.ts` 属于 utilityProcess runtime。它只负责把 host 传入的 runtime package ref 变成 `NativeExtensionRuntimePackage`。
- renderer 只通过现有 IPC / runtime surface 消费结果，不读取安装目录，不 import installed module。

### 17.2 `types.ts`

```ts
import type {
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import type { NativeExtensionRuntimePackageMetadata } from "@openwork/extension-api"
import type { ExtensionRuntimePackageRef } from "@shared/extension-runtime-protocol"

export type ExtensionPackageSource = "built-in" | "installed"

export type ExtensionPackageErrorCode =
  | "api_version_unsupported"
  | "asset_path_invalid"
  | "descriptor_invalid"
  | "descriptor_missing"
  | "main_invalid"
  | "main_missing"
  | "manifest_invalid"
  | "platform_unsupported"
  | "runtime_invalid"
  | "runtime_metadata_invalid"
  | "runtime_metadata_missing"
  | "runtime_missing"

export interface ExtensionPackageError {
  code: ExtensionPackageErrorCode
  message: string
}

export type ExtensionMainPackageRef =
  | {
      definition: NativeExtensionMainDefinition
      extensionName: string
      kind: "in-memory"
      version: string
    }
  | {
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }

export interface ExtensionPackageDescriptor {
  assetsDir: string
  enabled: boolean
  errors: ExtensionPackageError[]
  id: string
  main: ExtensionMainPackageRef | null
  manifest: NativeExtensionPackageManifest
  rootDir: string
  runtime: ExtensionRuntimePackageRef | null
  runtimeMetadata: NativeExtensionRuntimePackageMetadata | null
  source: ExtensionPackageSource
  version: string
}

export interface ExtensionProvider {
  listPackages(): Promise<ExtensionPackageDescriptor[]> | ExtensionPackageDescriptor[]
}

export interface ExtensionRegistryService {
  getMainPackageRef(extensionName: string): ExtensionMainPackageRef | null
  getPackage(extensionName: string): ExtensionPackageDescriptor | null
  getRuntimePackageRef(extensionName: string): ExtensionRuntimePackageRef | null
  listEnabledPackages(platform: string): ExtensionPackageDescriptor[]
  listManifests(platform: string): NativeExtensionPackageManifest[]
  listPackages(): ExtensionPackageDescriptor[]
  resolveAsset(extensionName: string, assetPath: string): string
}
```

`ExtensionRuntimePackageRef` 应放进 `src/shared/extension-runtime-protocol.ts`：

```ts
export type ExtensionRuntimePackageRef =
  | {
      extensionName: string
      kind: "built-in"
      version: string
    }
  | {
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }
```

### 17.3 `built-in-provider.ts`

```ts
import { join } from "node:path"
import { app } from "electron"
import type {
  NativeExtensionMainDefinition,
  NativeExtensionPackageManifest
} from "@shared/native-extensions"
import type {
  NativeExtensionRuntimePackage,
  NativeExtensionRuntimePackageMetadata
} from "@openwork/extension-api"
import type { ExtensionPackageDescriptor, ExtensionProvider } from "./types"

export interface BuiltInExtensionProviderInput {
  mainDefinitions: Map<string, NativeExtensionMainDefinition>
  manifests: NativeExtensionPackageManifest[]
  runtimeMetadataPackages: NativeExtensionRuntimePackageMetadata[]
  runtimePackages: NativeExtensionRuntimePackage[]
}

export class BuiltInExtensionProvider implements ExtensionProvider {
  constructor(private readonly input: BuiltInExtensionProviderInput) {}

  listPackages(): ExtensionPackageDescriptor[] {
    const runtimeExtensionNames = new Set(
      this.input.runtimePackages.map((runtimePackage) => runtimePackage.extensionName)
    )
    const runtimeMetadataByExtensionName = new Map(
      this.input.runtimeMetadataPackages.map((runtimeMetadata) => [
        runtimeMetadata.extensionName,
        runtimeMetadata
      ])
    )
    const assetsRoot = join(app.getAppPath(), "extensions")

    return this.input.manifests.map((manifest) => {
      const version = "built-in"
      return {
        assetsDir: join(assetsRoot, manifest.name, "assets"),
        enabled: true,
        errors: [],
        id: manifest.name,
        main: {
          definition: this.input.mainDefinitions.get(manifest.name) ?? {},
          extensionName: manifest.name,
          kind: "in-memory",
          version
        },
        manifest,
        rootDir: join(assetsRoot, manifest.name),
        runtime: runtimeExtensionNames.has(manifest.name)
          ? {
              extensionName: manifest.name,
              kind: "built-in",
              version
            }
          : null,
        runtimeMetadata: runtimeMetadataByExtensionName.get(manifest.name) ?? null,
        source: "built-in",
        version
      }
    })
  }
}
```

### 17.4 `service.ts`

```ts
import { isAbsolute, relative, resolve } from "node:path"
import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import type {
  ExtensionPackageDescriptor,
  ExtensionProvider,
  ExtensionRegistryService
} from "./types"

export async function createExtensionRegistryService(
  providers: ExtensionProvider[],
  platform = process.platform
): Promise<ExtensionRegistryService> {
  const packages = (await Promise.all(providers.map((provider) => provider.listPackages()))).flat()
  return new StaticExtensionRegistryService(packages, platform)
}

class StaticExtensionRegistryService implements ExtensionRegistryService {
  private readonly packagesById: Map<string, ExtensionPackageDescriptor>

  constructor(
    private readonly packages: ExtensionPackageDescriptor[],
    private readonly platform: string
  ) {
    const pairs = packages.map(
      (extensionPackage) => [extensionPackage.id, extensionPackage] as const
    )
    this.packagesById = new Map(pairs)
    if (this.packagesById.size !== pairs.length) {
      throw new Error("Extension registry declares duplicate extension ids.")
    }
  }

  listPackages(): ExtensionPackageDescriptor[] {
    return [...this.packages]
  }

  listEnabledPackages(platform = this.platform): ExtensionPackageDescriptor[] {
    return this.packages.filter(
      (extensionPackage) =>
        extensionPackage.enabled &&
        extensionPackage.errors.length === 0 &&
        supportsNativeExtensionPlatform(extensionPackage.manifest, platform)
    )
  }

  listManifests(platform = this.platform) {
    return this.listEnabledPackages(platform).map((extensionPackage) => extensionPackage.manifest)
  }

  getPackage(extensionName: string): ExtensionPackageDescriptor | null {
    return this.packagesById.get(extensionName) ?? null
  }

  getRuntimePackageRef(extensionName: string) {
    return this.getPackage(extensionName)?.runtime ?? null
  }

  getMainPackageRef(extensionName: string) {
    return this.getPackage(extensionName)?.main ?? null
  }

  resolveAsset(extensionName: string, assetPath: string): string {
    const extensionPackage = this.getPackage(extensionName)
    if (!extensionPackage) {
      throw new Error(`Unknown extension "${extensionName}".`)
    }
    const absolutePath = resolve(extensionPackage.assetsDir, assetPath)
    const assetsRoot = resolve(extensionPackage.assetsDir)
    const relativePath = relative(assetsRoot, absolutePath)
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Extension "${extensionName}" asset path escapes its assets directory.`)
    }
    return absolutePath
  }
}
```

### 17.5 `descriptor-schema.ts`

```ts
import { z } from "zod"

export const installedExtensionDescriptorSchema = z.object({
  apiVersion: z.string().min(1),
  assets: z.string().min(1),
  id: z.string().min(1),
  main: z.string().min(1).nullable().optional(),
  manifest: z.string().min(1),
  platforms: z.array(z.enum(["darwin", "linux", "win32"])).optional(),
  runtime: z.string().min(1).nullable().optional(),
  runtimeMetadata: z.string().min(1).nullable().optional(),
  schemaVersion: z.literal(1),
  version: z.string().min(1)
})

export type InstalledExtensionDescriptorFile = z.infer<typeof installedExtensionDescriptorSchema>
```

### 17.6 `runtime-package-loader.ts`

```ts
import { getNativeExtensionRuntimeCommand } from "@extensions/runtime"
import type {
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimePackage
} from "@openwork/extension-api"
import type { ExtensionRuntimeLaunchContext } from "@shared/extension-runtime-protocol"
import type { ExtensionRuntimePackageRef } from "@shared/extension-runtime-protocol"

export async function loadRuntimeCommand(input: {
  context: ExtensionRuntimeLaunchContext
  runtimeRef: ExtensionRuntimePackageRef
}): Promise<NativeExtensionRuntimeCommandDefinition> {
  const command =
    input.runtimeRef.kind === "built-in"
      ? getNativeExtensionRuntimeCommand(input.context)
      : toRuntimeCommandDefinition({
          context: input.context,
          runtimePackage: await importInstalledRuntimePackage(input.runtimeRef)
        })

  if (!command) {
    throw new Error(
      `Extension runtime command "${input.context.extensionName}:${input.context.commandName}" is not registered.`
    )
  }

  if (command.mode !== input.context.mode) {
    throw new Error(
      `Extension runtime command "${input.context.extensionName}:${input.context.commandName}" is registered for "${command.mode}" but launched as "${input.context.mode}".`
    )
  }

  return command
}

async function importInstalledRuntimePackage(
  runtimeRef: Extract<ExtensionRuntimePackageRef, { kind: "module" }>
): Promise<NativeExtensionRuntimePackage> {
  const imported = (await import(runtimeRef.modulePath)) as {
    default?: NativeExtensionRuntimePackage
    runtimePackage?: NativeExtensionRuntimePackage
  }
  const runtimePackage = imported.runtimePackage ?? imported.default
  if (!runtimePackage) {
    throw new Error(
      `Extension runtime module "${runtimeRef.modulePath}" has no runtime package export.`
    )
  }
  if (runtimePackage.extensionName !== runtimeRef.extensionName) {
    throw new Error(
      `Extension runtime module "${runtimeRef.modulePath}" exports "${runtimePackage.extensionName}", expected "${runtimeRef.extensionName}".`
    )
  }
  return runtimePackage
}

function toRuntimeCommandDefinition(input: {
  context: ExtensionRuntimeLaunchContext
  runtimePackage: NativeExtensionRuntimePackage
}): NativeExtensionRuntimeCommandDefinition | null {
  const command = input.runtimePackage.commands[input.context.commandName]
  if (!command) {
    return null
  }
  return {
    ...command,
    commandName: input.context.commandName,
    extensionName: input.runtimePackage.extensionName
  }
}
```

`src/extension-runtime/entry.ts` 后续只需要把当前：

```ts
const command = getNativeExtensionRuntimeCommand(context)
```

替换为：

```ts
const command = await loadRuntimeCommand({
  context,
  runtimeRef: startRequest.runtime
})
```

这保持了当前 command 执行和 snapshot 渲染逻辑，不引入第二套 renderer。

### 17.7 测试草案

```ts
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { InstalledExtensionProvider } from "../src/main/extensions/registry/installed-provider"
import { createExtensionRegistryService } from "../src/main/extensions/registry/service"

describe("InstalledExtensionProvider", () => {
  it("loads a valid installed extension descriptor", async () => {
    const rootDir = await createTempOpenworkHome()
    const packageDir = join(rootDir, "extensions", "sample", "1.0.0")
    await mkdir(join(packageDir, "dist"), { recursive: true })
    await mkdir(join(packageDir, "assets"), { recursive: true })
    await writeFile(
      join(packageDir, "openwork.extension.json"),
      JSON.stringify({
        apiVersion: "^1.0.0",
        assets: "./assets",
        id: "sample",
        main: "./dist/main.mjs",
        manifest: "./manifest.json",
        runtime: "./dist/runtime.mjs",
        runtimeMetadata: "./runtime-metadata.json",
        schemaVersion: 1,
        version: "1.0.0"
      })
    )
    await writeFile(
      join(packageDir, "manifest.json"),
      JSON.stringify({
        capabilities: ["runtime"],
        commands: [{ mode: "view", name: "open", title: "Open" }],
        name: "sample",
        title: "Sample"
      })
    )
    await writeFile(
      join(packageDir, "runtime-metadata.json"),
      JSON.stringify({
        commands: [{ name: "open", title: "Open" }],
        extensionName: "sample"
      })
    )
    await writeFile(
      join(packageDir, "dist", "runtime.mjs"),
      "export default { extensionName: 'sample', commands: {} }"
    )
    await writeFile(join(packageDir, "dist", "main.mjs"), "export default {}")

    const registry = await createExtensionRegistryService([
      new InstalledExtensionProvider(join(rootDir, "extensions"))
    ])

    expect(registry.getPackage("sample")?.errors).toEqual([])
    expect(registry.getRuntimePackageRef("sample")).toMatchObject({
      extensionName: "sample",
      kind: "module"
    })
  })
})
```

## 18. 当前验证记录

验证时间：2026-06-11。

工作树：

```bash
git rev-parse HEAD
# 39557d80ffc29db0b968308a7ce2740cc5f7e89d

git rev-list --left-right --count refs/remotes/origin/v3.0.0...HEAD
# 0 0
```

已通过：

```bash
npm run doctor
```

结果：

```txt
architecture doctor
route language doctor
watched files with legacy route language: 0
total matches: 0
secrets boundary doctor
doctor finished
```

当前实现已通过：

```bash
npm run build:installed-extensions
npm run test:node:target -- tests/node/extension-registry-service.test.ts tests/node/extension-runtime-registry.test.ts tests/node/extension-runtime-manager.test.ts tests/node/apple-reminders-source-tools.test.ts tests/node/native-extension-shell-packages.test.ts tests/node/apple-reminders-runtime-quick-add.test.ts tests/node/apple-reminders-runtime-accessories.test.ts
npm run check:extensions
npm run check:guardrails
npm run typecheck:node -- --pretty false
git diff --check
```

当前第一波实现验证结果：

```txt
openwork-extension build apple-reminders passed.
related node tests passed (78 tests).
Native extension validation passed (3 built-in extensions).
guardrails check passed.
typecheck:node passed.
git diff --check passed.
```

当前代码已经覆盖 main/runtime/settings/agent/menu-bar、renderer launcher command owner、source mention 的 installed package 消费路径，不代表 V1 全部完成。剩余最大缺口是 installed package 的函数型 launcher search resolver：Notion 这类 `buildIntentItems` / `resolveCommand` 仍不能通过 JSON catalog projection 进入 renderer 搜索入口。下一波需要先定 renderer-safe resolver ABI，而不是在 renderer 动态 import installed package。

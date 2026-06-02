# Extension 外部安装与外部打包方案调研

日期：2026-06-02

## 结论

Openwork 不应该把普通 extension 默认打成 `pkg` / Node SEA 这类独立可执行文件。

更合适的主线是：

```txt
extension source package
  -> build-time bundle
  -> installable Openwork extension artifact
  -> host registry validates and loads it
  -> runtime/main worker executes code through host capability protocol
  -> renderer only receives manifest, metadata and surface snapshot
```

推荐第一版产物格式是 `.owext` 或 `.tgz`，里面放预构建后的 JS module、静态 metadata 和 assets；安装时解压到 `OPENWORK_HOME/extensions/<extension>/<version>/`，由 main 侧 registry 做校验、索引和装载。

`pkg` 可以留作极少数“extension 自带独立 CLI/daemon adapter”的特殊逃生口，不作为 Openwork extension package 的默认形态。

## 当前架构事实

当前 bundled extension 已经按未来外部包的语义迈出关键一步：extension 的物理 home 是 `extensions/<name>`，并暴露五类 package surface：

```txt
extensions/<name>/
  manifest.ts
  runtime.ts
  runtime-metadata.ts
  main.ts
  assets/
```

但宿主发现和装载仍是编译期静态聚合：

- `src/extensions/index.ts` 静态 import bundled manifests。
- `src/extensions/main.ts` 静态 import main definitions。
- `src/extensions/runtime-packages.ts` 静态 import runtime packages。
- `src/extensions/runtime-metadata-packages.ts` 静态 import runtime metadata。

runtime 进程也仍然通过静态 registry 找 command：

```txt
src/main/services/extension-runtime/utility-process-launcher.ts
  -> utilityProcess.fork(extension-runtime-entry.js)
src/extension-runtime/entry.ts
  -> getNativeExtensionRuntimeCommand(context)
src/extensions/runtime.ts
  -> nativeExtensionRuntimePackages static map
```

这说明当前不是“缺 package contract”，而是还缺“外部 installed registry + external module loader”。

## 边界定义

### Host 拥有什么

Openwork host 拥有：

- extension 安装目录、启用状态、版本、integrity、签名和来源。
- manifest 校验、platform 过滤、capability 校验。
- preference、secret、connection resolver。
- extension asset protocol。
- runtime/main worker 生命周期。
- renderer 可见的 manifest 和 metadata cache。

### Extension 拥有什么

Extension package 拥有：

- `manifest`：identity、commands、AI capability、connection、preferences、capabilities。
- `runtime entry`：launcher command 的 React component 或 no-view runner；`view`、`menu-bar`、`no-view` 都必须有显式 runtime command entry。
- `main entry`：AI tools / RPC service / main-side helper。
- `runtime metadata`：搜索增强等 renderer 可读静态信息。
- `assets`：package-relative 静态资源。

### Renderer 不拥有什么

Renderer 不应该 import 或执行外部 extension code。它只消费：

- manifest 派生出的 launcher owner。
- runtime metadata 静态数据。
- runtime process 发回的 serialized surface snapshot。
- 用户事件转发。

这条边界非常重要。外部安装后，renderer 执行第三方 JS 会把安全、崩溃、依赖和 UI 一致性都搅在一起。

## `pkg` 判断

`pkg` 的问题不是“完全不能用”，而是和 Openwork extension 的目标模型不匹配。

官方 `vercel/pkg` 仓库已经 archived，并说明 `pkg` 已 deprecated，最后版本是 `5.8.1`。Node SEA 是 Node 官方继续推进的单可执行应用方向，但它服务的是“把一个 Node 应用发成 executable”，不是“让桌面 host 按插件协议装载多个 extension package”。

用 `pkg` 做默认 extension 形态会带来这些结构性问题：

- 每个 extension 都携带一份 Node runtime，体积和更新成本高。
- 产物是平台相关 executable，macOS signing/notarization、Windows AV、Linux glibc/arch 都会进入 extension 发布链路。
- Openwork 现在需要的是 `manifest/main/runtime/metadata/assets` 多入口包，`pkg` 会把它压成单入口进程。
- runtime React command 需要被 runtime host 渲染成 snapshot；独立 executable 只能走额外 RPC，再造一层协议。
- AI tools / command / menu-bar / metadata 共享同一个 extension identity 会变复杂。
- 动态 import、assets、native addon、源码映射、依赖 external 规则都会比 JS artifact 更难排错。

所以 `pkg` 适合的场景是：

```txt
extension wants to wrap an existing standalone CLI
  -> ship CLI as helper binary
  -> main/tool worker invokes it through explicit adapter
```

它不适合作为每个 Openwork extension 的默认打包方式。

## 推荐产物格式

第一版建议用 `.owext` 作为产品后缀，底层可以先是标准 `.tgz`。

```txt
notion-1.0.0.owext
  package.json
  openwork.extension.json
  manifest.json
  runtime-metadata.json
  dist/
    runtime.mjs
    main.mjs
  assets/
    icon.png
  integrity.json
```

### `openwork.extension.json`

```json
{
  "schemaVersion": 1,
  "id": "notion",
  "version": "1.0.0",
  "apiVersion": "^1.0.0",
  "manifest": "./manifest.json",
  "runtime": "./dist/runtime.mjs",
  "main": "./dist/main.mjs",
  "runtimeMetadata": "./runtime-metadata.json",
  "assets": "./assets",
  "platforms": ["darwin", "linux", "win32"]
}
```

### 依赖规则

默认规则：

- 业务依赖 bundle 进 `dist/runtime.mjs` 或 `dist/main.mjs`。
- `@openwork/extension-api` 作为 host-provided peer dependency。
- React runtime 由 host/runtime entry 提供，不让每个 extension 自带一份 React。
- Node builtins、native addon、postinstall 脚本、动态 require 进入审核/限制列表。
- renderer metadata 必须是可序列化数据，不能带 callback 或 import UI component。

这和当前 `extensions/<name>` package contract 是同一套语义，只是把 TypeScript source entry 换成 install artifact entry。

## Host 装载架构

### 1. Installed Extension Store

新增 main-side store，记录安装态：

```ts
interface InstalledExtensionRecord {
  id: string
  version: string
  rootDir: string
  source: "bundled" | "local" | "marketplace"
  enabled: boolean
  integrity: string
  installedAt: string
}
```

这里是产品状态，不是 renderer 状态。设置页和 launcher 都应该通过 IPC 查询 main 的 registry snapshot。

### 2. Extension Package Resolver

Resolver 负责把一个 installed root 转成 normalized package：

```txt
rootDir
  -> read openwork.extension.json
  -> validate manifest.json
  -> validate runtime-metadata.json
  -> validate assets are package-relative
  -> validate apiVersion/platform/signature/integrity
  -> return InstalledExtensionPackage
```

这个 resolver 同时服务 bundled extension 和外部 extension。bundled 可以有 adapter，把当前静态 import 包装成同样的 package descriptor。

### 3. Extension Registry Service

替代当前四个静态 registry 的主通路：

```txt
BundledExtensionProvider
InstalledExtensionProvider
  -> ExtensionRegistryService
    -> listManifests(platform)
    -> getRuntimeMetadata(extensionName)
    -> getRuntimeModule(extensionName)
    -> getMainModule(extensionName)
    -> resolveAsset(extensionName, assetPath)
```

短期为了不大拆，可以先保留静态 registry 作为 `BundledExtensionProvider`，再并入新 service。

### 4. Runtime Loader

当前 runtime process 启动后只能从 `@extensions/runtime` 找 command。外部安装后要改成：

```txt
main starts runtime session
  -> context includes extension package id/version
  -> runtime process asks host or receives runtimeModulePath
  -> runtime process dynamic imports file://.../dist/runtime.mjs
  -> lookup command in imported runtime package
  -> render/run as today
```

关键点：runtime code 仍在 `utilityProcess` 中跑，renderer 仍只吃 snapshot。

### 5. Main Tools Loader

AI tools / RPC service 不应该直接 dynamic import 到 Electron main process。

更稳的目标是：

```txt
Agent tool call
  -> ExtensionToolExecutor
  -> ExtensionMainWorker / utility process
  -> import dist/main.mjs
  -> execute tool with resolved connection/preferences
  -> return structured result
```

第一版如果只支持 trusted bundled/local extension，可以临时 main 侧 import，但 contract 要写清楚这是过渡，不是第三方安装的最终边界。

### 6. Asset Protocol

当前已有 `openwork-extension-asset://<extension>/<assetPath>`。外部安装后，这层应该改为 main-owned resolver：

```txt
openwork-extension-asset://notion/assets/icon.png
  -> ExtensionRegistryService.resolveAsset("notion", "assets/icon.png")
  -> verify path stays under package assets root
  -> return file
```

这样 bundled 和 installed assets 对 renderer 是同一个协议。

## 方案对比

| 方案 | 结论 | 原因 |
|---|---|---|
| `.owext` / `.tgz` + bundled JS modules | 推荐主线 | 最贴合当前 package contract，安装/校验/回滚简单，跨平台成本低 |
| npm package 直接安装到 extensions dir | 可做 dev 模式 | 对开发友好，但生产需要 lockfile、postinstall、依赖供应链控制 |
| ASAR | 可作为后期 archive 格式 | Electron 对 ASAR 支持好，但 archive read-only、cwd/native module/exec 有 caveat；MVP 先解压更容易验证 |
| Node SEA | 不推荐默认用 | 适合单 Node 应用 executable，不适合多入口 extension package |
| `pkg` | 不推荐默认用 | 已 deprecated，且 executable 形态和 Openwork extension host model 不匹配 |

## 分阶段落地

### Phase 1：把“静态 package contract”补成“可安装 artifact contract”

目标：

- 定义 `openwork.extension.json` schema。
- 让 build script 从 `extensions/apple-reminders`、`extensions/github` 产出 `.owext`。
- 产物包含 `manifest.json`、`runtime-metadata.json`、`dist/runtime.mjs`、`dist/main.mjs`、`assets/`。
- 更新 `check:extensions` 或新增 `check:extension-artifacts` 校验产物；迁移生成物在进入 installable artifact 前，先用 `check:extension-migration` 锁住 `migrated-source` / `shell` 与 `view` / `menu-bar` / `no-view` 的 package contract。

验收：

```bash
npm run check:extensions
npm run check:extension-migration
pnpm exec tsx --tsconfig tsconfig.node.json --test tests/node/native-extension-shell-packages.test.ts
```

### Phase 2：main 侧 registry service

目标：

- 新增 `ExtensionRegistryService`。
- 先把现有 bundled registry 接进去，行为不变。
- 再支持读取 `OPENWORK_HOME/extensions/**/openwork.extension.json`。
- renderer 通过 IPC 获取 manifest/metadata snapshot，不再直接依赖完整静态 registry 作为未来主路。

验收：

```bash
pnpm exec tsx --tsconfig tsconfig.node.json --test tests/node/extension-runtime-registry.test.ts
npm run check:guardrails
```

### Phase 3：runtime external module loader

目标：

- runtime launch context 增加 package descriptor 或 runtime module path。
- `src/extension-runtime/entry.ts` 支持按 package import `dist/runtime.mjs`。
- 用 temp installed directory 安装 Apple Reminders / GitHub artifact，证明 command 可以从外部 root 启动。

验收：

```bash
pnpm exec tsx --tsconfig tsconfig.node.json --test tests/node/native-extension-shell-packages.test.ts
pnpm exec tsc --noEmit -p tsconfig.node.json --composite false
pnpm exec tsc --noEmit -p tsconfig.web.json --composite false
```

### Phase 4：main tools worker

目标：

- AI tools / RPC service 从 main process import 迁到 main worker。
- worker 使用同一个 connection resolver 输出的 execution context。
- `@mention` preload 和 `loadExtension` 自动加载都走同一个 registry session。

验收：

```bash
pnpm exec tsx --tsconfig tsconfig.node.json --test tests/node/extension-source-tools.test.ts tests/node/apple-reminders-source-tools.test.ts
```

### Phase 5：签名、更新与 marketplace

目标：

- artifact integrity。
- extension id/version/source/channel。
- enable/disable。
- uninstall。
- 更新回滚。
- marketplace 下载和本地开发安装分流。

这一步不要提前做进 Phase 1，否则会拖慢真实 runtime 验证。

## 风险

### 最大风险：把外部包代码直接放进 main

这会让 extension 崩溃、任意 Node 能力、依赖污染和主进程稳定性绑在一起。过渡期可以只对 trusted bundled/local package 这样做，但第三方安装必须走 worker 边界。

### 第二风险：renderer 动态 import extension

这会破坏当前最有价值的 runtime snapshot 架构。renderer 只应该显示 host-owned UI，不应该执行 extension UI callback。

### 第三风险：把安装和迁移脚本混成一个系统

迁移脚本负责把 Raycast/旧 package 变成 Openwork source package；安装系统负责装载已经构建好的 Openwork artifact。二者可以共用 schema 和校验器，但不应该互相依赖运行时实现。

## 最小落地切片

外部安装的第一步不做 marketplace，也不把普通 extension 打成 `pkg`。

最小有效动作是：

1. 给 `extensions/apple-reminders` 和 `extensions/github` 增加 artifact build proof。
2. 产出两个 `.owext` 到临时目录。
3. 写 node test 从 artifact root 读取 `openwork.extension.json`、manifest、runtime metadata，并 dynamic import runtime/main。
4. 再把 main/renderer 的静态 registry 抽成 `BundledExtensionProvider`，为 external provider 留入口。

这个顺序能验证真正关键的问题：当前 package contract 是否足够让 extension 离开 app bundle 后继续工作。

## 参考资料

- Vercel `pkg`：https://github.com/vercel/pkg
- Node.js Single Executable Applications：https://nodejs.org/api/single-executable-applications.html
- Electron `utilityProcess`：https://www.electronjs.org/docs/latest/api/utility-process
- Electron ASAR Archives：https://www.electronjs.org/docs/latest/tutorial/asar-archives
- esbuild external packages：https://esbuild.github.io/api/
- VS Code Extension Host：https://code.visualstudio.com/api/advanced-topics/extension-host

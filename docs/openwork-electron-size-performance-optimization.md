# Openwork Electron 体积与性能优化指南

这份文档把 Innei 最近在 LobeHub 做的 Electron 优化工作映射到 Openwork。它不是泛泛的 checklist，而是一份可以按阶段执行的工程指导。

## 研究方法

我把当前 Openwork 工作区和 GitHub 作为证据来源：

- 通过 GitHub commits API 拉取 LobeHub 中 `author=Innei` 的近期提交。
- 交叉核对 Innei 合并的 PR，重点看 `desktop`、`electron`、`vite`、包体积、路由加载、渲染性能相关改动。
- 阅读包装/runtime 相关 PR 的描述和文件级 diff，而不是只依赖博客文章。
- 在当前 Openwork 本地用 `du`、`find`、`npx asar list`、`rg` 测量构建产物和 partial package。

LobeHub 的 Innei 提交里包含很多产品和 UI 细节。这份指南只吸收会影响 Electron packaging 边界、Vite 构建图、route/chunk 加载、死代码消除、高频渲染成本的改动。

## 当前证据

当前工作区本地测量结果：

| 产物 | 大小 | 说明 |
|---|---:|---|
| `out/` | 24 MB | 只是 Electron/Vite build output |
| partial `dist/mac-arm64/Electron.app` | 930 MB | `npm run dist:mac` 在生成 DMG 前失败，但 app payload 已经复制完成 |
| `app.asar` | 449 MB | 包含大量 `node_modules` 内容 |
| `app.asar.unpacked` | 392 MB | 主要是 runtime externals 以及重复的 Electron/Prisma payload |
| `app.asar.unpacked/node_modules/electron` | 282 MB | Electron runtime 被重复打进 app 自己的依赖里 |
| `app.asar.unpacked/node_modules/prisma` | 68 MB | Prisma CLI/runtime package 被复制 |
| `app.asar.unpacked/node_modules/@prisma` | 40 MB | Prisma engines/client 相关内容 |

这次 mac package 没有成功产出 DMG。Electron Builder 失败在重命名可执行文件：

```text
dist/mac-arm64/Electron.app/Contents/MacOS/Electron
  -> dist/mac-arm64/Electron.app/Contents/MacOS/Openwork
ENOENT
```

所以下载包大小还未知。但 installed app 的体积已经足够说明主问题。

## LobeHub 做了什么

相关 Innei PR 可以串成一条优化路径：

| PR | 对我们的启发 |
|---|---|
| [#11397](https://github.com/lobehub/lobehub/pull/11397) | 审完 main-process runtime deps 和 native deps 后，在 Electron Builder 里排除 `node_modules`。PR 描述里记录了约 `~100m app size` 的收益。 |
| [#11690](https://github.com/lobehub/lobehub/pull/11690) | Electron desktop export 场景下，把常用动态导入转成静态导入，减少本地路由切换时等待 chunk 的顿挫。 |
| [#14776](https://github.com/lobehub/lobehub/pull/14776) | 把 native deps 和 non-native runtime externals 拆开。两类依赖留在 bundle 外的原因不同，不能混成一个列表。 |
| [#15109](https://github.com/lobehub/lobehub/pull/15109) | 加 Vite route chunk prewarm：首屏只放很小的 `modulepreload`，其余 route chunks 延迟到 idle，广域 all-JS cache warmup 低并发执行，并用 emitted chunks 写测试。 |
| [#14470](https://github.com/lobehub/lobehub/pull/14470) | streaming 场景下，通过稳定 parse/projection 后的引用，以及让 tool 子树按 selector 自订阅，减少级联 re-render。 |
| [#14696](https://github.com/lobehub/lobehub/pull/14696) | 用 Vite boolean define `__DEV__` 替换 SPA 里的 `process.env.NODE_ENV` 判断，让生产构建能更稳定消除 dev-only code。 |
| [#14357](https://github.com/lobehub/lobehub/pull/14357) 和 [#14316](https://github.com/lobehub/lobehub/pull/14316) | desktop CI 和 pnpm workspace 布局的构建卫生。它们不是直接瘦身，但让 packaging 可复现，体积优化才有可信基线。 |

统一原则不是“多做 lazy load”，而是：先定义 build/runtime 边界，再证明每条边为什么必须存在。

## Openwork 诊断

### 1. 打包时复制了过多 runtime dependency state

当前 `electron-builder.yml` 包含：

```yaml
files:
  - out/**
  - package.json
  - resources/**
```

因为 `package.json` 声明了很多生产依赖，Electron Builder 会发现并打包 production `node_modules`。这就是为什么 `app.asar` 里有大量 package，`app.asar.unpacked` 里甚至有 Electron 自己。

最明显的异常：

```text
node_modules/electron         本地 271 MB
packaged duplicate electron   app.asar.unpacked 里 282 MB
```

Electron 应该由 Electron Builder 作为 app runtime 提供，不应该作为 app payload 里的运行时依赖再复制一份。

### 2. `electron` 同时在 dependencies 和 devDependencies

当前 `package.json` 同时把 `electron` 放在 `dependencies` 和 `devDependencies`。对 Electron Builder 来说这很危险：它会让 Electron 看起来像 app runtime dependency，从而造成重复 payload。

目标状态：

- `electron` 只留在 `devDependencies`。
- main/preload 里 import 的 `electron` 继续作为 runtime external。
- packaged output 里不能出现 `node_modules/electron`。

### 3. Prisma 同时是 runtime client 和 packaging hazard

Openwork 运行时真正使用 Prisma 的入口只有：

```text
src/main/db/client.ts -> PrismaClient from @prisma/client
```

其他 `@prisma/client` import 都是 type-only。但当前 packaged app 里包含了很宽的 Prisma 包：

```text
node_modules/@prisma/client   本地 73 MB
node_modules/.prisma          本地 21 MB
node_modules/@prisma/engines  本地 39 MB
node_modules/prisma           本地 68 MB
```

生产 app 需要 generated Prisma client 和 SQLite query engine。除非 packaged app 运行时确实会通过 `prisma` CLI 执行 migrations，否则不应该把 Prisma CLI/build machinery 打进去。当前应用启动路径是校验 schema；migration scripts 更像开发/运维命令。

### 4. main build externalization 太宽，而且边界不够显式

当前 `electron.vite.config.ts` externalize 了：

```ts
external: ["electron", "@prisma/client", "prisma"]
```

这意味着 `@prisma/client` 不会被 bundle，Electron Builder 只能去复制 runtime `node_modules`。这对 Prisma 可能是对的，但必须变成显式、最小的 runtime include。`prisma` 不应该是 runtime external，除非 packaged app 运行时调用 Prisma CLI。

### 5. renderer chunk 不是当前体积主因

renderer output 大约 21 MB。最大 chunk 是：

```text
out/renderer/assets/index-*.js  约 7.3 MB
```

确实有很多 Shiki/Mermaid language/diagram chunks，但它们不是 930 MB installed app 的主因。renderer 优化应该排在 packaging boundary 之后。

renderer 里显式 React lazy boundary 只有两个：

```text
src/renderer/src/ai-core/command.ts
src/renderer/src/extension-host/index.ts
```

所以 LobeHub 那套完整 route chunk prewarm plugin 对 Openwork 的优先级较低。我们更适合先做简单的静态导入判断或 targeted idle warmup。

## 目标状态

目标 packaging 模型：

```text
Electron runtime
  由 electron-builder 输出提供，不从 app node_modules 再复制一份。

out/**
  已 bundle 的 main/preload/renderer/native 输出。

resources/**
  icons、splash、extension assets。

node_modules/**
  默认排除。

runtime externals
  只有无法 bundle 的依赖才显式重新 include。

native/binary deps
  显式重新 include，并从 asar unpack。
```

目标性能模型：

```text
main/preload
  bundle pure JS deps，只 externalize Electron、native deps、singleton side-effect modules。

renderer
  首屏保持直接。
  高频本地 desktop surface 可以静态导入。
  只有 profiling 证明有导航顿挫时，才 idle-warm long-tail chunks。

streaming UI
  保持引用稳定，通过 entity id 自订阅，避免把大对象树层层 prop-drilling。
```

## 阶段 1：让 packaging 可测、可稳定复现

目标：先成功产出 unsigned app directory 和 DMG，再让体积数据可复现。

动作：

1. 先修 mac packaging failure，再把 DMG size 当指标。
2. 加一个 package-size audit script，打印：
   - `out`
   - `dist`
   - `.app`
   - `app.asar`
   - `app.asar.unpacked`
   - 最大 packaged files
   - packaged `node_modules` 顶层目录
3. 增加一个 CI 友好的 unsigned packaging 命令：

```bash
npm run build
npx electron-builder --dir --mac --publish never -c.mac.identity=null
```

验收：

- packaging 命令本地 exit 0。
- 体积报告能证明 `node_modules/electron` 是否存在。
- 每次 packaging boundary 改动后都跑这个报告。

## 阶段 2：移除 app 里的重复 Electron

目标：先去掉最大的确定异常，不改变应用行为。

动作：

1. 把 `electron` 从 `dependencies` 移出，只保留在 `devDependencies`。
2. 在 `electron.vite.config.ts` 里继续保持 `"electron"` external。
3. 根据阶段 3 的设计，在 Electron Builder 里加 `!node_modules/electron/**` 或更宽的 `!node_modules` 规则。
4. 重新 build/package，并检查 packaged output。

验收：

```bash
find dist -path '*/node_modules/electron/package.json' -print
```

对 packaged app 应该没有输出。

预期收益：

- 按当前本地大小，installed app 预计能先降 270-280 MB 左右。

风险：

- 低。Electron runtime 本来就由 Electron Builder 提供。

## 阶段 3：用显式 runtime includes 取代隐式 production `node_modules`

目标：停止让 Electron Builder 复制全部 production dependencies。

参考 LobeHub 的边界拆法，创建两个小配置模块：

```text
scripts or build config:
  native-runtime-deps.config.mjs
  external-runtime-deps.config.mjs
```

Openwork 可以从这张分类表开始：

| Package | 类别 | 初始决策 |
|---|---|---|
| `electron` | Electron 提供的 runtime | 只留 devDependency，永不打包进 app |
| `@prisma/client` | 带 generated code 的 runtime client | 先通过 smoke test 判断 external 还是 bundle；如果 external，只打最小 generated client |
| `.prisma/client/libquery_engine-darwin-arm64.dylib.node` | native/binary runtime | include 并 unpack |
| `prisma` | CLI/codegen/migration tool | 除非 app runtime 调用 CLI，否则不打包 |
| `electron-store` | pure JS runtime | 优先尝试 bundle |
| `deepagents`、`@langchain/*`、`langchain`、`just-bash` | pure JS 或 mostly JS runtime | 除非有明确 runtime failure，否则 bundle |
| `out/native` 里的 Swift helpers | app native binaries | 保留 `asarUnpack: out/native/**` |

不要硬编码宽泛 fallback copy。如果某个依赖不能 bundle，必须记录：

```text
package:
why external:
which files are required:
why asarUnpack is required or not:
runtime smoke test:
```

验收：

- `app.asar` 不再包含宽泛 `/node_modules` 树。
- `app.asar.unpacked/node_modules` 只包含有文档说明的 runtime externals/native deps。
- packaged app 能打开、初始化数据库、创建/加载 thread，并完成一个简单 agent flow 或等价 smoke。

预期收益：

- 如果 pure JS deps 被 bundle 而不是以 package 形式复制，`app.asar` 的 449 MB 大部分都应该消失。
- 如果确认 runtime 不需要 Prisma CLI，可以移除 `prisma` 包的 68 MB 级别 payload。

风险：

- 中等，主要在 Prisma。必须用 packaged app 验证数据库初始化，不能只跑 dev。

## 阶段 4：Prisma runtime 最小化

目标：生产包里只保留 Prisma 真正需要的内容。

需要用测试回答三个问题：

1. `@prisma/client` 能不能被 Vite bundle，同时保持 native query engine path 可解析？
2. 如果不能 bundle，最小 external include set 是什么？
3. packaged Openwork 是否真的会运行 `prisma migrate deploy` CLI，还是只校验现有 schema？

推荐方向：

- Prisma CLI 留在 dev/ops scripts，不进入 packaged app runtime。
- 只打 generated client 和 query engine。
- 如果生产需要 migrations，把它变成受控的应用逻辑，而不是隐式依赖整个 Prisma CLI package。

验证：

```bash
OPENWORK_HOME="$(mktemp -d)" ./dist/mac-arm64/Openwork.app/Contents/MacOS/Openwork
```

然后确认：

- SQLite database path 在 `OPENWORK_HOME` 下创建。
- Prisma client 能连接。
- schema validation/migration 行为是显式的，并有日志或可观察结果。

## 阶段 5：renderer 启动与导航体验

目标：包体积边界收干净之后，再改善 perceived speed。

当前 renderer 事实：

- `out/renderer` 约 21 MB。
- main entry chunk 约 7.3 MB。
- 显式 lazy routes 只有 launcher AI 和 extension runtime surface。

推荐顺序：

1. 对 `LauncherAiPage` 测 first open delay。如果明显，就在 Electron desktop 下改成 static import。
2. 对 `RuntimeExtensionCommandSurface`，如果 extension runtime 低频或较重，可以继续 lazy。
3. 只有 profiling 证明 first-use delay 存在时，才加很小的 idle warmup：

```ts
if ("requestIdleCallback" in window) {
  requestIdleCallback(() => {
    void import("@renderer/extension-runtime/RuntimeExtensionCommandSurface")
  })
}
```

4. 不要在 Openwork 还没有复杂文件路由/chunk 映射前，直接搬 LobeHub 的完整 route chunk preload plugin。

验收：

- 对比 launcher open 和第一次打开 AI command 的耗时。
- 确认 first screen 没有退化。
- 确认 renderer chunk graph 仍然可理解。

## 阶段 6：renderer dependency audit

目标：在不破坏 rich markdown/artifact 能力的前提下减少 renderer bundle weight。

观察到的本地依赖大小：

```text
node_modules/mermaid                  70 MB
node_modules/@phosphor-icons          57 MB
node_modules/react-syntax-highlighter 8.7 MB
node_modules/shiki                    3.8 MB
```

Openwork 已经约定通用 icon 库是 `lucide-react`，但 `@phosphor-icons/react` 仍在 `dependencies` 里。删除前必须审计，因为它可能仍被 import。

命令：

```bash
npm run audit:frontend-packages
rg -n "@phosphor-icons|react-syntax-highlighter|mermaid|shiki|streamdown" src package.json
npm run typecheck
```

规则：

- 不因为 rich rendering dependency 大，就直接删。
- 对 Markdown extras、diagrams、syntax grammars、PDF/media viewers，优先做 feature-level lazy imports。
- 避免把所有 languages/themes 拉进 first renderer chunk。

## 阶段 7：streaming UI 渲染性能

目标：长对话 streaming update 时保持响应性。

只有 profiling 证明存在级联 re-render 时，才套 LobeHub 模式：

1. 找到 raw messages/events 到 UI message tree 的 canonical projection step。
2. projection 后保留 unchanged subtree references。
3. 把昂贵的嵌套 surface 改成按 id selector 自订阅：
   - message id
   - block id
   - tool call id
   - artifact id
4. 如果 child 可以订阅自己的 entity，就不要从 parent 传完整 arrays/objects。
5. 为 reference stability 写 targeted tests。

Openwork 潜在目标：

- chat message projection
- tool call/result rendering
- artifact tab updates
- streaming 期间的 context usage updates

验收：

- React Profiler 显示 streaming 期间未变化的 messages/tools 跳过 re-render。
- 单元测试证明 projection 中未变化的 subtree 保持引用 identity。

## 不要做什么

- 不要加宽泛的 `asarUnpack: node_modules/**`。
- 不要为了“保险”复制所有 production dependencies。
- 不要把每个 packaging failure 都解释成“整个 package 必须 externalize”。
- 不要在修完 `node_modules` packaging 前先搬 route chunk prewarm。
- 不要用 runtime fallback 掩盖缺文件问题，应该把 package manifest 做正确。
- 不要在没有证明 packaged app 调用 Prisma CLI 前，把 `prisma` CLI 留在 runtime package。

## 建议里程碑

1. **Packaging report 和 DMG 成功**
   - 修当前 mac packaging failure。
   - 产出 baseline report。

2. **移除重复 Electron**
   - `electron` 改为 dev-only。
   - 确认 packaged app 没有 `node_modules/electron`。

3. **显式 runtime dependency config**
   - 默认排除 `node_modules`。
   - 只重新 include 有文档说明的 native/runtime external deps。

4. **Prisma 最小化**
   - 如果 runtime 不用 Prisma CLI，就从 packaged runtime 移除。
   - 保持 generated client/query engine 在 packaged app 中可用。

5. **Renderer targeted optimization**
   - 只对已证明高频的 lazy surface 做 static import 或 idle-warm。

6. **Streaming render audit**
   - profile 后，只稳定真实 hot path。

## 成功标准

这项工作完成时应该满足：

- DMG/install package 能成功构建。
- installed app size 和 DMG size 都已知。
- packaged output 中没有 `node_modules/electron`。
- packaged runtime dependencies 都按类别和原因记录清楚。
- packaged app 使用临时 `OPENWORK_HOME` 通过 smoke test。
- 如果做了 renderer 改动，有 before/after navigation 或 render evidence 支撑。

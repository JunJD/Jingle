# Installable Extension Dev Guide

本文说明如何在当前 Jingle 开发态调试一个安装型 extension。

## 当前边界

当前实现支持把一个 extension source package 构建成 installable artifact，再由 Jingle registry 在启动时发现。

已支持：

- extension 源码可以放在 Jingle repo 外部。
- CLI 可以从 extension 目录或显式路径构建 installable package。
- Jingle dev app 会扫描 `.jingle-build/installed-extensions`。
- Jingle user app 会扫描 `JINGLE_HOME/extensions`。
- trusted installed package 可以加载 runtime module 和 privileged main module。

未支持：

- `@jingle/extension-cli` 尚未作为外部 npm 包发布；当前命令仍从 Jingle repo 根目录执行。
- `extension dev` 不是 hot reload。它只 watch rebuild，Jingle registry 仍是进程启动时快照。
- 普通第三方 package 还没有完整 sandbox 安全模型。
- 函数型 search adapter 不能写进 installable metadata。

## Source Package 结构

一个最小 extension source package 需要这些文件：

```txt
my-extension/
  package.json
  manifest.ts
  runtime.ts
  runtime-metadata.ts
  main.ts
  assets/icon.svg
  src/HelloView.tsx
```

`package.json`：

```json
{
  "name": "@jingle/extension-my-extension",
  "version": "0.0.0",
  "type": "module",
  "main": "./main.ts",
  "types": "./manifest.ts",
  "jingle": {
    "distribution": "installable",
    "trust": "trusted"
  },
  "dependencies": {
    "@jingle/extension-api": "workspace:*",
    "react": "^19.2.1"
  }
}
```

package 必须通过 `@jingle/extension-api` 暴露四个入口：

- `manifest.ts`：extension manifest、commands、capabilities、preferences、AI capability。
- `runtime.ts`：command runtime package，声明 `view` / `menu-bar` / `no-view` 的执行入口。
- `runtime-metadata.ts`：renderer-safe JSON metadata，只能包含 aliases、keywords、placeholder、argument hints 等可序列化字段。
- `main.ts`：main-side tools 或 service。只有 trusted installed package 当前可以加载 privileged main module。

不要从外部 extension 直接 import Jingle app 私有路径，例如 `@shared/*`、`@extensions/*`、`src/main/*` 或 `src/renderer/*`。

`package.json.name` 是 npm package name，可以使用合法 scoped name，例如 `@jingle/extension-my-extension`；它不决定安装目录。安装身份来自 `manifest.ts` 的 `name`，必须是 flat lowercase id：以小写字母开头，只包含小写字母、数字和单个连字符，不能使用 npm scope、斜杠、反斜杠或嵌套路径。`package.json.version` 必须是 lowercase canonical SemVer。CLI、descriptor parser 和 installed registry 共同使用这套路径契约：`<installed-root>/<extension-id>/<version>/`。

同一个 extension id 安装多个健康版本时，registry 按 SemVer precedence 选择 owner；例如 `10.0.0` 高于 `2.0.0`，stable `1.0.0` 高于 `1.0.0-beta.1`。版本字符串的字典序不参与 owner 选择。

## 写一个最小 Command

`manifest.ts`：

```ts
import { defineLocalizedText as l, defineNativeExtensionManifest } from "@jingle/extension-api"

export const myExtensionManifest = defineNativeExtensionManifest({
  capabilities: ["surface"],
  commands: [
    {
      description: l("Open the hello view.", "打开 hello 视图。"),
      keywords: ["hello"],
      mode: "view",
      name: "hello",
      title: l("Hello", "你好")
    }
  ],
  icon: "assets/icon.svg",
  name: "my-extension",
  supportedPlatforms: ["darwin", "linux", "win32"],
  title: l("My Extension", "我的扩展")
})
```

`src/HelloView.tsx`：

```tsx
export default function HelloView() {
  return <div style={{ padding: 16 }}>Hello from installable extension.</div>
}
```

`runtime.ts`：

```ts
import { defineNativeExtensionRuntime } from "@jingle/extension-api"
import HelloView from "./src/HelloView"

export const myExtensionRuntime = defineNativeExtensionRuntime({
  commands: {
    hello: {
      Component: HelloView,
      mode: "view"
    }
  },
  extensionName: "my-extension"
})
```

## 调用宿主 AI

Runtime command 可以在 manifest 声明 `ai` capability 后通过公开 SDK 调用宿主模型：

```ts
import { AI } from "@jingle/extension-api"

const normal = await AI.ask("Summarize the current item")
const quick = await AI.ask({
  modelPreference: "fast",
  prompt: "Extract a short title",
  temperature: 0
})
```

字符串形式使用默认策略；对象形式必须显式提供 `modelPreference: "fast"`。`prompt` 上限为 200,000 字符，可选 `system` 上限为 40,000 字符，可选 `temperature` 范围为 `0..2`。模型 ID、provider 和推理强度由宿主拥有；`modelId` 不属于公开请求契约。旧 runtime 若仍发送 `modelId` 或缺失模型策略，宿主会返回 `extension_ai_request_invalid`，必须用当前 SDK 重新构建，不能静默改用默认模型。

`runtime-metadata.ts`：

```ts
import { defineNativeExtensionRuntimeMetadata } from "@jingle/extension-api"

export const myExtensionRuntimeMetadata = defineNativeExtensionRuntimeMetadata({
  commands: [
    {
      name: "hello",
      search: {
        aliases: ["hi"],
        keywords: ["hello", "example"],
        placeholder: "Open hello command"
      }
    }
  ],
  extensionName: "my-extension"
})
```

`main.ts`：

```ts
import { defineNativeExtensionMain } from "@jingle/extension-api"

export const myExtensionMain = defineNativeExtensionMain({})
```

## Dev 调试

从 Jingle repo 根目录执行：

```bash
make extension-dev EXTENSION=/absolute/path/to/my-extension
```

默认输出目录是：

```txt
.jingle-build/installed-extensions/<extension-id>/<version>/
  jingle.extension.json
  manifest.json
  runtime-metadata.json
  dist/runtime-<sha256>.mjs
  dist/main.mjs
  assets/
```

CLI 会对最终 runtime bundle 的精确字节计算 `sha256:<64 lowercase hex>`，把 digest 同时写入内容寻址文件名和 `jingle.extension.json.runtimeArtifactRevision`。宿主只有在 descriptor、文件名和实际字节三者一致时才接受该 revision。旧 descriptor 没有这个字段时仍可加载，但 runtime artifact revision 明确不可用，不能从 version、路径或 mtime 推断。

同一 package 目标的发布由跨进程锁和同级临时目录中的事务 journal 串行化。每次 build（包括 dev watch 的每次 rebuild）会先扫描严格符合 `<extension-id>/<version>` 契约的 journal。若 CLI 进程在旧目录移入 backup 后退出，下次发布会先恢复最后一个已发布目录；若新 staging 已经提升到最终目录，则保留新目录并清理旧 backup。扫描后 journal 被合法 publisher 删除时视为事务已经收敛；已成功读取但内容 malformed 的 journal 仍会 fail closed。没有观察到 journal 的 broken link、已消失 foreign entry 和非契约目录不会阻断其他 package 的恢复。journal 会绑定锁解析出的物理目标路径；无法严格解析或目标不一致时发布会停止，不会从路径 fallback，也不会猜测嵌套结构或其他版本的临时目录。

然后启动 Jingle dev app：

```bash
make dev
```

Jingle dev app 在 `ELECTRON_RENDERER_URL` 存在时会扫描 `.jingle-build/installed-extensions`。如果 extension 已经 rebuild，但 launcher、settings 或 runtime 没有变化，重启 Jingle dev app；当前 registry 不做 hot reload。

OAuth 连接当前使用 V1 credential contract：manifest 必须精确声明
`auth.secretNames: ["accessToken"]`。宿主完成 PKCE callback 后只写入这个连接级字段。
refresh token、撤销信息和多字段凭据尚未进入公开协议，不要把它们声明为 `secretNames`。

## 安装到用户目录调试

默认用户目录是 `~/.jingle`，也可以用 `JINGLE_HOME` 指向隔离目录。

隔离目录调试：

```bash
JINGLE_HOME=/tmp/jingle-extdev \
  pnpm exec jingle-extension build /absolute/path/to/my-extension \
  --out-dir /tmp/jingle-extdev/extensions \
  --trust trusted

JINGLE_HOME=/tmp/jingle-extdev make dev
```

真实用户目录安装：

```bash
pnpm exec jingle-extension build /absolute/path/to/my-extension \
  --out-dir ~/.jingle/extensions \
  --trust trusted
```

安装后需要重启 Jingle。宿主会读取：

```txt
JINGLE_HOME/extensions/<extension-id>/<version>/jingle.extension.json
```

## 调试 Checklist

如果 extension 没出现在 launcher 或 settings：

- 确认 `jingle.extension.json` 存在于 `<installed-root>/<extension-id>/<version>/`。
- 确认 descriptor id、manifest `name`、runtime metadata `extensionName` 一致。
- 确认 descriptor 的 `runtimeArtifactRevision` 与内容寻址 runtime 文件匹配；不要手工改写已发布 bundle。
- 确认 `manifest.ts` 的 command `mode` 和 `runtime.ts` 的 command entry mode 一致。
- 确认 `assets/` 目录存在，manifest icon 使用 package-relative path，例如 `assets/icon.svg`。
- 确认 `runtime-metadata.ts` 不包含 function、symbol、undefined、BigInt 或非有限 number。
- 如果用了 `main.ts` tools/service，确认 package 是 trusted；untrusted package 不会加载 privileged main module。
- 修改源码后确认 CLI rebuild 成功，再重启 Jingle dev app。

失败的 installed package 会作为 diagnostics 保留，但不会抢走健康的 built-in package owner。不要在 renderer 里读 installed package 文件、module path 或 filesystem；renderer 只消费 main/preload 投影出的 launcher catalog。

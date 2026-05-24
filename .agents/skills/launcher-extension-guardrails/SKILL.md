---
name: launcher-extension-guardrails
description: Guard launcher-shell, native extension host, extension sdk, and ai-core boundaries in Openwork. Use when touching src/extensions, src/renderer/src/launcher-shell, src/renderer/src/extension-host, src/renderer/src/ai-core, src/main/services/native-extensions, route language, preference/secrets flow, or architecture cleanup work. Run the architecture doctor before changes, then run guardrail checks and typecheck after changes.
user_invocable: true
version: "1.0.0"
---

# launcher-extension-guardrails

在 Openwork 里做 `launcher / native extension / extension sdk / ai-core` 相关工作时，先跑检查，再动实现。

## 什么时候用

- 改 `src/extensions/**`
- 改 `src/renderer/src/launcher-shell/**`
- 改 `src/renderer/src/extension-host/**`
- 改 `src/renderer/src/ai-core/**`
- 改 `src/main/services/native-extensions/**`
- 改 `src/main/preferences.ts`
- 改 command route、命名、settings schema、import 边界
- 做架构清理、目录重组、去 plugin 化

## 边界目标

- `launcher-shell` 是入口壳，不是 extension runtime
- `extension-sdk` 是作者 API，不直接暴露 launcher 私有实现
- `extensions/*` 只能通过 `src/extensions/api.ts` 和 `shared/*` 接宿主能力
- `AI` 是平台原生能力，不挂在 extension 下面

## 执行顺序

这些脚本都放在：

```bash
.agents/skills/launcher-extension-guardrails/scripts/
```

`package.json` 只暴露两个入口：`npm run doctor` 和 `npm run check:guardrails`。具体子检查留在本目录的脚本里，避免把内部 guardrail 细节摊到项目脚本表。

### 1. 先看现状

先跑：

```bash
npm run doctor
```

这会给你两类提醒：
- `doctor:route-language`
- `doctor:secrets-boundary`

它们默认是告警，不拦提交。

### 2. 改代码

改动期间重点守这几件事：

- 不新增 `import.meta.glob` 扩散发现逻辑
- 不让 `src/extensions/**` 直接 import `renderer/main/preload` 私有实现
- 不继续把 native extension 新代码接到旧 `LauncherPlugin*` 骨架上
- 不让 `password` preference 继续被当普通设置处理

### 3. 改完后跑阻断检查

```bash
npm run check:guardrails
npm run typecheck
```

## 各脚本职责

- `npm run doctor`
  运行架构诊断。当前包含 route language 和 secrets boundary 两类提示，默认告警不阻断。

- `npm run check:guardrails`
  运行所有阻断型 guardrail 检查。

- `check-architecture-imports.mjs`
  检查 import 边界，尤其是 `shared`、`extensions`、`src/extensions/api.ts`

- `check-extension-contract.mjs`
  检查每个 extension 是否满足最小结构：
  - `manifest.ts`
  - `index.ts`
  - command 文件存在
  - `view` command 有 `.meta.ts`
  - rpc/service 声明对齐

- `check-extension-registry.mjs`
  检查跨 extension 的唯一性和 registry 基本一致性：
  - extension id
  - extension title
  - default command

- `check-extension-runtime-registry.mjs`
  检查 manifest runtime command 与 package-level runtime entry 一致性：
  - manifest runtime command 必须由 `src/extensions/<extension>/runtime.ts` 导出
  - package runtime entry 不能导出 manifest 不存在或未声明 runtime 的 command
  - command mode 必须一致
  - `view` / `menu-bar` command 必须有 `Component`
  - `no-view` command 必须有 `run`

- `check-runtime-backed-renderer-imports.mjs`
  禁止 renderer import 已在 manifest 声明 `runtime` 的 extension command module

- `check-no-glob-sprawl.mjs`
  禁止新的 `import.meta.glob` 到处长

- `check-no-legacy-plugin-coupling.mjs`
  禁止 extension 新代码直接依赖旧 `LauncherPlugin*` / `built-plugins` 骨架

- `doctor-route-language.mjs`
  统计 `internal-plugin / pluginId / LauncherPlugin` 这类旧语言还剩多少

- `doctor-secrets-boundary.mjs`
  统计 `password` preferences，并提示当前是否仍像普通 settings 一样存储

## 输出方式

回答时优先给：

1. 哪条 guardrail 被触发
2. 这说明哪个边界还没收干净
3. 最小修法是什么

不要把 doctor 告警当成“先忽略也没事”的噪音。

# Launcher Extension Cleanups

这份文档只记录一类东西：

`为了让前几个 pause 平稳落地而保留的兼容层、桥接层、别名层。`

它们不是目标架构的一部分。

规则只有 3 条：

1. 只要新增了“为了先不报错”的桥接层，就必须登记到这里。
2. 每个条目都必须写清楚删除时机和删除后的验收方式。
3. 当前 launcher / native extension 主线全部完成后，这份文档应被清空并删除。

这份文档和 [launcher-extension-phase-checkpoints.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/launcher-extension-phase-checkpoints.md) 配套使用：

- `phase-checkpoints` 负责说明下一步做什么
- `cleanups.md` 负责约束哪些临时层最后必须删掉

## 当前状态

- `doctor:route-language` 当前还剩 `2 files / 8 matches`
- `doctor:secrets-boundary` 当前还剩 `github.accessToken`

这两个结果说明：

- route 语言上的 legacy plugin 还没有完全收干净
- password preference 还没有进入独立 secrets 边界

## 清理条目

### 1. `src/shared/launcher-plugin.ts`

- 类型：legacy contract
- 为什么还在：main / host 内部还在用旧 `LauncherPlugin*` 名字承接历史实现
- 当前作用：给旧 host、旧 capability 校验、部分 main service 提供兼容契约
- 不是终局的原因：native extension 主线的公开语言已经转向 `command owner / command`
- 删除时机：Phase 5 之后，shared contract 全部收口到新命名，旧 `LauncherPlugin*` 不再被 main / renderer 主路径引用
- 删除验收：
  - `rg -n "LauncherPlugin" src/shared src/main src/renderer/src/launcher` 只允许命中明确保留的历史文档，代码侧为 0
  - `npm run doctor:route-language` 结果为 `0 files / 0 matches`
  - `npm run check:guardrails && npm run typecheck` 通过

### 2. `src/shared/launcher-command-owner.ts`

- 类型：rename bridge
- 为什么还在：Phase 4 为了把 shell 主路径改成 `command owner` 语言，但不一次性重命名 shared contract
- 当前作用：把旧 `launcher-plugin` 契约别名成新语言，降低改动半径
- 不是终局的原因：它只是一个过渡文件，最终应该直接存在单一的新命名事实源
- 删除时机：`launcher-plugin.ts` 被彻底重命名或替换之后
- 删除验收：
  - `src/shared/launcher-command-owner.ts` 被删除
  - `src/shared/launcher-plugin.ts` 不再存在或不再暴露 legacy 名称
  - `pages/**`、`native-extensions/**`、`main/services/native-extensions/**` 继续通过类型检查

### 3. `src/renderer/src/launcher/LauncherPluginHost.ts`

- 类型：legacy host
- 为什么还在：built-in AI 和旧 launcher 内部宿主能力还没全部切到新 host 语言
- 当前作用：承接 clipboard / navigation / surface / threads / lifecycle 这些既有宿主能力
- 不是终局的原因：native extension 已经有独立 host 边界，这个文件不应该继续作为整条主线的核心宿主
- 删除时机：built-in command 和 AI 页都不再直接依赖 `useLauncherPlugin*`
- 删除验收：
  - [NativeExtensionHost.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/native-extensions/NativeExtensionHost.tsx) 不再引用 `LauncherPluginCapability`
  - [LauncherAiPage.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/pages/LauncherAiPage.tsx) 不再引用 `useLauncherPlugin*`
  - `doctor:route-language` 归零

### 4. `src/renderer/src/launcher/LauncherPluginHostContext.tsx`

- 类型：legacy context bridge
- 为什么还在：当前 launcher shell 仍通过旧 host context 给 built-in command 注入宿主能力
- 当前作用：把 legacy host value 挂到 React context
- 不是终局的原因：context 名称和边界都停留在 plugin-first 时代
- 删除时机：`LauncherPluginHost.ts` 被新 host/context 替换后
- 删除验收：
  - 旧 host provider 不再出现在 [LauncherApp.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/LauncherApp.tsx)
  - built-in command 仍能正常读取 navigation / surface / threads

### 5. `src/renderer/src/launcher/built-ins/host.ts`

- 类型：wrapper bridge
- 为什么还在：Phase 4 为了把 built-in 层从 `LauncherPlugin*` 语言里先隔离出来
- 当前作用：把 `useLauncherPlugin*` 包成 `useBuiltInLauncher*`
- 不是终局的原因：它只是旧 host 到新 built-in 语言的一层薄包装
- 删除时机：built-in host 直接接入新的宿主实现后
- 删除验收：
  - `built-ins/host.ts` 被删除
  - `built-plugins/sdk.ts` 不再通过 wrapper 间接读取 legacy host
  - `AI` 和其他 built-in command 行为不回退

### 6. `src/plugins/ai/manifest.ts` 中的 `aiBuiltInCommandManifest` 别名导出

- 类型：alias export
- 为什么还在：Phase 4 先把 built-in 主路径改成新语言，但不一次性重命名 AI manifest 事实源
- 当前作用：避免 built-in 层继续 import `aiLauncherPluginManifest`
- 不是终局的原因：manifest 事实源应该只有一个正式名字
- 删除时机：AI manifest 源变量彻底切到 built-in / command owner 语言后
- 删除验收：
  - 别名导出被删除
  - built-in AI 仍能注册和打开

### 7. `src/renderer/src/launcher/native-extensions/NativeExtensionHost.tsx` 中的 legacy plugin 语言

- 类型：host-internal compatibility residue
- 为什么还在：Phase 4 故意只清 shell 主路径，没有继续深入 host 内部
- 当前作用：host 内部仍借用旧 capability 类型和少量命名
- 不是终局的原因：host 自身最终也应完全使用 extension-host 语言
- 删除时机：Phase 5 或之后的 host 清理阶段
- 删除验收：
  - `rg -n "LauncherPlugin" src/renderer/src/launcher/native-extensions/NativeExtensionHost.tsx` 结果为 0
  - native extension command 全部继续可运行

### 8. `src/renderer/src/launcher/pages/LauncherAiPage.tsx` 中的 legacy plugin 语言

- 类型：built-in page residue
- 为什么还在：AI 仍是 built-in，页面实现还直接依赖旧 host hook
- 当前作用：读取 navigation / surface 等宿主能力
- 不是终局的原因：AI 是平台原生能力，不应该长期挂在 plugin-first 命名之下
- 删除时机：`useAI` 和 built-in host contract 明确之后
- 删除验收：
  - `rg -n "LauncherPlugin" src/renderer/src/launcher/pages/LauncherAiPage.tsx` 结果为 0
  - AI 页面打开、返回、输入焦点行为不回退

### 9. `src/renderer/src/launcher/built-plugins/*`

- 类型：temporary built-in zone
- 为什么还在：当前 built-in AI 还在这条目录下运行
- 当前作用：容纳平台内建 command
- 不是终局的原因：native extension 主线已经建立，这个目录不应该继续承接新能力
- 删除时机：AI built-in contract 独立稳定后，目录语义改名或迁出
- 删除验收：
  - 不再新增任何 native extension 到这个目录
  - built-in 能力仍可注册，但目录名不再带 `built-plugins`

### 10. `src/renderer/src/launcher/external-runtime/*`

- 类型：frozen compatibility zone
- 为什么还在：之前为跑 Raycast / SuperCmd case 迁入的兼容 runtime 仍在仓库里
- 当前作用：保留历史参考和兼容实验基础
- 不是终局的原因：当前主线只做 native extension，这条兼容层不应继续影响主架构
- 删除时机：如果短期不恢复外部 extension 主线，在 native extension 体系稳定后直接删除；如果恢复，则必须移出当前主线文档和依赖关系，单独立项
- 删除验收：
  - launcher / native extension / settings 主路径不再 import 这里的任何代码
  - 删除后 `npm run check:guardrails && npm run typecheck` 通过

## 使用规则

后续每个 pause 结束前，都要做这两件事：

1. 如果新增了桥接层，先在这里登记。
2. 如果删掉了桥接层，先从这里移除，再在 phase 文档里更新状态。

如果某个条目连续几个阶段都还在，但没人能清楚说明删除时机，说明它已经从“临时桥”变成了“架构债”，必须优先处理。

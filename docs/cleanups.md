# Launcher Extension Cleanups

这份文档只记录一类东西：

`为了让前几个 pause 平稳落地而保留的兼容层、桥接层、别名层。`

它们不是目标架构的一部分。

规则只有 4 条：

1. 只要新增了“为了先不报错”的桥接层，就必须登记到这里。
2. 每个条目都必须写清楚删除时机和删除后的验收方式。
3. 中途不为了“顺手更干净”提前删；先登记、先推进主线，最后统一清理。
4. 当前 launcher / native extension 主线全部完成后，这份文档应被清空并删除。

这份文档和 [launcher-extension-phase-checkpoints.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/launcher-extension-phase-checkpoints.md) 配套使用：

- `phase-checkpoints` 负责说明下一步做什么
- `cleanups.md` 负责约束哪些临时层最后必须删掉

## 清理策略

这里的条目默认都进入最后一个统一清理阶段，而不是在中间 phase 里边走边删。

原因很简单：

- 当前主线目标是把 native extension 架构收干净，不是让每一步都追求“立刻零临时层”
- 中途提前删除，容易把主线推进和兼容层拆除搅在一起，暂停点会变脏
- 最后一轮应该故意更激进：先删桥、先删别名、先删兼容层，报错了就顺着报错修

最终清理遵守 `delete-first` 原则：

1. 先删桥接层，而不是先补更多兜底。
2. 删完出现报错，不算“不能删”，而算“目标架构还没成立”。
3. 只要主路径因此暴露出缺陷，就继续修到目标边界成立为止。

`cleanups.md` 不是“以后有空再看”的备忘录，而是最后一个硬 phase 的删除清单。`

## 当前状态

- `doctor:route-language` 当前还剩 `2 files / 8 matches`
- `doctor:secrets-boundary` 当前仍识别到 `github.accessToken` 这个 password preference，但已经确认：
  - `preferences.ts uses safeStorage: yes`
  - `preferences.ts hints at dedicated secret helpers: yes`

这两个结果说明：

- route 语言上的 legacy plugin 还没有完全收干净
- secrets 边界已经立起来了，但 Phase 5 还留着最小迁移逻辑和共模块实现，后续要继续清

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

### 11. `src/main/preferences.ts` 里的 secrets 迁移逻辑

- 类型：migration residue
- 为什么还在：Phase 5 为了把已有明文 password preference 平滑迁到安全存储，没有单开一次“只迁移不读写”的发布阶段
- 当前作用：
  - `safeStorage` 加密 password preference
  - 维护独立 `secrets` store
  - 首次访问时把旧明文值迁走
- 不是终局的原因：
  - `settings` 和 `secrets` 目前还同住一个模块
  - `migrateLegacyPasswordPreferences()` / `ensureNativeExtensionSecretsMigrated()` 只是过渡逻辑，不该永久留在主路径
- 删除时机：确认旧明文 token 不再需要兼容之后
- 删除验收：
  - `preferences.ts` 不再包含 legacy 明文迁移逻辑
  - `doctor:secrets-boundary` 继续显示 `safeStorage: yes`
  - GitHub token 仍能读写，且已打开 command 仍能刷新

### 12. `src/renderer/src/launcher/LauncherApp.tsx` 里的 active command preference 订阅实现

- 类型：phase-local refresh bridge
- 为什么还在：Phase 5 先把“已打开 command 能感知设置变化”收在 launcher 壳层，避免这一步继续扩到 surface controller
- 当前作用：监听 `nativeExtensions:preferencesChanged`，在 active extension command 上重新拉取 preferences
- 不是终局的原因：最终这类刷新语义应该下沉到统一的 extension host / surface controller，而不是继续留在 `LauncherApp`
- 删除时机：Phase 6 或之后，surface controller / host 统一接管 active command 的 preference lifecycle
- 删除验收：
  - `LauncherApp.tsx` 不再手写 preference reload effect
  - active extension command 在设置变更后仍能刷新
  - `todo-list`、`github` 等 native extension 行为不回退

### 13. `src/renderer/src/launcher/native-extensions/registry.ts`

- 类型：parallel renderer registry
- 为什么还在：Phase 3 先把隐式发现收成显式 import，但 renderer 侧仍保留了一份独立 command inventory
- 当前作用：维护 `command -> component/meta` 的平行映射
- 不是终局的原因：extension 自己的 renderer 声明应收回 `src/extensions/<id>/renderer.ts`，而不是继续集中堆在 host 目录里
- 删除时机：Phase 6 完成后，renderer command registry 收回各 extension 自己目录
- 删除验收：
  - `src/renderer/src/launcher/native-extensions/registry.ts` 被删除
  - renderer 不再维护独立的 extension inventory
  - `todo-list`、`github`、`translate` 继续能搜索、打开、运行

### 14. `src/main/services/native-extensions/registry.ts`

- 类型：parallel main registry
- 为什么还在：main 侧 service 注册目前还单独维护在 host 目录，和 extension 自己目录分离
- 当前作用：维护 `extension -> main service` 的平行映射
- 不是终局的原因：main service 声明应收回 `src/extensions/<id>/main.ts`，没有 service 的 extension 不应再被迫经过独立 registry
- 删除时机：Phase 6 完成后，main service registry 收回各 extension 自己目录
- 删除验收：
  - `src/main/services/native-extensions/registry.ts` 被删除
  - main 不再维护独立的 extension inventory
  - `translate` 的 service 调用继续正常

### 15. `src/extensions/index.ts`

- 类型：aggregate inventory bridge
- 为什么还在：当前总清单只列 extension 包本身，但 command/component/service 的声明还散落在别处
- 当前作用：提供 native extension 的聚合列表
- 不是终局的原因：如果总清单继续只聚合半成品 definition，声明点仍然会分裂在 `extensions/*`、renderer registry、main registry 三处
- 删除时机：Phase 6 完成后，要么改造成唯一总 registry，要么被新的 `src/extensions/registry.ts` 替换
- 删除验收：
  - 仓库里只剩一份 native extension 总清单
  - 新增一个 extension 时，修改点集中在 `src/extensions/<id>/` 和唯一总 registry
  - `npm run check:extension-contract && npm run check:extension-registry` 通过

## 使用规则

后续每个 pause 结束前，都要做这两件事：

1. 如果新增了桥接层，先在这里登记。
2. 如果某个桥接层已经满足删除条件，先把条件写清楚，但先不要从这里移除，留到最终统一清理 phase 一次删除。

如果某个条目连续几个阶段都还在，但没人能清楚说明删除时机，说明它已经从“临时桥”变成了“架构债”，必须优先处理。

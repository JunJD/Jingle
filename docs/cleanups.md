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
- 当前已经确认、但不属于“临时桥接层”的结构问题，单独记在 [issues.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/issues.md)

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

另外当前还有一组“不是 cleanup，但会影响 pause 验收可信度”的已确认问题：

- 见 [issues.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/issues.md)
- 它们不属于“最后统一删除”的桥接层，所以不混在清理条目里
- 但 Final Cleanup 之前必须确保这些问题已经关闭，否则 cleanup 闸门会失真

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

### 6. `src/plugins/ai/manifest.ts` 中的 `aiBuiltInCommandManifest` 别名导出

- 类型：alias export
- 为什么还在：Phase 4 先把 built-in 主路径改成新语言，但不一次性重命名 AI manifest 事实源
- 当前作用：避免 built-in 层继续 import `aiLauncherPluginManifest`
- 不是终局的原因：manifest 事实源应该只有一个正式名字
- 删除时机：AI manifest 源变量彻底切到 built-in / command owner 语言后
- 删除验收：
  - 别名导出被删除
  - built-in AI 仍能注册和打开

### 7. `src/renderer/src/extension-host/NativeExtensionHost.tsx` 中的 legacy plugin 语言

- 类型：host-internal compatibility residue
- 为什么还在：Phase 4 故意只清 shell 主路径，没有继续深入 host 内部
- 当前作用：host 内部仍借用旧 capability 类型和少量命名
- 不是终局的原因：host 自身最终也应完全使用 extension-host 语言
- 删除时机：Phase 5 或之后的 host 清理阶段
- 删除验收：
  - `rg -n "LauncherPlugin" src/renderer/src/extension-host/NativeExtensionHost.tsx` 结果为 0
  - native extension command 全部继续可运行

### 8. `src/renderer/src/ai-core/LauncherAiPage.tsx` 中的 legacy plugin 语言

- 类型：built-in page residue
- 为什么还在：AI 仍是 built-in，页面实现还直接依赖旧 host hook
- 当前作用：读取 navigation / surface 等宿主能力
- 不是终局的原因：AI 是平台原生能力，不应该长期挂在 plugin-first 命名之下
- 删除时机：`useAI` 和 built-in host contract 明确之后
- 删除验收：
  - `rg -n "LauncherPlugin" src/renderer/src/ai-core/LauncherAiPage.tsx` 结果为 0
  - AI 页面打开、返回、输入焦点行为不回退

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

### 12. `src/renderer/src/launcher-shell/LauncherApp.tsx` 里的 active command preference 订阅实现

- 类型：phase-local refresh bridge
- 为什么还在：Phase 5 先把“已打开 command 能感知设置变化”收在 launcher 壳层，避免这一步继续扩到 surface controller
- 当前作用：监听 `nativeExtensions:preferencesChanged`，在 active extension command 上重新拉取 preferences
- 不是终局的原因：最终这类刷新语义应该下沉到统一的 extension host / surface controller，而不是继续留在 `LauncherApp`
- 删除时机：Phase 6 或之后，surface controller / host 统一接管 active command 的 preference lifecycle
- 删除验收：
  - `LauncherApp.tsx` 不再手写 preference reload effect
  - active extension command 在设置变更后仍能刷新
  - `todo-list`、`github` 等 native extension 行为不回退

### 13. `src/renderer/src/extension-host/registry.ts`

- 类型：parallel renderer registry
- 状态：已在 Phase 6 完成删除
- 为什么会存在过：Phase 3 先把隐式发现收成显式 import，但 renderer 侧仍保留了一份独立 command inventory
- 当时作用：维护 `command -> component/meta` 的平行映射
- 为什么必须删：extension 自己的 renderer 声明应收回 `src/extensions/<id>/renderer.ts`，而不是继续集中堆在 host 目录里
- 删除验收：
  - `src/renderer/src/extension-host/registry.ts` 被删除
  - renderer 不再维护独立的 extension inventory
  - `todo-list`、`github`、`translate` 继续能搜索、打开、运行

### 14. `src/main/services/native-extensions/registry.ts`

- 类型：parallel main registry
- 状态：已在 Phase 6 完成删除
- 为什么会存在过：main 侧 service 注册曾经单独维护在 host 目录，和 extension 自己目录分离
- 当时作用：维护 `extension -> main service` 的平行映射
- 为什么必须删：main service 声明应收回 `src/extensions/<id>/main.ts`，没有 service 的 extension 不应再被迫经过独立 registry
- 删除验收：
  - `src/main/services/native-extensions/registry.ts` 被删除
  - main 不再维护独立的 extension inventory
  - `translate` 的 service 调用继续正常

### 15. `src/extensions/index.ts`

- 类型：aggregate inventory bridge
- 状态：Phase 6 已改造成 manifest 唯一总清单
- 为什么会存在过：总清单曾经只列 extension 包本身，但 command/component/service 的声明还散落在别处
- 当前作用：只提供 manifest 聚合；renderer 和 main 分别收口到 `src/extensions/renderer.ts`、`src/extensions/main.ts`
- 为什么还要继续观察：直到 Final Cleanup，仍要确保仓库里不会重新长出 host 侧平行 inventory
- 删除验收：
  - 仓库里只剩一份 native extension 总清单
  - 新增一个 extension 时，修改点集中在 `src/extensions/<id>/` 和唯一总 registry
  - `npm run check:extension-contract && npm run check:extension-registry` 通过

## 使用规则

后续每个 pause 结束前，都要做这两件事：

1. 如果新增了桥接层，先在这里登记。
2. 如果某个桥接层已经满足删除条件，先把条件写清楚，但先不要从这里移除，留到最终统一清理 phase 一次删除。

如果某个条目连续几个阶段都还在，但没人能清楚说明删除时机，说明它已经从“临时桥”变成了“架构债”，必须优先处理。

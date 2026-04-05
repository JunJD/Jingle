# Cleanups

这份文档是迁移账本，不是愿景文档。

用途只有一个：

- 记录为了“保持每一步都能运行”而临时加入的兼容代码、桥接层、双跑逻辑、fallback 常量

如果某次改动没有新增兼容代码，不需要硬写一条。
如果新增了兼容代码，必须在同一次改动里更新这份文档。

## 使用规则

1. 只记录“临时存在、最终必须删除”的代码
2. 每条记录都必须写清删除条件，不能只写“以后删”
3. 每次完成一个迁移步骤后，先检查本文件，再决定是否还能继续下一步
4. 当某条兼容代码被删除时，把状态改为 `removed`，不要直接抹掉记录

## 记录模板

```md
## [cleanup-id]

- Status: `open` | `removed`
- Introduced In: `Step N`
- Area:
  - `path/to/file.ts`
  - `path/to/other-file.ts`
- Why:
  - 为什么当时需要这段兼容代码
- Compatibility Shape:
  - 旧路径和新路径如何同时存在
- Remove When:
  - 达到什么条件后必须删除
- Verification:
  - 删除前后如何验证行为没回归
- Notes:
  - 其他补充说明
```

## Outstanding

当前暂无已登记的 shortcut 兼容清理项。

新增第一条兼容代码时，从这里开始追加。

## Checkpoints

### Pause 1

- Completed Step: `Step 1: 锁定 Shared Shortcut Truth`
- Result:
  - 未引入需要后续删除的兼容代码
  - shared shortcut truth 已独立到 `src/shared/shortcuts/settings.ts`
- Cleanup Delta:
  - none

### Pause 2

- Completed Step: `Step 2: 建立 Main Persistence 与 Shortcut IPC`
- Result:
  - 未引入双跑逻辑或 fallback 常量
  - 已新增独立 `shortcutSettings` 存储切片和 preload / IPC API
- Cleanup Delta:
  - none

### Pause 3

- Completed Step: `Step 3: 接管 Main Global Shortcut 与 Menu Accelerator`
- Result:
  - 未保留 `DEFAULT_LAUNCHER_SHORTCUT` 作为兼容 fallback
  - global shortcut 和 menu accelerator 已直接切到 resolved binding
- Cleanup Delta:
  - none

### Pause 4

- Completed Step: `Step 4: 建立 Renderer Shortcut Core`
- Result:
  - 新增 provider / manager / context skeleton
  - 还没有迁移页面级 handler，因此没有引入 command 双跑兼容层
- Cleanup Delta:
  - none

### Pause 5

- Completed Step: `Step 5: 迁移 Launcher Shell 基础命令链`
- Result:
  - launcher `Escape / Tab / ArrowUp / ArrowDown / Enter` 已由 host 注册到统一 shortcut manager
  - `useLauncherSearchPage.ts` 删除了 `event.key -> commandId` 的本地硬编码
  - `useLauncherShellEffects.ts` 不再持有 launcher 根部 `Escape` 监听
- Cleanup Delta:
  - none

### Pause 6

- Completed Step: `Step 6: 迁移 AI 与 Native Surface Shortcut 链`
- Result:
  - AI `Enter / 空输入 Backspace`、native list `ArrowUp / ArrowDown`、action panel `Cmd/Ctrl+K / Escape / Arrow / Enter` 已迁到统一 shortcut runtime
  - `useAiThread.ts` 和 `surface-actions.tsx` 删除了主快捷键的本地 `keydown` 监听
  - overlay scope 由 `launcher.action-panel` layer 声明，优先级高于 page scope
  - BDD 环境下 launcher clipboard 不再读取宿主机剪贴板，避免外部状态污染 home / AI shortcut 场景
- Cleanup Delta:
  - none

## Removed

当前暂无已完成清理项。

# Launcher Extension Issues

这份文档只记录一类东西：

`当前已经确认、可以复现或可以从代码直接证明的问题。`

它和 [cleanups.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/cleanups.md) 不同：

- `cleanups.md` 记录的是临时桥接层、兼容层、别名层，最后要统一删除
- `issues.md` 记录的是当前真实存在的问题，不假设“以后重构自然会解决”

这里只分两类：

- `需求缺陷`
- `任务`

## 需求缺陷

当前没有新增条目。

## 任务

### 1. top-level extension registry 完整性没有被 guardrail 真正校验

- 类型：任务
- 状态：open
- 范围：
  - [check-extension-registry.mjs](/Users/junjieding/dingjunjie_dev/2026_03/openwork/.agents/skills/launcher-extension-guardrails/scripts/check-extension-registry.mjs)
  - [src/extensions/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/index.ts)
  - [src/extensions/renderer.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/renderer.ts)
  - [src/extensions/main.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/main.ts)
- 问题：
  - 现在脚本只检查 3 个 top-level registry 文件是否存在
  - 不检查每个 extension 目录是否真的被这 3 个 registry 收进去
- 影响：
  - 新 extension 漏接 top-level registry 时，`check:guardrails` 可能通过
  - 但 renderer/main 会在运行时或启动时才报错
- 最小修正方向：
  - 比较“目录里发现的 extension id 集合”和 `src/extensions/index.ts`、`src/extensions/renderer.ts`、`src/extensions/main.ts` 的 key 集合

### 2. extension contract guardrail 退化成正则检查，可能假通过

- 类型：任务
- 状态：open
- 范围：
  - [architecture-guardrails.mjs](/Users/junjieding/dingjunjie_dev/2026_03/openwork/.agents/skills/launcher-extension-guardrails/scripts/lib/architecture-guardrails.mjs)
  - [check-extension-contract.mjs](/Users/junjieding/dingjunjie_dev/2026_03/openwork/.agents/skills/launcher-extension-guardrails/scripts/check-extension-contract.mjs)
- 问题：
  - 现在用源码正则扫 `name: "..."` 和 `service:`
  - 不能证明这些声明真的出现在 `defineNativeExtensionRenderer(...)` / `defineNativeExtensionMain(...)` 里
- 影响：
  - `renderer.ts / main.ts` 的 shape 出错时，pause gate 可能继续绿灯
  - 验收闸门会失真
- 最小修正方向：
  - 升级为 AST 级检查，只认目标调用表达式里的声明

### 3. extension contract 报错路径仍残留旧 `index.ts` 语义

- 类型：任务
- 状态：open
- 范围：
  - [check-extension-contract.mjs](/Users/junjieding/dingjunjie_dev/2026_03/openwork/.agents/skills/launcher-extension-guardrails/scripts/check-extension-contract.mjs)
- 问题：
  - command 文件缺失时，脚本仍把责任打到 `src/extensions/<id>/index.ts`
  - 但 `Phase 6` 已经删掉 per-extension `index.ts`
- 影响：
  - 错误提示会把排查方向带错
- 最小修正方向：
  - 报错文件改成 `renderer.ts` 或对应的 `src/<command>.ts(x)`

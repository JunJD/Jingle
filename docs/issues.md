# Launcher Extension Issues

这份文档只记录一类东西：

`当前已经确认、可以复现或可以从代码直接证明的问题。`

这里只分两类：

- `需求缺陷`
- `任务`

## 需求缺陷

当前没有新增条目。

## 任务

当前没有 open 条目。

最近一轮已关闭的问题：

1. top-level extension registry 现在会校验目录集合与 `src/extensions/index.ts`、[renderer.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/renderer.ts)、[main.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/main.ts) 的收录一致性。
2. extension contract guardrail 已升级为 AST 级读取，只认 `defineNativeExtensionRenderer(...)` 和 `defineNativeExtensionMain(...)` 的真实声明。
3. command 文件缺失时，guardrail 报错路径已改成 `renderer.ts` 和实际 `src/<command>.ts(x)` 语义，不再残留旧 `index.ts` 方向。

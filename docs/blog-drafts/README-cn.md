# Blog Drafts

[English](./README.md)

这些草稿是独立的产品文章。它们应该能脱离仓库单独存在，不携带 repo path、release mechanics、implementation checklist 或内部 evidence links。

共同上下文很简单：

- launcher 只是 delegated work 的开始；
- agent work 需要可见生命周期；
- local-first 表示 state 和 control 从用户机器开始；
- extensions 应该是边界清楚的 capabilities，而不是隐藏耦合；
- diagnostics 是 trust 的一部分。

## Drafts

| Draft                                                                            | Purpose                               |
| -------------------------------------------------------------------------------- | ------------------------------------- |
| [product-launch-introduction-cn.md](./product-launch-introduction-cn.md)         | 产品介绍                              |
| [launcher-to-agent-workflow-cn.md](./launcher-to-agent-workflow-cn.md)           | Launcher 与 delegated workflow 的区别 |
| [local-first-agent-workspace-cn.md](./local-first-agent-workspace-cn.md)         | Local workspace 与用户拥有的 state    |
| [extension-runtime-design-cn.md](./extension-runtime-design-cn.md)               | 面向 agent work 的 extension 能力边界 |
| [production-logs-and-diagnostics-cn.md](./production-logs-and-diagnostics-cn.md) | Diagnostics 作为产品 trust surface    |

## Writing Rule

每篇文章都保持独立。不要把观点绑定到当前 file path、test suite、release artifact、extension list 或内部 planning document。如果一个细节容易漂移，要么删掉，要么把它改写成产品原则。

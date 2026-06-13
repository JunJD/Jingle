# 为 Agent Workflows 设计 Extensions

[English](./extension-runtime-design.md)

桌面 extensions 通常围绕人主动调用 command 设计：search、open、choose、submit、done。

Agent workflows 增加了另一个 actor。Assistant 也需要 capabilities。它可能需要搜索一个 service、创建一条 record、总结一个 source、打开一个 file，或者准备一个等待用户批准的 action。

如果 human surface 和 agent surface 分开设计，trust 会悄悄断掉。

人看到的可能是一个已连接 command，而 assistant 看到的却不是可用 capability。Assistant 可能知道一个 tool 存在，但可见界面无法解释它依赖哪个 account、permission 或 state。一个 capability 可能偶尔能用，但当每一层都带着不同版本的事实时，它会变得无法 debug。

面向 agent work 的 extension model 必须抵抗这种分裂。

一个 extension 应该有一个清楚的 identity、一个清楚的 account boundary、一个清楚的 capability contract。Human commands 和 assistant tools 不必是同一个 interface，但它们应该是同一个 underlying capability 的不同视图。

这意味着几个产品规则很重要：

- connection state 应该有一个 owner；
- secrets 不应该泄漏到 rendering 或 prompt construction；
- command 不应该暗示 agent 实际无法使用的 capability；
- agent tool 不应该绕过可见 permission model；
- display state 应该从真实 capability state 派生，而不是从 labels 猜出来。

这不是为了 architecture 而 architecture。这是 extensions 同时被人和 agents 使用时仍然可理解的方式。

对人来说，extension 是快速完成某件事的方法。对 agent 来说，extension 是带有 context、permissions 和 consequences 的 capability。产品必须让这两个视角相遇，而不是把它们揉成一个混乱界面。

目标很简单：

一个 connected capability 应该像一个完整东西那样工作，而不是两个半连接的东西。

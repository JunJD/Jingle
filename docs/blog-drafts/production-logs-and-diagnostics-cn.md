# 每个 Desktop Agent 都需要的朴素功能：Local Diagnostics

[English](./production-logs-and-diagnostics.md)

“它失败了”对 desktop agent 来说信息不够。

失败可能出现在几乎任何地方：model request、missing credential、rejected approval、window crash、operating-system permission、extension connection、command policy，或者一段 malformed state。

没有 diagnostics，这些失败会坍缩成同一种用户体验：出了问题，而且没人知道该看哪里。

所以 local diagnostics 很重要。

它们不华丽，也不适合 demo。但它们是产品 trust surface 的一部分。如果一个 agent workspace 要触碰 files、commands、windows、models、services 和 user decisions，它就需要一种方式让 failure 可观察。

好的 diagnostics 是有边界的。它们应该足够解释 app lifecycle、tool execution、window behavior、connection state 和 unexpected errors，给 support 一个起点。它们不应该随意暴露 secrets、private project contents 或不必要的 model payloads。

好的 diagnostics 是 local-first 的。用户不应该为了说明某件事坏了，就交出整个 workspace。产品应该在用户机器上留下一条小的、可检查的轨迹。

好的 diagnostics 也会塑造 engineering behavior。当 failure 可见，它就能被归属到真实 boundary。当它能被归属到 boundary，团队就能修复 contract，而不是继续加一个模糊 fallback。

可靠 agent products 背后有一种安静的纪律：

让 work 可见，让 risk 可 review，让 failure 可诊断。

对 desktop agents 来说，local diagnostics 不是 developer luxury。它们决定了我们只能说“agent 做了奇怪的事”，还是能够说“我们知道系统在哪个 boundary 上处理不了了”。

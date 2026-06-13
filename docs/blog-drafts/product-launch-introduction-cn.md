# Openwork/Jingle：给委托式 Agent 工作的桌面工作区

[English](./product-launch-introduction.md)

AI agents 已经越来越能触碰真实工作。也正因为如此，它们需要比空白 prompt box 更好的产品界面。

真正的问题不再只是 model 能不能 call tool。真正的问题是：人能不能理解 agent 正在做什么，决定它下一步可以做什么，并在出错时恢复。

这就是 Openwork/Jingle 正在探索的产品形状：一个给 delegated agent work 使用的桌面工作区。

第一步应该很快。你应该能打开 launcher、搜索、开始 task，然后把手从细节里拿出来。但 launcher 只是开始。一旦工作开始，产品就必须拥有这份工作的生命周期。

一份被委托出去的 task 应该有一个可见的发生地点。它应该显示正在使用什么 context、正在尝试什么 actions、哪里需要 approval、什么被改变了、留下了什么 evidence。它应该允许你 pause、return、continue 或 branch，而不会丢掉那条线。

这就是“让 agent 显得神奇”和“让 agent 变得可信”之间的区别。

神奇会隐藏机器。信任会让正确的部分可见。当软件可以代表你读文件、运行命令、调用服务并改变东西时，控制权不能只是 marketing copy 里的一句话。它必须出现在风险发生的那个时刻。

这个产品姿态是 local-first，但不是 isolationist。Models 和 connected services 仍然可能在机器之外。关键边界是：work state、history、approvals、diagnostics，以及用户对控制权的感受，都从用户自己的电脑开始。

我们想让这种体验变得清楚：

快速开始，清楚委托，检查工作，批准有风险的部分，并且稍后回来时不会丢掉轨迹。

Agent workspace 不只是一个带更多 tools 的 chat box。它是一个让工作拥有生命周期的地方，也让人在这个生命周期里保持在场，而不必 micromanage 每一步。

# Launcher 是入口；Workflow 才是产品

[English](./launcher-to-agent-workflow.md)

Launchers 非常擅长第一步。

它们压缩 intention 和 action 之间的距离。按下快捷键，输入几个词，打开某个东西，搜索某个东西，开始某件事。这种速度是真实的产品价值。桌面 agent 不应该让人在迷宫里走一圈才能开始工作。

但 agent work 不会停在 invocation。

一旦 agent 开始读取 context、制定计划、使用 tools、请求 approval、产生 changes，产品问题就变了。它不再只是“我能多快开始？”而变成：

- agent 正在使用什么 context；
- 它现在在做什么；
- 哪些部分有风险；
- 什么被改变了；
- 什么需要我决定；
- 它留下了什么 evidence；
- 我稍后怎么恢复或继续？

所以 launcher 应该被当成 doorway，而不是 whole house。

Launcher 赢下开始。Workflow 赢得信任。

这个区别很重要，因为它能避免一个常见产品陷阱：把黑盒 agent 包进一个漂亮 command palette，然后说产品完成了。这给了用户很快的开始，却在真实工作发生时把用户丢下。

Delegated work 在第一个 prompt 之后仍然需要界面。它需要可检查的 progress、可以 approve 或 reject 的 decisions、可以 review 的 outputs，以及可以 resume 的 history。

设计原则很简单：

让第一步快，让剩下的工作可检查。

这就是带 AI 的 launcher 和 agent workspace 的区别。

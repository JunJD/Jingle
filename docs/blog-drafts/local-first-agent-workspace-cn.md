# 为什么 Agent Work 需要本地 Workspace，而不只是 Prompt Box

[English](./local-first-agent-workspace.md)

Prompt box 很适合提问。但它不是管理一份工作的好地方。

真实工作有 state。它有 files、decisions、attempts、approvals、partial results、failures，以及稍后可能需要检查的 outputs。如果 agent product 把这些 state 藏在一次性 conversation 后面，用户得到的是一种奇怪的力量：软件能做更多，但人理解得更少。

Local workspace 改变了合同。

它说：工作发生在这里。这是 context、files、commands、memory、history 和 recovery 的边界。Scratch folder 里的 task 和重要项目里的 task 不是一回事。产品应该让这个差异可见。

Local-first 不是假装网络不存在。Agent 可能会使用 cloud models 或 connected services，因为用户选择了它们。Local-first 的意思是：用户的 work state 和 control surfaces 从用户自己的机器开始。

这对 trust 很重要。

Memory 不应该像看不见的 model magic。它应该像用户能理解、能控制的产品 state。

Approvals 不应该像打断。它们应该出现在 delegated work 跨过某个需要人判断的边界时。

History 不应该是 transcript graveyard。它应该是一种带着 context 回到未完成工作的方式。

Diagnostics 不应该是事后补丁。它们应该让 failures 变得可读，而不是要求用户凭记忆解释整个环境。

Local workspace 的重点不是怀旧 desktop software。它是 operational clarity。当 state 有位置，debugging 就有路径。当 risk 有界面，trust 就有形状。当 work 留下轨迹，delegation 才变成一种人可以长期相处的东西。

Agent work 不应该消失进远端黑盒。它应该落在用户能看见、理解和控制的 workspace 中。

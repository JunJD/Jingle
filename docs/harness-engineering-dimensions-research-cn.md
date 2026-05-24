# Harness 工程三维度研究：质疑与修正

日期：2026-05-20

## 研究问题

你的原始判断：

1. Harness 工程正在沿着时间维度、空间维度、交互维度发展。
2. Agent team 似乎是投资人心头好。
3. Raycast 做得好的更像是交互维度，另外两个维度没那么强。

我的结论：

> 这个判断方向对，但还不够硬。时间、空间、交互描述的是 Agent 产品被体验到的位置；真正让它成为 harness 的，是第四层：证据与控制。

换句话说，三维框架可以保留，但要升级成四层：

| 维度 | 真正问题 | 典型代表 |
| --- | --- | --- |
| 时间 | 从同步问答变成长时间、可暂停、可恢复、可并行的工作单元 | OpenAI Codex cloud、GitHub Copilot cloud agent、Google Jules |
| 空间 | 从聊天框进入受控执行环境：workspace、sandbox、browser、OS、IDE、PR branch | Codex sandbox、GitHub Actions env、Modal Sandboxes、Browserbase |
| 交互 | 从 prompt-response 变成入口、审批、状态、审查、handoff、恢复 | Raycast、IDE agent、PR review loop |
| 证据/控制 | 真正的 harness：run state、trace、diff、artifact、approval、checkpoint、eval、rollback | GitHub PR logs、Openwork run records、agent eval harness |

最关键的修正：

> Agent 产品沿着时间、空间、交互分化；Harness 工程不是三者之一，而是让三者可信的证据与控制层。

## 1. 质疑“三维度”：对，但不是 harness 的核心

### 时间维度：不是“跑得久”，而是生命周期

市场确实在从“和模型聊天”走向“委托一个任务，过一会儿回来验收”。

证据：

- OpenAI 把 Codex 描述成云端软件工程 Agent：每个任务在自己的 cloud sandbox 中运行，可以并行处理任务、修 bug、回答代码库问题、提出 PR。来源：[OpenAI Codex announcement](https://openai.com/index/introducing-codex/?video=1084810944)。
- GitHub Copilot cloud agent 是明确的异步工作流：可以从 issue 或 VS Code 发起，之后通过 commit、draft PR 和 session logs 跟踪结果。来源：[GitHub press release](https://github.com/newsroom/press-releases/coding-agent-for-github-copilot)、[GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)。
- Google Jules 也把自己定义成 asynchronous coding agent：读取代码、修 bug、写测试，在安全云环境里执行。来源：[Google Jules announcement](https://blog.google/technology/google-labs/jules/)。

产品判断：

时间维度的核心不是“Agent 在后台跑”。那只是后台 spinner。

真正的时间能力是 lifecycle：

- created
- running
- blocked
- approved / rejected
- failed
- succeeded
- reviewed
- resumed
- replayed

如果没有 durable lifecycle，异步只会制造焦虑：用户不知道它在干嘛、卡在哪、错了怎么救。

### 空间维度：不是“在哪里显示”，而是执行爆炸半径

Agent 产品也在从聊天框进入受控执行环境。

证据：

- OpenAI Codex 使用任务级 cloud sandbox，并预加载代码库。来源：[OpenAI Codex announcement](https://openai.com/index/introducing-codex/?video=1084810944)。
- GitHub Copilot cloud agent 在由 GitHub Actions 驱动的 ephemeral development environment 中探索代码、编辑、跑测试、lint。来源：[GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)。
- Modal 把 Sandboxes 定位成运行不可信 AI 生成代码和 agentic systems 的隔离环境。来源：[Modal Sandboxes](https://modal.com/products/sandboxes)、[Modal launch post](https://modal.com/blog/sandbox-launch)。
- Browserbase 做的是 agent 浏览器基础设施：隔离 browser session、AI-native browser automation。来源：[Browserbase docs](https://docs.browserbase.com/welcome/what-is-browserbase)。

产品判断：

空间维度不是 UI 空间，而是执行边界：

- local workspace
- remote sandbox
- browser session
- OS surface
- IDE workspace
- PR branch
- extension capability boundary

如果产品不能定义“Agent 到底被允许在哪里行动”，它就无法承接真实工作。

### 交互维度：Raycast 的确很强

Raycast 的强项就是高频入口和 OS-native 交互。

证据：

- Raycast Quick AI 可以从 Root Search 里按 `Tab` 直接触发，支持 follow-up，也能把 Quick AI 交接到 AI Chat 并保留历史。来源：[Raycast Chat manual](https://manual.raycast.com/ai/chat)。
- Raycast AI 集成 OS context、attachments、hotkey、model switching、extensions。来源：[Raycast AI product page](https://www.raycast.com/core-features/ai)。
- Raycast AI Extensions 允许 AI Chat、Quick AI、Root Search 调用 extension tools，并由 Raycast 选择正确工具和参数。来源：[Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions)、[Raycast Extensions manual](https://manual.raycast.com/extensions)。

产品判断：

Raycast 拥有一个非常强的交互层：

- keyboard-first entry
- 快速上下文捕获
- Quick AI 到 Chat 的低摩擦 handoff
- extension tool invocation
- OS-native 质感

但这不等于它拥有长时间软件委托工作的完整 harness。

## 2. 质疑“Agent team 是投资人心头好”

这句话有一半对，一半误导。

投资人并不是因为“多 Agent 分角色聊天”天然高级才买单。他们真正买单的是三类东西：

1. 能替代明确劳动岗位或流程。
2. 能拥有 workflow，并产出可衡量结果。
3. 能让 Agent 执行变可靠的基础设施。

### Agent team 叙事确实存在

证据：

- Relevance AI raised $24M Series B，叙事是 AI workforce 和 agent operating system。来源：[Relevance AI announcement](https://relevanceai.com/blog/the-ai-workforce-revolution-24m-series-b-to-accelerate-our-mission)。
- CrewAI announced $18M total funding，叙事是 multi-agent platform。来源：[CrewAI press release](https://www.globenewswire.com/NV/news-release/2024/10/22/2966872/0/en/CrewAI-Launches-Multi-Agentic-Platform-to-Deliver-on-the-Promise-of-Generative-AI-for-Enterprise.html)。

但更大的融资信号并不是泛泛的 agent team，而是有清楚 ROI 的软件工作/编码执行产品：

- Cursor/Anysphere raised $900M at a $9.9B valuation，并被报道 ARR 超过 $500M。来源：[TechCrunch](https://techcrunch.com/2025/06/05/cursors-anysphere-nabs-9-9b-valuation-soars-past-500m-arr/)。
- Cognition/Devin raised $400M at a $10.2B valuation，并被报道 Devin ARR 从 $1M 增至 $73M。来源：[TechCrunch](https://techcrunch.com/2025/09/08/cognition-ai-defies-turbulence-with-a-400m-raise-at-10-2b-valuation/)。
- Poolside raised $500M，方向是 AI coding work 和模型基础设施。来源：[TechCrunch](https://techcrunch.com/2024/10/02/ai-coding-startup-poolside-raises-500m-from-ebay-nvidia-and-others/)。

交互层产品也能融资。Raycast raised $30M Series B，用于把 Mac productivity app 扩到 Windows 和 iOS。来源：[TechCrunch](https://techcrunch.com/2024/09/25/raycast-raises-30m-to-bring-its-mac-productivity-app-to-windows-and-ios/)。这说明“只有 agent team 才受投资人喜欢”太粗糙；更准确是：编码/软件工作执行因为 ROI 更直接，资金强度明显更大。

### 反证：多 Agent 不自动更强

研究上不能把 multi-agent 当成默认正确答案。

- 一篇 2026 arXiv 论文认为，在 reasoning token budget 匹配时，single-agent 可以匹配或超过 multi-agent；很多 multi-agent 优势可能来自没有控制住的 compute 和 context 差异。来源：[Single-Agent LLMs Outperform Multi-Agent Systems...](https://arxiv.org/abs/2604.02460)。
- 一篇 2024 论文总结指出，一个强 single-agent prompt 在很多推理任务上接近最佳 discussion-based multi-agent 方法；multi-agent 主要在没有 demonstrations 时有帮助。来源：[Rethinking the Bounds of LLM Reasoning](https://huggingface.co/papers/2402.18272)。

产品判断：

> Agent team 是一个好销售隐喻，但不是一个好架构默认值。

真正的问题不是：

> 有几个 Agent？

而是：

> 系统能不能把一个用户目标变成可控、可检查、可恢复的工作单元？

如果多个 Agent 帮这个目标，就用；如果只是增加协调成本，就砍掉。

## 3. 质疑“Raycast 主要赢在交互维度”

这个判断基本成立，但需要更精确。

Raycast 最强的是 interaction fabric：它让 AI 出现在用户已有工作流的正确瞬间。

它也触碰了空间维度，因为 Raycast 能把 OS context、文件、窗口、浏览器 tab、日历、剪贴板、extension 能力拉进 AI。但这是“上下文空间”和“动作表面”，不是完整执行 harness。

它也有一点时间维度：

- Quick AI 支持 follow-up。
- AI Chat 有历史和 memory。
- Quick AI 可以按 inactivity timeout 自动开新 chat。

但 Raycast 不是围绕 durable work unit 设计的。它没有把下面这些东西变成产品核心：

- run lifecycle
- checkpoint state
- approval recovery
- code diff artifact
- rerun / replay
- branch / PR traceability
- per-run evaluation

所以更准确的说法是：

> Raycast 是 AI-at-the-OS 的交互层高手，但不是 long-running delegated software work 的深 harness。

这不是贬低 Raycast，而是边界判断。

## 4. 市场地图

### 交互层

代表：

- Raycast
- IDE assistants
- browser assistants
- command palettes
- quick actions

护城河：

- habit
- latency
- keyboard ergonomics
- context capture
- daily work distribution

风险：

- 当任务变长、风险变高，仅靠交互顺滑不够。

### 时间层

代表：

- OpenAI Codex cloud
- GitHub Copilot cloud agent
- Google Jules
- Devin-like systems

护城河：

- task lifecycle
- parallel work
- status visibility
- branch / PR workflow
- background execution

风险：

- 如果输出难验证，异步会制造焦虑，而不是信任。

### 空间层

代表：

- Modal Sandboxes
- Browserbase
- cloud coding environments
- browser automation infrastructure
- ephemeral GitHub Actions environments

护城河：

- isolation
- scale
- session persistence
- credential control
- observability
- environment reproducibility

风险：

- 基础设施如果不绑定具体 workflow，对最终用户不可感知。

### 证据/控制层

代表：

- GitHub PR loop
- coding agent eval harnesses
- Openwork-style run records
- artifact / diff / checkpoint systems

护城河：

- trust
- auditability
- recovery
- team review
- institutional memory

风险：

- 如果被藏成内部 plumbing，用户感受不到价值。

## 5. 对 Openwork 的产品判断

Openwork 不应该做 “Raycast plus agents”。

Raycast 已经拥有高频交互入口。Openwork 应该拥有更深的 delegated software work trust loop。

更强的产品命题：

> Build a launcher-first agent system where every software task becomes a controlled, inspectable unit of work with plan, permissions, artifacts, diffs, checkpoints, and recovery.

### Openwork 必须 own 的东西

1. Run lifecycle。
2. Approval boundary。
3. Artifact / diff evidence trail。
4. Workspace and tool permission model。
5. Agent 错误时的 recovery path。

### Openwork 应该 integrate 的东西

1. Models。
2. Extension tools。
3. MCP / external tool providers。
4. Browser / OS automation backends。
5. Cloud sandbox providers，必要时再接。

### Openwork 应该 delay 的东西

1. 泛泛的 agent team branding。
2. 在核心 run loop 成熟前做大而全 extension marketplace。
3. 和 Raycast 争 generic launcher utility。
4. 把 multi-agent orchestration 当 headline feature。

## 6. 修正后的框架

原判断：

> Harness 工程有时间、空间、交互三个维度。

修正后：

> Agent 产品在时间、空间、交互上分化；Harness 工程是让这些分化变可信的证据与控制层。

更有用的检查表：

| 问题 | 弱答案 | 强答案 |
| --- | --- | --- |
| 时间 | 它能后台运行 | 它有 durable lifecycle、checkpoint、resume、replay |
| 空间 | 它能访问工具 | 它有 scoped environment、credential boundary、isolation、blast-radius control |
| 交互 | 它有聊天/launcher UI | 它在正确时刻给 status、approval、review、handoff、recovery |
| 证据/控制 | 它记录日志 | 它产出可检查 artifact、diff、trace、eval、decision record |

## 最终建议

不要用 “agent team” 做 Openwork 的核心叙事。

用 “controlled unit of work”。

Openwork 的产品优势不应该是“我也能从 launcher 启动 Agent”。Raycast 已经能把 AI 启动得很漂亮。Openwork 的优势必须是：一旦任务从问答变成真实工作，用户在时间、空间和风险上都没有失控。

一句话：

> Raycast 赢在 invocation moment；Openwork 应该赢在 delegated work lifetime。

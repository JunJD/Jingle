# Harness Engineering Dimensions Research

Date: 2026-05-20

## Question

User hypothesis:

1. Harness engineering is developing along three dimensions: time, space, and interaction.
2. "Agent team" seems to be what investors like.
3. Raycast seems strongest in the interaction dimension, not necessarily the other two.

This memo challenges that frame and turns it into a more useful product judgment for Openwork.

## Short Verdict

The three-dimensional frame is useful, but incomplete.

Time, space, and interaction describe where an agent harness is experienced. They do not describe what makes it a harness. The missing dimension is evidence/control: durable run state, permissions, traces, diffs, artifacts, replay, rollback, and evaluation.

So the stronger frame is:

| Dimension | What It Means | Product Examples |
| --- | --- | --- |
| Time | From synchronous chat to long-running, resumable, asynchronous work | OpenAI Codex cloud, GitHub Copilot cloud agent, Google Jules |
| Space | From one chat box to isolated workspaces, cloud sandboxes, browser/OS/IDE environments | Codex sandbox, Copilot GitHub Actions env, Modal Sandboxes, Browserbase |
| Interaction | From prompt-response UI to launcher, approval, review, handoff, context capture | Raycast, IDE agents, PR review loops |
| Evidence/control | The actual harness: state, logs, diffs, approvals, artifacts, checkpoints, evals | GitHub PR logs, Openwork run records, agent eval harnesses |

The mistake would be to treat time/space/interaction as the whole thesis. A product can look good across those dimensions and still fail as a harness if users cannot inspect, verify, approve, recover, or replay the work.

## Hypothesis 1: "Harness Engineering Has Time / Space / Interaction Dimensions"

Mostly right, but underpowered.

### Time Dimension

The market is moving from "chat with a model" toward "delegate a unit of work and come back later."

Evidence:

- OpenAI describes Codex as a cloud-based software engineering agent that can work on many tasks in parallel, each in its own cloud sandbox, and can write features, answer codebase questions, fix bugs, and propose PRs. Source: [OpenAI Codex announcement](https://openai.com/index/introducing-codex/?video=1084810944).
- GitHub Copilot cloud agent is explicitly asynchronous: assign an issue or start from VS Code, then track commits and draft PRs through logs. Source: [GitHub press release](https://github.com/newsroom/press-releases/coding-agent-for-github-copilot) and [GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).
- Google Jules calls itself an asynchronous coding agent that reads code, fixes bugs, writes tests, and works in a secure cloud environment. Source: [Google Jules announcement](https://blog.google/technology/google-labs/jules/).

Product implication:

Time is not just "agent runs longer." It is durable lifecycle:

- created
- running
- blocked
- approved / rejected
- failed
- succeeded
- reviewed
- resumed
- replayed

Without lifecycle state, "async" is just a background spinner.

### Space Dimension

The market is also moving from "model inside a chat window" to "agent inside a controlled operating environment."

Evidence:

- OpenAI Codex uses task-specific cloud sandboxes preloaded with the repository. Source: [OpenAI Codex announcement](https://openai.com/index/introducing-codex/?video=1084810944).
- GitHub Copilot cloud agent works in its own ephemeral development environment powered by GitHub Actions, where it can explore code, edit, run tests, and lint. Source: [GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).
- Modal positions Sandboxes as isolated environments for untrusted AI-generated code and agentic systems, with high concurrency. Source: [Modal Sandboxes](https://modal.com/products/sandboxes) and [Modal sandbox launch](https://modal.com/blog/sandbox-launch).
- Browserbase is focused on browser infrastructure for agents, with isolated browser sessions and AI-native browser automation. Source: [Browserbase docs](https://docs.browserbase.com/welcome/what-is-browserbase).

Product implication:

Space is not just "where the UI appears." It is the execution blast radius:

- local workspace
- remote sandbox
- browser session
- OS surface
- IDE workspace
- PR branch
- extension capability boundary

If the product cannot define and constrain space, it cannot safely delegate real work.

### Interaction Dimension

Raycast is genuinely strong here.

Evidence:

- Raycast Quick AI starts directly from Root Search with `Tab`, supports follow-ups, and can hand off to AI Chat while preserving history. Source: [Raycast Chat manual](https://manual.raycast.com/ai/chat).
- Raycast AI integrates with OS context, attachments, hotkey access, model switching, and extensions. Source: [Raycast AI product page](https://www.raycast.com/core-features/ai).
- Raycast AI Extensions let users invoke extension tools from AI Chat, Quick AI, or Root Search; Raycast chooses the right tool and arguments. Source: [Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions) and [Raycast Extensions manual](https://manual.raycast.com/extensions).

Product implication:

Raycast owns a high-frequency interaction layer:

- keyboard-first entry
- low-friction context capture
- quick answer to chat handoff
- tool invocation across installed extensions
- OS-native feeling

But that is not the same as owning the full harness for long-running software work.

## Hypothesis 2: "Agent Team Is Investor Favorite"

Partly true, but the wording is misleading.

Investors are not funding "agent teams" because multi-agent roleplay is inherently good. They are funding three things:

1. labor substitution with a clear buyer
2. workflow ownership with measurable output
3. infrastructure that makes agent execution reliable

### Evidence For Investor Interest

Agent workforce/team framing exists:

- Relevance AI raised $24M Series B to build an "AI workforce" and an agent operating system for specialized agents. Source: [Relevance AI announcement](https://relevanceai.com/blog/the-ai-workforce-revolution-24m-series-b-to-accelerate-our-mission).
- CrewAI announced $18M total funding for a multi-agent platform. Source: [CrewAI press release](https://www.globenewswire.com/NV/news-release/2024/10/22/2966872/0/en/CrewAI-Launches-Multi-Agentic-Platform-to-Deliver-on-the-Promise-of-Generative-AI-for-Enterprise.html).

But the biggest funding signals are not generic "agent teams." They are coding/work execution products with clearer ROI:

- Cursor/Anysphere raised $900M at a $9.9B valuation, with reported ARR above $500M at the time. Source: [TechCrunch](https://techcrunch.com/2025/06/05/cursors-anysphere-nabs-9-9b-valuation-soars-past-500m-arr/).
- Cognition, maker of Devin, raised $400M at a $10.2B valuation, with reported Devin ARR growth from $1M to $73M in under a year. Source: [TechCrunch](https://techcrunch.com/2025/09/08/cognition-ai-defies-turbulence-with-a-400m-raise-at-10-2b-valuation/).
- Poolside raised $500M for AI coding work and model infrastructure. Source: [TechCrunch](https://techcrunch.com/2024/10/02/ai-coding-startup-poolside-raises-500m-from-ebay-nvidia-and-others/).

Interaction-layer products can also raise meaningful money. Raycast raised a $30M Series B to expand its Mac productivity app to Windows and iOS. Source: [TechCrunch](https://techcrunch.com/2024/09/25/raycast-raises-30m-to-bring-its-mac-productivity-app-to-windows-and-ios/). That matters because it weakens the lazy claim that only "agent teams" are fundable. The capital intensity is simply much larger around coding/work execution where the ROI story is more direct.

### Counterpoint: Multi-Agent Is Not Automatically Better

Research is more skeptical than startup narratives.

- A 2026 arXiv paper found that when reasoning token budgets are matched, single-agent systems can match or outperform multi-agent systems on multi-hop reasoning tasks, and many reported multi-agent advantages may come from unaccounted compute and context effects. Source: [Single-Agent LLMs Outperform Multi-Agent Systems...](https://arxiv.org/abs/2604.02460).
- A 2024 paper summarized on Hugging Face found a strong single-agent prompt can achieve almost the same performance as the best discussion-based multi-agent approach across many reasoning tasks; multi-agent discussion helped mainly when no demonstrations were provided. Source: [Rethinking the Bounds of LLM Reasoning](https://huggingface.co/papers/2402.18272).

Product implication:

"Agent team" is a good sales metaphor, but a bad architecture default.

The durable product question is not:

> How many agents are on the team?

It is:

> Can the system turn one user goal into a controlled, inspectable, recoverable unit of work?

If multiple agents help with that, use them. If they add coordination overhead, cut them.

## Hypothesis 3: "Raycast Does Interaction Well, Less So Time/Space"

Mostly right.

Raycast is strongest at interaction. It is a polished command surface for invoking AI in the flow of OS work.

Raycast also touches the space dimension because it can pull OS context, files, windows, browser tabs, calendar events, clipboard history, and installed extension capabilities into AI. But this is context space and action surface, not a full execution harness.

Raycast has some time dimension too:

- Quick AI supports follow-ups and recent chat navigation.
- AI Chat has persistent history and memory.
- Quick AI can automatically start a fresh chat after an inactivity timeout.

But it is not primarily built around durable, auditable work units. It is not optimized around:

- run lifecycle
- checkpoint state
- approval recovery
- code diff artifacts
- rerun/replay
- branch/PR traceability
- per-run evaluation

So the sharper statement is:

> Raycast is a great interaction fabric for AI-at-the-OS. It is not yet a deep harness for long-running delegated software work.

This is not an insult. It is a boundary.

## Market Map

### 1. Interaction Layer

Products that win by making AI available at the right moment:

- Raycast
- IDE assistants
- browser assistants
- command palettes
- quick actions

Moat:

- habit
- latency
- keyboard ergonomics
- context capture
- distribution across daily work

Risk:

- if execution becomes long-running and risky, interaction polish alone is not enough.

### 2. Time Layer

Products that win by letting agents work asynchronously:

- OpenAI Codex cloud
- GitHub Copilot cloud agent
- Google Jules
- Devin-like systems

Moat:

- task lifecycle
- parallel work
- status visibility
- branch/PR workflows
- background execution

Risk:

- if outputs are hard to verify, async creates anxiety rather than trust.

### 3. Space Layer

Products that win by owning execution environments:

- Modal Sandboxes
- Browserbase
- cloud coding environments
- browser automation infrastructure
- ephemeral GitHub Actions environments

Moat:

- isolation
- scale
- session persistence
- credential control
- observability
- environment reproducibility

Risk:

- infrastructure alone is invisible to end users unless it is attached to a concrete workflow.

### 4. Harness / Evidence Layer

Products that win by making delegated work inspectable:

- GitHub PR loop
- coding agent eval harnesses
- Openwork-style run records
- artifact/diff/checkpoint systems

Moat:

- trust
- auditability
- recovery
- team review
- institutional memory

Risk:

- if hidden as internal plumbing, users do not feel the value.

## Product Judgment For Openwork

Openwork should not try to be "Raycast plus agents."

Raycast already owns high-frequency interaction. Openwork should own the deeper trust loop around delegated software work.

The product thesis should be:

> Build a launcher-first agent system where every software task becomes a controlled, inspectable unit of work with plan, permissions, artifacts, diffs, checkpoints, and recovery.

### What Openwork Should Own

1. The run lifecycle.
2. The approval boundary.
3. The artifact/diff evidence trail.
4. The workspace and tool permission model.
5. The recovery path when the agent is wrong.

### What Openwork Should Integrate

1. Models.
2. Extension tools.
3. MCP or external tool providers.
4. Browser/OS automation backends.
5. Cloud sandbox providers, if needed later.

### What Openwork Should Delay

1. Generic "agent team" branding.
2. A broad extension marketplace before the core run loop works.
3. Competing with Raycast on generic launcher utility.
4. Multi-agent orchestration as a headline feature.

## The Corrected Framework

The original frame:

> Harness engineering has time, space, and interaction dimensions.

Corrected frame:

> Agent products are differentiating along time, space, and interaction, but harness engineering is the control/evidence layer that makes movement across those dimensions trustworthy.

The most useful table:

| Question | Weak Answer | Strong Answer |
| --- | --- | --- |
| Time | It runs in background | It has durable lifecycle, checkpoints, resume, replay |
| Space | It can access tools | It has scoped environments, credentials, isolation, blast-radius control |
| Interaction | It has chat/launcher UI | It has timely status, approval, review, handoff, recovery |
| Evidence/control | It logs things | It produces inspectable artifacts, diffs, traces, evals, and decisions |

## Final Recommendation

Do not lead with "agent teams."

Lead with "controlled unit of work."

For Openwork, the hard product advantage is not that it can start an agent from a launcher. Raycast can start AI beautifully. The advantage must be that when the task becomes real work, Openwork keeps the user oriented and in control across time, execution space, and risk.

In one line:

> Raycast wins the moment of invocation; Openwork should win the lifetime of delegated work.

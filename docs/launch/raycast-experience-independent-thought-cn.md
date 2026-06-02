# Raycast 把动作叫出来，Openwork 要让工作留下证据

你让一个 Agent 改项目时，最危险的时刻通常不在第一秒。

第一秒太容易了。

按一个快捷键，弹出输入框，写一句：把这个 bug 修掉。  
如果只是把这句话送进 AI，很多产品都能做到。Raycast 这类 launcher 甚至能把这一秒做得很漂亮：轻、快、贴手，像从当前工作里伸手拿了一下工具。

真正的问题会在几分钟后出现。

它读了哪些文件？  
它准备改哪里？  
它有没有碰到 GitHub issue、Linear ticket、Slack 讨论、Apple Reminders、数据库、外部 API？  
它现在是在读，还是已经开始写？  
它要执行一个 shell 命令时，凭什么判断这一步可以自动过？  
它做完以后，你能看到什么证据？

这才是我最近看 Raycast、Craft Agents OSS 和 Openwork 时真正关心的东西。

Raycast 最近很热。一方面是 v2 beta，一方面是 Windows beta。表面看，这是一次跨平台重构：从原来的 macOS 原生 AppKit 架构，换成 native shell、WebView、Node、Rust 的混合栈。很多技术帖会聊它为什么没用 Electron，为什么要自研 Rust file indexer，为什么 Windows 文件索引逼它做 Master File Table 扫描。

这些都重要，但它们更像表层症状。

Raycast 真正厉害的地方，一直是它站在用户的起手式上。

以前你要做事，先想打开哪个 app。打开浏览器、打开 GitHub、打开日历、打开翻译工具、打开 ChatGPT。每个 app 都有自己的门、自己的导航、自己的状态。人的注意力像一个进程，被频繁换出换入。

Raycast 把这个顺序改了。

你先想动作：查一个 PR，建一个 todo，翻译一句话，运行一个脚本，问一句 AI。背后到底是哪一个 app、哪一个 API、哪一个 extension，先退到后面。

所以 Raycast 的 v2 重构，不能只看成技术栈换新。它是在给这个 action layer 换身体。Root Search 放进 files、folders、contacts；AI Chat 接住 follow-up；Skills 和 extensions 让动作可以跨越更多系统；Windows beta 让这个入口从 Mac niche 往更大的桌面世界走。

Raycast 的问题也在这里。

它把动作叫出来的能力非常强。但一个动作开始以后，如果它变成一段长期工作，Raycast 的优势就没那么自然了。

查一个链接、建一个提醒、切一个窗口，这些是短动作。  
让 Agent 改一个真实项目，是工作。

工作会占用时间。工作会碰外部系统。工作会产生风险。工作会留下中间状态。工作失败以后，你不能只说“再问一次 AI”。

这时候，Craft Agents OSS 反而给了一个很有价值的参照。

Craft Agents OSS 是 Craft 开源出来的 agent-native desktop。它不是单纯把 Claude Code 包进一个漂亮 UI。它有一个很关键的概念：Sources。

Source 可以是 Linear、Gmail、Slack、GitHub、Notion、Postgres、本地文件、MCP server、REST API。用人话说，Source 就是 Agent 可以工作的外部系统。

这个概念好在它不把外部能力当成一堆孤立插件。

一个 Source 不只是“有几个工具可以调用”。它还包含配置、认证状态、连接状态、使用指南、权限规则。你可以在会话里启用某些 Sources，也可以让 workspace 默认启用一些 Sources。Craft 还把 Permission Mode 做成用户能理解的三档：Explore、Ask to Edit、Auto。

这个设计的味道很对。

Agent 真正开始工作前，用户需要回答的不是“你装了多少插件”。用户真正需要知道的是：这次任务会接触哪些工作系统？它在这些系统里能读什么？能写什么？什么时候必须停下来问我？

这就是 Source 的价值。

它把“工具列表”翻译成了“工作边界”。

但 Openwork 不能简单照抄 Craft。

Craft 的形状更 source-first：workspace 里有 sources 目录，有 config、guide、permissions，有 MCP/API/local adapters。它强调的是 agent-native work environment，甚至可以让 agent 帮你添加 Slack、Linear、API、MCP。

Openwork 的形状应该更 harness-first。

Harness 这个词听起来工程味很重。换成人话，它就是给一段 Agent 工作装上仪表盘、刹车、记录仪和检查点。

一个 run 开始时，Openwork 要知道用户原始意图是什么。  
执行过程中，它要知道 Agent 计划做什么、已经做了什么、哪里需要批准。  
碰到文件修改、shell 命令、外部系统写入时，它要能把风险摆到用户眼前。  
结束以后，它要留下 artifacts、diff、审批记录、环境信息和可恢复的状态。

这和 Raycast 的产品重心不同。

Raycast 让你从任何地方快速开始一个动作。  
Openwork 要让一个已经开始的工作始终可见、可控、可追溯。

这也和 Craft 的产品重心不同。

Craft 把 Sources 作为工作环境的一等公民。  
Openwork 应该把 extension capability 编译进每一次 run 的证据链里。

比如 Openwork 里现在更合理的分层应该是这样：

Extension 是能力包。它可以有人用的命令，也可以有 Agent 用的工具。
Loaded Extension Capability 是这份能力投射到 Agent 面前的工作系统，比如 Apple Reminders、GitHub、Linear。
Skill 是做事方法，告诉 Agent 怎么思考、怎么走流程。
Common Tool 是真正执行动作的单元，给人用和给 Agent 用都应该尽量复用同一套逻辑。
Permission Mode 是产品语言，不应该散落成一堆底层判断。
Capability Snapshot 是证据：这次 run 加载了哪个 extension、连接状态是什么、暴露了哪些工具、处在哪种权限模式。

这里有个很容易走偏的地方。

看到 Raycast 强，就想做一个更像 Raycast 的 launcher。  
看到 Craft 强，就想做一个更通用的 Source 平台。  
看到 agent 很热，就想把多模型、多 provider、多 agent team 全堆上去。

这些都很诱人，也都可能把产品带散。

Openwork 真正要赢的地方，应该更窄一点。

一个不写代码的人，想把真实软件工作交给 Agent。他不想学 git，不想读终端输出，不想理解 MCP，也不想在每个工具的权限面板里猜风险。但他仍然要保留判断权：这一步能不能做？这个文件能不能改？这个外部系统能不能写？这次工作最后交付了什么？

如果 Openwork 能把这件事做好，它就不需要在第一秒赢 Raycast。

Raycast 可以是入口。甚至以后用户从 Raycast 里叫起 Openwork 也没问题。关键在于：一旦任务进入长时间执行，Openwork 必须接管工作生命周期。

这里的产品判断会变得很具体。

第一，Openwork 不该和 Raycast 争 generic launcher utility。
启动 app、查文件、建短提醒、跑短命令，这些 Raycast 已经做得很好。Openwork 如果把精力花在这些地方，很容易变成一个更重、更慢、也更窄的 Raycast。

第二，Openwork 应该认真学习 Craft 的 Source 思想和 Permission Mode。
Source 思想的价值不是引入 `SourceProfile` 主模型，而是让 Agent 的上下文有边界；Permission Mode 让风险变成人能理解的选择。Explore、Ask to Edit、Auto 这类语言，比“工具 X 是否 allow”更像产品。

第三，Openwork 要把 loaded extension capability 放进自己的 harness。
这一步很关键。Extension 如果只存在于设置页，它只是配置。Extension 如果进入 run metadata、审批记录、artifact 和 replay，它才变成信任的一部分。

第四，Openwork 的 extension capability UI 要尽快变成用户能感知的东西。
如果只有内部架构，没有 extension catalog、`@extension` 入口、auth 状态、loaded capability 状态，用户不会知道系统边界在哪里。没有边界感，Agent 越强，用户越紧张。

第五，Openwork 的第一性体验应该是“我可以放心把一段工作交出去”。  
放心不是一句文案。它来自具体画面：计划在那里，权限在那里，正在执行的步骤在那里，等待我批准的动作在那里，最后改动和产物在那里。

这样看，Raycast、Craft Agents OSS、Openwork 其实站在三个不同的位置。

Raycast 负责意图出现的瞬间。

你想做事，它让动作立刻来到手边。

Craft Agents OSS 负责工作系统的接入。

你要让 Agent 真干活，它提醒你：干活总要碰某些 Source，总要有认证、指南和权限。

Openwork 应该负责工作持续发生时的可信度。

Agent 开始跑以后，它不能消失进黑盒。它要像一个可检查的工作单元：有计划，有边界，有证据，有审批，有恢复。

如果把这三者混在一起，就容易写出很空的“AI 操作系统”叙事。

但把它们拆开，方向反而清楚了。

Raycast 证明了入口的重要性。  
Craft 证明了 Source 是 Agent 产品的工作地面。  
Openwork 要证明：当 Agent 从聊天变成交付，用户仍然可以站在地面上。

我现在对 Openwork 的判断更明确了。

不要做一个“带 Agent 的 Raycast”。这个位置已经有人占得很好。

也不要急着做一个泛化的 Source marketplace。source 越多，信任问题越重，产品核心还没立住时，表面积会先把人压住。

先做一个更小但更硬的东西：

用户交代一个真实软件任务。  
选择这次任务会用到哪些 Sources。  
选择权限模式。  
Agent 开始执行。  
每个高风险动作都能被解释和批准。  
每个结果都能被检查。  
这次工作结束后，留下一个可回看的 run。

这条链路跑通，Openwork 才有资格谈更大的入口、更丰富的 sources、更开放的生态。

Raycast 最好的地方，是让动作不再藏在 app 里。

Openwork 最该做好的地方，是让工作不再藏进 Agent 里。

## 发布短版

最近看 Raycast v2、Craft Agents OSS 和 Openwork，我越来越觉得 agent 产品不能只问“怎么把 AI 叫出来”。

Raycast 已经把“叫出动作”这件事做得很强。Craft Agents OSS 更值得我们学的，是 Source 和 Permission Mode：Agent 到底能接触哪些工作系统，能读什么，能写什么，什么时候必须问人。

Openwork 的位置应该再往后半程走一步：把每次 Agent 工作变成可检查的 run。

有 Sources，有权限模式，有审批，有 artifacts，有 diff，有恢复。  
入口可以轻，工作必须留下证据。

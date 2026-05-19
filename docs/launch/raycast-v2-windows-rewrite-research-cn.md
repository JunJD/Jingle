 # Raycast 2.0 / Windows 重构调研

日期：2026-05-20

## 一句话结论

如果只看新界面，Raycast 2.0 很容易被理解成一次 redesign。如果只看 Windows beta，又会被理解成一次移植。

这两个判断都只摸到表面。更底下的变化是：Raycast 正在从一个原生 macOS launcher，换底成一个跨平台桌面生产力平台。

Windows 是重要触发器，但不是唯一原因。官方技术文明确说：Raycast 已经从 launcher 长成包含 AI Chat、Notes、extensions、sync、file search 的平台，原来为 launcher 设计的 AppKit 架构开始限制后续产品速度。即使没有 Windows，他们也认为需要重想大部分架构。

## 这波近期发生了什么

### 2024-09：融资和跨平台计划公开

TechCrunch 报道 Raycast raised $30M Series B，目标是把原本 Mac-only 的生产力 app 带到 Windows 和 iOS。

这时 Raycast 已经越过了早期开发者小工具阶段，开始把自己放到更广泛 prosumer 的桌面入口位置上。报道里也提到：Raycast 有数十万 DAU、两万多 extension 开发者，Windows 用户规模比 Mac 大几个数量级。

来源：[TechCrunch: Raycast raises $30M to bring its Mac productivity app to Windows and iOS](https://techcrunch.com/2024/09/25/raycast-raises-30m-to-bring-its-mac-productivity-app-to-windows-and-ios/)

### 2025-09：Extension API 先为 Windows 铺路

Raycast API changelog 里已经出现明显的跨平台准备：

- manifest 增加 `platforms` 字段，默认值是 `["macOS"]`，要上 Windows 需要显式声明 `["macOS", "Windows"]`
- shortcuts 支持按平台写不同 modifier，比如 macOS 用 `cmd`，Windows 用 `ctrl`
- preferences default 可以按平台给不同值
- `@raycast/utils` 变成 cross-platform，并新增 `runPowerShellScript`

这说明 Windows 这件事会穿透整个产品表面：宿主 app 要改，extension 分发、快捷键、配置、脚本工具和开发者 API 也都要跟着改。

来源：[Raycast API Changelog 1.103.0](https://developers.raycast.com/misc/changelog)

### 2025-11：Raycast for Windows public beta

Raycast 官方 Windows 发布文强调几个点：

- Windows public beta 开放
- 「feel like it belongs here, not like something ported over」
- Windows 没有满足他们要求的 system-wide file index，所以他们自研了 file indexer
- extensions 用 React + TypeScript，大量 extension 可跨 Mac / Windows
- beta 期间 Quick AI 免费，基于 GPT-5 mini

这篇发布文还没展开 2.0 的底层架构，但先把 Windows 用户侧价值讲清楚了：Windows 用户要的是一个统一入口，单纯多一个 PowerToys-style utility 不够。

来源：[Raycast for Windows](https://www.raycast.com/blog/raycast-for-windows)

### 2026-05-14：Raycast 2.0 public beta

Raycast 发布「The New Raycast」和「Technical Deep Dive」两篇核心文章。

产品发布文讲的是用户看得到的东西：

- 全新视觉，适配 macOS Tahoe / Liquid Glass
- Files、folders、contacts 进入 Root Search
- 自研 indexer 替代 Spotlight 依赖
- system-wide dictation
- 新 hotkey recorder
- Quick AI 和 AI Chat 更统一
- AI Chat 有 memory、Profile，Skills installed on Mac 自动加载
- beta 期间部分 Pro 功能免费

同时，v2 目前有明显 beta 限制：Cloud Sync、Raycast Focus、Inline Emoji Picker、larger font size、Local Models、Custom Providers 等仍在路上。

来源：[The New Raycast](https://www.raycast.com/blog/the-new-raycast)、[Raycast v2 landing page](https://www.raycast.com/new)

技术文讲的是底层换了什么：

- v1 是 Swift + AppKit 的原生 macOS app
- extensions 一直是 React + TypeScript + Node，native app 负责渲染
- v2 变成 TypeScript + Swift + C# + Rust + Node + React 的 hybrid stack
- 目标是在 macOS 和 Windows 两个平台上跑，同时保留 Raycast 的原生手感

来源：[A Technical Deep Dive Into the New Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)

## 这次“重构 v2”到底改了什么

Raycast 2.0 由四层组成：

1. Host app
   - macOS：Swift + AppKit
   - Windows：C# + .NET 8 + WPF
   - 负责窗口、全局快捷键、菜单栏 / tray、native API、加载 WebView、监管 Node backend

2. Web frontend
   - React + TypeScript
   - macOS / Windows 共用一份 UI 代码
   - Launcher、AI Chat、Notes、Settings 等 window 都是不同 entry points

3. Node backend
   - 单一 long-lived Node process
   - 负责 business logic、database access、extension runtime、long-lived services
   - 两个平台都和它通信，所以大量 feature work 只写一次

4. Rust core
   - 用在 performance / portability 更重要的地方
   - 包括 data layer、sync schema、custom file indexer

Raycast 没走 Electron，也没走 Tauri。

它选择的是自研 native shell + system WebView + Node backend + Rust core。

他们放弃 Electron 的理由很清楚：Raycast 深度依赖 OS 能力，比如 global hotkeys、clipboard、accessibility APIs、window management、不抢焦点的 floating panels、细粒度 translucency。Electron 能做一部分，但 web/native 边界会变痛，macOS 上也不想为了 WebView 自带 Chromium。

他们放弃 Tauri 的理由也很直白：native side 控制不够，当时成熟度不足，不想把公司压上去。

官方自己也承认：这个选择要自己维护 Electron 已经给你的那堆基础设施，比如 WebView/native/Node 的 IPC、调试、优化、跨平台差异。对大多数桌面 app，这个成本不划算。Raycast 特殊在它需要同时拥有 web 迭代速度和 native OS 控制权。

## 为什么 Windows 迫使它换底

### 1. 两套 native UI 不可持续

如果 Raycast 为 macOS 继续 Swift/AppKit，再为 Windows 单独写 WinUI/WPF 原生 UI，就会变成两套前端。

问题是 Raycast 的大部分产品价值已经在 UI 和 extension surface 里。两套 UI 意味着：

- 新功能要做两遍
- extension 表达层要对齐两遍
- AI Chat / Notes / Settings / Launcher 的细节要长期同步
- 团队速度会被平台差异拖死

官方说得很直接：大部分代码是 UI，只共享 backend 不够。

### 2. Windows 原生 UI 框架风险太高

官方对 Windows UI 框架的评价很冷：WPF、UWP、WinUI 3 历史复杂，WinUI 3 还年轻，不够 battle-tested。对一个对动画、窗口、输入、原生感极敏感的 launcher，这个风险太高。

所以他们没有选择「Windows 上纯 native」，而是选择 C# / WPF 做 native shell，UI 层交给 WebView2 + React。

### 3. Windows 文件搜索没有可依赖的 Spotlight

macOS v1 时代，Raycast file search 依赖 Spotlight metadata。但 Spotlight 有局限，Windows 又没有一个符合 Raycast 标准的系统级索引。

所以 v2 自研 Rust file indexer：

- 独立进程
- 直接扫描 filesystem
- 用 file system events 保持更新
- Windows 上为了性能，专门绕过常规 NTFS 遍历，直接读 Master File Table

这也是 X/Twitter 技术转述里最容易被拿出来讲的点：MFT direct scan 让全盘索引从分钟级变成秒级。

## 这波 Twitter / 社区讨论在讲什么

我能稳妥确认的是：可检索到的 X/Twitter 转述，大多围绕官方 technical deep dive 做压缩和再叙事。由于 X 原帖检索稳定性差，我不把单条帖子的情绪当事实依据，只把它们当传播侧信号。

中文圈比较常见的总结重点是：

- Raycast 从纯原生 Swift/AppKit 转向 hybrid architecture
- 混合栈是 TypeScript + Swift + C# + Rust + Node + React
- Raycast 没走 Electron，而是自研 native shell + WebView
- Windows 兼容牵动的不只是 port，还有 extension/runtime/API 的跨平台化
- Rust file indexer 和 NTFS Master File Table 是技术亮点
- 代价是内存上升和系统复杂度上升

例如 TwStalker 搜索结果里能看到对 X/Twitter 讨论的中文转述：Raycast 2.0 是 2020 年首发后最大一次重写，从 Swift/AppKit 转向混合架构；自研 Rust indexer 在 Windows 上读 MFT 做秒级索引。这类帖的主要价值是把官方长文压缩成工程师容易转发的叙事。

来源：[TwStalker 搜索结果 / @shao__meng profile 摘要](https://www6.twstalker.com/shao__meng)

Reddit 讨论更偏用户侧：

- 有人问 v2 是否更差，能否 downgrade
- 有人指出 v2 和 v1 并存
- 有人遇到 custom extensions、hotkeys、welcome screen、proxy 等 beta 问题
- 有人注意到 macOS 26 Tahoe requirement
- 有 Windows 用户困惑：技术文说 2.0 双平台，但 Windows 页面显示的是 v0.60.x beta

这说明用户侧的真实感受不会停在「重写很酷」上。真正打到人的，是新架构带来的迁移、缺功能、热键、扩展兼容、版本命名这些摩擦。

来源：[Reddit: Raycast v2 (Beta) is out now](https://www.reddit.com/r/raycastapp/comments/1tculxb/raycast_v2_beta_is_out_now/)、[Reddit: Product vs Platform Dilemma](https://www.reddit.com/r/raycastapp/comments/1tdqoln/the_product_vs_platform_dilemma_expressing_my/)

## 关键 trade-off

### 得到的东西

1. One team, two platforms

大部分产品工作发生在 Web frontend 和 Node backend。一个 feature 可以同时服务 macOS 和 Windows。

2. 开发速度

官方强调 hot reload 让 UI 改动一秒内可见，不再需要重新编译 Swift target、重启 app。

3. 招人和组织能力

React / TypeScript / Node 人才池远大于深 AppKit 工程师。Raycast 仍需要原生工程师，但多数产品工作不再依赖稀缺平台专家。

4. 更适合 AI Chat / Notes 这类富文本产品

markdown、code block、rich text editing、复杂布局、动画这些，Web stack 更成熟。

5. Extension 和内部产品栈统一

Raycast extension 本来就是 React / TypeScript / Node。现在 app 本身大量转向同一套栈，内部功能开发和 extension 开发更接近。

### 付出的东西

1. 内存基线变高

官方给的数字：v1 常见 200-300 MB；v2 类似场景 350-450 MB。主要成本来自 WebView 和 Node backend。

2. 栈复杂度变高

Swift / C#、Node、WebView、Rust 四套 runtime。一个 bug 可能穿过 React、IPC、Node、Rust。

3. Windows 变量更多

不同 OS 版本、硬件、显示器、WebView2 版本都会引入测试面。

4. 原生小细节要自己补

AppKit 免费提供的 accessibility、drag/drop、IME、窗口行为，在 WebView 里都要显式处理。

5. 冷启动 / window teardown 的平衡更难

为了控制内存，v2 会更积极地释放 inactive windows，因此 AI Chat / Notes 冷打开可能有短延迟。

## 我的判断

Raycast 这次重构真正说明一件事：

桌面 AI / launcher 产品的核心矛盾，比 native vs web 更深一层：

> 你既要靠近操作系统，又要像 web 产品一样快速迭代和跨平台分发。

纯 native 赢在手感和 OS 控制，但平台扩张慢，团队组织成本高。  
Electron 赢在速度和生态，但对 Raycast 这种 OS-integrated launcher 来说，控制感和资源成本不够理想。  
Raycast 选择自研 hybrid stack，本质是在买一件东西：产品边界的控制权。

这条路很贵。

它要自己维护四层 runtime、typed IPC、WebView 行为修补、Rust indexer、跨平台 extension API。普通桌面应用不该学。官方也没鼓励别人学。

但 Raycast 可以学，因为它的产品要求太特殊：

- 它必须每次弹出都快
- 它必须不抢焦点
- 它必须像系统原生窗口一样行为正确
- 它必须控制 clipboard / hotkeys / accessibility / windows
- 它必须让 extension 和 AI tool 进入同一套操作语法
- 它又必须去 Windows，不能永远困在 Mac developer niche

所以，用「技术炫技」解释这次重构太轻了。

它更像一个产品扩张期必须付的架构税。

## 对 Openwork / agent launcher 的启发

1. 如果目标是跨平台，早期就要定义 extension API 的平台边界

Raycast 没等 Windows 完成后再想 extension 兼容。它先改 manifest、shortcut、preferences、utils、PowerShell。跨平台不能只看 UI 是否编译通过，还要看开发者生态能不能判断某个能力在哪个平台成立。

2. Root search 的角色已经超过搜索框

Raycast 把 files / folders / contacts 放进 Root Search，意义不只是少一个命令。它在把「用户先想 action」这件事继续推进。

3. 文件索引是 launcher 的基础设施

Windows 上做 launcher，不能假设系统索引够用。Raycast 自研 Rust indexer，说明 file search 是入口产品的核心 trust surface。找不到文件，launcher 的可信度会直接掉。

4. AI 进入 launcher 后，产品会从 command router 走向 context router

Quick AI、AI Chat、memory、profile、skills 加在一起，Raycast 不只是让你启动命令，而是开始理解你的上下文和偏好。这会让 launcher 和 agent runtime 的边界越来越模糊。

5. 但 Raycast 仍然主要赢在 invocation moment

v2 强化了「叫出动作」的能力，但没有把长时间 agent run 的 evidence / approval / replay 做成核心产品。复杂软件委托仍然需要另一种 harness。

这也是我们之前那句话仍然成立：

> Raycast 赢在 invocation moment；Openwork 应该赢在 delegated work lifetime。

## 需要继续跟踪的问题

1. Windows v0.60.x beta 和 Raycast 2.0 品牌/代码线如何最终统一。
2. v2 GA 时内存能否从 350-450 MB 继续下降。
3. custom extensions / hotkeys / migration 的 beta 痛点是否快速收敛。
4. AI Chat 的 Skills / memory 会不会让 Raycast 从 launcher 进一步变成 agent host。
5. Windows extension ecosystem 的实际迁移速度，而不是官方说的「多数可跨平台」。

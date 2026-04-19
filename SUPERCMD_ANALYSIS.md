# SuperCmd 最近 60 次 Commit 分析

**分析时间**: 2026-04-19  
**分析范围**: 最近 60 次 commit（从 a15b7e2 到 fbc519c）  
**时间跨度**: 约 2 个月（2026-02 到 2026-04）

---

## 核心发现

SuperCmd 是一个 **macOS launcher/command palette**（类似 Raycast、Alfred），最近的开发重点是：

1. **Extension 系统完善** - 核心功能
2. **Raycast 兼容性** - 生态互通
3. **系统级集成** - 剪贴板、快捷键、系统命令
4. **AI 集成** - Claude 相关功能
5. **性能优化** - 多显示器、内存管理

---

## 功能模块分析

### 1. Extension 系统（最重要）⭐⭐⭐⭐⭐

**相关 commit：**
- `e27094c` - Extension Store system command
- `0d58a38` - Run extensions with real Node
- `3b1c506` - Add deeplink copy (supercmd:// scheme)
- `06166e2` - Add deeplink copy functionality

**关键特性：**
```
Extension 支持：
├─ Raycast 兼容的 extension 格式
├─ 用 Node.js 运行 extension
├─ Deeplink 支持（supercmd://extensions/<owner>/<ext>/<cmd>）
├─ Extension Store 系统命令
└─ 快速启动快捷键（Cmd+1-9）
```

**技术细节：**
- Extension 可以生成 deeplink，用户可以分享
- 支持 `supercmd://` 和 `raycast://` 两种协议（向后兼容）
- Extension 在真实的 Node.js 环境中运行（不是沙箱）

### 2. 剪贴板管理系统 ⭐⭐⭐⭐

**相关 commit：**
- `d0b5682` - Fixes for clipboard image copy
- `d7f52e5` - Copying now uses Swift
- `1a54545` - Clipboard history quick-paste (Cmd+1-9)
- `e65c59f` - Updated snippet and clipboard

**关键特性：**
```
剪贴板功能：
├─ 剪贴板历史记录
├─ 快速粘贴（Cmd+1-9）
├─ 图片复制支持
├─ 用 Swift 实现（性能优化）
└─ 快速复制 deeplink
```

**技术细节：**
- 用 Swift 处理系统级剪贴板操作（比 JavaScript 快）
- 支持图片和文本
- 集成到 launcher 的快速操作

### 3. 快捷键和别名系统 ⭐⭐⭐

**相关 commit：**
- `32fea3b` - Display alias badge and hotkey shortcut
- `e5ff1d4` - Don't add + between modifier keys
- `a71ba20` - Support aliases in quick link search
- `d93e15b` - Fixed the hotkey for f not being set

**关键特性：**
```
快捷键系统：
├─ 别名支持（同一个命令多个名字）
├─ 快捷键显示和管理
├─ 快速启动（Cmd+1-9）
├─ 修饰键处理（Cmd、Shift、Ctrl、Option）
└─ 别名徽章显示
```

### 4. AI 集成 ⭐⭐⭐

**相关 commit：**
- `257f8c9` - AI prompt clipboard snippet
- `2ee1bed` - Fixed persistent inline prompt
- `d24020c` - Remove blur-to-hide on inline AI prompt
- `3b1c506` - Claude deeplink copy

**关键特性：**
```
AI 功能：
├─ 内联 AI prompt 窗口
├─ 剪贴板 snippet 支持
├─ Claude 集成
└─ Deeplink 支持分享 prompt
```

### 5. 系统命令集成 ⭐⭐⭐

**相关 commit：**
- `8e13fe5` - Add system actions (Sleep, Restart, Lock Screen, Log Out)
- `9f11eca` - Fixed lock screen, added empty trash
- `a3b1539` - Add close all apps shortcut
- `1caaceb` - Toggle System Appearance and Shutdown

**关键特性：**
```
系统命令：
├─ Sleep / Restart / Shutdown
├─ Lock Screen / Log Out
├─ Close All Apps
├─ Toggle System Appearance
├─ Empty Trash
└─ 用 Swift 实现（系统级权限）
```

### 6. 计算器集成（Soulver）⭐⭐

**相关 commit：**
- `9e13a22` - Soulver LFG!! (新的计算器)

**关键特性：**
```
从自己的 smart-calculator 迁移到 Soulver
├─ 用 Swift 实现
├─ 更强大的计算能力
├─ 减少 JavaScript 代码（1061 行 → 161 行）
└─ 性能更好
```

### 7. 其他优化

**多显示器支持：**
- `60e29f7` - Multi monitor fix

**本地化：**
- `3d1933b` - Improve Korean locale quality

**性能优化：**
- `ee67fe7` - Persist launcher position + drag on all views
- `231ab11` - Reduce hover highlight opacity

**安全性：**
- `0adf6ff` - Remove unused keylogger and pre-compiled binary
- `108bac9` - Added MIT license

---

## 开发模式分析

### 提交频率

```
最近 60 次 commit 跨度：约 2 个月
平均每周：7-8 次 commit
模式：频繁的小改动 + 定期的大功能
```

### 提交类型分布

```
功能新增（feat）：    30%
Bug 修复（fix）：     50%
性能优化（perf）：    10%
文档/其他：           10%
```

### 开发节奏

```
高频迭代：
- 每天 1-2 次 commit
- 快速响应用户反馈
- 小步快跑

大功能周期：
- Extension Store（1 commit）
- Soulver 计算器（1 commit，但改动很大）
- Deeplink 支持（多个 commit）
```

---

## 技术栈选择

### 前端
- **Electron** - 跨平台桌面应用
- **React** - UI 框架
- **TypeScript** - 类型安全

### 后端/系统集成
- **Swift** - 系统级操作（剪贴板、快捷键、系统命令）
- **Node.js** - Extension 运行时

### 关键决策

**为什么用 Swift？**
```
JavaScript 的问题：
- 系统级操作性能差
- 权限管理复杂
- 剪贴板操作不稳定

Swift 的优势：
- 原生系统 API
- 性能好
- 权限管理清晰
- 代码量少（1061 行 → 161 行）
```

**为什么支持 Raycast 兼容？**
```
生态互通：
- 用户可以用 Raycast extension
- 用户可以分享 supercmd:// deeplink
- 降低迁移成本
```

---

## 对 OpenWork 的启示

### 1. Extension 系统是核心 ✅

SuperCmd 的最大投入就是 Extension 系统。这验证了我们的方向是对的。

**学习点：**
- Extension 需要支持 deeplink（可分享）
- Extension 需要支持别名和快捷键
- Extension 需要在真实的 Node.js 环境运行

### 2. Raycast 兼容性很重要 ✅

SuperCmd 支持 Raycast extension，这让用户可以复用生态。

**对 OpenWork 的启示：**
```
我们可以：
├─ 支持 Raycast extension 格式
├─ 生成 supercmd:// deeplink
├─ 让用户分享命令
└─ 建立自己的生态
```

### 3. 系统级集成有价值 ✅

剪贴板、快捷键、系统命令这些功能很受欢迎。

**对 OpenWork 的启示：**
```
企业场景中：
├─ 剪贴板集成（复制结果）
├─ 快捷键支持（快速触发）
├─ 系统命令（Sleep、Restart 等）
└─ 都是有价值的
```

### 4. 用 Swift 处理系统操作 ✅

不要用 JavaScript 做系统级操作，用 Swift/Objective-C。

**对 OpenWork 的启示：**
```
关键操作用 Swift：
├─ 剪贴板操作
├─ 快捷键注册
├─ 系统命令执行
└─ 性能和稳定性都更好
```

### 5. Deeplink 支持让命令可分享 ✅

`supercmd://extensions/owner/ext/cmd` 这样的 deeplink 让用户可以分享命令。

**对 OpenWork 的启示：**
```
我们可以支持：
├─ openwork://tools/salesforce/create-lead
├─ openwork://workflows/daily-report
└─ 用户可以分享和收藏
```

---

## 可以直接复刻的地方

### 1. Deeplink 格式

```
SuperCmd: supercmd://extensions/<owner>/<ext>/<cmd>
OpenWork: openwork://tools/<extension>/<tool>
          openwork://workflows/<workflow-name>
```

### 2. Extension 快捷键

```
Cmd+1-9: 快速启动前 9 个命令
Cmd+Shift+L: 复制 deeplink
Cmd+F: 聚焦搜索框
```

### 3. 别名系统

```
同一个命令可以有多个名字：
- "Create Issue" 也可以叫 "New Issue"
- "Search Repos" 也可以叫 "Find Repo"
```

### 4. 系统命令集成

```
内置系统命令：
├─ Sleep
├─ Restart
├─ Lock Screen
├─ Close All Apps
└─ Empty Trash
```

---

## 不需要复刻的地方

### 1. Soulver 计算器

- 这是 macOS 特定的
- OpenWork 是企业工具，不需要计算器

### 2. 菜单栏集成

- SuperCmd 有菜单栏通知（GitHub notifications）
- OpenWork 的审批流程不需要这个

### 3. 剪贴板历史

- 这是个人工具的功能
- 企业场景中不是核心需求

---

## 建议的 OpenWork 架构（基于 SuperCmd 学习）

```
OpenWork Extension System
├── Extension 定义（YAML）
│   ├─ 工具定义
│   ├─ 参数 schema
│   ├─ 凭证配置
│   └─ Deeplink 支持
├── Extension 编译（esbuild）
│   ├─ 编译 TypeScript
│   ├─ 生成 SKILL.md
│   └─ 输出 .openwork 包
├── Extension 运行
│   ├─ 在真实 Node.js 环境运行
│   ├─ 支持 deeplink 调用
│   └─ 支持别名和快捷键
├── 系统集成（Swift）
│   ├─ 剪贴板操作
│   ├─ 快捷键注册
│   └─ 系统命令执行
└── Deeplink 支持
    ├─ openwork://tools/<ext>/<tool>
    ├─ openwork://workflows/<name>
    └─ 用户可分享和收藏
```

---

## 总结

**SuperCmd 的成功因素：**
1. ✅ 强大的 Extension 系统
2. ✅ Raycast 兼容性（生态互通）
3. ✅ 系统级集成（剪贴板、快捷键）
4. ✅ 频繁迭代和优化
5. ✅ 用户体验优先

**对 OpenWork 的启示：**
1. Extension 系统确实是核心竞争力
2. Raycast 兼容性值得考虑
3. 系统级集成有价值
4. Deeplink 支持让命令可分享
5. 快速迭代很重要

**下一步建议：**
1. 确认 Extension 编译系统的设计
2. 考虑 Raycast 兼容性
3. 设计 Deeplink 格式
4. 实现第一个 extension（HTTP API）


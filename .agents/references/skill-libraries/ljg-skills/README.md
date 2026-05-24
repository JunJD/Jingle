# ljg-skills

我的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 自定义技能集。

## 技能

| 技能 | 说明 |
|------|------|
| **ljg-card** | 内容铸卡 — 将内容转为 PNG 视觉卡片（长图、信息图、海报）。信息图模式会根据内容密度、结构和情绪自动生成独特的视觉构图，没有固定模板，形式服务于内容。 |
| **ljg-learn** | 概念解剖 — 从八个方向切开一个概念（历史、辩证、现象、语言、形式、存在、美感、元反思），最后压成一句顿悟。输出 org-mode 文件。 |
| **ljg-paper** | 论文阅读器 — 为非学术人士提取论文中的想法，重理解不重批判 |
| **ljg-plain** | 白话引擎 — 把任何内容改写到聪明的十二岁小孩也能懂 |
| **ljg-rank** | 降秩引擎 — 给一个领域，找出背后真正撑着它的几根独立的力。现象砍到不可再少的生成器，砍完能把现象一个个生回来，才算数。 |
| **ljg-x-download** | X 媒体下载 — 将 X/Twitter 帖子中的图片和视频下载到 ~/Downloads |
| **ljg-skill-map** | 技能地图 — 扫描所有已安装技能，渲染可视化总览 |
| **ljg-word** | 英语单词精通 — 深度拆解一个英语单词的核心语义和顿悟时刻 |
| **ljg-writes** | 写作引擎 — 带着一个观点出发，在写的过程中把它想透 |
| **ljg-relationship** | 关系分析 — 融合五层结构诊断（交换/权力/边界/阶段/叙事）与精神分析方法（移情/无意识/阻抗），通过对话引导帮用户"看见"关系问题的真实结构。不给建议，只提问。 |
| **ljg-roundtable** | 圆桌讨论 — 以求真为目标的结构化多人辩证对话框架，主持人引导真实历史/当代人物进行多轮深度交锋，每轮生成 ASCII 思考框架图，最终输出知识网络。 |
| **ljg-travel** | 旅行研究 — 输入城市名，自动生成深度文化研究文档（org-mode）+ 便携卡片（PNG）。覆盖历史分层、博物馆重点、古建看点、考古发现，方法论借鉴考古学案头研究（DBA）。 |

## 工作流

工作流将多个技能串联为一个命令。

| 工作流 | 技能链 | 说明 |
|--------|--------|------|
| **ljg-paper-flow** | ljg-paper → ljg-card | 读论文 + 做卡片一气呵成 |
| **ljg-word-flow** | ljg-word → ljg-card -i | 单词深度分析 + 信息图卡片一气呵成 |
| **ljg-travel** | Research → ContentAnalysis → ljg-card | 城市文明研究 + org文档 + 便携卡片一气呵成 |

## 安装

```bash
git clone https://github.com/lijigang/ljg-skills.git ~/.claude/plugins/ljg-skills
```

然后重启 Claude Code。

### ljg-card 依赖

`ljg-card` 需要 Playwright 来截图：

```bash
cd ~/.claude/plugins/ljg-skills && bash scripts/install.sh
```

或手动安装：

```bash
cd ~/.claude/plugins/ljg-skills/skills/ljg-card && npm install && npx playwright install chromium
```

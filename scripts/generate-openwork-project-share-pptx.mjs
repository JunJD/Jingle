import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputPath = join(rootDir, "docs", "openwork-project-share.pptx")
const buildDir = join(rootDir, "docs", ".openwork-project-share-pptx-build")
const logoSource = join(rootDir, "resources", "icon.png")

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  ep: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
}

const SLIDE_W = 13.333
const SLIDE_H = 7.5
const EMU = 914400

const C = {
  bg: "0F1217",
  bg2: "111827",
  panel: "171C24",
  panel2: "202733",
  line: "313A49",
  text: "F5F7FA",
  muted: "A7B0BE",
  faint: "697386",
  red: "FF4B4B",
  red2: "B8212D",
  blue: "4AA8FF",
  green: "3DDC97",
  yellow: "F2C94C",
  orange: "FF9F43",
  purple: "A78BFA"
}

const slides = [
  {
    title: "Openwork",
    eyebrow: "项目分享",
    body:
      "面向非程序员的 harness-first 桌面 Agent：把软件工作交给 AI，同时保留可见、可控、可恢复的执行边界。",
    source: "README.md / docs/product-narrative.md",
    shapes: [
      image(0.86, 0.74, 0.72, 0.72),
      text(0.82, 1.68, 8.3, 0.58, "Openwork", {
        bold: true,
        color: C.text,
        size: 48
      }),
      text(0.86, 2.42, 8.7, 1.1, [
        {
          text:
            "一个 harness-first 的受控执行系统，而不是“带工具的聊天框”。用户能发起任务、观察进展、审批风险动作、查看产物，并在 Agent 错误时恢复。"
        }
      ], {
        color: C.muted,
        lineSpacing: 1.1,
        size: 24
      }),
      rect(0.86, 4.18, 3.55, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Controlled execution",
        textColor: C.text,
        textSize: 19
      }),
      rect(4.62, 4.18, 3.55, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Human approval",
        textColor: C.text,
        textSize: 19
      }),
      rect(8.38, 4.18, 3.55, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Persistent run visibility",
        textColor: C.text,
        textSize: 19
      }),
      text(0.86, 6.28, 8.0, 0.42, "分享目标：用 20 分钟讲清楚产品为什么存在、核心工作流是什么、工程架构如何支撑它。", {
        color: C.faint,
        size: 12
      })
    ]
  },
  {
    title: "为什么需要 Openwork",
    eyebrow: "用户问题",
    body: "目标用户不是开发者，但他们确实需要软件工作被完成：创始人、运营、设计师、研究者、领域专家。",
    source: "docs/product-narrative.md",
    shapes: [
      sectionTitle("为什么需要 Openwork", "用户问题"),
      text(0.86, 1.42, 6.1, 0.9, "当下多数 coding-agent 产品把非程序员夹在两个失败模式之间：", {
        color: C.muted,
        size: 22
      }),
      rect(0.86, 2.7, 5.65, 2.18, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      text(1.18, 2.98, 4.9, 0.42, "强，但黑箱", {
        bold: true,
        color: C.red,
        size: 24
      }),
      bulletList(1.18, 3.56, 4.95, 0.98, ["Agent 在行动，但用户看不懂发生了什么", "风险动作、等待事项、恢复路径不清晰"], {
        color: C.muted,
        size: 15
      }),
      rect(6.82, 2.7, 5.65, 2.18, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      text(7.14, 2.98, 4.9, 0.42, "安全，但很弱", {
        bold: true,
        color: C.yellow,
        size: 24
      }),
      bulletList(7.14, 3.56, 4.95, 0.98, ["退化成聊天框、表单工具或玩具 workflow", "无法承接真实软件工作"], {
        color: C.muted,
        size: 15
      }),
      rect(2.3, 5.62, 8.75, 0.88, {
        fill: C.bg2,
        line: C.red,
        radius: true,
        text: "Openwork 要解决的不是“让 Agent 更自主”，而是让委托变得可控、可审计、可恢复。",
        textColor: C.text,
        textSize: 17
      })
    ]
  },
  {
    title: "产品判断",
    eyebrow: "核心论点",
    body:
      "Openwork 不靠拥有模型入口取胜，而是拥有低层 Agent 行为与人类判断之间的控制面。",
    source: "docs/product-narrative.md",
    shapes: [
      sectionTitle("产品判断", "核心论点"),
      text(0.86, 1.35, 11.5, 0.8, "Openwork 是一个 controlled execution system：", {
        color: C.text,
        bold: true,
        size: 26
      }),
      text(0.86, 2.08, 11.2, 0.72, "用户交付一个软件目标，系统把它变成有边界、有审批点、有证据链的执行单元。", {
        color: C.muted,
        size: 20
      }),
      rect(1.0, 3.2, 3.15, 1.28, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Agent execution",
        textColor: C.text,
        textSize: 21
      }),
      rect(5.1, 3.2, 3.15, 1.28, {
        fill: C.panel,
        line: C.red,
        radius: true,
        text: "Harness control",
        textColor: C.text,
        textSize: 21
      }),
      rect(9.2, 3.2, 3.15, 1.28, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Human judgment",
        textColor: C.text,
        textSize: 21
      }),
      line(4.15, 3.84, 0.74, C.faint),
      line(8.25, 3.84, 0.74, C.faint),
      text(1.06, 5.34, 10.8, 0.76, "必须让用户始终知道：Agent 想做什么、已经做了什么、改动了什么、需要我批准什么、如何中断/恢复/重试。", {
        color: C.muted,
        size: 20
      })
    ]
  },
  {
    title: "Hero Workflow",
    eyebrow: "用户视角",
    body: "完整体验不是一段聊天，而是一条可追踪的工作流。",
    source: "docs/product-narrative.md",
    shapes: [
      sectionTitle("Hero Workflow", "用户视角"),
      workflow([
        ["1", "提出目标", "用户描述一个具体软件目标"],
        ["2", "生成工作单元", "Openwork 绑定 workspace、thread、run"],
        ["3", "计划并执行", "Agent 使用工具、产出事件流"],
        ["4", "风险审批", "危险或模糊动作停下来等待用户"],
        ["5", "查看证据", "进展、产物、文件变化、审批状态可见"],
        ["6", "结束或恢复", "结果可复查、可恢复、可重新进入"]
      ]),
      text(0.95, 6.36, 11.5, 0.44, "判断一个新功能是否值得做：它是否让这个循环更清楚、更可控、更容易恢复。", {
        color: C.faint,
        size: 13
      })
    ]
  },
  {
    title: "系统分层",
    eyebrow: "工程边界",
    body: "产品可控性的前提，是每一层只拥有自己该拥有的状态。",
    source: "docs/engineering-boundaries.md",
    shapes: [
      sectionTitle("系统分层", "工程边界"),
      layer(0.9, 1.32, 2.18, "Launcher", "入口、搜索、路由、恢复当前任务", C.blue),
      layer(0.9, 2.28, 2.18, "Ambient surfaces", "菜单栏 / sentinel：压缩展示运行状态", C.green),
      layer(0.9, 3.24, 2.18, "Renderer feature runtimes", "ai-core、extension-host、launcher-components", C.yellow),
      layer(0.9, 4.2, 2.18, "Main process runtime & services", "Agent 执行、窗口服务、搜索、guardrails", C.red),
      layer(0.9, 5.16, 2.18, "Harness persistence", "threads、runs、HITL、artifacts、checkpoints", C.purple),
      rect(7.62, 1.48, 4.82, 4.38, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      text(7.98, 1.82, 4.15, 0.42, "关键约束", {
        bold: true,
        color: C.text,
        size: 24
      }),
      bulletList(7.98, 2.48, 4.0, 2.42, [
        "Launcher 是入口 shell，不拥有长期 run truth",
        "Main process 是 durable execution state 的权威来源",
        "Extension 只能通过稳定 host API 接入",
        "Renderer 不发明本该持久化的真实状态"
      ], {
        color: C.muted,
        size: 15
      })
    ]
  },
  {
    title: "Main Process 是执行真相",
    eyebrow: "架构落点",
    body: "Electron 主进程组合 IPC、窗口、runtime、持久化和服务模块，是可恢复执行的边界层。",
    source: "src/main/composition-root.ts / src/main/agent/service.ts",
    shapes: [
      sectionTitle("Main Process 是执行真相", "架构落点"),
      codePanel(0.82, 1.48, 5.74, 4.84, [
        "MainCompositionRoot",
        "├─ registerAgentIpcHandlers",
        "├─ registerArtifactsIpcHandlers",
        "├─ registerLauncherIpcHandlers",
        "├─ registerModelProviderIpcHandlers",
        "├─ registerThreadsIpcHandlers",
        "└─ registerExtensionRuntimeIpcHandlers"
      ]),
      rect(7.05, 1.48, 5.42, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "运行开始：beginAgentRun 持久化 Run，并向 renderer 发 run_started",
        textColor: C.text,
        textSize: 16
      }),
      rect(7.05, 2.95, 5.42, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "流式执行：stream chunks 被投影后通过 IPC 发送",
        textColor: C.text,
        textSize: 16
      }),
      rect(7.05, 4.42, 5.42, 1.2, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "收束状态：success / interrupted / error / aborted 归入 durable state",
        textColor: C.text,
        textSize: 16
      })
    ]
  },
  {
    title: "Agent Runtime",
    eyebrow: "执行引擎",
    body:
      "Openwork 基于 deepagents / LangChain / LangGraph，把工具能力、guardrails、审批和 checkpoint 组合成一个可控 runtime。",
    source: "src/main/agent/runtime.ts",
    shapes: [
      sectionTitle("Agent Runtime", "执行引擎"),
      pipeline(0.78, 1.52, [
        ["Model", "Anthropic / OpenAI / Google", C.blue],
        ["Workspace", "LocalSandbox + filesystem tools", C.green],
        ["Middleware", "todos / artifacts / web / desktop automation", C.yellow],
        ["Extensions", "native extension source tools", C.orange],
        ["Guardrails", "mutation prediction + command classification", C.red],
        ["Approval", "tool approval middleware + HITL", C.purple],
        ["Checkpoint", "PrismaCheckpointSaver", C.blue]
      ]),
      text(0.9, 5.72, 11.7, 0.78, "工程重点：不是把工具简单塞给模型，而是在工具调用前后建立权限、审批、序列化、产物展示和恢复语义。", {
        color: C.muted,
        size: 19
      })
    ]
  },
  {
    title: "审批不是摩擦，是信任基础设施",
    eyebrow: "安全模型",
    body:
      "危险或模糊动作必须在执行前停下来，并把用户决策绑定到具体 tool call。",
    source: "docs/runtime-invariants.md / src/main/agent/service.ts",
    shapes: [
      sectionTitle("审批不是摩擦，是信任基础设施", "安全模型"),
      rect(0.86, 1.42, 3.65, 1.42, {
        fill: C.panel,
        line: C.red,
        radius: true,
        text: "Before execution",
        textColor: C.text,
        textSize: 22
      }),
      rect(4.86, 1.42, 3.65, 1.42, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Persist HITL",
        textColor: C.text,
        textSize: 22
      }),
      rect(8.86, 1.42, 3.65, 1.42, {
        fill: C.panel,
        line: C.line,
        radius: true,
        text: "Resume by decision",
        textColor: C.text,
        textSize: 22
      }),
      line(4.5, 2.12, 0.32, C.faint),
      line(8.5, 2.12, 0.32, C.faint),
      bulletList(1.05, 3.38, 5.12, 1.75, [
        "approve / reject / edit 是显式决策",
        "request_id 和 tool_call_id 负责把 UI 审批与真实执行关联",
        "renderer 刷新或重新打开后，pending approval 仍可找回"
      ], {
        color: C.muted,
        size: 16
      }),
      codePanel(6.66, 3.12, 5.44, 2.42, [
        "HitlRequest",
        "request_id",
        "thread_id",
        "run_id",
        "tool_call_id",
        "allowed_decisions",
        "status = pending | approved | rejected"
      ])
    ]
  },
  {
    title: "持久化就是 Harness",
    eyebrow: "数据模型",
    body:
      "SQLite + Prisma 记录的不是后台细节，而是用户能复查、恢复、继续执行的证据链。",
    source: "prisma/schema.prisma / docs/runtime-invariants.md",
    shapes: [
      sectionTitle("持久化就是 Harness", "数据模型"),
      dataModel(),
      text(0.92, 6.18, 11.5, 0.52, "这套数据模型服务于一个产品承诺：run 不只是一次临时请求，而是一段可审计、可恢复的软件工作记录。", {
        color: C.faint,
        size: 14
      })
    ]
  },
  {
    title: "Launcher 与 Extension",
    eyebrow: "入口与生态",
    body:
      "Launcher 负责启动和回到任务；Extension 是集成能力，不应该反过来重塑核心工作流。",
    source: "src/renderer/src/launcher-shell/LauncherApp.tsx / src/extensions/github/manifest.ts",
    shapes: [
      sectionTitle("Launcher 与 Extension", "入口与生态"),
      rect(0.86, 1.48, 5.5, 4.22, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      text(1.18, 1.82, 4.82, 0.42, "Launcher owns", {
        bold: true,
        color: C.blue,
        size: 24
      }),
      bulletList(1.18, 2.46, 4.78, 2.26, [
        "show / hide",
        "home search input and result selection",
        "打开内置命令或 extension command",
        "返回历史和当前工作"
      ], {
        color: C.muted,
        size: 16
      }),
      rect(6.96, 1.48, 5.5, 4.22, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      text(7.28, 1.82, 4.82, 0.42, "Extension contributes", {
        bold: true,
        color: C.green,
        size: 24
      }),
      bulletList(7.28, 2.46, 4.78, 2.26, [
        "稳定 runtime API：List / Form / Detail / AI / MenuBar",
        "manifest 声明 capabilities、preferences、commands",
        "GitHub、Reminders、Translate、Todo 等集成",
        "view / no-view / menu-bar 等命令形态"
      ], {
        color: C.muted,
        size: 16
      })
    ]
  },
  {
    title: "一次分享该怎么演示",
    eyebrow: "讲解路径",
    body:
      "最好的演示不是展示功能清单，而是走完一个受控软件工作单元。",
    source: "建议 demo flow",
    shapes: [
      sectionTitle("一次分享该怎么演示", "讲解路径"),
      timeline([
        ["01", "选 workspace", "强调 Agent 的执行边界从工作目录开始"],
        ["02", "输入一个具体软件目标", "让需求进入 thread/run，而不是散落在聊天里"],
        ["03", "观察计划和执行流", "展示 todos、tool events、文件读写、产物"],
        ["04", "触发一次审批", "解释为什么审批发生在执行前"],
        ["05", "查看结果与历史", "展示 artifacts、run status、恢复入口"]
      ]),
      rect(8.55, 5.55, 3.62, 0.84, {
        fill: C.bg2,
        line: C.green,
        radius: true,
        text: "演示结论：用户没有把控制权交出去，只是把执行劳动委托出去。",
        textColor: C.text,
        textSize: 15
      })
    ]
  },
  {
    title: "判断项目进展的标准",
    eyebrow: "What matters",
    body:
      "Openwork 的核心指标不是有多少 surface，而是每一次委托是否更清楚、更可控、更可恢复。",
    source: "docs/product-narrative.md / docs/engineering-boundaries.md",
    shapes: [
      sectionTitle("判断项目进展的标准", "What matters"),
      scorecard(),
      text(0.92, 6.05, 11.4, 0.66, "当前方向：构建一个安全、可控的软件 Agent，让每次 run 都成为可检查的工作单元，用户永远不会失去理解和介入的能力。", {
        color: C.text,
        bold: true,
        size: 18
      })
    ]
  },
  {
    title: "附：源码锚点",
    eyebrow: "Reference",
    body: "后续讲解、代码走读或 demo 可以从这些文件进入。",
    source: "local repository",
    shapes: [
      sectionTitle("附：源码锚点", "Reference"),
      codePanel(0.86, 1.42, 5.75, 4.94, [
        "产品叙事",
        "docs/product-narrative.md",
        "docs/engineering-boundaries.md",
        "docs/runtime-invariants.md",
        "",
        "主进程与 runtime",
        "src/main/composition-root.ts",
        "src/main/agent/service.ts",
        "src/main/agent/runtime.ts",
        "src/main/agent/persistence.ts"
      ]),
      codePanel(6.92, 1.42, 5.52, 4.94, [
        "界面与扩展",
        "src/renderer/src/launcher-shell/LauncherApp.tsx",
        "src/renderer/src/ai-core/LauncherAiPage.tsx",
        "src/renderer/src/extension-host",
        "src/extensions/runtime-api.ts",
        "src/extensions/github/manifest.ts",
        "",
        "持久化与验证",
        "prisma/schema.prisma",
        "tests/bdd"
      ])
    ]
  }
]

function sectionTitle(title, eyebrow) {
  return [
    text(0.82, 0.48, 3.6, 0.28, eyebrow.toUpperCase(), {
      bold: true,
      color: C.red,
      size: 10
    }),
    text(0.82, 0.76, 10.8, 0.54, title, {
      bold: true,
      color: C.text,
      size: 30
    })
  ]
}

function workflow(items) {
  const shapes = []
  const x0 = 0.72
  const y0 = 1.72
  const w = 3.85
  const h = 1.18
  const gapX = 0.35
  const gapY = 0.5
  items.forEach(([num, title, desc], idx) => {
    const row = Math.floor(idx / 3)
    const col = idx % 3
    const x = x0 + col * (w + gapX)
    const y = y0 + row * (h + gapY)
    shapes.push(
      rect(x, y, w, h, {
        fill: C.panel,
        line: idx === 3 ? C.red : C.line,
        radius: true
      }),
      rect(x + 0.22, y + 0.22, 0.45, 0.45, {
        fill: idx === 3 ? C.red : C.bg2,
        line: idx === 3 ? C.red : C.line,
        radius: true,
        text: num,
        textColor: C.text,
        textSize: 12
      }),
      text(x + 0.82, y + 0.2, w - 1.05, 0.34, title, {
        bold: true,
        color: C.text,
        size: 18
      }),
      text(x + 0.82, y + 0.58, w - 1.05, 0.38, desc, {
        color: C.muted,
        size: 12
      })
    )
  })
  return shapes
}

function layer(x, y, w, title, desc, accent) {
  return [
    rect(x, y, 6.1, 0.76, {
      fill: C.panel,
      line: C.line,
      radius: true
    }),
    rect(x, y, 0.12, 0.76, { fill: accent, line: accent }),
    text(x + 0.36, y + 0.13, 2.0, 0.28, title, {
      bold: true,
      color: C.text,
      size: 16
    }),
    text(x + 2.56, y + 0.13, 3.9, 0.28, desc, {
      color: C.muted,
      size: 12
    })
  ]
}

function pipeline(x, y, items) {
  const shapes = []
  const w = 1.62
  const h = 1.42
  const gap = 0.18
  items.forEach(([title, desc, accent], idx) => {
    const px = x + idx * (w + gap)
    shapes.push(
      rect(px, y, w, h, {
        fill: C.panel,
        line: accent,
        radius: true
      }),
      text(px + 0.16, y + 0.22, w - 0.32, 0.28, title, {
        bold: true,
        color: C.text,
        size: 15,
        align: "center"
      }),
      text(px + 0.16, y + 0.7, w - 0.32, 0.46, desc, {
        color: C.muted,
        size: 9,
        align: "center"
      })
    )
    if (idx < items.length - 1) {
      shapes.push(line(px + w + 0.02, y + h / 2, gap - 0.04, C.faint))
    }
  })
  return shapes
}

function dataModel() {
  const nodes = [
    ["Thread", 0.9, 1.64, C.blue, "会话与 checkpoint 容器"],
    ["Run", 4.0, 1.64, C.red, "一次执行生命周期"],
    ["HitlRequest", 7.1, 1.64, C.yellow, "审批状态"],
    ["Artifact", 10.2, 1.64, C.green, "用户可见产物"],
    ["Checkpoint", 2.46, 3.52, C.purple, "恢复状态"],
    ["SessionBinding", 5.92, 3.52, C.orange, "workspace 与 current thread"],
    ["CheckpointWrite", 9.38, 3.52, C.purple, "checkpoint writes"]
  ]
  const shapes = []
  nodes.forEach(([name, x, y, color, desc]) => {
    shapes.push(
      rect(x, y, 2.32, 1.1, { fill: C.panel, line: color, radius: true }),
      text(x + 0.18, y + 0.18, 1.96, 0.28, name, {
        bold: true,
        color: C.text,
        size: 15,
        align: "center"
      }),
      text(x + 0.18, y + 0.58, 1.96, 0.28, desc, {
        color: C.muted,
        size: 9,
        align: "center"
      })
    )
  })
  shapes.push(
    line(3.22, 2.18, 0.62, C.faint),
    line(6.32, 2.18, 0.62, C.faint),
    line(9.42, 2.18, 0.62, C.faint),
    line(3.62, 3.08, 1.2, C.faint),
    line(7.08, 3.08, 1.2, C.faint)
  )
  return shapes
}

function timeline(items) {
  const shapes = []
  const x = 1.0
  const y = 1.64
  const rowH = 0.86
  shapes.push(line(x + 0.34, y + 0.24, 0.01, C.faint, 4.5))
  items.forEach(([num, title, desc], idx) => {
    const py = y + idx * rowH
    shapes.push(
      rect(x, py, 0.68, 0.46, {
        fill: idx === 3 ? C.red : C.bg2,
        line: idx === 3 ? C.red : C.line,
        radius: true,
        text: num,
        textColor: C.text,
        textSize: 11
      }),
      text(x + 0.96, py - 0.01, 2.8, 0.3, title, {
        bold: true,
        color: C.text,
        size: 17
      }),
      text(x + 3.42, py, 4.55, 0.28, desc, {
        color: C.muted,
        size: 13
      })
    )
  })
  return shapes
}

function scorecard() {
  const rows = [
    ["可控", "关键动作是否在正确时刻交给人判断？", C.red],
    ["可见", "用户是否能看懂 Agent 的计划、进展、等待事项和结果？", C.blue],
    ["可恢复", "失败、刷新、关闭窗口后，run 状态和审批是否仍可找回？", C.green],
    ["边界清楚", "状态归属、依赖方向、失败语义是否明确？", C.yellow]
  ]
  const shapes = []
  rows.forEach(([title, desc, accent], idx) => {
    const y = 1.6 + idx * 0.96
    shapes.push(
      rect(0.9, y, 11.55, 0.72, {
        fill: C.panel,
        line: C.line,
        radius: true
      }),
      rect(0.9, y, 0.12, 0.72, { fill: accent, line: accent }),
      text(1.24, y + 0.17, 1.34, 0.24, title, {
        bold: true,
        color: C.text,
        size: 16
      }),
      text(2.78, y + 0.17, 8.8, 0.24, desc, {
        color: C.muted,
        size: 14
      })
    )
  })
  return shapes
}

function codePanel(x, y, w, h, lines) {
  return [
    rect(x, y, w, h, {
      fill: "0B0E13",
      line: C.line,
      radius: true
    }),
    text(
      x + 0.3,
      y + 0.32,
      w - 0.6,
      h - 0.64,
      lines.map((entry) => ({ text: entry })),
      {
        color: C.muted,
        font: "Menlo",
        size: 12,
        lineSpacing: 1.1
      }
    )
  ]
}

function image(x, y, w, h) {
  return { type: "image", x, y, w, h }
}

function rect(x, y, w, h, opts = {}) {
  return { type: "rect", x, y, w, h, ...opts }
}

function text(x, y, w, h, value, opts = {}) {
  const paragraphs = Array.isArray(value) ? value : [{ text: value }]
  return { type: "text", x, y, w, h, paragraphs, ...opts }
}

function bulletList(x, y, w, h, items, opts = {}) {
  return text(
    x,
    y,
    w,
    h,
    items.map((entry) => ({ bullet: true, text: entry })),
    opts
  )
}

function line(x, y, w, color, height = 0.025) {
  return rect(x, y, w, height, { fill: color, line: color })
}

function emu(value) {
  return Math.round(value * EMU)
}

function pt(value) {
  return Math.round(value * 100)
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function attrs(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ")
}

function colorXml(color) {
  return `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
}

function shapeTextXml(shape) {
  const anchor = shape.valign === "top" ? "t" : shape.valign === "bottom" ? "b" : "mid"
  const bodyAttrs = attrs({
    anchor,
    bIns: emu(0.03),
    lIns: emu(0.05),
    rIns: emu(0.05),
    tIns: emu(0.03),
    wrap: "square"
  })
  return `<p:txBody><a:bodyPr ${bodyAttrs}><a:normAutofit/></a:bodyPr><a:lstStyle/>${shape.paragraphs
    .map((paragraph) => paragraphXml(paragraph, shape))
    .join("")}</p:txBody>`
}

function paragraphXml(paragraph, shape) {
  const size = pt(paragraph.size ?? shape.size ?? 14)
  const color = paragraph.color ?? shape.color ?? shape.textColor ?? C.text
  const bold = paragraph.bold ?? shape.bold
  const align = paragraph.align ?? shape.align ?? "l"
  const font = paragraph.font ?? shape.font ?? "Aptos"
  const eastAsiaFont = font === "Menlo" ? "Menlo" : "PingFang SC"
  const pPrAttrs = attrs({
    algn: align,
    marL: paragraph.bullet ? emu(0.18) : undefined,
    indent: paragraph.bullet ? -emu(0.12) : undefined
  })
  const bullet = paragraph.bullet ? '<a:buChar char="•"/>' : ""
  const rPrAttrs = attrs({
    b: bold ? 1 : undefined,
    lang: "zh-CN",
    sz: size
  })
  return `<a:p><a:pPr ${pPrAttrs}>${bullet}</a:pPr><a:r><a:rPr ${rPrAttrs}>${colorXml(
    color
  )}<a:latin typeface="${esc(font)}"/><a:ea typeface="${esc(
    eastAsiaFont
  )}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(
    paragraph.text
  )}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${size}"/></a:p>`
}

function spPrXml(shape) {
  const fill =
    shape.fill === undefined
      ? "<a:noFill/>"
      : shape.fill === "none"
        ? "<a:noFill/>"
        : colorXml(shape.fill)
  const lineFill =
    shape.line === undefined
      ? "<a:noFill/>"
      : shape.line === "none"
        ? "<a:noFill/>"
        : colorXml(shape.line)
  const prst = shape.radius ? "roundRect" : "rect"
  return `<p:spPr><a:xfrm><a:off x="${emu(shape.x)}" y="${emu(shape.y)}"/><a:ext cx="${emu(
    shape.w
  )}" cy="${emu(shape.h)}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}<a:ln w="${
    shape.lineWidth ? pt(shape.lineWidth) : 9525
  }">${lineFill}</a:ln></p:spPr>`
}

function shapeXml(shape, id, rels) {
  if (Array.isArray(shape)) {
    return shape.map((entry, offset) => shapeXml(entry, id + offset, rels)).join("")
  }

  if (shape.type === "image") {
    const relId = `rId${rels.length + 1}`
    rels.push({
      id: relId,
      target: "../media/openwork-logo.png",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    })
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Openwork logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(
      shape.x
    )}" y="${emu(shape.y)}"/><a:ext cx="${emu(shape.w)}" cy="${emu(
      shape.h
    )}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  }

  const paragraphs =
    shape.text && !shape.paragraphs
      ? [{ text: shape.text }]
      : shape.paragraphs
  const textBody = paragraphs ? shapeTextXml({ ...shape, paragraphs }) : ""
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr txBox="${
    paragraphs ? 1 : 0
  }"/><p:nvPr/></p:nvSpPr>${spPrXml(shape)}${textBody}</p:sp>`
}

function slideXml(slide, index) {
  const rels = [
    {
      id: "rId1",
      target: "../slideLayouts/slideLayout1.xml",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
    }
  ]
  const flatShapes = [
    rect(0, 0, SLIDE_W, SLIDE_H, { fill: C.bg, line: C.bg }),
    rect(0, 0, SLIDE_W, 0.07, { fill: C.red, line: C.red }),
    ...(slide.shapes ?? []),
    text(0.82, 6.93, 4.8, 0.22, slide.source, {
      color: C.faint,
      size: 8
    }),
    text(11.78, 6.93, 0.7, 0.22, String(index + 1).padStart(2, "0"), {
      color: C.faint,
      size: 8,
      align: "r"
    })
  ].flat()
  const shapesXml = flatShapes.map((shape, shapeIndex) => shapeXml(shape, shapeIndex + 2, rels)).join("")
  const relsXml = relationshipsXml(rels)

  return {
    relsXml,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapesXml}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  }
}

function relationshipsXml(rels) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}">${rels
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${esc(rel.target)}"/>`
    )
    .join("")}</Relationships>`
}

function presentationXml() {
  const slideIds = slides
    .map((_, idx) => `<p:sldId id="${256 + idx}" r:id="rId${idx + 2}"/>`)
    .join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${emu(
    SLIDE_W
  )}" cy="${emu(SLIDE_H)}" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"><a:latin typeface="Aptos"/><a:ea typeface="PingFang SC"/><a:cs typeface="Aptos"/></a:defRPr></a:defPPr></p:defaultTextStyle></p:presentation>`
}

function presentationRelsXml() {
  const rels = [
    {
      id: "rId1",
      target: "slideMasters/slideMaster1.xml",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
    },
    ...slides.map((_, idx) => ({
      id: `rId${idx + 2}`,
      target: `slides/slide${idx + 1}.xml`,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
    }))
  ]
  return relationshipsXml(rels)
}

function contentTypesXml() {
  const slideOverrides = slides
    .map(
      (_, idx) =>
        `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${NS.a}" name="Openwork"><a:themeElements><a:clrScheme name="Openwork"><a:dk1><a:srgbClr val="${C.bg}"/></a:dk1><a:lt1><a:srgbClr val="${C.text}"/></a:lt1><a:dk2><a:srgbClr val="${C.panel}"/></a:dk2><a:lt2><a:srgbClr val="${C.muted}"/></a:lt2><a:accent1><a:srgbClr val="${C.red}"/></a:accent1><a:accent2><a:srgbClr val="${C.blue}"/></a:accent2><a:accent3><a:srgbClr val="${C.green}"/></a:accent3><a:accent4><a:srgbClr val="${C.yellow}"/></a:accent4><a:accent5><a:srgbClr val="${C.purple}"/></a:accent5><a:accent6><a:srgbClr val="${C.orange}"/></a:accent6><a:hlink><a:srgbClr val="${C.blue}"/></a:hlink><a:folHlink><a:srgbClr val="${C.purple}"/></a:folHlink></a:clrScheme><a:fontScheme name="Openwork"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="PingFang SC"/><a:cs typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="PingFang SC"/><a:cs typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Openwork"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="${NS.ep}" xmlns:vt="${NS.vt}"><Application>Openwork</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>${slides.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${slides.length}" baseType="lpstr">${slides
    .map((slide) => `<vt:lpstr>${esc(slide.title)}</vt:lpstr>`)
    .join("")}</vt:vector></TitlesOfParts><Company>Openwork</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`
}

function coreXml() {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="${NS.cp}" xmlns:dc="${NS.dc}" xmlns:dcterms="${NS.dcterms}" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Openwork 项目分享</dc:title><dc:subject>Harness-first desktop agent project overview</dc:subject><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

function rootRelsXml() {
  return relationshipsXml([
    {
      id: "rId1",
      target: "ppt/presentation.xml",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    },
    {
      id: "rId2",
      target: "docProps/core.xml",
      type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
    },
    {
      id: "rId3",
      target: "docProps/app.xml",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties"
    }
  ])
}

function write(partPath, content) {
  const fullPath = join(buildDir, partPath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content)
}

function buildDeck() {
  rmSync(buildDir, { force: true, recursive: true })
  rmSync(outputPath, { force: true })
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(join(buildDir, "ppt", "media"), { recursive: true })

  write("[Content_Types].xml", contentTypesXml())
  write("_rels/.rels", rootRelsXml())
  write("docProps/app.xml", appXml())
  write("docProps/core.xml", coreXml())
  write("ppt/presentation.xml", presentationXml())
  write("ppt/_rels/presentation.xml.rels", presentationRelsXml())
  write("ppt/slideMasters/slideMaster1.xml", slideMasterXml())
  write(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: "../slideLayouts/slideLayout1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
      },
      {
        id: "rId2",
        target: "../theme/theme1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
      }
    ])
  )
  write("ppt/slideLayouts/slideLayout1.xml", slideLayoutXml())
  write(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: "../slideMasters/slideMaster1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
      }
    ])
  )
  write("ppt/theme/theme1.xml", themeXml())
  copyFileSync(logoSource, join(buildDir, "ppt", "media", "openwork-logo.png"))

  slides.forEach((slide, idx) => {
    const { xml, relsXml } = slideXml(slide, idx)
    write(`ppt/slides/slide${idx + 1}.xml`, xml)
    write(`ppt/slides/_rels/slide${idx + 1}.xml.rels`, relsXml)
  })

  execFileSync("zip", ["-qr", outputPath, "."], { cwd: buildDir })
  if (!existsSync(outputPath)) {
    throw new Error(`PPTX was not created: ${outputPath}`)
  }
  rmSync(buildDir, { force: true, recursive: true })
  console.log(outputPath)
}

buildDeck()

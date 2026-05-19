import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(rootDir, "docs", "launch", "assets")
const logoPath = join(rootDir, "resources", "icon.png")
const W = 3840
const H = 2160

mkdirSync(outDir, { recursive: true })
copyFileSync(logoPath, join(outDir, "openwork-logo.png"))

const C = {
  bg: "#0f1217",
  panel: "#171c24",
  panel2: "#202733",
  line: "#313a49",
  text: "#f5f7fa",
  muted: "#a7b0be",
  faint: "#697386",
  red: "#ff4b4b",
  blue: "#4aa8ff",
  green: "#3ddc97",
  yellow: "#f2c94c",
  orange: "#ff9f43",
  purple: "#a78bfa"
}

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function tag(name, attrs = {}, content = "") {
  const attr = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ")
  return `<${name}${attr ? ` ${attr}` : ""}>${content}</${name}>`
}

function text(x, y, value, opts = {}) {
  const {
    anchor = "start",
    color = C.text,
    family = "Inter, SF Pro Display, PingFang SC, Arial, sans-serif",
    size = 64,
    weight = 500
  } = opts
  return tag(
    "text",
    {
      "dominant-baseline": "hanging",
      "font-family": family,
      "font-size": size,
      "font-weight": weight,
      fill: color,
      "text-anchor": anchor,
      x,
      y
    },
    esc(value)
  )
}

function multiText(x, y, lines, opts = {}) {
  const size = opts.size ?? 64
  const lineHeight = opts.lineHeight ?? size * 1.26
  return lines.map((line, idx) => text(x, y + idx * lineHeight, line, opts)).join("")
}

function rect(x, y, w, h, opts = {}) {
  return tag("rect", {
    fill: opts.fill ?? C.panel,
    height: h,
    opacity: opts.opacity,
    rx: opts.rx ?? 40,
    stroke: opts.stroke ?? C.line,
    "stroke-width": opts.strokeWidth ?? 2,
    width: w,
    x,
    y
  })
}

function line(x1, y1, x2, y2, color = C.faint, width = 4) {
  return tag("line", {
    stroke: color,
    "stroke-linecap": "round",
    "stroke-width": width,
    x1,
    x2,
    y1,
    y2
  })
}

function circle(cx, cy, r, opts = {}) {
  return tag("circle", {
    cx,
    cy,
    fill: opts.fill ?? C.panel,
    opacity: opts.opacity,
    r,
    stroke: opts.stroke ?? C.line,
    "stroke-width": opts.strokeWidth ?? 2
  })
}

function arrow(x1, y1, x2, y2, color = C.faint) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = 24
  const ax = x2 - Math.cos(angle) * size
  const ay = y2 - Math.sin(angle) * size
  const left = `${ax + Math.cos(angle + Math.PI * 0.75) * size},${ay + Math.sin(angle + Math.PI * 0.75) * size}`
  const right = `${ax + Math.cos(angle - Math.PI * 0.75) * size},${ay + Math.sin(angle - Math.PI * 0.75) * size}`
  return `${line(x1, y1, x2, y2, color, 6)}${tag("polygon", {
    fill: color,
    points: `${x2},${y2} ${left} ${right}`
  })}`
}

function logo(x, y, size) {
  return tag("image", {
    height: size,
    href: "openwork-logo.png",
    width: size,
    x,
    y
  })
}

function base(content) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="soft" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#171c24"/>
      <stop offset="100%" stop-color="#0f1217"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  ${rect(0, 0, W, H, { fill: C.bg, stroke: C.bg, rx: 0 })}
  ${tag("path", {
    d: "M0 0 H3840 V180 C3220 250 2780 120 2200 190 C1560 268 960 130 0 260 Z",
    fill: "#171c24",
    opacity: "0.75"
  })}
  ${tag("path", {
    d: "M0 2160 H3840 V1900 C3180 1840 2750 2040 2180 1970 C1450 1880 880 2060 0 1940 Z",
    fill: "#141922",
    opacity: "0.8"
  })}
  ${content}
</svg>`
}

function card(x, y, w, h, title, body, accent) {
  return `${rect(x, y, w, h, { fill: C.panel, stroke: accent, rx: 42 })}
${text(x + 54, y + 48, title, { color: C.text, size: 58, weight: 700 })}
${multiText(x + 54, y + 132, body, { color: C.muted, size: 36, lineHeight: 50, weight: 450 })}`
}

const svgs = {
  "openwork-hero-4k.svg": base(`
    ${logo(220, 210, 190)}
    ${text(450, 240, "Openwork", { size: 86, weight: 800 })}
    ${text(224, 515, "把软件工作交给 AI", { size: 148, weight: 850 })}
    ${text(224, 700, "但不把控制权交出去", { color: C.red, size: 148, weight: 850 })}
    ${multiText(230, 970, ["一个面向非程序员的桌面 Agent。", "它能执行真实软件任务，也会在关键步骤停下来让你决定。"], {
      color: C.muted,
      size: 54,
      lineHeight: 74,
      weight: 450
    })}
    ${rect(220, 1320, 1040, 390, { fill: C.panel, stroke: C.line, rx: 52 })}
    ${text(290, 1390, "Plan", { color: C.blue, size: 54, weight: 800 })}
    ${text(290, 1480, "先说清楚要做什么", { color: C.text, size: 48, weight: 650 })}
    ${text(290, 1560, "不是直接黑箱开跑", { color: C.muted, size: 38 })}
    ${rect(1400, 1320, 1040, 390, { fill: C.panel, stroke: C.red, rx: 52 })}
    ${text(1470, 1390, "Approve", { color: C.red, size: 54, weight: 800 })}
    ${text(1470, 1480, "危险动作先问你", { color: C.text, size: 48, weight: 650 })}
    ${text(1470, 1560, "写入、外部调用、删除都留边界", { color: C.muted, size: 38 })}
    ${rect(2580, 1320, 1040, 390, { fill: C.panel, stroke: C.green, rx: 52 })}
    ${text(2650, 1390, "Recover", { color: C.green, size: 54, weight: 800 })}
    ${text(2650, 1480, "错了还能接回来", { color: C.text, size: 48, weight: 650 })}
    ${text(2650, 1560, "记录、产物、检查点都在", { color: C.muted, size: 38 })}
    ${text(220, 1930, "Safe, controllable software work delegation", { color: C.faint, size: 42, weight: 500 })}
  `),

  "openwork-lifecycle-4k.svg": base(`
    ${text(220, 220, "一次委托，不是一段聊天", { size: 118, weight: 850 })}
    ${text(226, 380, "Openwork 把软件任务变成可追踪的工作单元", { color: C.muted, size: 54 })}
    ${[
      ["1", "说出目标", "我要改网站 / 连 API / 修脚本", C.blue],
      ["2", "确认边界", "workspace、权限、账号配置", C.yellow],
      ["3", "执行任务", "读文件、改代码、跑命令", C.green],
      ["4", "关键审批", "危险动作执行前停下来", C.red],
      ["5", "留下证据", "artifact、diff、日志、结果", C.purple],
      ["6", "恢复继续", "失败后知道从哪里接回", C.orange]
    ].map(([n, title, body, color], idx) => {
      const x = 260 + (idx % 3) * 1160
      const y = 650 + Math.floor(idx / 3) * 560
      return `${circle(x, y + 92, 72, { fill: color, stroke: color })}
${text(x, y + 52, n, { anchor: "middle", color: C.text, size: 58, weight: 850 })}
${card(x + 120, y, 860, 230, title, [body], color)}
${idx % 3 !== 2 ? arrow(x + 1010, y + 116, x + 1140, y + 116, C.faint) : ""}`
    }).join("")}
    ${text(232, 1880, "从开始到结束，每一步都能看见、能批准、能复查。", { color: C.text, size: 62, weight: 700 })}
  `),

  "openwork-permission-4k.svg": base(`
    ${text(220, 220, "能力给 Agent，用权限收住", { size: 118, weight: 850 })}
    ${text(226, 380, "人可以自然操作；Agent 只能调用受控工具。", { color: C.muted, size: 54 })}
    ${card(260, 670, 960, 500, "Read", ["默认可用", "读取信息、搜索、查看状态", "不改变外部世界"], C.green)}
    ${card(1440, 670, 960, 500, "Write", ["需要审批", "创建、修改、删除", "执行前把决定权交回人"], C.red)}
    ${card(2620, 670, 960, 500, "External", ["需要边界", "调用 GitHub、Reminders、API", "账号和 token 留在 Settings"], C.yellow)}
    ${arrow(1220, 920, 1400, 920, C.faint)}
    ${arrow(2400, 920, 2580, 920, C.faint)}
    ${rect(620, 1410, 2600, 360, { fill: C.panel2, stroke: C.line, rx: 60 })}
    ${text(800, 1488, "模型负责理解意图和整理参数", { color: C.text, size: 62, weight: 750 })}
    ${text(800, 1590, "系统负责权限、审批、留痕和恢复", { color: C.muted, size: 50, weight: 500 })}
    ${text(220, 1920, "Secret 不临时交给模型。危险动作不静默执行。", { color: C.faint, size: 42 })}
  `),

  "openwork-market-map-4k.svg": base(`
    ${text(220, 220, "AI 产品分化，但信任层还很空", { size: 112, weight: 850 })}
    ${text(226, 370, "Raycast 赢在调用瞬间；Openwork 要赢在委托工作的完整生命周期。", { color: C.muted, size: 52 })}
    ${line(520, 1180, 3310, 1180, C.line, 6)}
    ${line(1920, 610, 1920, 1740, C.line, 6)}
    ${text(650, 620, "Interaction", { color: C.blue, size: 62, weight: 800 })}
    ${text(650, 705, "快捷入口 / Action / Chat", { color: C.muted, size: 38 })}
    ${text(2450, 620, "Time", { color: C.green, size: 62, weight: 800 })}
    ${text(2450, 705, "异步任务 / 后台执行", { color: C.muted, size: 38 })}
    ${text(650, 1390, "Space", { color: C.yellow, size: 62, weight: 800 })}
    ${text(650, 1475, "workspace / sandbox / browser", { color: C.muted, size: 38 })}
    ${text(2450, 1390, "Evidence + Control", { color: C.red, size: 62, weight: 800 })}
    ${text(2450, 1475, "审批 / diff / artifact / replay", { color: C.muted, size: 38 })}
    ${rect(420, 860, 820, 210, { fill: C.panel, stroke: C.blue, rx: 48 })}
    ${text(830, 925, "Raycast", { anchor: "middle", size: 62, weight: 850 })}
    ${rect(2350, 1580, 980, 230, { fill: C.panel, stroke: C.red, rx: 48 })}
    ${text(2840, 1648, "Openwork", { anchor: "middle", size: 66, weight: 850 })}
    ${text(2840, 1735, "delegated work lifetime", { anchor: "middle", color: C.muted, size: 36 })}
    ${text(220, 1930, "产品差异不在“有没有 AI”，而在用户敢不敢把真实工作交出去。", { color: C.text, size: 54, weight: 650 })}
  `)
}

for (const [name, svg] of Object.entries(svgs)) {
  const svgPath = join(outDir, name)
  const pngPath = svgPath.replace(/\.svg$/, ".png")
  writeFileSync(svgPath, svg)
  execFileSync("/opt/homebrew/bin/rsvg-convert", ["-w", String(W), "-h", String(H), "-o", pngPath, svgPath])
  if (!existsSync(pngPath)) {
    throw new Error(`Failed to create ${pngPath}`)
  }
  console.log(pngPath)
}

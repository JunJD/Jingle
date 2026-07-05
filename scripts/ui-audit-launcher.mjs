import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { PNG } from "pngjs"
import { chromium } from "playwright"

const DEFAULT_CDP_PORT = 9333
const DEFAULT_OUTPUT_DIR = "test-results/ui-audit"

function parseArgs(argv) {
  const options = {
    cdpPort: DEFAULT_CDP_PORT,
    outputDir: DEFAULT_OUTPUT_DIR
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--cdp-port") {
      options.cdpPort = Number(argv[index + 1])
      index += 1
      continue
    }

    if (arg === "--out") {
      options.outputDir = argv[index + 1]
      index += 1
      continue
    }

    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isInteger(options.cdpPort) || options.cdpPort <= 0) {
    throw new Error("--cdp-port must be a positive integer")
  }

  if (!options.outputDir) {
    throw new Error("--out must not be empty")
  }

  return options
}

function printUsage() {
  console.log(`Usage: node scripts/ui-audit-launcher.mjs [--cdp-port 9333] [--out test-results/ui-audit]

Connects to a running Jingle Electron renderer over CDP and captures runtime
style evidence for launcher UI work. Start Jingle with:

  JINGLE_REMOTE_DEBUGGING_PORT=9333 npm run dev
`)
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function getLauncherPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes("window=launcher")) {
        return page
      }
    }
  }

  const pages = browser.contexts().flatMap((context) => context.pages())
  return pages[0] ?? null
}

async function collectRuntimeSnapshot(page) {
  return page.evaluate(() => {
    const selectorPlans = [
      { key: "shell", selector: ".launcher-window-shell" },
      { key: "header", selector: ".launcher-chrome-header" },
      { key: "promptInput", selector: ".ow-prompt-input" },
      { key: "composerTextbox", selector: ".ow-prompt-input [role='textbox'], .ow-prompt-input textarea, .ow-prompt-input [contenteditable='true']" },
      { key: "submitButton", selector: "button[aria-label='发给 AI']" },
      { key: "attachButton", selector: "button[aria-label='添加附件']" },
      { key: "actionButton", selector: "button[aria-label='操作']" },
      { key: "firstReasoning", selector: ".ow-reasoning-message" },
      { key: "firstAgentTool", selector: ".ow-agent-tool" },
      { key: "firstAgentToolGroup", selector: ".ow-agent-tool-group" }
    ]

    function styleOf(element, pseudoElement) {
      const computed = getComputedStyle(element, pseudoElement)

      return {
        backgroundColor: computed.backgroundColor,
        border: computed.border,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        color: computed.color,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        opacity: computed.opacity,
        padding: computed.padding
      }
    }

    function rectOf(element) {
      const rect = element.getBoundingClientRect()

      return {
        height: Number(rect.height.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2))
      }
    }

    function labelFor(element) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.placeholder || element.getAttribute("aria-label") || element.type
      }

      return element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.tagName
    }

    function describe(plan) {
      const element = document.querySelector(plan.selector)

      if (!element) {
        return {
          found: false,
          key: plan.key,
          selector: plan.selector
        }
      }

      return {
        found: true,
        label: labelFor(element).slice(0, 120),
        key: plan.key,
        rect: rectOf(element),
        selector: plan.selector,
        style: styleOf(element)
      }
    }

    function findComposerPlaceholder(textbox) {
      const composerRoot = document.querySelector(".ow-prompt-input")
      const overlayPlaceholder = composerRoot?.querySelector(".ow-composer-placeholder")

      if (overlayPlaceholder) {
        return {
          found: true,
          rect: rectOf(overlayPlaceholder),
          selector: ".ow-prompt-input .ow-composer-placeholder",
          source: "overlay",
          style: styleOf(overlayPlaceholder)
        }
      }

      if (
        textbox instanceof HTMLInputElement ||
        textbox instanceof HTMLTextAreaElement
      ) {
        return {
          found: true,
          rect: rectOf(textbox),
          selector: `${textbox.tagName.toLowerCase()}::placeholder`,
          source: "pseudo",
          style: styleOf(textbox, "::placeholder")
        }
      }

      return null
    }

    const textbox = document.querySelector(".ow-prompt-input [role='textbox'], .ow-prompt-input textarea, .ow-prompt-input [contenteditable='true']")
    const placeholder = findComposerPlaceholder(textbox)
    const root = getComputedStyle(document.documentElement)

    return {
      counts: {
        agentTool: document.querySelectorAll(".ow-agent-tool").length,
        agentToolGroup: document.querySelectorAll(".ow-agent-tool-group").length,
        buttons: document.querySelectorAll("button").length,
        promptInput: document.querySelectorAll(".ow-prompt-input").length,
        reasoning: document.querySelectorAll(".ow-reasoning-message").length
      },
      elements: Object.fromEntries(selectorPlans.map((plan) => [plan.key, describe(plan)])),
      placeholder: {
        composer: placeholder
      },
      textStats: {
        bodyCharacterCount: document.body.innerText.length
      },
      tokens: {
        foreground: root.getPropertyValue("--foreground").trim(),
        mutedForeground: root.getPropertyValue("--muted-foreground").trim(),
        tertiaryForeground: root.getPropertyValue("--tertiary-foreground").trim(),
        promptInputShadow: root.getPropertyValue("--ow-prompt-input-shadow").trim(),
        promptInputShadowFocus: root.getPropertyValue("--ow-prompt-input-shadow-focus").trim()
      },
      url: location.href,
      viewport: {
        devicePixelRatio: window.devicePixelRatio,
        height: window.innerHeight,
        width: window.innerWidth
      }
    }
  })
}

function rgbaAt(png, x, y) {
  const boundedX = Math.max(0, Math.min(png.width - 1, Math.floor(x)))
  const boundedY = Math.max(0, Math.min(png.height - 1, Math.floor(y)))
  const index = (boundedY * png.width + boundedX) * 4

  return [png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]]
}

function relativeLuminance([r, g, b]) {
  function channel(value) {
    const normalized = value / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(first, second) {
  const firstLum = relativeLuminance(first)
  const secondLum = relativeLuminance(second)

  return round((Math.max(firstLum, secondLum) + 0.05) / (Math.min(firstLum, secondLum) + 0.05))
}

function colorDistance(first, second) {
  return Math.sqrt(
    (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2 + (first[2] - second[2]) ** 2
  )
}

function collectPixelMetrics(buffer) {
  const png = PNG.sync.read(buffer)
  const samples = {
    bottom: rgbaAt(png, png.width / 2, png.height - 8),
    center: rgbaAt(png, png.width / 2, png.height / 2),
    composer: rgbaAt(png, png.width / 2, png.height - 34),
    contentLeft: rgbaAt(png, 32, png.height / 2),
    contentRight: rgbaAt(png, png.width - 32, png.height / 2),
    header: rgbaAt(png, png.width / 2, 24)
  }
  const buckets = new Map()
  let compared = 0
  let differentFromCenter = 0
  let strongContrast = 0

  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const color = rgbaAt(png, x, y)

      if (color[3] < 20) {
        continue
      }

      const key = color
        .slice(0, 3)
        .map((channel) => Math.round(channel / 8) * 8)
        .join(",")
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
      compared += 1

      const distance = colorDistance(color, samples.center)
      if (distance > 16) {
        differentFromCenter += 1
      }
      if (distance > 36) {
        strongContrast += 1
      }
    }
  }

  const topColors = [...buckets.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([rgb, count]) => ({
      percent: round((count / compared) * 100),
      rgb
    }))

  return {
    contrast: {
      bottomCenter: contrastRatio(samples.bottom, samples.center),
      composerCenter: contrastRatio(samples.composer, samples.center),
      headerCenter: contrastRatio(samples.header, samples.center)
    },
    differentFromCenterPercent: round((differentFromCenter / compared) * 100),
    height: png.height,
    samples,
    strongContrastPercent: round((strongContrast / compared) * 100),
    topColors,
    width: png.width
  }
}

function rgbText(styleColor) {
  return styleColor.replace(/\s+/g, " ").trim()
}

function createFindings(snapshot) {
  const findings = []
  const composer = snapshot.elements.promptInput
  const textbox = snapshot.elements.composerTextbox
  const placeholder = snapshot.placeholder.composer
  const toolCount = snapshot.counts.agentTool
  const reasoningCount = snapshot.counts.reasoning
  const buttonCount = snapshot.counts.buttons

  if (placeholder?.style && textbox?.style) {
    const placeholderColor = rgbText(placeholder.style.color)
    const textboxColor = rgbText(textbox.style.color)
    const placeholderWeight = placeholder.style.fontWeight

    if (placeholderColor === textboxColor || Number(placeholderWeight) >= 500) {
      findings.push({
        actual: `placeholder color ${placeholderColor}, weight ${placeholderWeight}; text color ${textboxColor}`,
        expected: "placeholder should be visibly muted and normal weight",
        id: "composer-placeholder-too-strong",
        priority: "P1",
        selector: placeholder.selector,
        title: "Composer placeholder matches input text"
      })
    }
  }

  if (composer?.found && snapshot.viewport.width > 0) {
    const widthRatio = composer.rect.width / snapshot.viewport.width

    if (widthRatio > 0.92) {
      findings.push({
        actual: `composer width ${composer.rect.width}px of viewport ${snapshot.viewport.width}px (${round(
          widthRatio * 100
        )}%)`,
        expected: "composer width should be intentional and aligned with the content column",
        id: "composer-wide-anchor",
        priority: "P3",
        selector: composer.selector,
        title: "Composer nearly spans the launcher width"
      })
    }
  }

  if (toolCount >= 20 || reasoningCount >= 20 || buttonCount >= 80) {
    findings.push({
      actual: `${toolCount} tool cards, ${reasoningCount} reasoning rows, ${buttonCount} buttons`,
      expected: "completed tool/reasoning rows should collapse into a lower-noise timeline in long threads",
      id: "long-thread-process-noise",
      priority: "P1",
      selector: ".ow-agent-tool / .ow-reasoning-message",
      title: "Long launcher thread has high process UI density"
    })
  }

  return findings
}

function formatElement(element) {
  if (!element?.found) {
    return `- \`${element?.selector ?? "unknown"}\`: not found`
  }

  return `- \`${element.selector}\`: ${element.rect.width}x${element.rect.height} at (${element.rect.x}, ${element.rect.y}); color ${element.style.color}; weight ${element.style.fontWeight}; bg ${element.style.backgroundColor}; label ${JSON.stringify(element.label)}`
}

function createMarkdownReport({ findings, output, pixelMetrics, snapshot }) {
  const lines = [
    "# Launcher UI Audit",
    "",
    `- URL: \`${snapshot.url}\``,
    `- Viewport: \`${snapshot.viewport.width}x${snapshot.viewport.height}@${snapshot.viewport.devicePixelRatio}\``,
    `- Screenshot: \`${output.screenshotPath}\``,
    `- JSON: \`${output.jsonPath}\``,
    "",
    "## Findings",
    ""
  ]

  if (findings.length === 0) {
    lines.push("No findings.")
  } else {
    for (const finding of findings) {
      lines.push(
        `- **${finding.priority} ${finding.title}**`,
        `  - selector: \`${finding.selector}\``,
        `  - actual: ${finding.actual}`,
        `  - expected: ${finding.expected}`
      )
    }
  }

  lines.push(
    "",
    "## Runtime Counts",
    "",
    `- prompt inputs: ${snapshot.counts.promptInput}`,
    `- reasoning rows: ${snapshot.counts.reasoning}`,
    `- standalone tool cards: ${snapshot.counts.agentTool}`,
    `- tool groups: ${snapshot.counts.agentToolGroup}`,
    `- buttons: ${snapshot.counts.buttons}`,
    "",
    "## Key Elements",
    "",
    formatElement(snapshot.elements.promptInput),
    formatElement(snapshot.elements.composerTextbox),
    formatElement(snapshot.elements.submitButton),
    formatElement(snapshot.elements.firstReasoning),
    formatElement(snapshot.elements.firstAgentTool),
    "",
    "## Placeholder",
    "",
    snapshot.placeholder.composer
      ? `- \`${snapshot.placeholder.composer.selector}\` (${snapshot.placeholder.composer.source}): color ${snapshot.placeholder.composer.style.color}; weight ${snapshot.placeholder.composer.style.fontWeight}; opacity ${snapshot.placeholder.composer.style.opacity}`
      : "- placeholder target not found",
    "",
    "## Pixel Metrics",
    "",
    `- screenshot size: ${pixelMetrics.width}x${pixelMetrics.height}`,
    `- composer/center contrast: ${pixelMetrics.contrast.composerCenter}`,
    `- header/center contrast: ${pixelMetrics.contrast.headerCenter}`,
    `- strong contrast pixels: ${pixelMetrics.strongContrastPercent}%`,
    `- top colors: ${pixelMetrics.topColors.map((entry) => `${entry.rgb} ${entry.percent}%`).join("; ")}`,
    "",
    "## Text Capture",
    "",
    `- body text characters: ${snapshot.textStats.bodyCharacterCount}`,
    "- body text is intentionally not written to this report; this harness audits runtime style, not conversation content.",
    ""
  )

  return `${lines.join("\n")}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outputDir = resolve(options.outputDir)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const screenshotPath = join(outputDir, `launcher-runtime-${timestamp}.png`)
  const jsonPath = join(outputDir, `launcher-runtime-${timestamp}.json`)
  const markdownPath = join(outputDir, `launcher-runtime-${timestamp}.md`)

  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.cdpPort}`)

  try {
    const page = await getLauncherPage(browser)

    if (!page) {
      throw new Error(`No page found on CDP port ${options.cdpPort}`)
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined)

    const screenshotBuffer = await page.screenshot({ path: screenshotPath })
    const snapshot = await collectRuntimeSnapshot(page)
    const pixelMetrics = collectPixelMetrics(screenshotBuffer)
    const findings = createFindings(snapshot)
    const report = {
      findings,
      generatedAt: new Date().toISOString(),
      pixelMetrics,
      screenshotPath,
      snapshot
    }
    const markdown = createMarkdownReport({
      findings,
      output: {
        jsonPath,
        screenshotPath
      },
      pixelMetrics,
      snapshot
    })

    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(markdownPath, markdown)

    console.log(`Launcher UI audit written:`)
    console.log(`- ${screenshotPath}`)
    console.log(`- ${jsonPath}`)
    console.log(`- ${markdownPath}`)

    if (findings.length > 0) {
      console.log("")
      console.log("Findings:")
      for (const finding of findings) {
        console.log(`- ${finding.priority} ${finding.title}: ${finding.actual}`)
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

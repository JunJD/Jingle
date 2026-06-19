const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR

function color(open, close) {
  return (value) => (colorEnabled ? `${open}${value}${close}` : value)
}

const bold = color("\x1B[1m", "\x1B[22m")
const cyan = color("\x1B[36m", "\x1B[39m")
const dim = color("\x1B[2m", "\x1B[22m")
const green = color("\x1B[32m", "\x1B[39m")
const magenta = color("\x1B[35m", "\x1B[39m")
const red = color("\x1B[31m", "\x1B[39m")
const yellow = color("\x1B[33m", "\x1B[39m")

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(value) {
  const tokens = Number(value) || 0
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

function formatCost(value) {
  const cost = Number(value) || 0
  if (cost === 0) return "$0"
  if (cost < 0.001) return `$${cost.toFixed(6)}`
  return `$${cost.toFixed(4)}`
}

function truncate(value, maxLength = 80) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function parseBlobJson(value) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function collectText(value, output) {
  if (typeof value === "string") {
    if (value.trim()) output.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output)
    return
  }

  if (!value || typeof value !== "object") return

  if (typeof value.text === "string") {
    collectText(value.text, output)
    return
  }

  if (typeof value.content === "string") {
    collectText(value.content, output)
    return
  }

  if (Array.isArray(value.content)) {
    collectText(value.content, output)
  }
}

function readBlobText(blob) {
  if (!blob) return undefined
  const parsed = parseBlobJson(blob.value)
  const parts = []
  collectText(parsed, parts)
  if (parts.length > 0) return parts.join("")
  return typeof blob.value === "string" ? blob.value : JSON.stringify(blob.value)
}

function readBlobArgs(blob) {
  if (!blob) return undefined
  const parsed = parseBlobJson(blob.value)
  return parsed && typeof parsed === "object" ? parsed : undefined
}

function readBlobJson(blob) {
  if (!blob) return undefined
  return parseBlobJson(blob.value)
}

function getToolDisplayName(step, args) {
  if (args?.extensionName && args?.toolName) {
    return `${args.extensionName}.${args.toolName}`
  }

  return step.tool_name || "unknown_tool"
}

function mapCompletionReason(trace) {
  if (trace.status === "completed") return "done"
  if (trace.status === "failed") return "error"
  if (trace.status === "waiting_for_human") return "waiting_for_human"
  if (trace.status === "interrupted" || trace.status === "canceled") return "interrupted"
  return trace.status || "unknown"
}

function stepDuration(step) {
  if (step.duration_ms !== null && step.duration_ms !== undefined) {
    return Number(step.duration_ms)
  }

  if (step.completed_at && step.started_at) {
    return Math.max(0, Number(step.completed_at) - Number(step.started_at))
  }

  return 0
}

function buildExecutionSnapshot(input) {
  const { readBlob, steps, trace } = input
  const snapshotSteps = steps.map((step) => {
    const inputBlob = readBlob(step.input_blob_id)
    const outputBlob = readBlob(step.output_blob_id)
    const args = readBlobArgs(inputBlob)
    const base = {
      completedAt: step.completed_at ?? step.started_at,
      events: step.event_type ? [{ seq: step.event_seq, type: step.event_type }] : [],
      executionTimeMs: stepDuration(step),
      inputTokens: step.input_tokens,
      outputTokens: step.output_tokens,
      startedAt: step.started_at,
      stepIndex: step.step_index,
      stepType: step.step_type,
      totalCost: 0,
      totalTokens: step.total_tokens
    }

    if (step.step_type === "call_tool") {
      const toolName = getToolDisplayName(step, args)
      return {
        ...base,
        toolsResult: [
          {
            apiName: step.tool_name || toolName,
            identifier: toolName,
            isSuccess: step.status !== "failed",
            output: readBlobText(outputBlob)
          }
        ]
      }
    }

    if (step.step_type === "approval") {
      const toolName = getToolDisplayName(step, args)
      return {
        ...base,
        stepType: "approval",
        toolsResult: [
          {
            apiName: step.tool_name || toolName,
            identifier: toolName,
            isSuccess: step.status === "completed",
            output: step.status
          }
        ]
      }
    }

    return {
      ...base,
      content: readBlobText(outputBlob)
    }
  })

  for (let index = 0; index < snapshotSteps.length; index += 1) {
    const step = snapshotSteps[index]
    if (step.stepType !== "call_llm") continue

    const toolCalls = []
    for (let nextIndex = index + 1; nextIndex < snapshotSteps.length; nextIndex += 1) {
      const nextStep = snapshotSteps[nextIndex]
      if (nextStep.stepType === "call_llm") break
      if (nextStep.stepType !== "call_tool") continue

      const tool = nextStep.toolsResult?.[0]
      if (tool) {
        toolCalls.push({
          apiName: tool.apiName,
          arguments: undefined,
          identifier: tool.identifier
        })
      }
    }

    if (toolCalls.length > 0) {
      step.toolsCalling = toolCalls
    }
  }

  return {
    completedAt: trace.completed_at ?? undefined,
    completionReason: mapCompletionReason(trace),
    error: trace.error_message
      ? {
          message: trace.error_message,
          type: trace.error_type || "Error"
        }
      : undefined,
    model: trace.model || undefined,
    operationId: trace.run_id,
    provider: trace.provider || undefined,
    startedAt: trace.started_at,
    steps: snapshotSteps,
    totalCost: Number(trace.total_cost) || 0,
    totalSteps: snapshotSteps.length,
    totalTokens: Number(trace.total_tokens) || 0,
    traceId: trace.trace_id
  }
}

function renderLlmStep(lines, step, prefix) {
  const tokenInfo = []
  if (step.inputTokens) tokenInfo.push(`in:${formatTokens(step.inputTokens)}`)
  if (step.outputTokens) tokenInfo.push(`out:${formatTokens(step.outputTokens)}`)

  if (tokenInfo.length > 0) {
    lines.push(`${prefix}${dim("├─")} LLM     ${tokenInfo.join(" ")} tokens`)
  }

  if (step.toolsCalling?.length) {
    const names = step.toolsCalling.map((tool) => tool.identifier || tool.apiName)
    lines.push(
      `${prefix}${dim("├─")} ${yellow("→")} ${step.toolsCalling.length} tool_calls: [${names.join(", ")}]`
    )
  }

  if (step.content) {
    lines.push(`${prefix}${dim("└─")} Output  ${dim(truncate(step.content))}`)
  }
}

function renderToolStep(lines, step, prefix) {
  const tools = step.toolsResult ?? []
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]
    const connector = index === tools.length - 1 ? "└─" : "├─"
    const status = tool.isSuccess === false ? red("✗") : green("✓")
    const name = tool.identifier || tool.apiName
    lines.push(`${prefix}${dim(connector)} Tool  ${name}  ${status}`)
  }
}

function renderSnapshot(snapshot) {
  const lines = []
  const durationMs = (snapshot.completedAt ?? Date.now()) - snapshot.startedAt
  const shortId = snapshot.traceId.slice(0, 12)

  lines.push(
    `${bold("Agent Operation")}  ${cyan(shortId)}${
      snapshot.model ? `  ${magenta(snapshot.model)}` : ""
    }  ${snapshot.totalSteps} steps  ${formatMs(durationMs)}`
  )

  const lastIndex = snapshot.steps.length - 1
  for (let index = 0; index <= lastIndex; index += 1) {
    const step = snapshot.steps[index]
    const isLast = index === lastIndex
    const prefix = isLast ? "└─" : "├─"
    const childPrefix = isLast ? "   " : "│  "

    lines.push(
      `${prefix} Step ${step.stepIndex}  ${dim(`[${step.stepType}]`)}  ${formatMs(
        step.executionTimeMs
      )}`
    )

    if (step.stepType === "call_llm") {
      renderLlmStep(lines, step, childPrefix)
    } else {
      renderToolStep(lines, step, childPrefix)
    }
  }

  const reasonColor = snapshot.completionReason === "done" ? green : snapshot.error ? red : yellow
  lines.push(
    `${dim("└─")} ${reasonColor(snapshot.completionReason ?? "unknown")}  tokens=${formatTokens(
      snapshot.totalTokens
    )}  cost=${formatCost(snapshot.totalCost)}`
  )

  if (snapshot.error) {
    lines.push(`   ${red("Error:")} ${snapshot.error.type} - ${snapshot.error.message}`)
  }

  return lines.join("\n")
}

module.exports = {
  buildExecutionSnapshot,
  renderSnapshot
}

#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require("child_process")
const { existsSync } = require("fs")
const { homedir } = require("os")
const path = require("path")
const { buildExecutionSnapshot, renderSnapshot } = require("../packages/agent-tracing")

const args = process.argv.slice(2)

function getOpenworkHome() {
  const override = process.env.OPENWORK_HOME?.trim()
  return override && override.length > 0 ? override : path.join(homedir(), ".openwork")
}

function getDbPath() {
  return path.join(getOpenworkHome(), "openwork.sqlite")
}

function usage() {
  console.log(`
inspect-agent-trace - Inspect local Openwork agent traces

Usage:
  node scripts/inspect-agent-trace.cjs list
  node scripts/inspect-agent-trace.cjs inspect latest
  node scripts/inspect-agent-trace.cjs inspect <traceId>
  node scripts/inspect-agent-trace.cjs inspect <traceId> --step <n>
  node scripts/inspect-agent-trace.cjs inspect <traceId> --events
  node scripts/inspect-agent-trace.cjs inspect <traceId> --tools
  node scripts/inspect-agent-trace.cjs inspect <traceId> --messages
`)
}

function quoteSqlValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return `'${String(value).replace(/'/g, "''")}'`
}

function bindSqlParams(sql, params) {
  let index = 0
  return sql.replace(/\?/g, () => {
    if (index >= params.length) {
      throw new Error("Missing SQL parameter for trace query.")
    }

    const value = quoteSqlValue(params[index])
    index += 1
    return value
  })
}

function readJsonQuery(sql, params = []) {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    throw new Error(`Openwork database not found at ${dbPath}`)
  }

  const output = execFileSync("sqlite3", ["-json", dbPath, bindSqlParams(sql, params)], {
    encoding: "utf8"
  }).trim()
  return output.length > 0 ? JSON.parse(output) : []
}

function formatTime(value) {
  if (value === null || value === undefined || value === "") {
    return "-"
  }

  return new Date(Number(value)).toISOString()
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return "-"
  }

  const ms = Math.max(0, Number(completedAt) - Number(startedAt))
  return `${(ms / 1000).toFixed(1)}s`
}

function compact(value, max = 220) {
  if (value === null || value === undefined) {
    return ""
  }

  const text = String(value).replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function printTraceList() {
  const rows = readJsonQuery(`
    SELECT trace_id, thread_id, run_id, status, model, provider, started_at, completed_at,
           total_steps, total_tokens, error_message
    FROM agent_traces
    ORDER BY started_at DESC
    LIMIT 30
  `)

  if (rows.length === 0) {
    console.log("No local traces found.")
    return
  }

  for (const row of rows) {
    console.log(
      [
        row.trace_id,
        `status=${row.status}`,
        `thread=${row.thread_id}`,
        `run=${row.run_id}`,
        `started=${formatTime(row.started_at)}`,
        `duration=${formatDuration(row.started_at, row.completed_at)}`,
        `steps=${row.total_steps}`,
        `tokens=${row.total_tokens}`,
        row.model ? `model=${row.model}` : null,
        row.error_message ? `error=${compact(row.error_message, 80)}` : null
      ]
        .filter(Boolean)
        .join("  ")
    )
  }
}

function resolveTraceId(traceId) {
  if (traceId !== "latest") {
    return traceId
  }

  const [row] = readJsonQuery(`
    SELECT trace_id
    FROM agent_traces
    ORDER BY started_at DESC
    LIMIT 1
  `)
  if (!row) {
    throw new Error("No local traces found.")
  }
  return row.trace_id
}

function getTrace(traceId) {
  const [trace] = readJsonQuery(
    `
      SELECT trace_id, thread_id, run_id, status, model, provider, started_at, completed_at,
             completion_reason, error_type, error_message, total_steps, total_cost, total_input_tokens,
             total_output_tokens, total_tokens, projected_through_seq, has_gap, projection_error
      FROM agent_traces
      WHERE trace_id = ?
      LIMIT 1
    `,
    [traceId]
  )
  if (!trace) {
    throw new Error(`Trace "${traceId}" not found.`)
  }
  return trace
}

function printTraceHeader(trace) {
  console.log(`Trace ${trace.trace_id}`)
  console.log(
    [
      `thread=${trace.thread_id}`,
      `run=${trace.run_id}`,
      `status=${trace.status}`,
      trace.model ? `model=${trace.model}` : null,
      trace.provider ? `provider=${trace.provider}` : null,
      `started=${formatTime(trace.started_at)}`,
      `duration=${formatDuration(trace.started_at, trace.completed_at)}`,
      `tokens=${trace.total_tokens}`,
      `projectedSeq=${trace.projected_through_seq}`,
      trace.has_gap ? "gap=true" : null
    ]
      .filter(Boolean)
      .join("  ")
  )
  if (trace.error_message) {
    console.log(`error=${trace.error_type || "error"} ${trace.error_message}`)
  }
  if (trace.projection_error) {
    console.log(`projection_error=${trace.projection_error}`)
  }
}

function readSteps(traceId) {
  return readJsonQuery(
    `
      SELECT step_index, step_type, status, started_at, completed_at, duration_ms, model, provider,
             input_tokens, output_tokens, total_tokens, tool_name, tool_call_id,
             input_blob_id, output_blob_id, messages_baseline_blob_id, messages_delta_blob_id,
             event_seq, event_type, error_type, error_message
      FROM agent_trace_steps
      WHERE trace_id = ?
      ORDER BY step_index ASC
    `,
    [traceId]
  )
}

function readBlob(blobId) {
  if (!blobId) {
    return null
  }

  const [blob] = readJsonQuery(
    `
      SELECT blob_id, kind, size_bytes, preview, value
      FROM agent_trace_blobs
      WHERE blob_id = ?
      LIMIT 1
    `,
    [blobId]
  )
  return blob || null
}

function printTimeline(trace) {
  const steps = readSteps(trace.trace_id)
  const snapshot = buildExecutionSnapshot({
    readBlob,
    steps,
    trace
  })
  console.log(renderSnapshot(snapshot))
}

function printStep(traceId, stepIndex) {
  const [step] = readJsonQuery(
    `
      SELECT *
      FROM agent_trace_steps
      WHERE trace_id = ? AND step_index = ?
      LIMIT 1
    `,
    [traceId, stepIndex]
  )

  if (!step) {
    throw new Error(`Step ${stepIndex} not found in trace "${traceId}".`)
  }

  console.log(
    [
      `Step ${step.step_index}`,
      step.step_type,
      step.status,
      step.duration_ms === null ? null : `${(Number(step.duration_ms) / 1000).toFixed(1)}s`,
      step.tool_name ? `tool=${step.tool_name}` : null,
      step.tool_call_id ? `toolCall=${step.tool_call_id}` : null,
      step.total_tokens ? `tokens=${step.total_tokens}` : null
    ]
      .filter(Boolean)
      .join("  ")
  )

  for (const [label, blobId] of [
    ["input", step.input_blob_id],
    ["output", step.output_blob_id],
    ["messages_baseline", step.messages_baseline_blob_id],
    ["messages_delta", step.messages_delta_blob_id],
    ["context", step.context_blob_id]
  ]) {
    const blob = readBlob(blobId)
    if (blob) {
      console.log(`\n${label} (${blob.kind}, ${blob.size_bytes} bytes)`)
      console.log(compact(blob.value, 4000))
    }
  }
}

function printEvents(traceId) {
  const events = readJsonQuery(
    `
      SELECT seq, type, created_at, payload
      FROM agent_events
      WHERE trace_id = ?
      ORDER BY seq ASC
    `,
    [traceId]
  )

  for (const event of events) {
    console.log(`${event.seq}  ${event.type}  ${formatTime(event.created_at)}`)
    console.log(`  ${compact(event.payload, 1000)}`)
  }
}

function printTools(traceId) {
  const steps = readJsonQuery(
    `
      SELECT step_index, status, tool_name, tool_call_id, output_blob_id, error_message
      FROM agent_trace_steps
      WHERE trace_id = ? AND step_type = 'call_tool'
      ORDER BY step_index ASC
    `,
    [traceId]
  )

  for (const step of steps) {
    const output = readBlob(step.output_blob_id)
    console.log(
      [
        `${step.step_index}`,
        step.status,
        step.tool_name || "unknown_tool",
        step.tool_call_id ? `id=${step.tool_call_id}` : null,
        output ? `outputChars=${output.value.length}` : "outputChars=0",
        step.error_message ? `error=${compact(step.error_message, 100)}` : null
      ]
        .filter(Boolean)
        .join("  ")
    )
  }
}

function printMessages(traceId, stepArg) {
  const stepIndex = stepArg === null ? 0 : Number(stepArg)
  const [step] = readJsonQuery(
    `
      SELECT messages_baseline_blob_id, messages_delta_blob_id
      FROM agent_trace_steps
      WHERE trace_id = ? AND step_index = ?
      LIMIT 1
    `,
    [traceId, stepIndex]
  )

  if (!step) {
    throw new Error(`Step ${stepIndex} not found in trace "${traceId}".`)
  }

  const baseline = readBlob(step.messages_baseline_blob_id)
  if (!baseline) {
    console.log("No messages baseline blob recorded for this step.")
    return
  }

  const baselineMessages = JSON.parse(baseline.value)
  const delta = readBlob(step.messages_delta_blob_id)
  let messages = baselineMessages
  if (delta) {
    const parsedDelta = JSON.parse(delta.value)
    messages = Array.isArray(parsedDelta)
      ? [...baselineMessages, ...parsedDelta]
      : [...baselineMessages, ...(parsedDelta.append || [])]
  }

  console.log(JSON.stringify(messages, null, 2))
}

function handleTraceCommand(traceArgs) {
  const [command, rawTraceId, ...rest] = traceArgs

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage()
    return
  }

  if (command === "list") {
    printTraceList()
    return
  }

  if (command !== "inspect") {
    throw new Error(`Unknown trace command "${command}".`)
  }

  const traceId = resolveTraceId(rawTraceId || "latest")
  const trace = getTrace(traceId)
  const stepFlagIndex = rest.indexOf("--step")
  const stepArg = stepFlagIndex >= 0 ? rest[stepFlagIndex + 1] : null

  printTraceHeader(trace)

  if (stepArg !== null && stepArg !== undefined) {
    printStep(traceId, Number(stepArg))
    if (rest.includes("--messages")) {
      console.log("\nmessages")
      printMessages(traceId, stepArg)
    }
    return
  }

  if (rest.includes("--events")) {
    printEvents(traceId)
    return
  }

  if (rest.includes("--tools")) {
    printTools(traceId)
    return
  }

  if (rest.includes("--messages")) {
    printMessages(traceId, null)
    return
  }

  console.log("")
  printTimeline(trace)
}

try {
  handleTraceCommand(args)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

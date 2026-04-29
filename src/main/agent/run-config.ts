import type { ToolRuntime } from "langchain"

const AGENT_STREAM_MODE = ["messages", "values"] as Array<"messages" | "values">

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : null
}

export function buildAgentRunConfig(
  threadId: string,
  runId: string,
  abortController: AbortController
) {
  return {
    configurable: { thread_id: threadId },
    metadata: { run_id: runId },
    signal: abortController.signal,
    streamMode: [...AGENT_STREAM_MODE],
    recursionLimit: 1000
  }
}

export function buildAgentResumeConfig(
  threadId: string,
  runId: string,
  abortController: AbortController
) {
  return {
    configurable: { thread_id: threadId, run_id: runId },
    metadata: { run_id: runId },
    signal: abortController.signal,
    streamMode: [...AGENT_STREAM_MODE],
    recursionLimit: 1000
  }
}

export function getRunIdFromToolRuntime(runtime: ToolRuntime): string | null {
  return (
    readStringField(runtime.metadata, "run_id") ??
    readStringField(runtime.config?.metadata, "run_id") ??
    readStringField(runtime.configurable, "run_id") ??
    readStringField(runtime.config?.configurable, "run_id")
  )
}

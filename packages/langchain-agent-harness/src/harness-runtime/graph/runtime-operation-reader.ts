import type {
  RuntimeCompactOperation,
  RuntimeOperation,
  RuntimeOperationKind
} from "../../runtime-operation"
import type { RunnableConfig } from "@langchain/core/runnables"

const RUNTIME_OPERATION_KINDS = new Set<RuntimeOperationKind>([
  "invoke",
  "resume",
  "drain",
  "complete",
  "fail",
  "abort",
  "compact"
])

function readRuntimeConfigString(
  config: RunnableConfig,
  key: "run_id" | "thread_id" | "workspace_path"
): string {
  const value = config.configurable?.[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[RuntimeGraph] Runtime config is missing ${key}.`)
  }

  return value
}

export function readRuntimeOperation(config: RunnableConfig): RuntimeOperation {
  const kind = config.configurable?.runtime_operation_kind
  if (typeof kind !== "string" || !RUNTIME_OPERATION_KINDS.has(kind as RuntimeOperationKind)) {
    throw new Error("[RuntimeGraph] Runtime config is missing runtime_operation_kind.")
  }

  const operationBase = {
    kind: kind as RuntimeOperationKind,
    runId: readRuntimeConfigString(config, "run_id"),
    threadId: readRuntimeConfigString(config, "thread_id"),
    workspacePath: readRuntimeConfigString(config, "workspace_path")
  }
  if (kind === "compact") {
    const trigger = config.configurable?.runtime_compact_trigger
    if (typeof trigger !== "string" || trigger.length === 0) {
      throw new Error("[RuntimeGraph] Compact operation is missing runtime_compact_trigger.")
    }

    const preserveLastUserMessageCount =
      config.configurable?.runtime_compact_preserve_last_user_message_count
    if (
      preserveLastUserMessageCount !== undefined &&
      (!Number.isInteger(preserveLastUserMessageCount) || preserveLastUserMessageCount < 0)
    ) {
      throw new Error(
        "[RuntimeGraph] runtime_compact_preserve_last_user_message_count must be a non-negative integer."
      )
    }

    const reason = config.configurable?.runtime_compact_reason
    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      throw new Error("[RuntimeGraph] runtime_compact_reason must be a string or null.")
    }

    return {
      ...operationBase,
      kind: "compact",
      preserveLastUserMessageCount:
        preserveLastUserMessageCount === undefined
          ? undefined
          : (preserveLastUserMessageCount as number),
      reason: reason as string | null | undefined,
      trigger
    } satisfies RuntimeCompactOperation
  }

  return {
    ...operationBase,
    kind: kind as Exclude<RuntimeOperationKind, "compact">
  } as RuntimeOperation
}

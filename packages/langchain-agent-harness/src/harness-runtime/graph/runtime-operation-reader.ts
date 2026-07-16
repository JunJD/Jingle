import type { RuntimeOperation } from "../../runtime-operation"
import type { RunnableConfig } from "@langchain/core/runnables"

type RuntimeGraphOperationKind = "invoke" | "resume"

const RUNTIME_OPERATION_KINDS = new Set<RuntimeGraphOperationKind>(["invoke", "resume"])

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
  if (typeof kind !== "string" || !RUNTIME_OPERATION_KINDS.has(kind as RuntimeGraphOperationKind)) {
    throw new Error("[RuntimeGraph] Runtime config is missing runtime_operation_kind.")
  }

  const operationBase = {
    kind: kind as RuntimeGraphOperationKind,
    runId: readRuntimeConfigString(config, "run_id"),
    threadId: readRuntimeConfigString(config, "thread_id"),
    workspacePath: readRuntimeConfigString(config, "workspace_path")
  }
  return operationBase as RuntimeOperation
}

import { z } from "zod/v4"
import type { AgentConfig } from "./app-types"

export const COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE =
  "computer_use.settings_apply_failed" as const

export const computerUseSettingsRuntimeStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("applied") }).strict(),
  z.object({ state: z.literal("applying") }).strict(),
  z
    .object({
      diagnosticCode: z.literal(COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE),
      retryable: z.literal(true),
      state: z.literal("retry_required")
    })
    .strict()
])

export type ComputerUseSettingsRuntimeStatus = z.infer<
  typeof computerUseSettingsRuntimeStatusSchema
>

export interface AgentConfigUpdateResult {
  config: AgentConfig
  computerUseRuntime: ComputerUseSettingsRuntimeStatus
}

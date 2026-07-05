import { createMiddleware } from "langchain"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"
import { jingleAgentTitleStateSchema } from "./title-state"
import { shouldGenerateJingleTitle, type JingleTitlePolicyState } from "./title-policy"

export interface CreateJingleTitleMiddlewareOptions {
  generateTitle: (state: JingleTitlePolicyState) => Promise<string | null>
}

function createJingleTitleRuntimeMiddleware(options: CreateJingleTitleMiddlewareOptions) {
  return createMiddleware({
    name: "TitleMiddleware",
    stateSchema: jingleAgentTitleStateSchema,
    afterModel: async (state) => {
      const titleState = state as JingleTitlePolicyState
      if (!shouldGenerateJingleTitle(titleState)) {
        return undefined
      }

      const title = await options.generateTitle(titleState)
      return title ? { title } : undefined
    }
  })
}

export function createJingleTitleHook(
  options: CreateJingleTitleMiddlewareOptions
): RuntimeMiddlewareHook {
  return defineJingleHarnessHook({
    name: "title",
    phase: "agent_loop",
    adapterStateKeys: [],
    reads: [],
    runtimeStateKeys: ["messages"],
    writes: ["title"],
    writePolicy: "command-update",
    failureSemantics: "projection",
    observableSignals: ["state", "stream"],
    createMiddleware: () => createJingleTitleRuntimeMiddleware(options)
  })
}

import type { AgentMiddleware } from "langchain"
import {
  createJingleFilesystemMiddleware,
  type JingleFilesystemMiddlewareOptions
} from "./harness-runtime/filesystem"
import {
  createJingleSkillsMiddleware,
  type JingleSkillsMiddlewareOptions
} from "./harness-runtime/skills"

export interface CreateRuntimeSandboxCapabilityInput {
  backend: JingleFilesystemMiddlewareOptions["backend"] & JingleSkillsMiddlewareOptions["backend"]
  executeToolDescription: string
  filesystemSystemPrompt: string
  skillSources: JingleSkillsMiddlewareOptions["sources"]
}

export interface RuntimeSandboxCapability {
  filesystemEntry: AgentMiddleware
  skillsEntry: AgentMiddleware
}

export function createRuntimeSandboxCapability(
  input: CreateRuntimeSandboxCapabilityInput
): RuntimeSandboxCapability {
  return {
    filesystemEntry: createJingleFilesystemMiddleware({
      backend: input.backend,
      customToolDescriptions: {
        execute: input.executeToolDescription
      },
      systemPrompt: input.filesystemSystemPrompt
    }),
    skillsEntry: createJingleSkillsMiddleware({
      backend: input.backend,
      sources: input.skillSources
    })
  }
}

import type { ExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { MutationPrediction } from "@shared/mutation-prediction"
import type {
  GuardrailDecision,
  GuardrailProvider,
  GuardrailRequest
} from "@jingle/langchain-agent-harness/transitional"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"
import { createExecuteCommandSessionEnv } from "./execute-command-cwd"
import type { ExecuteCommandClassifier } from "./execute-command-classifier"
import type { MutationPredictor } from "./mutation-predictor"

const EXECUTE_TOOL_NAME = "execute"

export interface ExecuteCommandGuardrailMetadata {
  executeCommandPolicy?: ExecuteCommandPolicy
  mutationPrediction?: MutationPrediction
}

type ExecuteCommandGuardrailDecision = GuardrailDecision<ExecuteCommandGuardrailMetadata>

export interface ExecuteCommandGuardrailProviderOptions {
  classifier: ExecuteCommandClassifier
  predictor: MutationPredictor
}

function buildDeniedDecision(
  reason: string,
  metadata?: ExecuteCommandGuardrailMetadata
): ExecuteCommandGuardrailDecision {
  return {
    allow: false,
    reasons: [
      {
        code: "jingle.controlled_shell_denied",
        message: reason
      }
    ],
    metadata
  }
}

function buildAllowedDecision(
  classification: ExecuteCommandPolicy,
  metadata?: ExecuteCommandGuardrailMetadata
): ExecuteCommandGuardrailDecision {
  return {
    allow: true,
    reasons: [
      {
        code: "jingle.controlled_shell_allowed",
        message: classification.summary
      }
    ],
    metadata: {
      ...metadata,
      executeCommandPolicy: classification
    }
  }
}

function buildUnknownCommandPolicy(
  classification: ExecuteCommandPolicy,
  reason: string
): ExecuteCommandPolicy {
  return {
    ...classification,
    profile: "unknown_command",
    disposition: "require_approval",
    summary: `Unknown command requires approval (${classification.commands.slice(0, 4).join(", ") || "shell command"}).`,
    reason
  }
}

function buildOutsideWorkspaceCwdPolicy(params: {
  classification: ExecuteCommandPolicy
  command: string
  cwd: string
  cwdInput: string
}): ExecuteCommandPolicy {
  return {
    command: params.command,
    profile: "host_unsafe",
    disposition: "require_approval",
    summary: "Command cwd is outside the workspace and requires approval.",
    reason: `Command cwd resolves outside the workspace: ${params.cwdInput} -> ${params.cwd}. Approve only if you intend to run this command outside the current workspace.`,
    commands: params.classification.commands,
    ...(params.classification.networkTargets
      ? { networkTargets: params.classification.networkTargets }
      : {})
  }
}

export function createExecuteCommandGuardrailProvider(
  options: ExecuteCommandGuardrailProviderOptions
): GuardrailProvider<ExecuteCommandGuardrailMetadata> {
  return {
    async evaluate(request: GuardrailRequest): Promise<ExecuteCommandGuardrailDecision> {
      if (request.toolName !== EXECUTE_TOOL_NAME) {
        return {
          allow: true
        }
      }

      const command =
        typeof request.toolInput.command === "string" ? request.toolInput.command : null
      if (!command || command.trim().length === 0) {
        return {
          allow: true
        }
      }

      const cwdInput = request.toolInput.cwd
      if (cwdInput !== undefined && typeof cwdInput !== "string") {
        return buildDeniedDecision("Execute cwd must be a string when provided.")
      }

      const sessionEnv = createExecuteCommandSessionEnv(request.workspacePath)
      const cwd = sessionEnv.resolveCwd(cwdInput)

      const classification = options.classifier.classify(command)

      if (classification.disposition === "deny") {
        return buildDeniedDecision(classification.reason, {
          executeCommandPolicy: classification
        })
      }

      if (classification.networkTargets?.length) {
        try {
          await Promise.all(
            classification.networkTargets.map((target) => assertSafePublicHttpUrl(target))
          )
        } catch (error) {
          return buildDeniedDecision(
            error instanceof Error
              ? error.message
              : "Network targets are outside the controlled shell profile.",
            {
              executeCommandPolicy: classification
            }
          )
        }
      }

      if (!sessionEnv.isInsideWorkspacePath(cwd)) {
        return buildAllowedDecision(
          buildOutsideWorkspaceCwdPolicy({
            classification,
            command,
            cwd,
            cwdInput: cwdInput ?? cwd
          })
        )
      }

      if (classification.disposition === "allow") {
        return buildAllowedDecision(classification)
      }

      if (classification.profile !== "predictable_mutation") {
        return buildAllowedDecision(classification)
      }

      const prediction = await options.predictor.predictExecute(command, { cwd })
      if (prediction.status !== "predicted") {
        if (prediction.status === "unsupported_command") {
          return buildAllowedDecision(
            buildUnknownCommandPolicy(
              classification,
              "Command could not be simulated in just-bash, so it is treated as an unknown command and requires user approval."
            ),
            {
              mutationPrediction: prediction
            }
          )
        }

        return buildDeniedDecision(
          `Command may modify files, but target files could not be predicted (${prediction.status}). Use explicit file tools or simplify the shell command.`,
          {
            executeCommandPolicy: classification,
            mutationPrediction: prediction
          }
        )
      }

      return buildAllowedDecision(classification, {
        mutationPrediction: prediction
      })
    }
  }
}

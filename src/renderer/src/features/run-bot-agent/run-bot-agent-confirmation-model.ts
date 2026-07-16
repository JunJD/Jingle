import type {
  ExtensionRunBotAgentPayload,
  ExtensionRunBotAgentWorkflowLabel
} from "@shared/extension-runtime-protocol"
import type { ProjectWorkflowDefinition, ThreadWorkflowCreateInput } from "@shared/thread-workflow"

export interface RunBotAgentConfirmationResolution {
  invalidLabelTypeKeys: string[]
  missingLabelKeys: string[]
  missingStatus: boolean
  requestedLabels: ExtensionRunBotAgentWorkflowLabel[]
  resolvedStatusKey: string | null
  selectedProject: ProjectWorkflowDefinition | null
}

export function resolveRunBotAgentConfirmation(
  input: ExtensionRunBotAgentPayload,
  selectedProject: ProjectWorkflowDefinition | null
): RunBotAgentConfirmationResolution {
  const requestedStatusKey = input.workflow?.status
  const resolvedStatusKey =
    requestedStatusKey ?? selectedProject?.statuses.find((status) => status.isDefault)?.key ?? null
  const requestedLabels = input.workflow?.labels ?? []
  const labelsByKey = new Map(selectedProject?.labels.map((label) => [label.key, label]) ?? [])
  const missingLabelKeys: string[] = []
  const invalidLabelTypeKeys: string[] = []

  for (const requestedLabel of requestedLabels) {
    const definition = labelsByKey.get(requestedLabel.key)
    if (!definition) {
      missingLabelKeys.push(requestedLabel.key)
    } else if (definition.valueType !== "string") {
      invalidLabelTypeKeys.push(requestedLabel.key)
    }
  }

  return {
    invalidLabelTypeKeys,
    missingLabelKeys,
    missingStatus: Boolean(
      selectedProject &&
      resolvedStatusKey &&
      !selectedProject.statuses.some((status) => status.key === resolvedStatusKey)
    ),
    requestedLabels,
    resolvedStatusKey,
    selectedProject
  }
}

export function createConfirmedRunBotAgentWorkflow(
  input: ExtensionRunBotAgentPayload,
  resolution: RunBotAgentConfirmationResolution
): ThreadWorkflowCreateInput | null {
  if (
    !resolution.selectedProject ||
    !resolution.resolvedStatusKey ||
    resolution.missingStatus ||
    resolution.missingLabelKeys.length > 0 ||
    resolution.invalidLabelTypeKeys.length > 0
  ) {
    return null
  }

  return {
    labels: resolution.requestedLabels.map((label) => ({
      key: label.key,
      value: label.value
    })),
    primarySourceRef: input.sourceRef,
    statusKey: resolution.resolvedStatusKey
  }
}

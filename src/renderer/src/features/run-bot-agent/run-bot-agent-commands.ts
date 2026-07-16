import type { ProjectWorkflowDefinition } from "@shared/thread-workflow"

interface AddedProject {
  projectId: string
}

export interface RunBotAgentConfirmationCommands {
  addProject: (workspacePath: string) => Promise<AddedProject>
  listProjects: () => Promise<ProjectWorkflowDefinition[]>
  selectProjectFolder: () => Promise<string | null>
}

export const runBotAgentConfirmationCommands: RunBotAgentConfirmationCommands = {
  addProject(workspacePath) {
    return window.api.threadWorkspace.addProject(workspacePath)
  },
  listProjects() {
    return window.api.threadWorkflow.listProjects()
  },
  selectProjectFolder() {
    return window.api.workspace.selectFolder()
  }
}

export type WorkflowStatusCategory = "open" | "closed"

export type WorkflowLabelValueType = "boolean" | "string" | "number" | "date" | "link"

export interface WorkflowColor {
  dark: string
  light: string
}

export interface ThreadWorkflowSourceRef {
  id?: string
  label?: string
  metadata?: Record<string, unknown>
  type: string
  url?: string
}

export interface ThreadWorkflowLabelInput {
  key: string
  value?: string
}

export interface ThreadWorkflowCreateInput {
  labels: ThreadWorkflowLabelInput[]
  primarySourceRef?: ThreadWorkflowSourceRef
  statusKey: string
}

export interface WorkflowStatusDefinition {
  category: WorkflowStatusCategory
  color: WorkflowColor | null
  icon: string | null
  isDefault: boolean
  isFixed: boolean
  key: string
  label: string
  orderIndex: number
  projectId: string
  statusId: string
}

export interface WorkflowLabelDefinition {
  color: WorkflowColor | null
  key: string
  labelId: string
  name: string
  orderIndex: number
  parentLabelId: string | null
  projectId: string
  valueType: WorkflowLabelValueType
}

export interface ThreadWorkflowLabelAssignment {
  label: WorkflowLabelDefinition
  rawValue: string
}

export interface ThreadWorkflowSummary {
  currentGate: string | null
  labels: ThreadWorkflowLabelAssignment[]
  primarySourceRef: ThreadWorkflowSourceRef | null
  projectId: string | null
  status: WorkflowStatusDefinition | null
  statusUpdatedAt: Date | null
  threadId: string
  updatedAt: Date | null
  workspacePath: string | null
}

export interface ThreadWorkflowChangedEvent {
  threadId: string
}

export interface ProjectWorkflowDefinition {
  displayName: string
  labels: WorkflowLabelDefinition[]
  projectId: string
  statuses: WorkflowStatusDefinition[]
  workspacePath: string
}

export interface CreateProjectWorkflowStatusInput {
  category: WorkflowStatusCategory
  color: WorkflowColor
  label: string
  projectId: string
}

export interface CreateProjectWorkflowLabelInput {
  name: string
  parentLabelId?: string
  projectId: string
  valueType: WorkflowLabelValueType
}

export interface SetProjectDefaultWorkflowStatusInput {
  projectId: string
  statusId: string
}

export interface SetThreadWorkflowStatusInput {
  statusId: string
  threadId: string
}

export interface AddThreadWorkflowLabelInput {
  labelId: string
  rawValue: string
  threadId: string
}

export interface RemoveThreadWorkflowLabelInput extends AddThreadWorkflowLabelInput {}

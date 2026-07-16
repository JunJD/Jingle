import { z } from "zod/v4"

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

export type ThreadWorkflowChangedEvent =
  | { projectId: string; scope: "project" }
  | { scope: "thread"; threadId: string }

export interface ProjectWorkflowDefinition {
  displayName: string
  labels: WorkflowLabelDefinition[]
  projectId: string
  statuses: WorkflowStatusDefinition[]
  workspacePath: string
}

export interface ThreadWorkflowView {
  project: ProjectWorkflowDefinition | null
  summary: ThreadWorkflowSummary | null
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

export function normalizeWorkflowLabelRawValue(
  valueType: WorkflowLabelValueType,
  rawValue: string
): string {
  if (valueType === "boolean") {
    if (rawValue !== "") {
      throw new Error("Boolean workflow labels use assignment presence and require an empty value.")
    }
    return ""
  }

  const value = rawValue.trim()
  if (valueType === "string") {
    return value
  }
  if (!value) {
    throw new Error(`${valueType} workflow label values cannot be empty.`)
  }
  if (valueType === "number") {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number workflow label value: ${rawValue}`)
    }
    return Object.is(parsed, -0) ? "0" : String(parsed)
  }
  if (valueType === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid date workflow label value: ${rawValue}`)
    }
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`Invalid date workflow label value: ${rawValue}`)
    }
    return value
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Invalid link workflow label value: ${rawValue}`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Workflow label links must use http or https: ${rawValue}`)
  }
  return parsed.href
}

const canonicalNonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Value must not have surrounding whitespace.")
const workflowColorChannelSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

export const workflowStatusCategorySchema = z.enum(["open", "closed"])
export const workflowLabelValueTypeSchema = z.enum(["boolean", "string", "number", "date", "link"])
export const workflowColorSchema = z
  .object({
    dark: workflowColorChannelSchema,
    light: workflowColorChannelSchema
  })
  .strict()
export const threadWorkflowSourceRefSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    type: canonicalNonEmptyStringSchema,
    url: z.string().url().optional()
  })
  .strict()
export const workflowStatusDefinitionSchema = z
  .object({
    category: workflowStatusCategorySchema,
    color: workflowColorSchema.nullable(),
    icon: z.string().nullable(),
    isDefault: z.boolean(),
    isFixed: z.boolean(),
    key: canonicalNonEmptyStringSchema,
    label: canonicalNonEmptyStringSchema,
    orderIndex: z.int().nonnegative(),
    projectId: canonicalNonEmptyStringSchema,
    statusId: canonicalNonEmptyStringSchema
  })
  .strict()
export const workflowLabelDefinitionSchema = z
  .object({
    color: workflowColorSchema.nullable(),
    key: canonicalNonEmptyStringSchema,
    labelId: canonicalNonEmptyStringSchema,
    name: canonicalNonEmptyStringSchema,
    orderIndex: z.int().nonnegative(),
    parentLabelId: canonicalNonEmptyStringSchema.nullable(),
    projectId: canonicalNonEmptyStringSchema,
    valueType: workflowLabelValueTypeSchema
  })
  .strict()
export const threadWorkflowLabelAssignmentSchema = z
  .object({
    label: workflowLabelDefinitionSchema,
    rawValue: z.string()
  })
  .strict()
  .superRefine((assignment, context) => {
    try {
      if (
        normalizeWorkflowLabelRawValue(assignment.label.valueType, assignment.rawValue) !==
        assignment.rawValue
      ) {
        context.addIssue({
          code: "custom",
          message: "Workflow label assignment value is not canonical."
        })
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid workflow label assignment value."
      })
    }
  })
export const threadWorkflowSummarySchema = z
  .object({
    currentGate: z.string().nullable(),
    labels: z.array(threadWorkflowLabelAssignmentSchema),
    primarySourceRef: threadWorkflowSourceRefSchema.nullable(),
    projectId: canonicalNonEmptyStringSchema.nullable(),
    status: workflowStatusDefinitionSchema.nullable(),
    statusUpdatedAt: z.date().nullable(),
    threadId: canonicalNonEmptyStringSchema,
    updatedAt: z.date().nullable(),
    workspacePath: z.string().min(1).nullable()
  })
  .strict()
export const projectWorkflowDefinitionSchema = z
  .object({
    displayName: canonicalNonEmptyStringSchema,
    labels: z.array(workflowLabelDefinitionSchema),
    projectId: canonicalNonEmptyStringSchema,
    statuses: z.array(workflowStatusDefinitionSchema),
    workspacePath: z.string().min(1)
  })
  .strict()
  .superRefine((project, context) => {
    if (project.statuses.some((status) => status.projectId !== project.projectId)) {
      context.addIssue({
        code: "custom",
        message: "Workflow statuses must belong to their Project definition."
      })
    }
    if (project.labels.some((label) => label.projectId !== project.projectId)) {
      context.addIssue({
        code: "custom",
        message: "Workflow labels must belong to their Project definition."
      })
    }
    const labelIds = new Set(project.labels.map((label) => label.labelId))
    if (
      project.labels.some(
        (label) => label.parentLabelId !== null && !labelIds.has(label.parentLabelId)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Workflow label parents must belong to the same Project definition."
      })
    }
  })
export const projectWorkflowDefinitionsSchema = z.array(projectWorkflowDefinitionSchema)
export const threadWorkflowViewSchema = z
  .object({
    project: projectWorkflowDefinitionSchema.nullable(),
    summary: threadWorkflowSummarySchema.nullable()
  })
  .strict()
  .superRefine((view, context) => {
    const projectId = view.summary?.projectId ?? null
    if (projectId === null) {
      if (view.project !== null) {
        context.addIssue({
          code: "custom",
          message: "A projectless thread workflow view cannot include a Project."
        })
      }
      return
    }
    if (view.project?.projectId !== projectId) {
      context.addIssue({
        code: "custom",
        message: "Thread workflow summary and Project definition must have the same projectId."
      })
      return
    }
    if (view.summary?.status && view.summary.status.projectId !== projectId) {
      context.addIssue({
        code: "custom",
        message: "Thread workflow status must belong to the view Project."
      })
    }
    if (view.summary?.labels.some((assignment) => assignment.label.projectId !== projectId)) {
      context.addIssue({
        code: "custom",
        message: "Thread workflow labels must belong to the view Project."
      })
    }
  })
export const threadWorkflowChangedEventSchema = z.discriminatedUnion("scope", [
  z.object({ projectId: canonicalNonEmptyStringSchema, scope: z.literal("project") }).strict(),
  z.object({ scope: z.literal("thread"), threadId: canonicalNonEmptyStringSchema }).strict()
])

export const listProjectWorkflowsRequestSchema = z.tuple([])
export const getThreadWorkflowRequestSchema = z
  .object({ threadId: canonicalNonEmptyStringSchema })
  .strict()
export const createProjectWorkflowStatusInputSchema = z
  .object({
    category: workflowStatusCategorySchema,
    color: workflowColorSchema,
    label: canonicalNonEmptyStringSchema,
    projectId: canonicalNonEmptyStringSchema
  })
  .strict()
export const setProjectDefaultWorkflowStatusInputSchema = z
  .object({
    projectId: canonicalNonEmptyStringSchema,
    statusId: canonicalNonEmptyStringSchema
  })
  .strict()
export const createProjectWorkflowLabelInputSchema = z
  .object({
    name: canonicalNonEmptyStringSchema,
    parentLabelId: canonicalNonEmptyStringSchema.optional(),
    projectId: canonicalNonEmptyStringSchema,
    valueType: workflowLabelValueTypeSchema
  })
  .strict()
export const setThreadWorkflowStatusInputSchema = z
  .object({
    statusId: canonicalNonEmptyStringSchema,
    threadId: canonicalNonEmptyStringSchema
  })
  .strict()
export const addThreadWorkflowLabelInputSchema = z
  .object({
    labelId: canonicalNonEmptyStringSchema,
    rawValue: z.string(),
    threadId: canonicalNonEmptyStringSchema
  })
  .strict()
export const removeThreadWorkflowLabelInputSchema = addThreadWorkflowLabelInputSchema

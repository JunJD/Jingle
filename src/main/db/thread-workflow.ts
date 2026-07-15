import { randomUUID } from "node:crypto"
import { Prisma, type WorkflowLabel, type WorkflowStatus } from "@prisma/client"
import type { ThreadRow } from "./threads"
import { mapThreadRow } from "./threads"
import { getPrismaClient } from "./client"
import type {
  AddThreadWorkflowLabelInput,
  CreateProjectWorkflowLabelInput,
  CreateProjectWorkflowStatusInput,
  ProjectWorkflowDefinition,
  RemoveThreadWorkflowLabelInput,
  SetThreadWorkflowStatusInput,
  SetProjectDefaultWorkflowStatusInput,
  ThreadWorkflowCreateInput,
  ThreadWorkflowLabelAssignment,
  ThreadWorkflowSourceRef,
  ThreadWorkflowSummary,
  WorkflowColor,
  WorkflowLabelDefinition,
  WorkflowLabelValueType,
  WorkflowStatusCategory,
  WorkflowStatusDefinition
} from "@shared/thread-workflow"

const DEFAULT_PROJECT_WORKFLOW_STATUSES = [
  {
    category: "open",
    color: { dark: "#60A5FA", light: "#2563EB" },
    isDefault: true,
    key: "ready",
    label: "Ready"
  },
  {
    category: "open",
    color: { dark: "#2DD4BF", light: "#0F766E" },
    isDefault: false,
    key: "running",
    label: "Running"
  },
  {
    category: "open",
    color: { dark: "#F87171", light: "#DC2626" },
    isDefault: false,
    key: "blocked",
    label: "Blocked"
  },
  {
    category: "open",
    color: { dark: "#A78BFA", light: "#7C3AED" },
    isDefault: false,
    key: "review",
    label: "Review"
  },
  {
    category: "closed",
    color: { dark: "#4ADE80", light: "#15803D" },
    isDefault: false,
    key: "done",
    label: "Done"
  },
  {
    category: "closed",
    color: { dark: "#94A3B8", light: "#64748B" },
    isDefault: false,
    key: "cancelled",
    label: "Cancelled"
  }
] as const

const DEFAULT_PROJECT_WORKFLOW_LABELS = [
  { key: "source", name: "Source" },
  { key: "repo", name: "Repository" },
  { key: "kind", name: "Kind" }
] as const

const threadWorkflowSummaryInclude = {
  workflow: {
    include: {
      status: true
    }
  },
  workflowLabels: {
    include: {
      label: true
    },
    orderBy: {
      createdAt: "asc"
    }
  },
  workspaceBinding: true
} satisfies Prisma.ThreadInclude

type ThreadWorkflowSummaryRow = Prisma.ThreadGetPayload<{
  include: typeof threadWorkflowSummaryInclude
}>

const threadWorkflowMutationInclude = {
  workflow: {
    include: {
      status: true
    }
  },
  workflowLabels: {
    include: {
      label: true
    }
  },
  workspaceBinding: true
} satisfies Prisma.ThreadInclude

type ThreadWorkflowMutationRow = Prisma.ThreadGetPayload<{
  include: typeof threadWorkflowMutationInclude
}>

const projectWorkflowDefinitionInclude = {
  workflowLabels: {
    orderBy: {
      orderIndex: "asc"
    }
  },
  workflowStatuses: {
    orderBy: {
      orderIndex: "asc"
    }
  }
} satisfies Prisma.ProjectInclude

type ProjectWorkflowDefinitionRow = Prisma.ProjectGetPayload<{
  include: typeof projectWorkflowDefinitionInclude
}>

export interface CreateClassifiedThreadInput {
  metadata?: Record<string, unknown>
  project: {
    canonicalWorkspacePath: string
    projectId: string
    workspaceKey: string
  }
  threadId: string
  title: string
  workflow: ThreadWorkflowCreateInput
}

export interface ApplyThreadWorkflowRuntimeTransitionInput {
  currentGate: string | null
  expectedStatusKeys?: readonly string[]
  statusKey?: string
  threadId: string
}

function defaultStatusId(projectId: string, key: string): string {
  return `${projectId}:workflow-status:${key}`
}

function defaultLabelId(projectId: string, key: string): string {
  return `${projectId}:workflow-label:${key}`
}

function customDefinitionKey(label: string, prefix: "label" | "status"): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

  return slug || `${prefix}-${randomUUID().slice(0, 8)}`
}

function normalizeStatusCategory(value: string): WorkflowStatusCategory {
  if (value === "open" || value === "closed") {
    return value
  }

  throw new Error(`Unknown workflow status category: ${value}`)
}

function normalizeLabelValueType(value: string): WorkflowLabelValueType {
  if (
    value === "boolean" ||
    value === "string" ||
    value === "number" ||
    value === "date" ||
    value === "link"
  ) {
    return value
  }

  throw new Error(`Unknown workflow label value type: ${value}`)
}

function parseWorkflowColor(value: string | null, ownerId: string): WorkflowColor | null {
  if (value === null) {
    return null
  }

  const parsed = JSON.parse(value) as unknown
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "dark" in parsed &&
    typeof parsed.dark === "string" &&
    "light" in parsed &&
    typeof parsed.light === "string"
  ) {
    return {
      dark: parsed.dark,
      light: parsed.light
    }
  }

  throw new Error(`Workflow definition "${ownerId}" has invalid color JSON.`)
}

function parseSourceRef(value: string | null, threadId: string): ThreadWorkflowSourceRef | null {
  if (value === null) {
    return null
  }

  const parsed = JSON.parse(value) as unknown
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    typeof parsed.type !== "string"
  ) {
    throw new Error(`Thread "${threadId}" has an invalid workflow source reference.`)
  }

  return parsed as ThreadWorkflowSourceRef
}

function mapStatusDefinition(row: WorkflowStatus): WorkflowStatusDefinition {
  return {
    category: normalizeStatusCategory(row.category),
    color: parseWorkflowColor(row.colorJson, row.statusId),
    icon: row.icon,
    isDefault: row.isDefault,
    isFixed: row.isFixed,
    key: row.key,
    label: row.label,
    orderIndex: row.orderIndex,
    projectId: row.projectId,
    statusId: row.statusId
  }
}

function mapLabelDefinition(row: WorkflowLabel): WorkflowLabelDefinition {
  return {
    color: parseWorkflowColor(row.colorJson, row.labelId),
    key: row.key,
    labelId: row.labelId,
    name: row.name,
    orderIndex: row.orderIndex,
    parentLabelId: row.parentLabelId,
    projectId: row.projectId,
    valueType: normalizeLabelValueType(row.valueType)
  }
}

function mapLabelAssignment(
  row: ThreadWorkflowSummaryRow["workflowLabels"][number]
): ThreadWorkflowLabelAssignment {
  return {
    label: mapLabelDefinition(row.label),
    rawValue: row.rawValue
  }
}

function resolveWorkflowProjectId(
  row: ThreadWorkflowSummaryRow | ThreadWorkflowMutationRow
): string | null {
  const binding = row.workspaceBinding
  if (!binding) {
    if (row.workflow || row.workflowLabels.length > 0) {
      throw new Error(`Thread "${row.threadId}" workflow is not assigned to a Project.`)
    }
    return null
  }

  if (binding.workspaceKind === "projectless") {
    if (binding.projectId || row.workflow || row.workflowLabels.length > 0) {
      throw new Error(`Thread "${row.threadId}" workflow is not assigned to a Project.`)
    }
    return null
  }

  if (binding.workspaceKind !== "project") {
    throw new Error(`Unknown thread workspace kind: ${binding.workspaceKind}`)
  }
  if (!binding.projectId) {
    throw new Error(`Thread "${row.threadId}" Project binding is missing projectId.`)
  }
  if (!row.workflow && row.workflowLabels.length > 0) {
    throw new Error(`Thread "${row.threadId}" has workflow labels without a workflow.`)
  }

  if (row.workflow?.status && row.workflow.status.projectId !== binding.projectId) {
    throw new Error(`Thread "${row.threadId}" workflow status belongs to a different Project.`)
  }

  for (const assignment of row.workflowLabels) {
    if (assignment.label.projectId !== binding.projectId) {
      throw new Error(`Thread "${row.threadId}" workflow label belongs to a different Project.`)
    }
  }

  return binding.projectId
}

function mapThreadWorkflowSummary(row: ThreadWorkflowSummaryRow): ThreadWorkflowSummary {
  const projectId = resolveWorkflowProjectId(row)
  const workflow = row.workflow

  return {
    currentGate: workflow?.currentGate ?? null,
    labels: row.workflowLabels.map(mapLabelAssignment),
    primarySourceRef: workflow ? parseSourceRef(workflow.primarySourceRefJson, row.threadId) : null,
    projectId,
    status: workflow?.status ? mapStatusDefinition(workflow.status) : null,
    statusUpdatedAt: workflow ? new Date(Number(workflow.statusUpdatedAt)) : null,
    threadId: row.threadId,
    updatedAt: workflow ? new Date(Number(workflow.updatedAt)) : null,
    workspacePath: row.workspaceBinding?.workspacePath ?? null
  }
}

function mapProjectWorkflowDefinition(
  row: ProjectWorkflowDefinitionRow
): ProjectWorkflowDefinition {
  return {
    displayName: row.displayName,
    labels: row.workflowLabels.map(mapLabelDefinition),
    projectId: row.projectId,
    statuses: row.workflowStatuses.map(mapStatusDefinition),
    workspacePath: row.canonicalWorkspacePath
  }
}

export async function ensureDefaultProjectWorkflowTaxonomy(
  tx: Prisma.TransactionClient,
  projectId: string,
  now: bigint
): Promise<void> {
  const statuses = await tx.workflowStatus.findMany({
    select: {
      isDefault: true,
      key: true
    },
    where: {
      projectId
    }
  })
  const labelCount = await tx.workflowLabel.count({
    where: {
      key: {
        in: DEFAULT_PROJECT_WORKFLOW_LABELS.map((label) => label.key)
      },
      projectId
    }
  })
  const existingStatusKeys = new Set(statuses.map((status) => status.key))
  const defaultStatusCount = statuses.filter((status) => status.isDefault).length
  if (defaultStatusCount > 1) {
    throw new Error(
      `Project "${projectId}" must have at most one default workflow status; found ${defaultStatusCount}.`
    )
  }

  if (
    DEFAULT_PROJECT_WORKFLOW_STATUSES.every((status) => existingStatusKeys.has(status.key)) &&
    labelCount === DEFAULT_PROJECT_WORKFLOW_LABELS.length
  ) {
    if (defaultStatusCount === 0) {
      await tx.workflowStatus.update({
        data: {
          isDefault: true,
          updatedAt: now
        },
        where: {
          projectId_key: {
            key: "ready",
            projectId
          }
        }
      })
    }
    return
  }

  for (const [orderIndex, status] of DEFAULT_PROJECT_WORKFLOW_STATUSES.entries()) {
    const shouldBeDefault = status.isDefault && defaultStatusCount === 0
    await tx.workflowStatus.upsert({
      create: {
        category: status.category,
        colorJson: JSON.stringify(status.color),
        createdAt: now,
        isDefault: shouldBeDefault,
        isFixed: true,
        key: status.key,
        label: status.label,
        orderIndex,
        projectId,
        statusId: defaultStatusId(projectId, status.key),
        updatedAt: now
      },
      update: {},
      where: {
        projectId_key: {
          key: status.key,
          projectId
        }
      }
    })
  }

  if (defaultStatusCount === 0) {
    await tx.workflowStatus.update({
      data: {
        isDefault: true,
        updatedAt: now
      },
      where: {
        projectId_key: {
          key: "ready",
          projectId
        }
      }
    })
  }

  for (const [orderIndex, label] of DEFAULT_PROJECT_WORKFLOW_LABELS.entries()) {
    await tx.workflowLabel.upsert({
      create: {
        createdAt: now,
        key: label.key,
        labelId: defaultLabelId(projectId, label.key),
        name: label.name,
        orderIndex,
        projectId,
        updatedAt: now,
        valueType: "string"
      },
      update: {},
      where: {
        projectId_key: {
          key: label.key,
          projectId
        }
      }
    })
  }
}

export async function listProjectWorkflowDefinitions(): Promise<ProjectWorkflowDefinition[]> {
  const rows = await getPrismaClient().project.findMany({
    include: projectWorkflowDefinitionInclude,
    orderBy: {
      displayName: "asc"
    },
    where: {
      archivedAt: null
    }
  })

  return rows.map(mapProjectWorkflowDefinition)
}

async function getProjectWorkflowDefinition(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<ProjectWorkflowDefinition> {
  const row = await tx.project.findFirst({
    include: projectWorkflowDefinitionInclude,
    where: {
      archivedAt: null,
      projectId
    }
  })
  if (!row) {
    throw new Error(`Unknown Project: ${projectId}`)
  }

  return mapProjectWorkflowDefinition(row)
}

export async function createProjectWorkflowStatus(
  input: CreateProjectWorkflowStatusInput
): Promise<ProjectWorkflowDefinition> {
  const label = input.label.trim()
  if (!label) {
    throw new Error("Workflow status label cannot be empty.")
  }

  const prisma = getPrismaClient()
  return prisma.$transaction(async (tx) => {
    const project = await getProjectWorkflowDefinition(tx, input.projectId)
    if (project.statuses.some((status) => status.label.toLowerCase() === label.toLowerCase())) {
      throw new Error(`Workflow status "${label}" already exists.`)
    }

    const baseKey = customDefinitionKey(label, "status")
    const key = project.statuses.some((status) => status.key === baseKey)
      ? `${baseKey}-${randomUUID().slice(0, 8)}`
      : baseKey
    const now = BigInt(Date.now())
    await tx.workflowStatus.create({
      data: {
        category: input.category,
        colorJson: JSON.stringify(input.color),
        createdAt: now,
        isDefault: false,
        isFixed: false,
        key,
        label,
        orderIndex: project.statuses.length,
        projectId: input.projectId,
        statusId: randomUUID(),
        updatedAt: now
      }
    })

    return getProjectWorkflowDefinition(tx, input.projectId)
  })
}

export async function setProjectDefaultWorkflowStatus(
  input: SetProjectDefaultWorkflowStatusInput
): Promise<ProjectWorkflowDefinition> {
  const prisma = getPrismaClient()
  return prisma.$transaction(async (tx) => {
    const status = await tx.workflowStatus.findUnique({
      where: {
        statusId: input.statusId
      }
    })
    if (!status || status.projectId !== input.projectId) {
      throw new Error(
        `Workflow status "${input.statusId}" does not belong to Project "${input.projectId}".`
      )
    }

    const now = BigInt(Date.now())
    await tx.workflowStatus.updateMany({
      data: {
        isDefault: false,
        updatedAt: now
      },
      where: {
        isDefault: true,
        projectId: input.projectId
      }
    })
    await tx.workflowStatus.update({
      data: {
        isDefault: true,
        updatedAt: now
      },
      where: {
        statusId: input.statusId
      }
    })

    return getProjectWorkflowDefinition(tx, input.projectId)
  })
}

export async function createProjectWorkflowLabel(
  input: CreateProjectWorkflowLabelInput
): Promise<ProjectWorkflowDefinition> {
  const name = input.name.trim()
  if (!name) {
    throw new Error("Workflow label name cannot be empty.")
  }

  const prisma = getPrismaClient()
  return prisma.$transaction(async (tx) => {
    const project = await getProjectWorkflowDefinition(tx, input.projectId)
    if (project.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Workflow label "${name}" already exists.`)
    }
    if (
      input.parentLabelId &&
      !project.labels.some((label) => label.labelId === input.parentLabelId)
    ) {
      throw new Error(
        `Workflow label parent "${input.parentLabelId}" does not belong to Project "${input.projectId}".`
      )
    }

    const baseKey = customDefinitionKey(name, "label")
    const key = project.labels.some((label) => label.key === baseKey)
      ? `${baseKey}-${randomUUID().slice(0, 8)}`
      : baseKey
    const now = BigInt(Date.now())
    await tx.workflowLabel.create({
      data: {
        createdAt: now,
        key,
        labelId: randomUUID(),
        name,
        orderIndex: project.labels.length,
        parentLabelId: input.parentLabelId ?? null,
        projectId: input.projectId,
        updatedAt: now,
        valueType: input.valueType
      }
    })

    return getProjectWorkflowDefinition(tx, input.projectId)
  })
}

export async function getThreadWorkflowSummary(
  threadId: string
): Promise<ThreadWorkflowSummary | null> {
  const row = await getPrismaClient().thread.findUnique({
    include: threadWorkflowSummaryInclude,
    where: {
      threadId
    }
  })

  return row ? mapThreadWorkflowSummary(row) : null
}

export async function listThreadWorkflowSummaries(
  threadIds: readonly string[]
): Promise<ThreadWorkflowSummary[]> {
  if (threadIds.length === 0) {
    return []
  }

  const rows = await getPrismaClient().thread.findMany({
    include: threadWorkflowSummaryInclude,
    where: {
      threadId: {
        in: [...threadIds]
      }
    }
  })

  return rows.map(mapThreadWorkflowSummary)
}

export async function createClassifiedThread(
  input: CreateClassifiedThreadInput
): Promise<ThreadRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: {
        projectId: input.project.projectId
      }
    })
    if (!project) {
      throw new Error(`Unknown Project: ${input.project.projectId}`)
    }
    if (
      project.workspaceKey !== input.project.workspaceKey ||
      project.canonicalWorkspacePath !== input.project.canonicalWorkspacePath
    ) {
      throw new Error(`Project "${project.projectId}" does not match the requested workspace.`)
    }

    const status = await tx.workflowStatus.findUnique({
      where: {
        projectId_key: {
          key: input.workflow.statusKey,
          projectId: project.projectId
        }
      }
    })
    if (!status) {
      throw new Error(
        `Unknown workflow status key "${input.workflow.statusKey}" for Project "${project.projectId}".`
      )
    }

    const labelDefinitions = await tx.workflowLabel.findMany({
      where: {
        key: {
          in: input.workflow.labels.map((label) => label.key)
        },
        projectId: project.projectId
      }
    })
    const labelsByKey = new Map(labelDefinitions.map((label) => [label.key, label]))
    for (const label of input.workflow.labels) {
      if (!labelsByKey.has(label.key)) {
        throw new Error(
          `Unknown workflow label key "${label.key}" for Project "${project.projectId}".`
        )
      }
    }

    const thread = await tx.thread.create({
      data: {
        archivedAt: null,
        createdAt: now,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        status: "idle",
        threadId: input.threadId,
        title: input.title,
        updatedAt: now
      }
    })
    await tx.threadWorkspaceBinding.create({
      data: {
        createdAt: now,
        projectId: project.projectId,
        threadId: input.threadId,
        updatedAt: now,
        workspaceKey: project.workspaceKey,
        workspaceKind: "project",
        workspacePath: project.canonicalWorkspacePath
      }
    })
    await tx.threadWorkflow.create({
      data: {
        createdAt: now,
        primarySourceRefJson: input.workflow.primarySourceRef
          ? JSON.stringify(input.workflow.primarySourceRef)
          : null,
        statusId: status.statusId,
        statusUpdatedAt: now,
        threadId: input.threadId,
        updatedAt: now
      }
    })

    for (const labelInput of input.workflow.labels) {
      const label = labelsByKey.get(labelInput.key)
      if (!label) {
        throw new Error(
          `Unknown workflow label key "${labelInput.key}" for Project "${project.projectId}".`
        )
      }
      await tx.threadLabel.create({
        data: {
          createdAt: now,
          labelId: label.labelId,
          rawValue: labelInput.value ?? "",
          threadId: input.threadId
        }
      })
    }

    return mapThreadRow(thread)
  })
}

async function requireProjectThreadState(
  tx: Prisma.TransactionClient,
  threadId: string
): Promise<{ projectId: string; workflow: ThreadWorkflowMutationRow["workflow"] }> {
  const thread = await tx.thread.findUnique({
    include: threadWorkflowMutationInclude,
    where: {
      threadId
    }
  })
  if (!thread) {
    throw new Error(`Unknown thread: ${threadId}`)
  }

  const projectId = resolveWorkflowProjectId(thread)
  if (!projectId) {
    throw new Error(`Thread "${threadId}" is not assigned to a Project.`)
  }

  return {
    projectId,
    workflow: thread.workflow
  }
}

async function getProjectDefaultStatus(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<WorkflowStatus> {
  const statuses = await tx.workflowStatus.findMany({
    where: {
      isDefault: true,
      projectId
    }
  })
  if (statuses.length !== 1) {
    throw new Error(
      `Project "${projectId}" must have exactly one default workflow status; found ${statuses.length}.`
    )
  }

  return statuses[0]
}

export async function applyThreadWorkflowRuntimeTransition(
  input: ApplyThreadWorkflowRuntimeTransitionInput
): Promise<boolean> {
  const prisma = getPrismaClient()
  return prisma.$transaction(async (tx) => {
    const thread = await tx.thread.findUnique({
      include: threadWorkflowMutationInclude,
      where: {
        threadId: input.threadId
      }
    })
    if (!thread) {
      return false
    }
    const projectId = resolveWorkflowProjectId(thread)
    const workflow = thread.workflow
    if (!projectId || !workflow) {
      return false
    }

    const currentStatusKey = workflow.status?.key ?? null
    const targetStatusKey =
      input.statusKey !== undefined &&
      (input.expectedStatusKeys === undefined ||
        (currentStatusKey !== null && input.expectedStatusKeys.includes(currentStatusKey)))
        ? input.statusKey
        : null
    const targetStatus = targetStatusKey
      ? await tx.workflowStatus.findUnique({
          where: {
            projectId_key: {
              key: targetStatusKey,
              projectId
            }
          }
        })
      : null

    if (targetStatusKey && !targetStatus) {
      throw new Error(`Project "${projectId}" is missing workflow status "${targetStatusKey}".`)
    }

    const nextStatusId = targetStatus?.statusId ?? workflow.statusId
    const statusChanged = nextStatusId !== workflow.statusId
    const gateChanged = input.currentGate !== workflow.currentGate
    if (!statusChanged && !gateChanged) {
      return false
    }

    const now = BigInt(Date.now())
    const updated = await tx.threadWorkflow.updateMany({
      data: {
        currentGate: input.currentGate,
        statusId: nextStatusId,
        ...(statusChanged ? { statusUpdatedAt: now } : {}),
        updatedAt: now
      },
      where: {
        statusId: workflow.statusId,
        threadId: input.threadId
      }
    })
    return updated.count === 1
  })
}

export async function setThreadWorkflowStatus(
  input: SetThreadWorkflowStatusInput
): Promise<ThreadWorkflowSummary> {
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    const { projectId } = await requireProjectThreadState(tx, input.threadId)
    const status = await tx.workflowStatus.findUnique({
      where: {
        statusId: input.statusId
      }
    })
    if (!status) {
      throw new Error(`Unknown workflow status: ${input.statusId}`)
    }
    if (status.projectId !== projectId) {
      throw new Error(
        `Workflow status "${input.statusId}" belongs to Project "${status.projectId}", not "${projectId}".`
      )
    }

    const now = BigInt(Date.now())
    await tx.threadWorkflow.upsert({
      create: {
        createdAt: now,
        statusId: status.statusId,
        statusUpdatedAt: now,
        threadId: input.threadId,
        updatedAt: now
      },
      update: {
        statusId: status.statusId,
        statusUpdatedAt: now,
        updatedAt: now
      },
      where: {
        threadId: input.threadId
      }
    })
  })

  const summary = await getThreadWorkflowSummary(input.threadId)
  if (!summary) {
    throw new Error(`Thread "${input.threadId}" does not have a Project workflow.`)
  }
  return summary
}

export async function addThreadWorkflowLabel(
  input: AddThreadWorkflowLabelInput
): Promise<ThreadWorkflowSummary> {
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    const state = await requireProjectThreadState(tx, input.threadId)
    const { projectId } = state
    const label = await tx.workflowLabel.findUnique({
      where: {
        labelId: input.labelId
      }
    })
    if (!label) {
      throw new Error(`Unknown workflow label: ${input.labelId}`)
    }
    if (label.projectId !== projectId) {
      throw new Error(
        `Workflow label "${input.labelId}" belongs to Project "${label.projectId}", not "${projectId}".`
      )
    }

    const now = BigInt(Date.now())
    if (!state.workflow) {
      const defaultStatus = await getProjectDefaultStatus(tx, projectId)
      await tx.threadWorkflow.create({
        data: {
          createdAt: now,
          statusId: defaultStatus.statusId,
          statusUpdatedAt: now,
          threadId: input.threadId,
          updatedAt: now
        }
      })
    }
    await tx.threadLabel.create({
      data: {
        createdAt: now,
        labelId: label.labelId,
        rawValue: input.rawValue,
        threadId: input.threadId
      }
    })
    await tx.threadWorkflow.update({
      data: {
        updatedAt: now
      },
      where: {
        threadId: input.threadId
      }
    })
  })

  const summary = await getThreadWorkflowSummary(input.threadId)
  if (!summary) {
    throw new Error(`Thread "${input.threadId}" does not have a Project workflow.`)
  }
  return summary
}

export async function removeThreadWorkflowLabel(
  input: RemoveThreadWorkflowLabelInput
): Promise<ThreadWorkflowSummary> {
  const prisma = getPrismaClient()
  await prisma.$transaction(async (tx) => {
    const state = await requireProjectThreadState(tx, input.threadId)
    const { projectId } = state
    const label = await tx.workflowLabel.findUnique({
      where: {
        labelId: input.labelId
      }
    })
    if (!label) {
      throw new Error(`Unknown workflow label: ${input.labelId}`)
    }
    if (label.projectId !== projectId) {
      throw new Error(
        `Workflow label "${input.labelId}" belongs to Project "${label.projectId}", not "${projectId}".`
      )
    }

    const deleted = await tx.threadLabel.deleteMany({
      where: {
        labelId: input.labelId,
        rawValue: input.rawValue,
        threadId: input.threadId
      }
    })
    if (deleted.count === 0) {
      throw new Error(
        `Workflow label assignment "${input.labelId}:${input.rawValue}" was not found on thread "${input.threadId}".`
      )
    }
    if (state.workflow) {
      await tx.threadWorkflow.update({
        data: {
          updatedAt: BigInt(Date.now())
        },
        where: {
          threadId: input.threadId
        }
      })
    }
  })

  const summary = await getThreadWorkflowSummary(input.threadId)
  if (!summary) {
    throw new Error(`Thread "${input.threadId}" does not have a Project workflow.`)
  }
  return summary
}

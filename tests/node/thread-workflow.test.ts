import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after, before } from "node:test"
import { closeDatabase, createThread, getThread, initializeDatabase } from "../../src/main/db"
import { getPrismaClient } from "../../src/main/db/client"
import {
  applyThreadWorkflowRuntimeTransition,
  addThreadWorkflowLabel,
  createClassifiedThread,
  createProjectWorkflowLabel,
  createProjectWorkflowStatus,
  getThreadWorkflowSummary,
  listProjectWorkflowDefinitions,
  setProjectDefaultWorkflowStatus,
  setThreadWorkflowStatus
} from "../../src/main/db/thread-workflow"
import { upsertProject, upsertThreadWorkspaceBinding } from "../../src/main/db/thread-workspace"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-thread-workflow-home-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome
    }
  })
  await initializeDatabase()
})

after(async () => {
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

async function createProject(projectId: string) {
  return upsertProject({
    canonicalWorkspacePath: join(jingleHome, projectId),
    displayName: projectId,
    projectId,
    workspaceKey: projectId
  })
}

test("Project workflow taxonomy initializes manual Thread classification", async () => {
  const project = await createProject("workflow-project-manual")
  const projectDefinition = (await listProjectWorkflowDefinitions()).find(
    (entry) => entry.projectId === project.project_id
  )
  assert.ok(projectDefinition)
  assert.deepEqual(
    projectDefinition.statuses.map((status) => status.key),
    ["ready", "running", "blocked", "review", "done", "cancelled"]
  )
  assert.deepEqual(
    projectDefinition.labels.map((label) => label.key),
    ["source", "repo", "kind"]
  )

  const threadId = "workflow-manual-thread"
  await createThread(threadId, { title: "Manual workflow" })
  await upsertThreadWorkspaceBinding({
    projectId: project.project_id,
    threadId,
    workspaceKey: project.workspace_key,
    workspaceKind: "project",
    workspacePath: project.canonical_workspace_path
  })

  const unclassified = await getThreadWorkflowSummary(threadId)
  assert.equal(unclassified?.projectId, project.project_id)
  assert.equal(unclassified?.status, null)

  const running = projectDefinition.statuses.find((status) => status.key === "running")
  const source = projectDefinition.labels.find((label) => label.key === "source")
  assert.ok(running)
  assert.ok(source)
  const classified = await setThreadWorkflowStatus({ statusId: running.statusId, threadId })
  assert.equal(classified.status?.key, "running")
  const labeled = await addThreadWorkflowLabel({
    labelId: source.labelId,
    rawValue: "github",
    threadId
  })
  assert.deepEqual(
    labeled.labels.map((assignment) => [assignment.label.key, assignment.rawValue]),
    [["source", "github"]]
  )
})

test("Project workflow taxonomy preserves Project-owned status customization", async () => {
  const project = await createProject("workflow-project-customized")
  const prisma = getPrismaClient()
  await prisma.$transaction([
    prisma.workflowStatus.update({
      data: {
        colorJson: JSON.stringify({ dark: "#FFFFFF", light: "#000000" }),
        isDefault: false
      },
      where: {
        projectId_key: {
          key: "ready",
          projectId: project.project_id
        }
      }
    }),
    prisma.workflowStatus.update({
      data: {
        isDefault: true
      },
      where: {
        projectId_key: {
          key: "running",
          projectId: project.project_id
        }
      }
    })
  ])

  await createProject("workflow-project-customized")
  const definition = (await listProjectWorkflowDefinitions()).find(
    (entry) => entry.projectId === project.project_id
  )
  assert.ok(definition)
  const ready = definition.statuses.find((status) => status.key === "ready")
  const running = definition.statuses.find((status) => status.key === "running")
  assert.deepEqual(ready?.color, { dark: "#FFFFFF", light: "#000000" })
  assert.equal(ready?.isDefault, false)
  assert.equal(running?.isDefault, true)
})

test("Project workflow taxonomy repairs a partial taxonomy without a default", async () => {
  const project = await createProject("workflow-project-partial")
  const prisma = getPrismaClient()
  await prisma.workflowStatus.updateMany({
    data: { isDefault: false },
    where: { projectId: project.project_id }
  })
  await prisma.workflowStatus.deleteMany({
    where: {
      key: { not: "ready" },
      projectId: project.project_id
    }
  })
  await prisma.workflowLabel.deleteMany({
    where: {
      key: { not: "source" },
      projectId: project.project_id
    }
  })

  await createProject("workflow-project-partial")
  const definition = (await listProjectWorkflowDefinitions()).find(
    (entry) => entry.projectId === project.project_id
  )
  assert.ok(definition)
  assert.deepEqual(
    definition.statuses.map((status) => status.key),
    ["ready", "running", "blocked", "review", "done", "cancelled"]
  )
  assert.deepEqual(
    definition.statuses.filter((status) => status.isDefault).map((status) => status.key),
    ["ready"]
  )
  assert.deepEqual(
    definition.labels.map((label) => label.key),
    ["source", "repo", "kind"]
  )
})

test("Project workflow taxonomy can be extended and choose a new default status", async () => {
  const project = await createProject("workflow-project-definitions")
  const withStatus = await createProjectWorkflowStatus({
    category: "open",
    color: { dark: "#FBBF24", light: "#B45309" },
    label: "Testing",
    projectId: project.project_id
  })
  const testing = withStatus.statuses.find((status) => status.key === "testing")
  assert.ok(testing)
  assert.equal(testing.isDefault, false)

  const withDefault = await setProjectDefaultWorkflowStatus({
    projectId: project.project_id,
    statusId: testing.statusId
  })
  assert.deepEqual(
    withDefault.statuses.filter((status) => status.isDefault).map((status) => status.key),
    ["testing"]
  )

  const withParent = await createProjectWorkflowLabel({
    name: "Area",
    projectId: project.project_id,
    valueType: "boolean"
  })
  const area = withParent.labels.find((label) => label.key === "area")
  assert.ok(area)
  const withChild = await createProjectWorkflowLabel({
    name: "Frontend",
    parentLabelId: area.labelId,
    projectId: project.project_id,
    valueType: "string"
  })
  const frontend = withChild.labels.find((label) => label.key === "frontend")
  assert.equal(frontend?.parentLabelId, area.labelId)
})

test("classified Thread creation persists Project, status, labels, and source atomically", async () => {
  const project = await createProject("workflow-project-classified")
  await createClassifiedThread({
    project: {
      canonicalWorkspacePath: project.canonical_workspace_path,
      projectId: project.project_id,
      workspaceKey: project.workspace_key
    },
    threadId: "workflow-classified-thread",
    title: "GitHub issue",
    workflow: {
      labels: [
        { key: "source", value: "github" },
        { key: "kind", value: "issue" }
      ],
      primarySourceRef: { id: "JunJD/Jingle#1", type: "github.issue" },
      statusKey: "ready"
    }
  })

  const summary = await getThreadWorkflowSummary("workflow-classified-thread")
  assert.equal(summary?.projectId, project.project_id)
  assert.equal(summary?.status?.key, "ready")
  assert.equal(summary?.primarySourceRef?.type, "github.issue")
  assert.deepEqual(
    summary?.labels.map((assignment) => [assignment.label.key, assignment.rawValue]),
    [
      ["source", "github"],
      ["kind", "issue"]
    ]
  )
})

test("runtime facts advance classified work while preserving manual status overrides", async () => {
  const project = await createProject("workflow-project-runtime")
  const projectDefinition = (await listProjectWorkflowDefinitions()).find(
    (entry) => entry.projectId === project.project_id
  )
  assert.ok(projectDefinition)

  const createRuntimeThread = (threadId: string) =>
    createClassifiedThread({
      project: {
        canonicalWorkspacePath: project.canonical_workspace_path,
        projectId: project.project_id,
        workspaceKey: project.workspace_key
      },
      threadId,
      title: threadId,
      workflow: {
        labels: [],
        statusKey: "ready"
      }
    })

  await createRuntimeThread("workflow-runtime-completed")
  assert.equal(
    await applyThreadWorkflowRuntimeTransition({
      currentGate: null,
      statusKey: "running",
      threadId: "workflow-runtime-completed"
    }),
    true
  )
  await applyThreadWorkflowRuntimeTransition({
    currentGate: "approval",
    threadId: "workflow-runtime-completed"
  })
  assert.equal(
    (await getThreadWorkflowSummary("workflow-runtime-completed"))?.currentGate,
    "approval"
  )
  await applyThreadWorkflowRuntimeTransition({
    currentGate: null,
    expectedStatusKeys: ["running"],
    statusKey: "review",
    threadId: "workflow-runtime-completed"
  })
  const completed = await getThreadWorkflowSummary("workflow-runtime-completed")
  assert.equal(completed?.status?.key, "review")
  assert.equal(completed?.currentGate, null)

  await createRuntimeThread("workflow-runtime-failed")
  await applyThreadWorkflowRuntimeTransition({
    currentGate: null,
    statusKey: "running",
    threadId: "workflow-runtime-failed"
  })
  await applyThreadWorkflowRuntimeTransition({
    currentGate: null,
    expectedStatusKeys: ["running"],
    statusKey: "blocked",
    threadId: "workflow-runtime-failed"
  })
  assert.equal((await getThreadWorkflowSummary("workflow-runtime-failed"))?.status?.key, "blocked")

  await createRuntimeThread("workflow-runtime-manual")
  await applyThreadWorkflowRuntimeTransition({
    currentGate: null,
    statusKey: "running",
    threadId: "workflow-runtime-manual"
  })
  const done = projectDefinition.statuses.find((status) => status.key === "done")
  assert.ok(done)
  await setThreadWorkflowStatus({
    statusId: done.statusId,
    threadId: "workflow-runtime-manual"
  })
  assert.equal(
    await applyThreadWorkflowRuntimeTransition({
      currentGate: null,
      expectedStatusKeys: ["running"],
      statusKey: "review",
      threadId: "workflow-runtime-manual"
    }),
    false
  )
  assert.equal((await getThreadWorkflowSummary("workflow-runtime-manual"))?.status?.key, "done")

  await createThread("workflow-runtime-projectless", { title: "Projectless" })
  assert.equal(
    await applyThreadWorkflowRuntimeTransition({
      currentGate: null,
      statusKey: "running",
      threadId: "workflow-runtime-projectless"
    }),
    false
  )
})

test("invalid workflow classification rolls back Thread creation", async () => {
  const project = await createProject("workflow-project-rollback")
  await assert.rejects(
    createClassifiedThread({
      project: {
        canonicalWorkspacePath: project.canonical_workspace_path,
        projectId: project.project_id,
        workspaceKey: project.workspace_key
      },
      threadId: "workflow-rollback-thread",
      title: "Invalid workflow",
      workflow: {
        labels: [{ key: "unknown", value: "value" }],
        statusKey: "ready"
      }
    }),
    /Unknown workflow label key/
  )
  assert.equal(await getThread("workflow-rollback-thread"), null)
})

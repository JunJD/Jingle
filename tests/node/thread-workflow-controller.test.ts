import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { ThreadWorkflowController } from "../../src/main/thread-workflow/controller"
import type { ThreadWorkflowService } from "../../src/main/thread-workflow/service"
import {
  projectWorkflowDefinitionsSchema,
  threadWorkflowChangedEventSchema,
  threadWorkflowViewSchema,
  type ProjectWorkflowDefinition,
  type ThreadWorkflowChangedEvent,
  type ThreadWorkflowView
} from "../../src/shared/thread-workflow"

class FakeIpcMain {
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    return this.invokeFromFrame(channel, sender, sender.mainFrame, ...args)
  }

  async invokeFromFrame(
    channel: string,
    sender: FakeWebContents,
    senderFrame: object,
    ...args: unknown[]
  ): Promise<unknown> {
    const handler = this.handlers.get(channel)
    assert.ok(handler, `Missing IPC handler for ${channel}`)
    return handler({ sender, senderFrame } as unknown as IpcMainInvokeEvent, ...args)
  }
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  readonly mainFrame = {}
  readonly sent: Array<{ channel: string; payload: unknown }> = []

  constructor(readonly id: number) {
    super()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

class FakeWindow {
  destroyed = false

  constructor(readonly webContents: FakeWebContents) {}

  isDestroyed(): boolean {
    return this.destroyed
  }
}

const PROJECT: ProjectWorkflowDefinition = {
  displayName: "Jingle",
  labels: [
    {
      color: null,
      key: "source",
      labelId: "label-source",
      name: "Source",
      orderIndex: 0,
      parentLabelId: null,
      projectId: "project-1",
      valueType: "string"
    }
  ],
  projectId: "project-1",
  statuses: [
    {
      category: "open",
      color: { dark: "#60A5FA", light: "#2563EB" },
      icon: null,
      isDefault: true,
      isFixed: true,
      key: "ready",
      label: "Ready",
      orderIndex: 0,
      projectId: "project-1",
      statusId: "status-ready"
    }
  ],
  workspacePath: "/tmp/jingle"
}

const VIEW: ThreadWorkflowView = {
  project: PROJECT,
  summary: {
    currentGate: null,
    labels: [],
    primarySourceRef: null,
    projectId: "project-1",
    status: PROJECT.statuses[0],
    statusUpdatedAt: new Date(10),
    threadId: "thread-bound",
    updatedAt: new Date(10),
    workspacePath: "/tmp/jingle"
  }
}

function createServiceStub(calls: string[]) {
  let changedListener: ((event: ThreadWorkflowChangedEvent) => void) | null = null
  const service = {
    addLabel: async (input: { threadId: string }) => {
      calls.push(`addLabel:${input.threadId}`)
      return VIEW
    },
    createLabel: async (input: { projectId: string }) => {
      calls.push(`createLabel:${input.projectId}`)
      return PROJECT
    },
    createStatus: async (input: { projectId: string }) => {
      calls.push(`createStatus:${input.projectId}`)
      return PROJECT
    },
    getView: async (threadId: string) => {
      calls.push(`get:${threadId}`)
      if (threadId === "thread-other") {
        return {
          project: null,
          summary: VIEW.summary
            ? { ...VIEW.summary, projectId: null, status: null, threadId, workspacePath: null }
            : null
        }
      }
      return { ...VIEW, summary: VIEW.summary ? { ...VIEW.summary, threadId } : null }
    },
    listProjects: async () => {
      calls.push("listProjects")
      return [PROJECT]
    },
    onChanged: (listener: (event: ThreadWorkflowChangedEvent) => void) => {
      changedListener = listener
      return () => {
        changedListener = null
      }
    },
    removeLabel: async (input: { threadId: string }) => {
      calls.push(`removeLabel:${input.threadId}`)
      return VIEW
    },
    setDefaultStatus: async (input: { projectId: string }) => {
      calls.push(`setDefaultStatus:${input.projectId}`)
      return PROJECT
    },
    setStatus: async (input: { threadId: string }) => {
      calls.push(`setStatus:${input.threadId}`)
      return VIEW
    }
  }

  return {
    emitChanged: (event: ThreadWorkflowChangedEvent) => {
      assert.ok(changedListener)
      changedListener(event)
    },
    service: service as unknown as ThreadWorkflowService
  }
}

function createSenderIdentity(input: {
  launcher: FakeWebContents
  pinned: ReadonlyMap<FakeWebContents, string>
}) {
  return {
    getPinnedThreadId: (sender: WebContents) =>
      input.pinned.get(sender as unknown as FakeWebContents) ?? null,
    isLauncher: (sender: WebContents) => sender === (input.launcher as unknown as WebContents)
  }
}

test("thread workflow IPC enforces strict codecs and the Launcher/Pinned sender matrix", async () => {
  const calls: string[] = []
  const launcher = new FakeWebContents(1)
  const pinned = new FakeWebContents(2)
  const settings = new FakeWebContents(3)
  const { service } = createServiceStub(calls)
  const controller = new ThreadWorkflowController(
    service,
    createSenderIdentity({ launcher, pinned: new Map([[pinned, "thread-bound"]]) }),
    () => []
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  assert.equal(ipcMain.handlers.size, 8)
  await ipcMain.invoke("threadWorkflow:listProjects", launcher)
  await ipcMain.invoke("threadWorkflow:get", launcher, { threadId: "thread-any" })
  await ipcMain.invoke("threadWorkflow:get", pinned, { threadId: "thread-bound" })
  await ipcMain.invoke("threadWorkflow:createStatus", launcher, {
    category: "open",
    color: { dark: "#FBBF24", light: "#B45309" },
    label: "Testing",
    projectId: "project-1"
  })
  await ipcMain.invoke("threadWorkflow:setDefaultStatus", launcher, {
    projectId: "project-1",
    statusId: "status-ready"
  })
  await ipcMain.invoke("threadWorkflow:createLabel", launcher, {
    name: "Area",
    projectId: "project-1",
    valueType: "string"
  })
  await ipcMain.invoke("threadWorkflow:setStatus", pinned, {
    statusId: "status-ready",
    threadId: "thread-bound"
  })
  await ipcMain.invoke("threadWorkflow:addLabel", pinned, {
    labelId: "label-source",
    rawValue: "github",
    threadId: "thread-bound"
  })
  await ipcMain.invoke("threadWorkflow:removeLabel", pinned, {
    labelId: "label-source",
    rawValue: "github",
    threadId: "thread-bound"
  })

  await assert.rejects(
    ipcMain.invoke("threadWorkflow:get", pinned, { threadId: "thread-other" }),
    /bound Pinned AI session/
  )
  await assert.rejects(
    ipcMain.invoke("threadWorkflow:setStatus", settings, {
      statusId: "status-ready",
      threadId: "thread-bound"
    }),
    /bound Pinned AI session/
  )
  await assert.rejects(
    ipcMain.invoke("threadWorkflow:listProjects", pinned),
    /only available from the Launcher/
  )
  await assert.rejects(
    ipcMain.invokeFromFrame("threadWorkflow:get", launcher, {}, { threadId: "thread-any" }),
    /window's main frame/
  )
  await assert.rejects(
    ipcMain.invoke("threadWorkflow:get", launcher, { threadId: "thread-any", extra: true }),
    /validation failed/
  )
  await assert.rejects(
    ipcMain.invoke("threadWorkflow:listProjects", launcher, {}),
    /validation failed/
  )
  const malformedRequests: Array<[string, unknown]> = [
    [
      "threadWorkflow:createStatus",
      {
        category: "open",
        color: { dark: "#FBBF24", light: "#B45309" },
        extra: true,
        label: "Testing",
        projectId: "project-1"
      }
    ],
    [
      "threadWorkflow:setDefaultStatus",
      { extra: true, projectId: "project-1", statusId: "status-ready" }
    ],
    [
      "threadWorkflow:createLabel",
      { extra: true, name: "Area", projectId: "project-1", valueType: "string" }
    ],
    ["threadWorkflow:setStatus", { extra: true, statusId: "status-ready", threadId: "thread-any" }],
    [
      "threadWorkflow:addLabel",
      { extra: true, labelId: "label-source", rawValue: "github", threadId: "thread-any" }
    ],
    [
      "threadWorkflow:removeLabel",
      { extra: true, labelId: "label-source", rawValue: "github", threadId: "thread-any" }
    ]
  ]
  for (const [channel, payload] of malformedRequests) {
    await assert.rejects(ipcMain.invoke(channel, launcher, payload), /validation failed/)
  }

  assert.deepEqual(calls, [
    "listProjects",
    "get:thread-any",
    "get:thread-bound",
    "createStatus:project-1",
    "setDefaultStatus:project-1",
    "createLabel:project-1",
    "setStatus:thread-bound",
    "addLabel:thread-bound",
    "removeLabel:thread-bound"
  ])
})

test("thread workflow events expose scope and publish only to authorized windows", async () => {
  const calls: string[] = []
  const launcher = new FakeWebContents(1)
  const matchingPinned = new FakeWebContents(2)
  const otherPinned = new FakeWebContents(3)
  const settings = new FakeWebContents(4)
  const windows = [launcher, matchingPinned, otherPinned, settings].map(
    (webContents) => new FakeWindow(webContents)
  )
  const { emitChanged, service } = createServiceStub(calls)
  const controller = new ThreadWorkflowController(
    service,
    createSenderIdentity({
      launcher,
      pinned: new Map([
        [matchingPinned, "thread-bound"],
        [otherPinned, "thread-other"]
      ])
    }),
    () => windows as unknown as BrowserWindow[]
  )
  controller.register(new FakeIpcMain() as unknown as IpcMain)

  emitChanged({ scope: "thread", threadId: "thread-bound" })
  emitChanged({ projectId: "project-1", scope: "project" })
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(launcher.sent, [
    {
      channel: "threadWorkflow:changed",
      payload: { scope: "thread", threadId: "thread-bound" }
    },
    {
      channel: "threadWorkflow:changed",
      payload: { projectId: "project-1", scope: "project" }
    }
  ])
  assert.deepEqual(matchingPinned.sent, [
    {
      channel: "threadWorkflow:changed",
      payload: { scope: "thread", threadId: "thread-bound" }
    },
    {
      channel: "threadWorkflow:changed",
      payload: { projectId: "project-1", scope: "project" }
    }
  ])
  assert.deepEqual(otherPinned.sent, [])
  assert.deepEqual(settings.sent, [])
})

test("thread workflow result and event codecs fail closed", () => {
  assert.equal(projectWorkflowDefinitionsSchema.safeParse([PROJECT]).success, true)
  assert.equal(threadWorkflowViewSchema.safeParse(VIEW).success, true)
  assert.equal(
    threadWorkflowViewSchema.safeParse({ ...VIEW, summary: { ...VIEW.summary, extra: true } })
      .success,
    false
  )
  assert.equal(
    threadWorkflowViewSchema.safeParse({ ...VIEW, project: { ...PROJECT, projectId: "other" } })
      .success,
    false
  )
  assert.equal(
    threadWorkflowViewSchema.safeParse({
      ...VIEW,
      summary: {
        ...VIEW.summary,
        labels: [
          {
            label: { ...PROJECT.labels[0], valueType: "number" },
            rawValue: "01.5"
          }
        ]
      }
    }).success,
    false
  )
  assert.equal(
    threadWorkflowChangedEventSchema.safeParse({ scope: "thread", threadId: "" }).success,
    false
  )
  assert.equal(
    threadWorkflowChangedEventSchema.safeParse({
      projectId: "project-1",
      scope: "project",
      threadId: "x"
    }).success,
    false
  )
})

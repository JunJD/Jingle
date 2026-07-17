import assert from "node:assert/strict"
import test, { mock } from "node:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { AgentController } from "../../src/main/agent/controller"
import { parseAgentConnectThreadEventsResult } from "../../src/shared/agent-thread-contract"
import { parseSerializedIpcErrorMessage } from "../../src/shared/ipc-error"

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

interface FakeSender {
  destroy(): void
  readonly id: number
  readonly mainFrame: object
  readonly sent: Array<{ channel: string; payload: unknown }>
  isDestroyed(): boolean
  once(event: "destroyed", listener: () => void): void
  removeListener(event: "destroyed", listener: () => void): void
  send(channel: string, payload: unknown): void
}

function createFakeSender(id = 1): FakeSender {
  let destroyed = false
  const destroyedListeners = new Set<() => void>()
  const mainFrame = {}
  const sent: FakeSender["sent"] = []
  return {
    destroy: () => {
      destroyed = true
      const listeners = [...destroyedListeners]
      destroyedListeners.clear()
      listeners.forEach((listener) => listener())
    },
    id,
    isDestroyed: () => destroyed,
    mainFrame,
    once: (_event, listener) => destroyedListeners.add(listener),
    removeListener: (_event, listener) => destroyedListeners.delete(listener),
    send: (channel, payload) => sent.push({ channel, payload }),
    sent
  }
}

function createInvokeEvent(input?: {
  sender?: FakeSender
  senderFrame?: object
}): IpcMainInvokeEvent {
  const sender = input?.sender ?? createFakeSender()
  return {
    sender: sender as unknown as WebContents,
    senderFrame: (input?.senderFrame ?? sender.mainFrame) as IpcMainInvokeEvent["senderFrame"]
  } as IpcMainInvokeEvent
}

const launcherSenderIdentity: ConstructorParameters<typeof AgentController>[3] = {
  getMainWindowThreadId: () => null,
  isLauncher: () => true
}

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>()
  readonly listeners = new Map<string, IpcHandler>()

  constructor(private readonly event: IpcMainInvokeEvent = createInvokeEvent()) {}

  emit(channel: string, ...args: unknown[]): void {
    this.listeners.get(channel)?.(this.event, ...args)
  }

  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return this.invokeFrom(this.event, channel, ...args)
  }

  invokeFrom(event: IpcMainInvokeEvent, channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`Missing IPC handler: ${channel}`)
    }
    return Promise.resolve(handler(event, ...args))
  }

  on(channel: string, listener: IpcHandler): void {
    this.listeners.set(channel, listener)
  }
}

test("AgentController orders cancellation after an accepted run projection", async () => {
  const events: string[] = []
  let releasePrepare!: () => void
  let prepareStarted!: () => void
  const prepareEntered = new Promise<void>((resolve) => {
    prepareStarted = resolve
  })
  const prepareGate = new Promise<void>((resolve) => {
    releasePrepare = resolve
  })
  const service = {
    cancel: async () => true,
    dispatchInvoke: async (
      _params: unknown,
      _sink: unknown,
      options: { onCoreAdmitted?: () => void; onRunAccepted?: () => void }
    ) => {
      options.onCoreAdmitted?.()
      options.onRunAccepted?.()
      return { disposition: "run" as const, type: "accepted" as const }
    }
  }
  const runner = {
    handlePayload: async (_threadId: string, payload: { type: string }) => {
      events.push(payload.type)
    },
    prepareInvoke: async () => {
      events.push("prepare.started")
      prepareStarted()
      await prepareGate
      events.push("prepare.finished")
    },
    readThreadState: async () => {
      throw new Error("Projection state must not gate ordinary invoke admission.")
    }
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const sender = createFakeSender()
  const ipcMain = new FakeIpcMain(createInvokeEvent({ sender }))
  const consoleLog = mock.method(console, "log", () => {})

  try {
    controller.register(ipcMain as unknown as IpcMain)
    const invoke = ipcMain.invoke("agent:invoke", {
      message: { content: "hello", id: "message-1" },
      modelId: "bdd",
      threadId: "thread-1"
    })
    await prepareEntered
    assert.deepEqual(sender.sent, [
      {
        channel: "agent:command-lifecycle:message-1",
        payload: {
          commandId: "message-1",
          threadId: "thread-1",
          type: "admitted"
        }
      }
    ])

    const cancellation = ipcMain.invoke("agent:cancel", { threadId: "thread-1" })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(events, ["prepare.started"])
    let projectionFlushSettled = false
    const projectionFlush = controller.flushRuntimeProjections().then(() => {
      projectionFlushSettled = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(projectionFlushSettled, false)

    releasePrepare()
    assert.deepEqual(await invoke, { disposition: "run", type: "accepted" })
    await cancellation
    await projectionFlush
    assert.equal(projectionFlushSettled, true)
    assert.deepEqual(events, ["prepare.started", "prepare.finished", "cancelled"])
    assert.deepEqual(sender.sent.at(-1), {
      channel: "agent:command-lifecycle:message-1",
      payload: {
        commandId: "message-1",
        threadId: "thread-1",
        type: "projection_applied"
      }
    })
  } finally {
    consoleLog.mock.restore()
  }
})

test("AgentController returns run admission rejection without runtime projection", async () => {
  const projectedPayloads: string[] = []
  const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = []
  const service = {
    dispatchInvoke: async (
      _params: unknown,
      sink: { send(payload: Record<string, unknown>): void }
    ) => {
      sink.send({
        code: "CONFLICT",
        error: "Agent run is already in progress",
        message: "Agent run is already in progress",
        status: 409,
        type: "run_rejected"
      })
      return {
        error: {
          channel: "agent:invoke",
          code: "CONFLICT",
          message: "Agent run is already in progress",
          status: 409
        },
        type: "rejected" as const
      }
    }
  }
  const runner = {
    handlePayload: async (_threadId: string, payload: { type: string }) => {
      projectedPayloads.push(payload.type)
    },
    readThreadState: async () => {
      throw new Error("Projection state must not gate ordinary invoke admission.")
    }
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    {
      error: () => undefined,
      warn: (message, metadata) => warnings.push({ message, metadata })
    },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()

  controller.register(ipcMain as unknown as IpcMain)
  const outcome = await ipcMain.invoke("agent:invoke", {
    message: { content: "must not replace", id: "message-rejected" },
    modelId: "bdd",
    threadId: "thread-rejected"
  })

  assert.deepEqual(outcome, {
    error: {
      channel: "agent:invoke",
      code: "CONFLICT",
      message: "Agent run is already in progress",
      status: 409
    },
    type: "rejected"
  })
  assert.deepEqual(projectedPayloads, [])
  assert.deepEqual(warnings, [
    {
      message: "Agent run admission rejected",
      metadata: {
        code: "CONFLICT",
        message: "Agent run is already in progress",
        threadId: "thread-rejected"
      }
    }
  ])
})

test("AgentController returns typed edit and resume admission rejections", async () => {
  const rejected = {
    error: {
      channel: "agent:invoke",
      code: "CONFLICT",
      message: "Agent run is already in progress",
      status: 409
    },
    type: "rejected" as const
  }
  const service = {
    dispatchEditLastUserMessageAndInvoke: async () => rejected,
    dispatchResume: async () => rejected
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    {} as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  assert.deepEqual(
    await ipcMain.invoke("agent:editLastUserMessageAndInvoke", {
      message: { content: "edited", id: "message-edit" },
      threadId: "thread-edit"
    }),
    rejected
  )
  assert.deepEqual(
    await ipcMain.invoke("agent:resume", {
      decision: {
        request_id: "request-resume",
        tool_call_id: "tool-resume",
        type: "approve"
      },
      threadId: "thread-resume"
    }),
    rejected
  )
})

test("AgentController returns steer conflicts as a nonterminal command outcome", async () => {
  const service = {
    dispatchInvoke: async () => {
      throw new Error("A surfaced steer rejection must not fall through to run admission.")
    },
    steerActiveRun: () => ({
      reason: "active_turn_mismatch" as const,
      type: "rejected" as const
    })
  }
  const runner = {
    handlePayload: async () => {
      throw new Error("A steer command rejection must not enter runtime projection.")
    }
  }
  const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = []
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    {
      error: () => undefined,
      warn: (message, metadata) => warnings.push({ message, metadata })
    },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  const outcome = await ipcMain.invoke("agent:invoke", {
    expectedRunId: "run-1",
    expectedTurnId: "turn-1",
    followUpAction: "steer",
    message: { content: "follow up", id: "message-steer-conflict" },
    modelId: "bdd",
    threadId: "thread-steer-conflict"
  })

  assert.deepEqual(outcome, {
    error: {
      channel: "agent:invoke",
      code: "CONFLICT",
      message: "Agent turn changed before the queued follow-up could steer it",
      status: 409
    },
    type: "rejected"
  })
  assert.deepEqual(warnings, [
    {
      message: "Agent steering command rejected",
      metadata: {
        code: "CONFLICT",
        message: "Agent turn changed before the queued follow-up could steer it",
        reason: "active_turn_mismatch",
        threadId: "thread-steer-conflict"
      }
    }
  ])
})

test("AgentController distinguishes accepted steering from stale steering fallback", async () => {
  const preparedMessages: string[] = []
  let steerResult: { reason: "no_active_run"; type: "rejected" } | { type: "accepted" } = {
    type: "accepted"
  }
  const service = {
    dispatchInvoke: async () => ({ disposition: "run" as const, type: "accepted" as const }),
    steerActiveRun: () => steerResult
  }
  const runner = {
    prepareSteeringMessage: async (_threadId: string, message: { id: string }) => {
      preparedMessages.push(message.id)
    }
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const input = {
    expectedRunId: "run-1",
    expectedTurnId: "turn-1",
    followUpAction: "steer",
    message: { content: "follow up", id: "message-steer" },
    modelId: "bdd",
    threadId: "thread-steer"
  }

  assert.deepEqual(await ipcMain.invoke("agent:invoke", input), {
    disposition: "steer",
    type: "accepted"
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(preparedMessages, ["message-steer"])

  steerResult = { reason: "no_active_run", type: "rejected" }
  assert.deepEqual(await ipcMain.invoke("agent:invoke", input), {
    disposition: "run",
    type: "accepted"
  })
})

test("AgentController keeps queued steer rejection nonterminal and retains the queue item", async () => {
  const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = []
  const service = {
    isRecoveryRequired: () => false,
    steerActiveRun: () => ({
      reason: "active_turn_mismatch" as const,
      type: "rejected" as const
    })
  }
  const runner = {
    handlePayload: async () => {
      throw new Error("Queued steer rejection must not fail the active run.")
    },
    readThreadState: async () => ({
      followUpQueue: {
        items: [
          {
            messageInput: { refs: [], text: "keep this queued" },
            requestId: "follow-up-1",
            text: "keep this queued"
          }
        ]
      }
    }),
    removeFollowUp: async () => {
      throw new Error("Rejected queued steer must retain its queue item.")
    }
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    {
      error: () => undefined,
      warn: (message, metadata) => warnings.push({ message, metadata })
    },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  assert.deepEqual(
    await ipcMain.invoke("agent:steerFollowUp", {
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      requestId: "follow-up-1",
      threadId: "thread-1"
    }),
    { reason: "active_turn_mismatch", type: "rejected" }
  )
  assert.deepEqual(warnings, [
    {
      message: "Queued agent steering command rejected",
      metadata: {
        message: "Agent turn changed before the queued follow-up could steer it",
        reason: "active_turn_mismatch",
        requestId: "follow-up-1",
        threadId: "thread-1"
      }
    }
  ])
})

test("AgentController rejects every agent IPC channel outside trusted main frames", async () => {
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    {} as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: () => null,
      isLauncher: () => false
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const unauthorizedEvent = createInvokeEvent({ sender: createFakeSender(99) })
  const channels = [
    "agent:invoke",
    "agent:editLastUserMessageAndInvoke",
    "agent:resume",
    "agent:cancel",
    "agent:connectThreadEvents",
    "agent:disconnectThreadEvents",
    "agent:enqueueFollowUp",
    "agent:removeFollowUp",
    "agent:restoreFollowUp",
    "agent:takeFollowUp",
    "agent:steerFollowUp"
  ]

  for (const channel of channels) {
    await assert.rejects(ipcMain.invokeFrom(unauthorizedEvent, channel, null), /PERMISSION_DENIED/)
  }

  const launcherSender = createFakeSender(1)
  const subframeEvent = createInvokeEvent({ sender: launcherSender, senderFrame: {} })
  const launcherController = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    {} as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const launcherIpc = new FakeIpcMain()
  launcherController.register(launcherIpc as unknown as IpcMain)
  await assert.rejects(
    launcherIpc.invokeFrom(subframeEvent, "agent:cancel", { threadId: "thread-1" }),
    /PERMISSION_DENIED/
  )

  const ambiguousController = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    {} as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: () => "thread-ambiguous",
      isLauncher: () => true
    }
  )
  const ambiguousIpc = new FakeIpcMain()
  ambiguousController.register(ambiguousIpc as unknown as IpcMain)
  await assert.rejects(
    ambiguousIpc.invoke("agent:cancel", { threadId: "thread-ambiguous" }),
    /PERMISSION_DENIED/
  )
})

test("AgentController derives subscription surfaces from trusted window identity", async () => {
  const connected: Array<{ key: string; threadId: string }> = []
  const service = {
    cancel: async () => false
  }
  const runner = {
    connectThreadEvents: async (
      threadId: string,
      key: string,
      _listener: unknown,
      _options: unknown
    ) => {
      connected.push({ key, threadId })
    },
    disconnectThreadEvents: () => undefined
  }
  const controller = new AgentController(
    service as unknown as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: (sender) => {
        if (sender.id === 2) {
          return "thread-pinned"
        }
        if (sender.id === 3) {
          return "thread-pinned-derived"
        }
        return null
      },
      isLauncher: (sender) => sender.id === 1
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const launcherEvent = createInvokeEvent({ sender: createFakeSender(1) })
  const pinnedEvent = createInvokeEvent({ sender: createFakeSender(2) })
  const derivedMainEvent = createInvokeEvent({ sender: createFakeSender(3) })

  await ipcMain.invokeFrom(launcherEvent, "agent:cancel", { threadId: "thread-launcher" })
  await ipcMain.invokeFrom(pinnedEvent, "agent:cancel", { threadId: "thread-pinned" })
  await ipcMain.invokeFrom(launcherEvent, "agent:connectThreadEvents", {
    surface: "launcher",
    threadId: "thread-launcher"
  })
  await ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
    surface: "main",
    threadId: "thread-pinned"
  })
  await ipcMain.invokeFrom(derivedMainEvent, "agent:connectThreadEvents", {
    threadId: "thread-pinned-derived"
  })
  await assert.rejects(
    ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
      surface: "launcher",
      threadId: "thread-pinned"
    }),
    /PERMISSION_DENIED/
  )

  assert.deepEqual(
    connected.map(({ key, ...entry }) => ({ ...entry, key: key.replace(/:\d+$/, "") })),
    [
      { key: "1:thread-launcher", threadId: "thread-launcher" },
      { key: "2:thread-pinned", threadId: "thread-pinned" },
      { key: "3:thread-pinned-derived", threadId: "thread-pinned-derived" }
    ]
  )
})

test("AgentController rejects every main-window command targeting another thread", async () => {
  const unexpectedOwnerCall = (): never => {
    throw new Error("A cross-thread pinned command must not reach a business owner.")
  }
  const controller = new AgentController(
    new Proxy(
      {},
      {
        get: () => unexpectedOwnerCall
      }
    ) as ConstructorParameters<typeof AgentController>[0],
    new Proxy(
      {},
      {
        get: () => unexpectedOwnerCall
      }
    ) as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: () => "thread-bound",
      isLauncher: () => false
    }
  )
  const ipcMain = new FakeIpcMain(createInvokeEvent({ sender: createFakeSender(21) }))
  controller.register(ipcMain as unknown as IpcMain)
  const threadId = "thread-other"
  const cases: ReadonlyArray<{ channel: string; payload: unknown }> = [
    {
      channel: "agent:invoke",
      payload: { message: { content: "invoke", id: "message-invoke" }, threadId }
    },
    {
      channel: "agent:editLastUserMessageAndInvoke",
      payload: { message: { content: "edit", id: "message-edit" }, threadId }
    },
    {
      channel: "agent:resume",
      payload: {
        decision: {
          request_id: "request-resume",
          tool_call_id: "tool-resume",
          type: "approve"
        },
        threadId
      }
    },
    { channel: "agent:cancel", payload: { threadId } },
    { channel: "agent:connectThreadEvents", payload: { threadId } },
    {
      channel: "agent:disconnectThreadEvents",
      payload: { subscriptionToken: "subscription-cross-thread", threadId }
    },
    {
      channel: "agent:enqueueFollowUp",
      payload: { messageInput: { refs: [], text: "queued" }, threadId }
    },
    {
      channel: "agent:removeFollowUp",
      payload: { requestId: "follow-up-remove", threadId }
    },
    {
      channel: "agent:restoreFollowUp",
      payload: {
        item: {
          messageInput: { refs: [], text: "restore" },
          requestId: "follow-up-restore",
          text: "restore"
        },
        threadId
      }
    },
    {
      channel: "agent:takeFollowUp",
      payload: { requestId: "follow-up-take", threadId }
    },
    {
      channel: "agent:steerFollowUp",
      payload: { requestId: "follow-up-steer", threadId }
    }
  ]

  for (const testCase of cases) {
    await assert.rejects(ipcMain.invoke(testCase.channel, testCase.payload), /PERMISSION_DENIED/)
  }
})

test("AgentController blocks follow-up mutations while terminal recovery is required", async () => {
  const unexpectedOwnerCall = (): never => {
    throw new Error("Recovery-blocked follow-up reached the runtime owner.")
  }
  const controller = new AgentController(
    new Proxy(
      { isRecoveryRequired: () => true },
      {
        get: (target, property, receiver) =>
          property === "isRecoveryRequired"
            ? Reflect.get(target, property, receiver)
            : unexpectedOwnerCall
      }
    ) as unknown as ConstructorParameters<typeof AgentController>[0],
    new Proxy({}, { get: () => unexpectedOwnerCall }) as ConstructorParameters<
      typeof AgentController
    >[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const threadId = "thread-recovery-required"
  const cases: ReadonlyArray<{ channel: string; payload: unknown }> = [
    {
      channel: "agent:enqueueFollowUp",
      payload: { messageInput: { refs: [], text: "queued" }, threadId }
    },
    {
      channel: "agent:restoreFollowUp",
      payload: {
        item: {
          messageInput: { refs: [], text: "restore" },
          requestId: "follow-up-restore",
          text: "restore"
        },
        threadId
      }
    },
    {
      channel: "agent:takeFollowUp",
      payload: { requestId: "follow-up-take", threadId }
    },
    {
      channel: "agent:steerFollowUp",
      payload: { requestId: "follow-up-steer", threadId }
    }
  ]

  for (const testCase of cases) {
    await assert.rejects(ipcMain.invoke(testCase.channel, testCase.payload), (error) => {
      assert.ok(error instanceof Error)
      assert.equal(parseSerializedIpcErrorMessage(error.message)?.code, "UNAVAILABLE")
      return true
    })
  }
})

test("AgentController requires a subscription token for thread event disconnect", async () => {
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    {} as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)

  await assert.rejects(
    ipcMain.invoke("agent:disconnectThreadEvents", { threadId: "thread-a" }),
    /subscriptionToken/
  )
})

test("AgentController restores Launcher events after a Main window changes thread", async () => {
  const listeners = new Map<string, (batch: never) => void>()
  const disconnected: string[] = []
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      key: string,
      listener: (batch: never) => void
    ) => {
      listeners.set(key, listener)
    },
    disconnectThreadEvents: (_threadId: string, key: string) => {
      disconnected.push(key)
      listeners.delete(key)
    }
  }
  let mainThreadId = "thread-a"
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: (sender) => (sender.id === 2 ? mainThreadId : null),
      isLauncher: (sender) => sender.id === 1
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const launcherSender = createFakeSender(1)
  const pinnedSender = createFakeSender(2)
  const launcherEvent = createInvokeEvent({ sender: launcherSender })
  const pinnedEvent = createInvokeEvent({ sender: pinnedSender })

  await ipcMain.invokeFrom(launcherEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  await ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  const launcherThreadAKey = [...listeners.keys()].find((key) => key.startsWith("1:thread-a:"))
  const pinnedThreadAKey = [...listeners.keys()].find((key) => key.startsWith("2:thread-a:"))
  assert.ok(launcherThreadAKey)
  assert.ok(pinnedThreadAKey)
  listeners.get(launcherThreadAKey)?.({} as never)
  listeners.get(pinnedThreadAKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 0)
  assert.equal(pinnedSender.sent.length, 1)

  mainThreadId = "thread-b"
  listeners.get(pinnedThreadAKey)?.({} as never)
  listeners.get(launcherThreadAKey)?.({} as never)
  assert.equal(pinnedSender.sent.length, 1)
  assert.equal(launcherSender.sent.length, 1)

  await ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
    threadId: "thread-b"
  })
  assert.equal(
    disconnected.some((key) => key.startsWith("1:thread-a:")),
    false
  )
  assert.equal(disconnected.includes(pinnedThreadAKey), true)
  assert.equal(listeners.has(launcherThreadAKey), true)
  assert.equal(listeners.has(pinnedThreadAKey), false)
  assert.equal(
    [...listeners.keys()].some((key) => key.startsWith("2:thread-b:")),
    true
  )
})

test("AgentController discards a stale Main subscription that resolves after retarget", async () => {
  let releaseThreadA!: () => void
  const threadAGate = new Promise<void>((resolve) => {
    releaseThreadA = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  const disconnected: string[] = []
  const runner = {
    connectThreadEvents: async (
      threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      listeners.set(subscriberId, listener)
      if (threadId === "thread-a") {
        await threadAGate
      }
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      disconnected.push(subscriberId)
      listeners.delete(subscriberId)
    }
  }
  let mainThreadId = "thread-a"
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: () => mainThreadId,
      isLauncher: () => false
    }
  )
  const sender = createFakeSender(31)
  const event = createInvokeEvent({ sender })
  const ipcMain = new FakeIpcMain(event)
  controller.register(ipcMain as unknown as IpcMain)

  const connectThreadA = ipcMain.invoke("agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  mainThreadId = "thread-b"
  await ipcMain.invoke("agent:connectThreadEvents", { threadId: "thread-b" })
  const threadBKey = [...listeners.keys()].find((key) => key.startsWith("31:thread-b:"))
  assert.ok(threadBKey)

  releaseThreadA()
  await connectThreadA

  const threadAKey = disconnected.find((key) => key.startsWith("31:thread-a:"))
  assert.ok(threadAKey)
  assert.equal(listeners.has(threadAKey), false)
  assert.equal(listeners.has(threadBKey), true)
  listeners.get(threadBKey)?.({} as never)
  assert.equal(sender.sent.length, 1)
})

test("AgentController preserves Launcher ownership across Main reconnects", async () => {
  let reconnectStarted!: () => void
  let releaseReconnect!: () => void
  const reconnectEntered = new Promise<void>((resolve) => {
    reconnectStarted = resolve
  })
  const reconnectGate = new Promise<void>((resolve) => {
    releaseReconnect = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  const disconnected: string[] = []
  let pinnedConnectCount = 0
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      listeners.set(subscriberId, listener)
      if (subscriberId.startsWith("2:thread-a:")) {
        pinnedConnectCount += 1
        if (pinnedConnectCount === 2) {
          reconnectStarted()
          await reconnectGate
        }
      }
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      disconnected.push(subscriberId)
      listeners.delete(subscriberId)
    }
  }
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: (sender) => (sender.id === 2 ? "thread-a" : null),
      isLauncher: (sender) => sender.id === 1
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const launcherSender = createFakeSender(1)
  const pinnedSender = createFakeSender(2)
  const launcherEvent = createInvokeEvent({ sender: launcherSender })
  const pinnedEvent = createInvokeEvent({ sender: pinnedSender })

  await ipcMain.invokeFrom(launcherEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  const initialConnection = parseAgentConnectThreadEventsResult(
    await ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
      threadId: "thread-a"
    })
  )
  const reconnect = ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  await reconnectEntered
  await ipcMain.invokeFrom(pinnedEvent, "agent:disconnectThreadEvents", {
    subscriptionToken: initialConnection.subscriptionToken,
    threadId: "thread-a"
  })
  releaseReconnect()
  const replacementConnection = parseAgentConnectThreadEventsResult(await reconnect)
  await ipcMain.invokeFrom(pinnedEvent, "agent:disconnectThreadEvents", {
    subscriptionToken: replacementConnection.subscriptionToken,
    threadId: "thread-a"
  })

  const launcherKey = [...listeners.keys()].find((key) => key.startsWith("1:thread-a:"))
  assert.ok(launcherKey)
  assert.equal(
    [...listeners.keys()].some((key) => key.startsWith("2:thread-a:")),
    false
  )
  assert.equal(disconnected.filter((key) => key.startsWith("2:thread-a:")).length >= 2, true)
  listeners.get(launcherKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 1)
})

test("AgentController ignores delayed cleanup for an older subscription generation", async () => {
  let firstConnectStarted!: () => void
  let releaseFirstConnect!: () => void
  const firstConnectEntered = new Promise<void>((resolve) => {
    firstConnectStarted = resolve
  })
  const firstConnectGate = new Promise<void>((resolve) => {
    releaseFirstConnect = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  let connectCount = 0
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      connectCount += 1
      listeners.set(subscriberId, listener)
      if (connectCount === 1) {
        firstConnectStarted()
        await firstConnectGate
      }
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      listeners.delete(subscriberId)
    }
  }
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const sender = createFakeSender(51)
  const event = createInvokeEvent({ sender })
  const ipcMain = new FakeIpcMain(event)
  controller.register(ipcMain as unknown as IpcMain)

  const firstConnect = ipcMain.invoke("agent:connectThreadEvents", { threadId: "thread-a" })
  await firstConnectEntered
  const replacementConnection = parseAgentConnectThreadEventsResult(
    await ipcMain.invoke("agent:connectThreadEvents", { threadId: "thread-a" })
  )
  const replacementSubscriberId = [...listeners.keys()].find((subscriberId) =>
    subscriberId.endsWith(":2")
  )
  const staleSubscriberId = [...listeners.keys()].find((subscriberId) =>
    subscriberId.endsWith(":1")
  )
  assert.ok(replacementSubscriberId)
  assert.ok(staleSubscriberId)

  listeners.get(staleSubscriberId)?.({} as never)
  listeners.get(replacementSubscriberId)?.({} as never)
  assert.equal(sender.sent.length, 1)

  releaseFirstConnect()
  const staleConnection = parseAgentConnectThreadEventsResult(await firstConnect)
  await ipcMain.invoke("agent:disconnectThreadEvents", {
    subscriptionToken: staleConnection.subscriptionToken,
    threadId: "thread-a"
  })

  listeners.get(replacementSubscriberId)?.({} as never)
  assert.equal(sender.sent.length, 2)

  await ipcMain.invoke("agent:disconnectThreadEvents", {
    subscriptionToken: replacementConnection.subscriptionToken,
    threadId: "thread-a"
  })
  assert.equal(listeners.has(replacementSubscriberId), false)
})

test("AgentController keeps Launcher events active until a Main subscription connects", async () => {
  let pinnedConnectStarted!: () => void
  let releaseMainConnect!: () => void
  const pinnedConnectEntered = new Promise<void>((resolve) => {
    pinnedConnectStarted = resolve
  })
  const pinnedConnectGate = new Promise<void>((resolve) => {
    releaseMainConnect = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      if (subscriberId.startsWith("2:thread-a:")) {
        pinnedConnectStarted()
        await pinnedConnectGate
      }
      listeners.set(subscriberId, listener)
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      listeners.delete(subscriberId)
    }
  }
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: (sender) => (sender.id === 2 ? "thread-a" : null),
      isLauncher: (sender) => sender.id === 1
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const launcherSender = createFakeSender(1)
  const pinnedSender = createFakeSender(2)
  const launcherEvent = createInvokeEvent({ sender: launcherSender })
  const pinnedEvent = createInvokeEvent({ sender: pinnedSender })

  await ipcMain.invokeFrom(launcherEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  const pinnedConnect = ipcMain.invokeFrom(pinnedEvent, "agent:connectThreadEvents", {
    threadId: "thread-a"
  })
  await pinnedConnectEntered
  const launcherKey = [...listeners.keys()].find((key) => key.startsWith("1:thread-a:"))
  assert.ok(launcherKey)
  listeners.get(launcherKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 1)

  releaseMainConnect()
  await pinnedConnect
  const pinnedKey = [...listeners.keys()].find((key) => key.startsWith("2:thread-a:"))
  assert.ok(pinnedKey)
  listeners.get(launcherKey)?.({} as never)
  listeners.get(pinnedKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 1)
  assert.equal(pinnedSender.sent.length, 1)
})

test("AgentController preserves a pending Launcher subscription through Main handoff", async () => {
  let launcherConnectStarted!: () => void
  let releaseLauncherConnect!: () => void
  const launcherConnectEntered = new Promise<void>((resolve) => {
    launcherConnectStarted = resolve
  })
  const launcherConnectGate = new Promise<void>((resolve) => {
    releaseLauncherConnect = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      if (subscriberId.startsWith("1:thread-a:")) {
        launcherConnectStarted()
        await launcherConnectGate
      }
      listeners.set(subscriberId, listener)
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      listeners.delete(subscriberId)
    }
  }
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    {
      getMainWindowThreadId: (sender) => (sender.id === 2 ? "thread-a" : null),
      isLauncher: (sender) => sender.id === 1
    }
  )
  const ipcMain = new FakeIpcMain()
  controller.register(ipcMain as unknown as IpcMain)
  const launcherSender = createFakeSender(1)
  const launcherConnect = ipcMain.invokeFrom(
    createInvokeEvent({ sender: launcherSender }),
    "agent:connectThreadEvents",
    { threadId: "thread-a" }
  )
  await launcherConnectEntered
  const mainSender = createFakeSender(2)
  const mainConnection = parseAgentConnectThreadEventsResult(
    await ipcMain.invokeFrom(
      createInvokeEvent({ sender: mainSender }),
      "agent:connectThreadEvents",
      { threadId: "thread-a" }
    )
  )
  releaseLauncherConnect()
  await launcherConnect

  const launcherKey = [...listeners.keys()].find((key) => key.startsWith("1:thread-a:"))
  const mainKey = [...listeners.keys()].find((key) => key.startsWith("2:thread-a:"))
  assert.ok(launcherKey)
  assert.ok(mainKey)
  listeners.get(launcherKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 0)

  await ipcMain.invokeFrom(
    createInvokeEvent({ sender: mainSender }),
    "agent:disconnectThreadEvents",
    { subscriptionToken: mainConnection.subscriptionToken, threadId: "thread-a" }
  )
  listeners.get(launcherKey)?.({} as never)
  assert.equal(launcherSender.sent.length, 1)
})

test("AgentController discards a pending subscription when its sender is destroyed", async () => {
  let connectStarted!: () => void
  let releaseConnect!: () => void
  const connectEntered = new Promise<void>((resolve) => {
    connectStarted = resolve
  })
  const connectGate = new Promise<void>((resolve) => {
    releaseConnect = resolve
  })
  const listeners = new Map<string, (batch: never) => void>()
  const disconnected: string[] = []
  const runner = {
    connectThreadEvents: async (
      _threadId: string,
      subscriberId: string,
      listener: (batch: never) => void
    ) => {
      connectStarted()
      await connectGate
      listeners.set(subscriberId, listener)
    },
    disconnectThreadEvents: (_threadId: string, subscriberId: string) => {
      disconnected.push(subscriberId)
      listeners.delete(subscriberId)
    }
  }
  const controller = new AgentController(
    {} as ConstructorParameters<typeof AgentController>[0],
    runner as unknown as ConstructorParameters<typeof AgentController>[1],
    { error: () => undefined, warn: () => undefined },
    launcherSenderIdentity
  )
  const sender = createFakeSender(41)
  const ipcMain = new FakeIpcMain(createInvokeEvent({ sender }))
  controller.register(ipcMain as unknown as IpcMain)

  const connection = ipcMain.invoke("agent:connectThreadEvents", { threadId: "thread-a" })
  await connectEntered
  sender.destroy()
  releaseConnect()
  await connection

  assert.equal(listeners.size, 0)
  assert.equal(
    disconnected.some((key) => key.startsWith("41:thread-a:")),
    true
  )
})

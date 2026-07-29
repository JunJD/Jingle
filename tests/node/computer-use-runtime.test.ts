/* eslint-disable @typescript-eslint/no-empty-function -- explicit no-op test doubles */
import assert from "node:assert/strict"
import test from "node:test"
import type { ComputerUseBackend, ComputerUseObservation } from "@jingle/computer-use-core"
import type { JingleComputerUseToolContext } from "@jingle/langchain-agent-harness"
import { ComputerUseApplicationService } from "../../src/main/computer-use/service"
import { ComputerUseRuntime } from "../../src/main/computer-use/runtime"
import type { DurableWindowCallerLease } from "../../src/main/windows/window-identity"

function observation(applicationId = "com.example.editor"): ComputerUseObservation {
  return {
    application: { id: applicationId, name: "Editor" },
    capturedAt: 1,
    elements: [{ actions: ["press"], index: 0, ref: "@save", role: "button" }],
    epoch: 0,
    resourceKey: "macos:42:window-1:g1",
    sourceTruncated: false,
    stateId: "state-1",
    window: { generation: "g1", nativeId: "window-1", pid: 42, platform: "macos" }
  }
}

function caller(threadId = "thread-1") {
  const controller = new AbortController()
  const lease: DurableWindowCallerLease = Object.freeze({
    incarnation: 1,
    signal: controller.signal,
    threadId,
    window: Object.freeze({ kind: "main", windowId: "main-1" })
  })
  return { controller, lease }
}

function context(signal = new AbortController().signal): JingleComputerUseToolContext {
  return {
    runId: "run-1",
    signal,
    threadId: "thread-1",
    toolCallId: "tool-call-1"
  }
}

test("Computer Use authorizes the canonical observed application, not model target text", async () => {
  let createCalls = 0
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.allowed"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) => {
      createCalls += 1
      return {
        async close() {},
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation("com.example.denied")
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled() {}
      } as never
    }
  })
  const { lease } = caller()

  await assert.rejects(
    runtime.createToolHandlers(lease)!.observe({ applicationId: "com.example.allowed" }, context()),
    /not allowed/i
  )
  assert.equal(createCalls, 1)
  await runtime.close()
})

test("Computer Use never authorizes a mutable application display name", async () => {
  let createCalls = 0
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["Editor"],
      computerUseEnabled: true
    },
    createService: async () => {
      createCalls += 1
      throw new Error("must reject before service creation")
    }
  })
  const { lease } = caller()

  assert.throws(
    () => runtime.createToolHandlers(lease)!.observe({ applicationName: "Editor" }, context()),
    /applicationId/i
  )
  assert.equal(createCalls, 0)
  await runtime.close()
})

test("Computer Use binds one durable caller lease and hides full successor state from the model", async () => {
  const closedRuns: string[] = []
  const enabledTransitions: boolean[] = []
  let transactionId = ""
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) =>
      ({
        async close() {},
        async closeRun(runId: string) {
          closedRuns.push(runId)
        },
        async execute(input: { transactionId: string }) {
          transactionId = input.transactionId
          return {
            projection: {
              added: [],
              baseStateId: "state-1",
              capturedAt: 2,
              identityConfidence: 1,
              identityReason: "native_identity",
              kind: "diff",
              removed: [],
              successorEpoch: 1,
              successorStateId: "state-2",
              updated: []
            },
            result: {
              baseStateId: "state-1",
              outcome: "worked",
              steps: [],
              successor: observation()
            }
          }
        },
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled(enabled: boolean) {
          enabledTransitions.push(enabled)
        }
      }) as never
  })
  const { controller, lease } = caller()
  const handlers = runtime.createToolHandlers(lease)!
  const observed = await handlers.observe({ applicationId: "com.example.editor" }, context())
  assert.deepEqual(observed, {
    kind: "observe",
    observation: { elements: [], kind: "full", reason: "initial", stateId: "state-1" },
    sessionId: "session-1",
    version: 1
  })
  const acted = (await handlers.action(
    {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    context()
  )) as Record<string, unknown>
  assert.match(transactionId, /^jingle:computer-use:transaction:v1:sha256:/)
  assert.equal("successor" in ((acted.result ?? {}) as Record<string, unknown>), false)
  assert.deepEqual(acted.retry, { allowed: false, reason: "side_effect_possible" })
  assert.equal(acted.kind, "action")
  assert.equal(acted.version, 1)
  assert.equal((acted.projection as { successorStateId: string }).successorStateId, "state-2")

  controller.abort(new Error("window rebound"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(closedRuns, ["run-1"])
  await runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  })
  assert.deepEqual(enabledTransitions, [true, false])
  assert.equal(runtime.createToolHandlers(lease), undefined)
  await runtime.close()
})

test("Computer Use visibly rejects launcher and mismatched-thread callers before service creation", async () => {
  let createCalls = 0
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async () => {
      createCalls += 1
      throw new Error("must not create")
    }
  })
  assert.equal(runtime.createToolHandlers(null), undefined)
  const { lease } = caller("thread-other")
  const handlers = runtime.createToolHandlers(lease)!
  await assert.rejects(
    handlers.observe({ applicationId: "com.example.editor" }, context()),
    /durable window/i
  )
  assert.equal(createCalls, 0)
  await runtime.close()
})

test("Computer Use retries a native service creation failure without creating a second owner", async () => {
  let createCalls = 0
  let closeCalls = 0
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) => {
      createCalls += 1
      if (createCalls === 1) throw new Error("probe temporarily failed")
      return {
        async close() {
          closeCalls += 1
        },
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled() {}
      } as never
    }
  })
  const { lease } = caller()
  const handlers = runtime.createToolHandlers(lease)!

  await assert.rejects(
    handlers.observe({ applicationId: "com.example.editor" }, context()),
    /probe temporarily failed/
  )
  await handlers.observe({ applicationId: "com.example.editor" }, context())

  assert.equal(createCalls, 2)
  await runtime.close()
  assert.equal(closeCalls, 1)
})

test("Computer Use settings leave applying state when concurrent service creation rejects", async () => {
  let rejectService!: (error: Error) => void
  const servicePromise = new Promise<ComputerUseApplicationService>((_resolve, reject) => {
    rejectService = reject
  })
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async () => servicePromise
  })
  const { lease } = caller()
  const invocation = runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())
  await new Promise<void>((resolve) => setImmediate(resolve))
  const disabledConfig = {
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  }
  const applying = runtime.applyAgentConfig(disabledConfig)
  const latestConfig = {
    computerUseApplicationAllowlist: ["com.example.other"],
    computerUseEnabled: false
  }
  const latestApplying = runtime.applyAgentConfig(latestConfig)

  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applying" })
  rejectService(new Error("native service creation failed"))
  await assert.rejects(invocation, /native service creation failed/)
  await assert.rejects(applying, /native service creation failed/)
  await assert.rejects(latestApplying, /native service creation failed/)
  assert.deepEqual(runtime.getConfigApplicationStatus(), {
    diagnosticCode: "computer_use.settings_apply_failed",
    retryable: true,
    state: "retry_required"
  })

  await runtime.applyAgentConfig(latestConfig)
  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applied" })
  await runtime.close()
})

test("Computer Use disable wins while the native service is still being created", async () => {
  let observeCalls = 0
  let resolveService!: (service: ComputerUseApplicationService) => void
  const servicePromise = new Promise<ComputerUseApplicationService>((resolve) => {
    resolveService = resolve
  })
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async () => servicePromise
  })
  const { lease } = caller()
  const invocation = runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())
  await new Promise<void>((resolve) => setImmediate(resolve))
  const disabling = runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  })
  resolveService({
    async close() {},
    async closeRun() {},
    async observeAndOpenSession() {
      observeCalls += 1
      throw new Error("observe must not run")
    },
    async setEnabled() {}
  } as never)

  await assert.rejects(invocation, /disabled in Settings/i)
  await disabling
  assert.equal(observeCalls, 0)
  await runtime.close()
})

test("Computer Use retries failed session cleanup when the same disabled config is saved", async () => {
  const transitions: boolean[] = []
  let failDisable = true
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) =>
      ({
        async close() {},
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled(enabled: boolean) {
          transitions.push(enabled)
          if (!enabled && failDisable) {
            failDisable = false
            throw new Error("dispose failed")
          }
        }
      }) as never
  })
  const { lease } = caller()
  await runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())
  const disabledConfig = {
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  }

  await assert.rejects(runtime.applyAgentConfig(disabledConfig), /dispose failed/)
  assert.deepEqual(runtime.getConfigApplicationStatus(), {
    diagnosticCode: "computer_use.settings_apply_failed",
    retryable: true,
    state: "retry_required"
  })
  await runtime.applyAgentConfig(disabledConfig)

  assert.deepEqual(transitions, [true, false, false])
  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applied" })
  assert.equal(runtime.createToolHandlers(lease), undefined)
  await runtime.close()
})

test("Computer Use retries failed disable cleanup before restoring the applied enabled state", async () => {
  const transitions: boolean[] = []
  let failDisable = true
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) =>
      ({
        async close() {},
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled(enabled: boolean) {
          transitions.push(enabled)
          if (!enabled && failDisable) {
            failDisable = false
            throw new Error("dispose failed")
          }
        }
      }) as never
  })
  const { lease } = caller()
  await runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())

  await assert.rejects(
    runtime.applyAgentConfig({
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: false
    }),
    /dispose failed/
  )
  assert.deepEqual(runtime.getConfigApplicationStatus(), {
    diagnosticCode: "computer_use.settings_apply_failed",
    retryable: true,
    state: "retry_required"
  })
  await runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: true
  })

  assert.deepEqual(transitions, [true, false, false, true])
  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applied" })
  assert.ok(runtime.createToolHandlers(lease))
  await runtime.close()
})

test("Computer Use ignores stale apply failure status while a newer config is queued", async () => {
  let disableCalls = 0
  let releaseFirstDisable!: () => void
  let releaseSecondDisable!: () => void
  let startFirstDisable!: () => void
  let startSecondDisable!: () => void
  const firstDisableStarted = new Promise<void>((resolve) => {
    startFirstDisable = resolve
  })
  const secondDisableStarted = new Promise<void>((resolve) => {
    startSecondDisable = resolve
  })
  const firstDisableReleased = new Promise<void>((resolve) => {
    releaseFirstDisable = resolve
  })
  const secondDisableReleased = new Promise<void>((resolve) => {
    releaseSecondDisable = resolve
  })
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) =>
      ({
        async close() {},
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled(enabled: boolean) {
          if (enabled) return
          disableCalls += 1
          if (disableCalls === 1) {
            startFirstDisable()
            await firstDisableReleased
            throw new Error("stale disable failed")
          }
          startSecondDisable()
          await secondDisableReleased
        }
      }) as never
  })
  const { lease } = caller()
  await runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())

  const staleApply = runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  })
  await firstDisableStarted
  const currentApply = runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: true
  })
  releaseFirstDisable()
  await assert.rejects(staleApply, /stale disable failed/)
  await secondDisableStarted
  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applying" })

  releaseSecondDisable()
  await currentApply
  assert.deepEqual(runtime.getConfigApplicationStatus(), { state: "applied" })
  await runtime.close()
})

test("Computer Use runtime retries terminal service cleanup after a failed close", async () => {
  let closeCalls = 0
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async ({ authorizeTarget }) =>
      ({
        async close() {
          closeCalls += 1
          if (closeCalls === 1) throw new Error("close failed")
        },
        async closeRun() {},
        async observeAndOpenSession() {
          const value = observation()
          authorizeTarget(value)
          return {
            authorization: { sessionId: "session-1" },
            observation: value,
            projection: { elements: [], kind: "full", reason: "initial", stateId: value.stateId }
          }
        },
        async setEnabled() {}
      }) as never
  })
  const { lease } = caller()
  await runtime
    .createToolHandlers(lease)!
    .observe({ applicationId: "com.example.editor" }, context())

  await assert.rejects(runtime.close(), /close failed/)
  assert.equal(runtime.createToolHandlers(lease), undefined)
  await runtime.close()
  assert.equal(closeCalls, 2)
})

test("Computer Use observation queries require the owning run, thread, and session", async () => {
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "press",
          background: "verified",
          foreground: "verified",
          route: "ax_action"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    async disposeSession() {},
    async execute() {
      throw new Error("execute is not used")
    },
    async identify() {
      const {
        capturedAt: _capturedAt,
        elements: _elements,
        epoch: _epoch,
        stateId: _stateId,
        ...target
      } = observation()
      return target
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = observation()
      return value
    }
  }
  const service = new ComputerUseApplicationService(backend)
  await service.setEnabled(true)
  const snapshot = await service.observeAndOpenSession({
    applicationId: "com.example.editor",
    runId: "run-1",
    threadId: "thread-1"
  })
  const query = {
    query: "save",
    runId: "run-1",
    sessionId: snapshot.authorization.sessionId,
    stateId: snapshot.observation.stateId,
    threadId: "thread-1"
  }

  assert.deepEqual(
    service.search(query).elements.map((element) => element.ref),
    ["@save"]
  )
  assert.deepEqual(
    service.describeActionApproval({
      actions: [{ kind: "press", ref: "@save" }],
      runId: "run-1",
      sessionId: snapshot.authorization.sessionId,
      stateId: snapshot.observation.stateId,
      threadId: "thread-1"
    }).target,
    {
      application: { id: "com.example.editor", name: "Editor" },
      elements: [{ ref: "@save", role: "button" }],
      window: { nativeId: "window-1", platform: "macos" }
    }
  )
  assert.throws(
    () =>
      service.describeActionApproval({
        actions: [{ kind: "press", ref: "@missing" }],
        runId: "run-1",
        sessionId: snapshot.authorization.sessionId,
        stateId: snapshot.observation.stateId,
        threadId: "thread-1"
      }),
    /unavailable semantic ref/i
  )
  assert.throws(
    () =>
      service.describeActionApproval({
        actions: [
          { kind: "press", ref: "@save" },
          { kind: "type_text", ref: "@save", value: "not supported" }
        ],
        runId: "run-1",
        sessionId: snapshot.authorization.sessionId,
        stateId: snapshot.observation.stateId,
        threadId: "thread-1"
      }),
    /unavailable semantic ref/i
  )
  assert.throws(() => service.search({ ...query, runId: "run-other" }), /authorization/i)
  assert.throws(() => service.search({ ...query, threadId: "thread-other" }), /authorization/i)
  assert.throws(() => service.search({ ...query, sessionId: "session-other" }), /session/i)
  await service.close()
})

test("Computer Use application service retries disposal after terminal close failure", async () => {
  let disposeCalls = 0
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    async disposeSession() {
      disposeCalls += 1
      if (disposeCalls === 1) throw new Error("dispose failed")
    },
    async execute() {
      throw new Error("execute is not used")
    },
    async identify() {
      const {
        capturedAt: _capturedAt,
        elements: _elements,
        epoch: _epoch,
        stateId: _stateId,
        ...target
      } = observation()
      return target
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = observation()
      return value
    }
  }
  const service = new ComputerUseApplicationService(backend)
  await service.setEnabled(true)
  await service.observeAndOpenSession({
    applicationId: "com.example.editor",
    runId: "run-1",
    threadId: "thread-1"
  })

  await assert.rejects(service.close(), /dispose failed/)
  assert.throws(
    () =>
      service.search({
        query: "save",
        runId: "run-1",
        sessionId: "session-1",
        stateId: "state-1",
        threadId: "thread-1"
      }),
    /closed/
  )
  await service.close()
  assert.equal(disposeCalls, 2)
})

test("Computer Use approval admission aborts when Settings revokes its session", async () => {
  const session = new AbortController()
  const runtime = new ComputerUseRuntime({
    initialConfig: {
      computerUseApplicationAllowlist: ["com.example.editor"],
      computerUseEnabled: true
    },
    createService: async () =>
      ({
        async close() {},
        async closeRun() {},
        prepareActionApproval() {
          return {
            review: { kind: "computer_use_action" },
            signal: session.signal
          }
        },
        async setEnabled(enabled: boolean) {
          if (!enabled) session.abort(new Error("Computer use was disabled."))
        }
      }) as never
  })
  const { lease } = caller()
  const admission = await runtime.prepareActionApproval(
    {
      actions: [{ kind: "press", ref: "@save" }],
      sessionId: "session-1",
      stateId: "state-1"
    },
    { runId: "run-1", threadId: "thread-1" },
    lease
  )
  assert.equal(admission.signal.aborted, false)

  await runtime.applyAgentConfig({
    computerUseApplicationAllowlist: ["com.example.editor"],
    computerUseEnabled: false
  })

  assert.equal(admission.signal.aborted, true)
  await runtime.close()
})

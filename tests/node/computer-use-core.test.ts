import assert from "node:assert/strict"
import test from "node:test"
import * as computerUseCore from "../../packages/computer-use-core/src"
import {
  ComputerUseAuthorizationRegistry,
  ComputerUseActionLedger,
  computerUseCapabilityMatrix,
  createJingleComputerUseNativeBackend,
  ComputerUseObservationStore,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  StaleComputerUseStateError,
  computerUseResultAllowsForegroundRetry,
  type ComputerUseBackend,
  type ComputerUseBackendEnvironment,
  type ComputerUseCapability,
  type ComputerUseCapabilityMatrix,
  type ComputerUseObservation,
  type ComputerUseBackendExecutionResult,
  type JingleComputerUseNativeBridge,
  type JingleComputerUseNativeRequest
} from "../../packages/computer-use-core/src"

function observation(overrides: Partial<ComputerUseObservation> = {}): ComputerUseObservation {
  return {
    application: { id: "com.example.fixture", name: "Fixture" },
    capturedAt: 1,
    elements: [],
    epoch: 0,
    resourceKey: "desktop-pid:42",
    stateId: "state-0",
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" },
    ...overrides
  }
}

function typeTextObservation(): ComputerUseObservation {
  return observation({
    elements: [
      {
        actions: ["type_text"],
        index: 0,
        ref: "@e1",
        role: "text_field"
      }
    ]
  })
}

function resolvedVoid(): Promise<void> {
  return Promise.resolve()
}

interface RecordedNativeInvocation {
  request: JingleComputerUseNativeRequest
  signal?: AbortSignal
}

function recordingNativeBridge(
  handler: (
    request: JingleComputerUseNativeRequest,
    signal?: AbortSignal
  ) => unknown | Promise<unknown>
): { bridge: JingleComputerUseNativeBridge; calls: RecordedNativeInvocation[] } {
  const calls: RecordedNativeInvocation[] = []
  return {
    bridge: {
      async invoke<T>(request: JingleComputerUseNativeRequest, signal?: AbortSignal): Promise<T> {
        calls.push({ request, signal })
        return (await handler(request, signal)) as T
      }
    },
    calls
  }
}

function probedMatrix(environment: ComputerUseBackendEnvironment): ComputerUseCapabilityMatrix {
  if (environment === "macos-quartz") {
    return {
      capabilities: [
        { action: "press", background: "verified", foreground: "unavailable", route: "ax_action" },
        {
          action: "set_value",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        },
        {
          action: "type_text",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        },
        {
          action: "keypress",
          background: "refused",
          foreground: "unavailable",
          route: "unavailable"
        },
        {
          action: "scroll",
          background: "unavailable",
          foreground: "unavailable",
          route: "unavailable"
        }
      ],
      environment,
      platform: "macos",
      protocolVersion: 1
    }
  }
  if (environment === "windows-win32") {
    return {
      capabilities: [
        {
          action: "press",
          background: "unavailable",
          foreground: "unavailable",
          route: "uia_action"
        },
        {
          action: "set_value",
          background: "unavailable",
          foreground: "unavailable",
          route: "uia_value"
        },
        {
          action: "type_text",
          background: "unavailable",
          foreground: "unavailable",
          route: "uia_value"
        },
        {
          action: "keypress",
          background: "unavailable",
          foreground: "unavailable",
          route: "uia_unavailable"
        },
        {
          action: "scroll",
          background: "unavailable",
          foreground: "unavailable",
          route: "uia_unavailable"
        }
      ],
      environment,
      platform: "windows",
      protocolVersion: 1
    }
  }
  return {
    capabilities: [
      {
        action: "press",
        background: "verified",
        foreground: "unavailable",
        route: "at_spi_action"
      },
      {
        action: "set_value",
        background: "verified",
        foreground: "unavailable",
        route: "at_spi_editable_text"
      },
      {
        action: "type_text",
        background: "verified",
        foreground: "unavailable",
        route: "at_spi_editable_text"
      },
      {
        action: "keypress",
        background: "refused",
        foreground: "unavailable",
        route: "unavailable"
      },
      {
        action: "scroll",
        background: "verified",
        foreground: "unavailable",
        route: "at_spi_action"
      }
    ],
    environment,
    platform: "linux",
    protocolVersion: 1
  }
}

function replaceCapability(
  matrix: ComputerUseCapabilityMatrix,
  action: ComputerUseCapability["action"],
  patch: Partial<ComputerUseCapability>
): ComputerUseCapabilityMatrix {
  return {
    ...matrix,
    capabilities: matrix.capabilities.map((capability) =>
      capability.action === action ? { ...capability, ...patch } : capability
    )
  }
}

test("computer-use scheduler rejects stale mutations before dispatch", async () => {
  const scheduler = new ComputerUseResourceScheduler()
  let dispatchCount = 0
  await scheduler.write({
    expectedEpoch: 0,
    physicalInput: false,
    resourceKey: "desktop-pid:42",
    work: async (commit) => {
      commit()
      dispatchCount += 1
    }
  })
  await assert.rejects(
    scheduler.write({
      expectedEpoch: 0,
      physicalInput: false,
      resourceKey: "desktop-pid:42",
      work: async (commit) => {
        commit()
        dispatchCount += 1
      }
    }),
    StaleComputerUseStateError
  )
  assert.equal(dispatchCount, 1)
})

test("queued computer-use work observes cancellation before dispatch", async () => {
  const scheduler = new ComputerUseResourceScheduler()
  let release!: () => void
  const blocker = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = scheduler.read("desktop-pid:42", async () => blocker)
  const controller = new AbortController()
  let dispatched = false
  const second = scheduler.write({
    expectedEpoch: 0,
    physicalInput: false,
    resourceKey: "desktop-pid:42",
    signal: controller.signal,
    work: async () => {
      dispatched = true
    }
  })
  controller.abort()
  release()
  await first
  await assert.rejects(second, /aborted/i)
  assert.equal(dispatched, false)
})

test("foreground retry requires an explicit side-effect-free didnt", () => {
  const base = {
    action: { kind: "type_text", ref: "@e1", value: "hello" } as const,
    evidence: {
      delivery: "semantic" as const,
      noSideEffectProof: true,
      route: "ax_value",
      verification: "failed" as const
    }
  }
  assert.equal(
    computerUseResultAllowsForegroundRetry({
      baseStateId: "state-0",
      outcome: "didnt",
      steps: [{ ...base, outcome: "didnt" }]
    }),
    true
  )
  for (const outcome of ["unknown", "worked", "refused"] as const) {
    assert.equal(
      computerUseResultAllowsForegroundRetry({
        baseStateId: "state-0",
        outcome,
        steps: [{ ...base, outcome }]
      }),
      false
    )
  }
})

test("authorization is bound to run, session, and window generation", () => {
  const registry = new ComputerUseAuthorizationRegistry()
  const base = observation()
  registry.grant({
    expiresAt: Date.now() + 10_000,
    runId: "run-1",
    sessionId: "session-1",
    threadId: "thread-1",
    window: base.window
  })
  assert.doesNotThrow(() =>
    registry.assertAuthorized({
      observation: base,
      runId: "run-1",
      sessionId: "session-1",
      threadId: "thread-1"
    })
  )
  assert.throws(() =>
    registry.assertAuthorized({
      observation: observation({ window: { ...base.window, generation: "g2" } }),
      runId: "run-1",
      sessionId: "session-1",
      threadId: "thread-1"
    })
  )
})

test("coordinator never replays an ambiguous background outcome", async () => {
  const calls: string[] = []
  const result: ComputerUseBackendExecutionResult = {
    baseStateId: "state-0",
    outcome: "unknown",
    steps: [
      {
        action: { kind: "type_text", ref: "@e1", value: "hello" },
        evidence: {
          delivery: "targeted_input",
          noSideEffectProof: false,
          route: "background_keyboard",
          verification: "unverifiable"
        },
        outcome: "unknown"
      }
    ]
  }
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "verified",
          route: "background_keyboard"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute(request) {
      calls.push(request.delivery)
      return result
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...backendObservation } = typeTextObservation()
      return backendObservation
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const ledger = new ComputerUseActionLedger({
    async reserve() { return "reserved" },
    write: resolvedVoid
  })
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    ledger
  )
  const baseObservation = await coordinator.observe({ applicationId: "com.example.fixture" })
  await sessions.setEnabled(true)
  const grant = sessions.openSession({
    observation: baseObservation,
    runId: "run-1",
    threadId: "thread-1"
  })
  await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: baseObservation.stateId,
    runId: "run-1",
    sessionId: grant.sessionId,
    threadId: "thread-1",
    transactionId: "transaction-1"
  })
  assert.deepEqual(calls, ["background"])
})

test("observation store keeps immutable bounded states", () => {
  const store = new ComputerUseObservationStore(1)
  const { stateId: _firstStateId, ...firstInput } = observation()
  const { stateId: _secondStateId, ...secondInput } = observation({ epoch: 1 })
  const first = store.create(firstInput)
  const second = store.create(secondInput)
  assert.equal(store.get(first.stateId), undefined)
  assert.equal(store.get(second.stateId), second)
  assert.equal(Object.isFrozen(second), true)
  assert.equal(Object.isFrozen(second.window), true)
  assert.equal(Object.isFrozen(second.elements), true)
})

test("settings off revokes sessions before backend disposal completes", async () => {
  const disposed: string[] = []
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    async disposeSession(sessionId) {
      disposed.push(sessionId)
    },
    async execute() {
      throw new Error("unused")
    },
    async observe() {
      throw new Error("unused")
    }
  }
  const manager = new ComputerUseSessionManager(backend)
  assert.throws(() => manager.openSession({ observation: observation(), runId: "r", threadId: "t" }))
  await manager.setEnabled(true)
  const grant = manager.openSession({ observation: observation(), runId: "r", threadId: "t" })
  await manager.setEnabled(false)
  assert.deepEqual(disposed, [grant.sessionId])
  assert.throws(() =>
    manager.assertAuthorized({
      observation: observation(),
      runId: "r",
      sessionId: grant.sessionId,
      threadId: "t"
    })
  )
})

test("cancel after native dispatch is recorded as unknown, never cancelled", async () => {
  const writes: string[] = []
  const ledger = new ComputerUseActionLedger({
    async reserve() { return "reserved" },
    async write(attempt) {
      writes.push(`${attempt.phase}:${attempt.outcome ?? "pending"}`)
    }
  })
  const attempt = await ledger.begin({
    runId: "run-1",
    sessionId: "session-1",
    transactionId: "transaction-1"
  })
  await ledger.dispatched(attempt.attemptId)
  assert.equal(await ledger.cancel(attempt.attemptId), "unknown")
  assert.deepEqual(writes, ["dispatched:pending", "settled:unknown"])
})

test("settings off aborts a queued transaction before native dispatch", async () => {
  let nativeDispatches = 0
  const base = typeTextObservation()
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "verified",
          route: "background_keyboard"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute() {
      nativeDispatches += 1
      return {
        baseStateId: base.stateId,
        outcome: "unknown",
        steps: []
      }
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...raw } = base
      return raw
    }
  }
  const scheduler = new ComputerUseResourceScheduler()
  const sessions = new ComputerUseSessionManager(backend)
  const ledger = new ComputerUseActionLedger({
    async reserve() { return "reserved" },
    write: resolvedVoid
  })
  const coordinator = new ComputerUseTransactionCoordinator(backend, scheduler, sessions, ledger)
  const canonicalBase = await coordinator.observe({ applicationId: "com.example.fixture" })
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: canonicalBase, runId: "r", threadId: "t" })
  let release!: () => void
  const blocker = scheduler.read(base.resourceKey, async () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const queued = coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: canonicalBase.stateId,
    runId: "r",
    sessionId: grant.sessionId,
    threadId: "t",
    transactionId: "queued-transaction"
  })
  await sessions.setEnabled(false)
  release()
  await blocker
  assert.equal((await queued).outcome, "cancelled_before_dispatch")
  assert.equal(nativeDispatches, 0)
})

test("transaction ids are single-use even after a result is lost", async () => {
  const reserved = new Set<string>()
  const ledger = new ComputerUseActionLedger({
    async reserve(attempt) {
      if (reserved.has(attempt.attemptId)) return "exists"
      reserved.add(attempt.attemptId)
      return "reserved"
    },
    write: resolvedVoid
  })
  await ledger.begin({ runId: "r", sessionId: "s", transactionId: "tx" })
  await assert.rejects(
    ledger.begin({ runId: "r", sessionId: "s", transactionId: "tx" }),
    /already attempted/
  )
})

test("empty transaction ids are rejected before durable reserve", async () => {
  let reserves = 0
  const ledger = new ComputerUseActionLedger({
    async reserve() {
      reserves += 1
      return "reserved"
    },
    write: resolvedVoid
  })
  await assert.rejects(ledger.begin({ runId: "r", sessionId: "s", transactionId: "   " }))
  assert.equal(reserves, 0)
})

test("observation store rejects duplicate semantic refs", () => {
  const store = new ComputerUseObservationStore()
  const base = observation()
  assert.throws(() =>
    store.create({
      ...base,
      elements: [base.elements[0]!, { ...base.elements[0]!, index: 1 }]
    })
  )
})

test("cancellation while waiting for physical input does not advance epoch", async () => {
  const scheduler = new ComputerUseResourceScheduler()
  let release!: () => void
  const holding = scheduler.write({
    expectedEpoch: 0,
    physicalInput: true,
    resourceKey: "window:a",
    work: async (commit) => {
      commit()
      return new Promise<void>((resolve) => { release = resolve })
    }
  })
  while (!release) await Promise.resolve()
  const controller = new AbortController()
  const waiting = scheduler.write({
    expectedEpoch: 0,
    physicalInput: true,
    resourceKey: "window:b",
    signal: controller.signal,
    work: async () => undefined
  })
  controller.abort()
  const outcome = await Promise.race([
    waiting.then(
      () => "resolved",
      () => "cancelled"
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve("pending")))
  ])
  assert.equal(outcome, "cancelled")
  release()
  await holding
  assert.equal(scheduler.epoch("window:b"), 0)
})

test("capability matrices cannot be mutated into verified support", () => {
  const matrix = computerUseCapabilityMatrix("windows-win32")
  assert.throws(() => {
    ;(matrix.capabilities[0] as { background: string }).background = "verified"
  })
  assert.equal(computerUseCapabilityMatrix("windows-win32").capabilities[0]?.background, "unavailable")
})

test("latest settings-off wins while session disposal is pending", async () => {
  let releaseDispose!: () => void
  const disposeGate = new Promise<void>((resolve) => {
    releaseDispose = resolve
  })
  let disposeCalls = 0
  const backend: ComputerUseBackend = {
    matrix: computerUseCapabilityMatrix("macos-quartz"),
    async disposeSession() {
      disposeCalls += 1
      await disposeGate
    },
    async execute() {
      throw new Error("unused")
    },
    async observe() {
      throw new Error("unused")
    }
  }
  const manager = new ComputerUseSessionManager(backend)
  await manager.setEnabled(true)
  manager.openSession({ observation: observation(), runId: "run", threadId: "thread" })

  const firstOff = manager.setEnabled(false)
  const staleOn = manager.setEnabled(true)
  const latestOff = manager.setEnabled(false)
  releaseDispose()
  await Promise.all([firstOff, staleOn, latestOff])

  assert.equal(manager.isEnabled(), false)
  assert.equal(disposeCalls, 1)
  assert.throws(() =>
    manager.openSession({ observation: observation(), runId: "run", threadId: "thread" })
  )
})

test("enable retries failed session cleanup before accepting new work", async () => {
  let disposeCalls = 0
  const backend: ComputerUseBackend = {
    matrix: computerUseCapabilityMatrix("macos-quartz"),
    async disposeSession() {
      disposeCalls += 1
      if (disposeCalls === 1) throw new Error("dispose failed")
    },
    async execute() {
      throw new Error("unused")
    },
    async observe() {
      throw new Error("unused")
    }
  }
  const manager = new ComputerUseSessionManager(backend)
  await manager.setEnabled(true)
  manager.openSession({ observation: observation(), runId: "run", threadId: "thread" })

  await assert.rejects(manager.setEnabled(false), /dispose failed/)
  assert.equal(manager.isEnabled(), false)
  await manager.setEnabled(true)

  assert.equal(disposeCalls, 2)
  assert.equal(manager.isEnabled(), true)
})

test("queued abort settles before its resource predecessor finishes", async () => {
  const scheduler = new ComputerUseResourceScheduler()
  let release!: () => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const first = scheduler.read(
    "resource",
    () =>
      new Promise<void>((resolve) => {
        release = resolve
        markStarted()
      })
  )
  await started

  const controller = new AbortController()
  const queued = scheduler.write({
    expectedEpoch: 0,
    physicalInput: false,
    resourceKey: "resource",
    signal: controller.signal,
    work: async () => {
      throw new Error("cancelled work must not dispatch")
    }
  })
  controller.abort()
  const outcome = await Promise.race([
    queued.then(
      () => "resolved",
      () => "cancelled"
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve("pending")))
  ])

  assert.equal(outcome, "cancelled")
  assert.equal(scheduler.epoch("resource"), 0)
  release()
  await first
})

test("queued observation abort settles before its resource predecessor finishes", async () => {
  const scheduler = new ComputerUseResourceScheduler()
  let release!: () => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const first = scheduler.read(
    "resource",
    () =>
      new Promise<void>((resolve) => {
        release = resolve
        markStarted()
      })
  )
  await started

  const controller = new AbortController()
  const queued = scheduler.read(
    "resource",
    async () => {
      throw new Error("cancelled observation must not run")
    },
    controller.signal
  )
  controller.abort()
  const outcome = await Promise.race([
    queued.then(
      () => "resolved",
      () => "cancelled"
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve("pending")))
  ])

  assert.equal(outcome, "cancelled")
  release()
  await first
})

test("backend cannot report pre-dispatch cancellation after dispatch", async () => {
  const raw = typeTextObservation()
  const writes: string[] = []
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute(request) {
      return {
        baseStateId: request.base.stateId,
        outcome: "cancelled_before_dispatch",
        steps: []
      } as unknown as ComputerUseBackendExecutionResult
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return value
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger({
      async reserve() {
        return "reserved"
      },
      async write(attempt) {
        writes.push(`${attempt.phase}:${attempt.outcome ?? "pending"}`)
      }
    })
  )
  const base = await coordinator.observe({})
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })

  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread",
    transactionId: "impossible-cancellation"
  })

  assert.equal(result.outcome, "unknown")
  assert.equal(writes.at(-1), "settled:unknown")
})

test("successor identity changes never publish an observation with the old epoch", async () => {
  const baseRaw = typeTextObservation()
  const executeWithReplacement = async (replacement: ComputerUseObservation) => {
    let observeCalls = 0
    const backend: ComputerUseBackend = {
      matrix: {
        capabilities: [
          {
            action: "type_text",
            background: "verified",
            foreground: "unavailable",
            route: "ax_value"
          }
        ],
        environment: "macos-quartz",
        platform: "macos",
        protocolVersion: 1
      },
      disposeSession: resolvedVoid,
      async execute(request) {
        return {
          baseStateId: request.base.stateId,
          outcome: "worked",
          steps: [
            {
              action: request.actions[0]!,
              evidence: {
                delivery: "semantic",
                noSideEffectProof: false,
                route: "ax_value",
                verification: "verified"
              },
              outcome: "worked"
            }
          ]
        }
      },
      async observe() {
        observeCalls += 1
        const source = observeCalls <= 2 ? baseRaw : replacement
        const { epoch: _epoch, stateId: _stateId, ...value } = source
        return value
      }
    }
    const scheduler = new ComputerUseResourceScheduler()
    const sessions = new ComputerUseSessionManager(backend)
    const coordinator = new ComputerUseTransactionCoordinator(
      backend,
      scheduler,
      sessions,
      new ComputerUseActionLedger({
        async reserve() {
          return "reserved"
        },
        write: resolvedVoid
      })
    )
    const base = await coordinator.observe({})
    await sessions.setEnabled(true)
    const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })
    const result = await coordinator.execute({
      actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
      baseStateId: base.stateId,
      runId: "run",
      sessionId: grant.sessionId,
      threadId: "thread",
      transactionId: `replacement-${replacement.resourceKey}-${replacement.window.nativeId}`
    })
    return { base, result, scheduler }
  }

  const changedResource = observation({
    elements: baseRaw.elements,
    resourceKey: "replacement-resource",
    window: { generation: "g2", nativeId: "w2", pid: 43, platform: "macos" }
  })
  const changedResourceRun = await executeWithReplacement(changedResource)
  assert.equal(changedResourceRun.result.outcome, "unknown")
  assert.equal(changedResourceRun.result.successor, undefined)
  assert.equal(changedResourceRun.scheduler.epoch(changedResourceRun.base.resourceKey), 1)
  assert.equal(changedResourceRun.scheduler.epoch(changedResource.resourceKey), 0)

  const reusedResourceKey = observation({
    elements: baseRaw.elements,
    resourceKey: baseRaw.resourceKey,
    window: { generation: baseRaw.window.generation, nativeId: "w2", pid: 43, platform: "macos" }
  })
  const reusedResourceRun = await executeWithReplacement(reusedResourceKey)
  assert.equal(reusedResourceRun.result.outcome, "unknown")
  assert.equal(reusedResourceRun.result.successor, undefined)
  assert.equal(reusedResourceRun.scheduler.epoch(reusedResourceRun.base.resourceKey), 1)
})

test("coordinator preserves typed stale-state failure before dispatch", async () => {
  const raw = typeTextObservation()
  const writes: string[] = []
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute(request) {
      return {
        baseStateId: request.base.stateId,
        outcome: "worked",
        steps: [
          {
            action: request.actions[0]!,
            evidence: {
              delivery: "semantic",
              noSideEffectProof: false,
              route: "ax_value",
              verification: "verified"
            },
            outcome: "worked"
          }
        ]
      }
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return value
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger({
      async reserve() {
        return "reserved"
      },
      async write(attempt) {
        writes.push(`${attempt.phase}:${attempt.outcome ?? "pending"}`)
      }
    })
  )
  const base = await coordinator.observe({})
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })
  const input = {
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }] as const,
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread"
  }
  await coordinator.execute({ ...input, transactionId: "first" })

  await assert.rejects(
    coordinator.execute({ ...input, transactionId: "stale" }),
    StaleComputerUseStateError
  )
  assert.equal(writes.at(-1), "settled:unavailable")
  assert.equal(writes.includes("settled:refused"), false)
})

test("session TTL must be finite and bounded", async () => {
  const backend: ComputerUseBackend = {
    matrix: computerUseCapabilityMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    async execute() {
      throw new Error("unused")
    },
    async observe() {
      throw new Error("unused")
    }
  }
  const manager = new ComputerUseSessionManager(backend)
  await manager.setEnabled(true)
  for (const ttlMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, 999, 30 * 60_000 + 1]) {
    assert.throws(() =>
      manager.openSession({ observation: observation(), runId: "run", threadId: "thread", ttlMs })
    )
  }
  assert.doesNotThrow(() =>
    manager.openSession({
      observation: observation(),
      runId: "run",
      threadId: "thread",
      ttlMs: 1_000
    })
  )
  assert.doesNotThrow(() =>
    manager.openSession({
      observation: observation(),
      runId: "run",
      threadId: "thread",
      ttlMs: 30 * 60_000
    })
  )
})

test("backend actions are compared by fields rather than object property order", async () => {
  const raw = typeTextObservation()
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute(request) {
      const source = request.actions[0]!
      return {
        baseStateId: request.base.stateId,
        outcome: "worked",
        steps: [
          {
            action: { ref: source.ref, value: source.value, kind: source.kind },
            evidence: {
              delivery: "semantic",
              noSideEffectProof: false,
              route: "ax_value",
              verification: "verified"
            },
            outcome: "worked"
          }
        ]
      }
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return value
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger({
      async reserve() {
        return "reserved"
      },
      write: resolvedVoid
    })
  )
  const base = await coordinator.observe({})
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })

  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread",
    transactionId: "reordered-action"
  })

  assert.equal(result.outcome, "worked")
})

test("native computer-use backend has one probe factory and no injectable constructor", () => {
  assert.equal(typeof computerUseCore.createJingleComputerUseNativeBackend, "function")
  assert.equal("JingleComputerUseNativeBackend" in computerUseCore, false)
})

test("native capability probes accept the exact policy for every environment", async () => {
  const environments: readonly ComputerUseBackendEnvironment[] = [
    "macos-quartz",
    "windows-win32",
    "linux-x11",
    "linux-wayland-gnome",
    "linux-wayland-kde",
    "linux-wayland-other"
  ]
  for (const environment of environments) {
    const matrix = probedMatrix(environment)
    const { bridge, calls } = recordingNativeBridge(() => matrix)
    const backend = await createJingleComputerUseNativeBackend(environment, bridge)

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]?.request, { environment, method: "probe" })
    assert.equal(backend.matrix.environment, environment)
    assert.deepEqual(
      backend.matrix.capabilities.map((capability) => capability.action),
      ["press", "set_value", "type_text", "keypress", "scroll"]
    )
  }
})

test("native capability probes reject environment and protocol mismatches", async () => {
  const base = probedMatrix("macos-quartz")
  const invalidMatrices: unknown[] = [
    { ...base, environment: "windows-win32" },
    { ...base, platform: "windows" },
    { ...base, protocolVersion: 2 }
  ]
  for (const matrix of invalidMatrices) {
    const { bridge } = recordingNativeBridge(() => matrix)
    await assert.rejects(
      createJingleComputerUseNativeBackend("macos-quartz", bridge),
      /another environment or protocol/
    )
  }
})

test("native capability probes reject missing, duplicate, extra, and invalid actions", async () => {
  const base = probedMatrix("macos-quartz")
  const invalidMatrices: unknown[] = [
    { ...base, capabilities: base.capabilities.slice(0, -1) },
    { ...base, capabilities: [...base.capabilities.slice(0, -1), base.capabilities[0]] },
    { ...base, capabilities: [...base.capabilities, { ...base.capabilities[0], action: "bogus" }] },
    {
      ...base,
      capabilities: base.capabilities.map((capability, index) =>
        index === 0 ? { ...capability, action: "bogus" } : capability
      )
    }
  ]
  for (const matrix of invalidMatrices) {
    const { bridge } = recordingNativeBridge(() => matrix)
    await assert.rejects(createJingleComputerUseNativeBackend("macos-quartz", bridge), /action/)
  }
})

test("native capability probes reject invalid support and action-route combinations", async () => {
  const base = probedMatrix("macos-quartz")
  const invalidMatrices: unknown[] = [
    {
      ...base,
      capabilities: base.capabilities.map((capability) =>
        capability.action === "press" ? { ...capability, background: "invalid" } : capability
      )
    },
    replaceCapability(base, "press", { background: "refused" }),
    replaceCapability(base, "press", { route: "ax_value" }),
    replaceCapability(base, "press", { route: "global_input" }),
    replaceCapability(base, "keypress", { background: "verified" })
  ]
  for (const matrix of invalidMatrices) {
    const { bridge } = recordingNativeBridge(() => matrix)
    await assert.rejects(createJingleComputerUseNativeBackend("macos-quartz", bridge))
  }
})

test("native bridge keeps signals out of probe, observe, and execute JSON payloads", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...backendObservation } = base
  const controller = new AbortController()
  const { bridge, calls } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "observe") return backendObservation
    if (request.method === "execute") {
      return {
        baseStateId: request.request.base.stateId,
        outcome: "worked",
        steps: [
          {
            action: request.request.actions[0],
            evidence: {
              delivery: "semantic",
              noSideEffectProof: false,
              route: "ax_value",
              verification: "verified"
            },
            outcome: "worked"
          }
        ]
      }
    }
    return undefined
  })
  const backend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    bridge,
    controller.signal
  )
  await backend.observe({ applicationId: base.application.id, signal: controller.signal })
  await backend.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    authorization: {
      expiresAt: Date.now() + 1_000,
      runId: "run",
      sessionId: "session",
      threadId: "thread",
      window: base.window
    },
    base,
    delivery: "background",
    signal: controller.signal
  })

  assert.deepEqual(
    calls.map((call) => call.request.method),
    ["probe", "observe", "execute"]
  )
  for (const call of calls) {
    assert.equal(call.signal, controller.signal)
    assert.equal(JSON.stringify(call.request).includes("signal"), false)
    if (call.request.method === "observe" || call.request.method === "execute") {
      assert.equal(Object.hasOwn(call.request.request, "signal"), false)
    }
  }
})

test("pre-aborted native calls never invoke the bridge", async () => {
  const probeController = new AbortController()
  probeController.abort()
  const probe = recordingNativeBridge(() => probedMatrix("macos-quartz"))
  await assert.rejects(
    createJingleComputerUseNativeBackend("macos-quartz", probe.bridge, probeController.signal),
    /aborted/i
  )
  assert.equal(probe.calls.length, 0)

  const active = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    throw new Error("pre-aborted native operation must not invoke the bridge")
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", active.bridge)
  active.calls.length = 0
  const operationController = new AbortController()
  operationController.abort()
  const base = typeTextObservation()

  await assert.rejects(backend.observe({ signal: operationController.signal }), /aborted/i)
  await assert.rejects(
    backend.execute({
      actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
      authorization: {
        expiresAt: Date.now() + 1_000,
        runId: "run",
        sessionId: "session",
        threadId: "thread",
        window: base.window
      },
      base,
      delivery: "background",
      signal: operationController.signal
    }),
    /aborted/i
  )
  assert.equal(active.calls.length, 0)
})

test("native backend returns an empty typed refusal before invoking unsupported actions", async () => {
  const base = typeTextObservation()
  const { bridge, calls } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    throw new Error("unsupported native actions must not invoke the bridge")
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
  calls.length = 0
  const authorization = {
    expiresAt: Date.now() + 1_000,
    runId: "run",
    sessionId: "session",
    threadId: "thread",
    window: base.window
  }
  const press = { kind: "press", ref: "@e1" } as const
  const keypress = { keys: ["ENTER"], kind: "keypress", ref: "@e1" } as const

  const firstUnsupported = await backend.execute({
    actions: [keypress, press],
    authorization,
    base,
    delivery: "background"
  })
  const secondUnsupported = await backend.execute({
    actions: [press, keypress],
    authorization,
    base,
    delivery: "background"
  })

  assert.deepEqual(firstUnsupported, {
    baseStateId: base.stateId,
    outcome: "refused",
    steps: []
  })
  assert.deepEqual(secondUnsupported, {
    baseStateId: base.stateId,
    outcome: "refused",
    steps: []
  })
  assert.equal(calls.length, 0)
})

test("native capability matrices are canonical immutable copies", async () => {
  const matrix = probedMatrix("linux-x11")
  const { bridge } = recordingNativeBridge(() => matrix)
  const backend = await createJingleComputerUseNativeBackend("linux-x11", bridge)
  ;(matrix.capabilities as ComputerUseCapability[]).reverse()

  assert.deepEqual(
    backend.matrix.capabilities.map((capability) => capability.action),
    ["press", "set_value", "type_text", "keypress", "scroll"]
  )
  assert.equal(Object.isFrozen(backend.matrix), true)
  assert.equal(Object.isFrozen(backend.matrix.capabilities), true)
  assert.equal(Object.isFrozen(backend.matrix.capabilities[0]), true)
  assert.throws(() => {
    ;(backend.matrix.capabilities[0] as { route: string }).route = "global_input"
  })
})

test("coordinator preflight settles first and later unsupported actions without dispatch", async () => {
  const raw = observation({
    elements: [
      {
        actions: ["type_text", "keypress", "scroll"],
        index: 0,
        ref: "@e1",
        role: "text_field"
      }
    ]
  })
  let backendDispatches = 0
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "unavailable",
          route: "ax_value"
        },
        {
          action: "keypress",
          background: "refused",
          foreground: "unavailable",
          route: "unavailable"
        },
        {
          action: "scroll",
          background: "unavailable",
          foreground: "unavailable",
          route: "unavailable"
        }
      ],
      environment: "macos-quartz",
      platform: "macos",
      protocolVersion: 1
    },
    disposeSession: resolvedVoid,
    async execute() {
      backendDispatches += 1
      throw new Error("unsupported coordinator actions must not dispatch")
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return value
    }
  }
  const ledgerWrites: string[] = []
  const ledger = new ComputerUseActionLedger({
    async reserve() {
      return "reserved"
    },
    async write(attempt) {
      ledgerWrites.push(`${attempt.attemptId}:${attempt.phase}:${attempt.outcome ?? "pending"}`)
    }
  })
  const scheduler = new ComputerUseResourceScheduler()
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(backend, scheduler, sessions, ledger)
  const base = await coordinator.observe({})
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })
  const input = {
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread"
  }

  const firstUnsupported = await coordinator.execute({
    ...input,
    actions: [
      { kind: "scroll", ref: "@e1", scrollAmount: 1 },
      { kind: "type_text", ref: "@e1", value: "hello" }
    ],
    transactionId: "first-unsupported"
  })
  const laterUnsupported = await coordinator.execute({
    ...input,
    actions: [
      { kind: "type_text", ref: "@e1", value: "hello" },
      { keys: ["ENTER"], kind: "keypress", ref: "@e1" }
    ],
    transactionId: "later-unsupported"
  })

  assert.deepEqual(firstUnsupported, {
    baseStateId: base.stateId,
    outcome: "unavailable",
    steps: []
  })
  assert.deepEqual(laterUnsupported, {
    baseStateId: base.stateId,
    outcome: "refused",
    steps: []
  })
  assert.equal(backendDispatches, 0)
  assert.equal(scheduler.epoch(base.resourceKey), 0)
  assert.deepEqual(ledgerWrites, [
    "first-unsupported:settled:unavailable",
    "later-unsupported:settled:refused"
  ])
})

import assert from "node:assert/strict"
import test from "node:test"
import {
  ComputerUseAuthorizationRegistry,
  ComputerUseActionLedger,
  computerUseCapabilityMatrix,
  ComputerUseObservationStore,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  StaleComputerUseStateError,
  computerUseResultAllowsForegroundRetry,
  type ComputerUseBackend,
  type ComputerUseObservation,
  type ComputerUseBackendExecutionResult
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
    async disposeSession() {},
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
    async write() {}
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
    async disposeSession() {},
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
    async write() {}
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
    async write() {}
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
    async write() {}
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
  release()
  await holding
  await assert.rejects(waiting)
  assert.equal(scheduler.epoch("window:b"), 0)
})

test("capability matrices cannot be mutated into verified support", () => {
  const matrix = computerUseCapabilityMatrix("windows-win32")
  assert.throws(() => {
    ;(matrix.capabilities[0] as { background: string }).background = "verified"
  })
  assert.equal(computerUseCapabilityMatrix("windows-win32").capabilities[0]?.background, "unavailable")
})

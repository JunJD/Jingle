import assert from "node:assert/strict"
import test from "node:test"
import {
  COMPUTER_USE_NATIVE_ACTIONS,
  getComputerUseNativeEnvironmentPolicy
} from "../../packages/computer-use-core/native-policy.mjs"
import * as computerUseCore from "../../packages/computer-use-core/src"
import {
  COMPUTER_USE_NATIVE_RESPONSE_LIMITS,
  ComputerUseAuthorizationRegistry,
  ComputerUseActionLedger,
  ComputerUseNativeProtocolError,
  createJingleComputerUseNativeBackend,
  ComputerUseObservationStore,
  ComputerUseResourceScheduler,
  ComputerUseSessionManager,
  ComputerUseTransactionCoordinator,
  StaleComputerUseStateError,
  computerUseResultAllowsForegroundRetry,
  type ComputerUseBackend,
  type ComputerUseBackendEnvironment,
  type ComputerUseActionAttempt,
  type ComputerUseActionLedgerPort,
  type ComputerUseCapability,
  type ComputerUseCapabilityMatrix,
  type ComputerUseObservation,
  type ComputerUseBackendExecutionResult,
  type ComputerUseSemanticAction,
  type ComputerUseTargetIdentity,
  type ComputerUseTraceEvent,
  type ComputerUseTransactionResult,
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
    sourceTruncated: false,
    stateId: "state-0",
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" },
    ...overrides
  }
}

function observationInput(
  overrides: Partial<ComputerUseObservation> = {}
): Omit<ComputerUseObservation, "stateId"> {
  const { stateId: _stateId, ...input } = observation(overrides)
  return input
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

function activationObservation(
  overrides: Partial<ComputerUseObservation> = {}
): ComputerUseObservation {
  return observation({
    elements: [
      {
        actions: ["activate"],
        index: 0,
        ref: "@root",
        role: "window",
        title: "Fixture"
      }
    ],
    ...overrides
  })
}

function targetIdentity(value: ComputerUseObservation = observation()): ComputerUseTargetIdentity {
  return {
    application: value.application,
    resourceKey: value.resourceKey,
    window: value.window
  }
}

function backendObservation(
  value: ComputerUseObservation = observation()
): Omit<ComputerUseObservation, "epoch" | "stateId"> {
  const { epoch: _epoch, stateId: _stateId, ...result } = value
  return result
}

async function identifyAndObserve(
  coordinator: ComputerUseTransactionCoordinator,
  applicationId = "com.example.fixture"
): Promise<ComputerUseObservation> {
  const target = await coordinator.identify({ applicationId })
  return coordinator.observe({ target })
}

function resolvedVoid(): Promise<void> {
  return Promise.resolve()
}

const confirmedStableRefMatcher = {
  match: ({
    base,
    successor
  }: {
    base: ComputerUseObservation
    successor: ComputerUseObservation
  }) => {
    const baseRefs = new Set(base.elements.map((element) => element.ref))
    const stableRefs = successor.elements
      .filter((element) => baseRefs.has(element.ref))
      .map((element) => element.ref)
    const smallerStateSize = Math.min(base.elements.length, successor.elements.length)
    return {
      confidence: smallerStateSize === 0 ? 1 : stableRefs.length / smallerStateSize,
      reason: "stable_ref_overlap" as const,
      stableRefs
    }
  }
}

function actionLedgerPort(
  input: {
    attempts?: Map<string, ComputerUseActionAttempt>
    beforeTransition?: (
      transition: Parameters<ComputerUseActionLedgerPort["transition"]>[0]
    ) => Promise<void>
    onReserve?: (attempt: ComputerUseActionAttempt) => void
    onWrite?: (attempt: ComputerUseActionAttempt) => void
  } = {}
): ComputerUseActionLedgerPort {
  const attempts = input.attempts ?? new Map<string, ComputerUseActionAttempt>()
  return {
    read(attemptId) {
      return Promise.resolve(attempts.get(attemptId))
    },
    reserve(attempt) {
      input.onReserve?.(attempt)
      const existing = attempts.get(attempt.attemptId)
      if (existing) return Promise.resolve({ attempt: existing, status: "exists" })
      attempts.set(attempt.attemptId, attempt)
      return Promise.resolve({ status: "reserved" })
    },
    async transition(transition) {
      await input.beforeTransition?.(transition)
      const current = attempts.get(transition.attempt.attemptId)
      if (!current) throw new Error("transitioned attempt is missing")
      if (
        current.phase !== transition.expectedPhase ||
        current.revision !== transition.expectedRevision
      ) {
        return { current, status: "conflict" }
      }
      attempts.set(transition.attempt.attemptId, transition.attempt)
      input.onWrite?.(transition.attempt)
      return { status: "applied" }
    }
  }
}

function actionAttemptInput(transactionId: string) {
  return {
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }] as const,
    authorization: {
      expiresAt: Date.now() + 60_000,
      runId: "run-1",
      sessionId: "session-1",
      threadId: "thread-1",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" as const }
    },
    baseStateId: "state-0",
    target: {
      applicationId: "com.example.fixture",
      resourceKey: "desktop-pid:42",
      window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" as const }
    },
    transactionId
  }
}

function unreachableComputerUseBackend(calls: {
  execute: number
  observe: number
}): ComputerUseBackend {
  return {
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    execute() {
      calls.execute += 1
      return Promise.reject(new Error("durable recovery must not execute the backend"))
    },
    identify() {
      return Promise.reject(new Error("durable recovery must not identify the backend"))
    },
    observe() {
      calls.observe += 1
      return Promise.reject(new Error("durable recovery must not observe the backend"))
    }
  }
}

interface RecordedNativeInvocation {
  request: JingleComputerUseNativeRequest
  signal?: AbortSignal
}

interface NativeOperationResponse {
  environment: ComputerUseBackendEnvironment
  method: "execute" | "identify" | "observe"
  protocolVersion: number
  result: unknown
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
      async invoke(
        request: JingleComputerUseNativeRequest,
        signal?: AbortSignal
      ): Promise<unknown> {
        calls.push({ request, signal })
        return handler(request, signal)
      }
    },
    calls
  }
}

function nativeOperationResponse(
  method: "execute" | "identify" | "observe",
  result: unknown,
  environment: ComputerUseBackendEnvironment = "macos-quartz"
): NativeOperationResponse {
  return {
    environment,
    method,
    protocolVersion: 1,
    result
  }
}

function probedMatrix(environment: ComputerUseBackendEnvironment): ComputerUseCapabilityMatrix {
  const policy = getComputerUseNativeEnvironmentPolicy(environment)
  return {
    capabilities: COMPUTER_USE_NATIVE_ACTIONS.map((action) => ({
      action,
      background: policy.capabilities[action].background[0]!,
      foreground: policy.capabilities[action].foreground[0]!,
      route: policy.capabilities[action].route
    })),
    environment,
    platform: policy.platform,
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
  assert.equal(
    computerUseResultAllowsForegroundRetry({
      baseStateId: "state-0",
      outcome: "didnt",
      steps: [{ ...base, outcome: "didnt" }],
      stoppedAt: 0
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

test("coordinator identifies before observing the exact native target", async () => {
  const raw = typeTextObservation()
  const target = targetIdentity(raw)
  const calls: string[] = []
  const backend: ComputerUseBackend = {
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    async execute() {
      throw new Error("unused")
    },
    async identify(request) {
      calls.push(`identify:${request.applicationId}`)
      return target
    },
    async observe(request) {
      calls.push(`observe:${request.target.resourceKey}`)
      assert.deepEqual(request.target, target)
      return backendObservation(raw)
    }
  }
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    new ComputerUseSessionManager(backend),
    new ComputerUseActionLedger(actionLedgerPort())
  )

  const result = await identifyAndObserve(coordinator, raw.application.id)

  assert.equal(result.application.id, raw.application.id)
  assert.deepEqual(calls, [`identify:${raw.application.id}`, `observe:${raw.resourceKey}`])
})

test("coordinator rejects an observation whose target changed after identification", async () => {
  const raw = typeTextObservation()
  const backend: ComputerUseBackend = {
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    async execute() {
      throw new Error("unused")
    },
    async identify() {
      return targetIdentity(raw)
    },
    async observe() {
      return backendObservation({
        ...raw,
        application: { id: "com.example.replacement", name: "Replacement" }
      })
    }
  }
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    new ComputerUseSessionManager(backend),
    new ComputerUseActionLedger(actionLedgerPort())
  )

  await assert.rejects(identifyAndObserve(coordinator, raw.application.id), /target changed/)
})

test("activate dispatches once in foreground and observes before durable settlement", async () => {
  const raw = activationObservation()
  const events: string[] = []
  let observeCalls = 0
  const backend: ComputerUseBackend = {
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    async execute(request) {
      events.push(`execute:${request.delivery}`)
      assert.deepEqual(request.actions, [{ kind: "activate", ref: "@root" }])
      return {
        baseStateId: request.base.stateId,
        outcome: "worked",
        steps: [
          {
            action: request.actions[0]!,
            evidence: {
              delivery: "semantic",
              noSideEffectProof: false,
              route: "ax_raise_activate",
              verification: "verified"
            },
            outcome: "worked"
          }
        ]
      }
    },
    async identify() {
      return targetIdentity(raw)
    },
    async observe() {
      observeCalls += 1
      if (observeCalls > 1) events.push("observe:successor")
      return backendObservation({ ...raw, capturedAt: observeCalls })
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger(
      actionLedgerPort({
        onReserve(attempt) {
          events.push(attempt.phase)
        },
        onWrite(attempt) {
          events.push(attempt.phase)
        }
      })
    )
  )
  const base = await identifyAndObserve(coordinator)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })

  const result = await coordinator.execute({
    actions: [{ kind: "activate", ref: "@root" }],
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread",
    transactionId: "activate-window"
  })

  assert.deepEqual(events, [
    "queued",
    "dispatched",
    "execute:foreground",
    "observe:successor",
    "settled"
  ])
  assert.equal(result.outcome, "worked")
  assert.equal(result.successor?.epoch, 1)
  assert.equal(result.successor?.capturedAt, 2)
})

test("activate must be the advertised single action on the current root", async () => {
  const cases: readonly {
    actions: readonly ComputerUseSemanticAction[]
    pattern: RegExp
    raw: ComputerUseObservation
  }[] = [
    {
      actions: [
        { kind: "activate", ref: "@root" },
        { kind: "press", ref: "@root" }
      ],
      pattern: /activate only as a single action/,
      raw: activationObservation({
        elements: [
          {
            actions: ["activate", "press"],
            index: 0,
            ref: "@root",
            role: "window"
          }
        ]
      })
    },
    {
      actions: [{ kind: "activate", ref: "@child" }],
      pattern: /activate ref must identify the current window root/,
      raw: activationObservation({
        elements: [
          { actions: ["press"], index: 0, ref: "@root", role: "window" },
          { actions: ["activate"], index: 1, ref: "@child", role: "button" }
        ]
      })
    },
    {
      actions: [{ kind: "activate", ref: "@root" }],
      pattern: /does not support activate/,
      raw: activationObservation({
        elements: [{ actions: ["press"], index: 0, ref: "@root", role: "window" }]
      })
    }
  ]

  for (const fixture of cases) {
    let backendDispatches = 0
    const backend: ComputerUseBackend = {
      matrix: probedMatrix("macos-quartz"),
      disposeSession: resolvedVoid,
      async execute() {
        backendDispatches += 1
        throw new Error("invalid activate action must not dispatch")
      },
      async identify() {
        return targetIdentity(fixture.raw)
      },
      async observe() {
        return backendObservation(fixture.raw)
      }
    }
    const sessions = new ComputerUseSessionManager(backend)
    const coordinator = new ComputerUseTransactionCoordinator(
      backend,
      new ComputerUseResourceScheduler(),
      sessions,
      new ComputerUseActionLedger(actionLedgerPort())
    )
    const base = await identifyAndObserve(coordinator)
    await sessions.setEnabled(true)
    const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })

    await assert.rejects(
      coordinator.execute({
        actions: fixture.actions,
        baseStateId: base.stateId,
        runId: "run",
        sessionId: grant.sessionId,
        threadId: "thread",
        transactionId: `invalid-activate-${fixture.raw.elements.length}-${fixture.actions.length}`
      }),
      fixture.pattern
    )
    assert.equal(backendDispatches, 0)
  }
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
    identify() {
      return Promise.resolve(targetIdentity(typeTextObservation()))
    },
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
  const ledger = new ComputerUseActionLedger(actionLedgerPort())
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    ledger
  )
  const baseObservation = await identifyAndObserve(coordinator)
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

test("a complete side-effect-free didnt prefix remains eligible for foreground retry", async () => {
  const calls: string[] = []
  const raw = typeTextObservation()
  const backend: ComputerUseBackend = {
    matrix: {
      ...probedMatrix("macos-quartz"),
      capabilities: [
        {
          action: "type_text",
          background: "verified",
          foreground: "verified",
          route: "ax_value"
        }
      ]
    },
    disposeSession: resolvedVoid,
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
    execute(request) {
      calls.push(request.delivery)
      return Promise.resolve({
        baseStateId: request.base.stateId,
        outcome: "didnt",
        steps: [
          {
            action: request.actions[0]!,
            evidence: {
              delivery: "semantic",
              noSideEffectProof: true,
              route: "ax_value",
              verification: "failed"
            },
            outcome: "didnt"
          }
        ],
        stoppedAt: 0
      })
    },
    observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return Promise.resolve(value)
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger(actionLedgerPort())
  )
  const base = await identifyAndObserve(coordinator, raw.application.id)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({
    observation: base,
    runId: "run-1",
    threadId: "thread-1"
  })
  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: base.stateId,
    runId: "run-1",
    sessionId: grant.sessionId,
    threadId: "thread-1",
    transactionId: "complete-didnt-prefix"
  })

  assert.deepEqual(calls, ["background", "foreground"])
  assert.equal(result.outcome, "didnt")
  assert.equal(result.stoppedAt, 0)
  assert.equal(result.successor?.epoch, 1)
})

test("coordinator rejects noncanonical actions before durable or scheduler admission", async () => {
  const base = typeTextObservation()
  let executeCalls = 0
  let reserves = 0
  let writes = 0
  const backend: ComputerUseBackend = {
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    identify() {
      return Promise.resolve(targetIdentity(base))
    },
    execute() {
      executeCalls += 1
      return Promise.reject(new Error("invalid actions must not reach the backend"))
    },
    observe() {
      const { epoch: _epoch, stateId: _stateId, ...raw } = base
      return Promise.resolve(raw)
    }
  }
  const scheduler = new ComputerUseResourceScheduler()
  const sessions = new ComputerUseSessionManager(backend)
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onReserve() {
        reserves += 1
      },
      onWrite() {
        writes += 1
      }
    })
  )
  const coordinator = new ComputerUseTransactionCoordinator(backend, scheduler, sessions, ledger)
  const canonicalBase = await identifyAndObserve(coordinator, base.application.id)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({
    observation: canonicalBase,
    runId: "run-1",
    threadId: "thread-1"
  })

  await assert.rejects(
    coordinator.execute({
      actions: [
        { kind: "press", ref: "@e1", value: "forbidden" }
      ] as unknown as readonly ComputerUseSemanticAction[],
      baseStateId: canonicalBase.stateId,
      runId: "run-1",
      sessionId: grant.sessionId,
      threadId: "thread-1",
      transactionId: "invalid-action"
    }),
    /transaction\.actions\[0\].*invalid action shape/
  )
  assert.equal(reserves, 0)
  assert.equal(writes, 0)
  assert.equal(executeCalls, 0)
  assert.equal(scheduler.epoch(base.resourceKey), 0)
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

test("model observation starts folded, then derives a trustworthy state-owned diff", () => {
  const store = new ComputerUseObservationStore(
    8,
    { foldedElementLimit: 2 },
    { refMatcher: confirmedStableRefMatcher }
  )
  const base = store.create({
    ...observationInput(),
    elements: [
      { actions: ["press"], index: 0, ref: "ref-save", role: "button", title: "Save" },
      {
        actions: ["type_text"],
        index: 1,
        ref: "ref-name",
        role: "text_field",
        value: "before"
      },
      { actions: ["press"], index: 2, ref: "ref-remove", role: "button", title: "Old" }
    ]
  })
  const initial = store.project({ stateId: base.stateId })
  assert.equal(initial.kind, "full")
  if (initial.kind !== "full") throw new Error("expected folded full view")
  assert.equal(initial.reason, "initial")
  assert.equal(initial.stateId, base.stateId)
  assert.equal(initial.elements.length, 2)
  assert.equal(initial.hasMore, true)
  assert.equal(initial.totalElements, 3)
  assert.deepEqual(initial.truncation, {
    byteLimit: 48 * 1024,
    omittedElements: 1,
    truncatedFields: 0
  })
  assert.equal("resourceKey" in initial, false)
  assert.equal("window" in initial, false)

  const successor = store.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: [
      { actions: ["press"], index: 0, ref: "ref-save", role: "button", title: "Save" },
      {
        actions: ["type_text"],
        index: 1,
        ref: "ref-name",
        role: "text_field",
        value: "after"
      },
      { actions: ["press"], index: 2, ref: "ref-added", role: "button", title: "New" }
    ]
  })
  const projection = store.project({ baseStateId: base.stateId, stateId: successor.stateId })
  assert.equal(projection.kind, "diff")
  if (projection.kind !== "diff") throw new Error("expected observation diff")
  assert.equal(projection.baseStateId, base.stateId)
  assert.equal(projection.successorStateId, successor.stateId)
  assert.deepEqual(
    projection.added.map((element) => element.ref),
    ["ref-added"]
  )
  assert.deepEqual(
    projection.updated.map((element) => [element.ref, element.value]),
    [["ref-name", "after"]]
  )
  assert.deepEqual(projection.removed, ["ref-remove"])
  assert.equal(projection.identityConfidence, 2 / 3)
  assert.equal(projection.identityReason, "stable_ref_overlap")
  assert.equal(Object.isFrozen(projection), true)
  assert.equal(Object.isFrozen(projection.added), true)
  assert.equal(store.get(successor.stateId)?.elements.length, 3)

  assert.deepEqual(store.expand({ offset: 2, stateId: successor.stateId }).elements, [
    successor.elements[2]
  ])
  assert.deepEqual(store.search({ query: "AFTER", stateId: successor.stateId }).elements, [
    successor.elements[1]
  ])
  const inspected = store.inspect({
    refs: ["ref-added", "ref-save"],
    stateId: successor.stateId
  })
  assert.equal(inspected.stateId, successor.stateId)
  assert.deepEqual(inspected.elements, [successor.elements[2], successor.elements[0]])
  assert.throws(() => store.inspect({ refs: ["ref-added"], stateId: base.stateId }))
})

test("observation queries report refs omitted by query limits", () => {
  const store = new ComputerUseObservationStore()
  const observation = store.create({
    ...observationInput(),
    elements: Array.from({ length: 100 }, (_, index) => ({
      actions: ["press"],
      index,
      ref: `ref-${index}`,
      role: "button",
      title: "matching control"
    }))
  })

  const search = store.search({ limit: 20, query: "matching", stateId: observation.stateId })
  assert.equal(search.elements.length, 20)
  assert.equal(search.totalElements, 100)
  assert.equal(search.hasMore, true)
  assert.equal(search.truncation.omittedElements, 80)

  const expand = store.expand({ limit: 20, offset: 10, stateId: observation.stateId })
  assert.equal(expand.elements.length, 20)
  assert.equal(expand.elements[0]?.ref, "ref-10")
  assert.equal(expand.hasMore, true)
  assert.equal(expand.truncation.omittedElements, 70)

  const tail = store.expand({ limit: 20, offset: 90, stateId: observation.stateId })
  assert.equal(tail.elements.length, 10)
  assert.equal(tail.hasMore, false)
  assert.equal(tail.truncation.omittedElements, 0)
})

test("observation projection re-anchors at every unsafe incremental boundary", () => {
  const createState = (
    store: ComputerUseObservationStore,
    epoch: number,
    refs: readonly string[],
    overrides: Partial<ComputerUseObservation> = {}
  ) =>
    store.create({
      ...observationInput({ capturedAt: epoch + 1, epoch, ...overrides }),
      elements: refs.map((ref, index) => ({
        actions: ["press"],
        index,
        ref,
        role: "button",
        title: ref
      }))
    })

  const store = new ComputerUseObservationStore(8, {}, { refMatcher: confirmedStableRefMatcher })
  const base = createState(store, 0, ["a", "b", "c", "d"])
  const replacement = createState(store, 1, ["w", "x", "y", "z"])
  const rootProjection = store.project({
    baseStateId: base.stateId,
    stateId: replacement.stateId
  })
  assert.equal(rootProjection.kind, "full")
  assert.equal(rootProjection.kind === "full" ? rootProjection.reason : null, "root_replacement")

  const lowConfidence = createState(store, 2, ["a", "new-1", "new-2", "new-3"])
  const lowProjection = store.project({
    baseStateId: base.stateId,
    stateId: lowConfidence.stateId
  })
  assert.equal(lowProjection.kind, "full")
  assert.equal(
    lowProjection.kind === "full" ? lowProjection.reason : null,
    "low_identity_confidence"
  )

  const otherRoot = createState(store, 3, ["a", "b", "c", "d"], {
    resourceKey: "desktop-pid:84",
    window: { generation: "g2", nativeId: "w2", pid: 84, platform: "macos" }
  })
  const otherRootProjection = store.project({
    baseStateId: base.stateId,
    stateId: otherRoot.stateId
  })
  assert.equal(
    otherRootProjection.kind === "full" ? otherRootProjection.reason : null,
    "root_replacement"
  )

  for (const reason of [
    "context_compaction",
    "external_mutation_uncertain",
    "process_restart",
    "requested"
  ] as const) {
    const forced = store.project({ forceFullReason: reason, stateId: lowConfidence.stateId })
    assert.equal(forced.kind === "full" ? forced.reason : null, reason)
  }

  const evictingStore = new ComputerUseObservationStore(1)
  const evicted = createState(evictingStore, 0, ["stable"])
  const retained = createState(evictingStore, 1, ["stable"])
  const evictedProjection = evictingStore.project({
    baseStateId: evicted.stateId,
    stateId: retained.stateId
  })
  assert.equal(evictedProjection.kind === "full" ? evictedProjection.reason : null, "state_evicted")

  const budgetStore = new ComputerUseObservationStore(
    8,
    { diffChangeLimit: 1 },
    { refMatcher: confirmedStableRefMatcher }
  )
  const budgetBase = createState(budgetStore, 0, ["stable", "removed"])
  const budgetSuccessor = createState(budgetStore, 1, ["stable", "added"])
  const overBudget = budgetStore.project({
    baseStateId: budgetBase.stateId,
    stateId: budgetSuccessor.stateId
  })
  assert.equal(overBudget.kind === "full" ? overBudget.reason : null, "diff_over_budget")

  const byteBudgetStore = new ComputerUseObservationStore(
    8,
    { diffByteLimit: 1 },
    { refMatcher: confirmedStableRefMatcher }
  )
  const byteBase = createState(byteBudgetStore, 0, ["stable"])
  const byteSuccessor = createState(byteBudgetStore, 1, ["stable"])
  const byteOverBudget = byteBudgetStore.project({
    baseStateId: byteBase.stateId,
    stateId: byteSuccessor.stateId
  })
  assert.equal(byteOverBudget.kind === "full" ? byteOverBudget.reason : null, "diff_over_budget")

  const truncatedStore = new ComputerUseObservationStore(
    8,
    {},
    { refMatcher: confirmedStableRefMatcher }
  )
  const complete = createState(truncatedStore, 0, ["stable"])
  const incomplete = createState(truncatedStore, 1, ["stable"], { sourceTruncated: true })
  const truncatedProjection = truncatedStore.project({
    baseStateId: complete.stateId,
    stateId: incomplete.stateId
  })
  assert.equal(
    truncatedProjection.kind === "full" ? truncatedProjection.reason : null,
    "source_truncated"
  )
  assert.equal(truncatedProjection.kind === "full" && truncatedProjection.sourceTruncated, true)
  assert.equal(
    truncatedStore.search({ query: "stable", stateId: incomplete.stateId }).sourceTruncated,
    true
  )
})

test("observation store rejects noncanonical indexes and missing query states", () => {
  const store = new ComputerUseObservationStore()
  assert.throws(() =>
    store.create({
      ...observationInput(),
      elements: [{ actions: ["press"], index: 2, ref: "ref", role: "button" }]
    })
  )
  assert.throws(() => store.expand({ stateId: "evicted" }), /missing or was evicted/)
  assert.throws(() => store.search({ query: "", stateId: "evicted" }), /missing or was evicted/)
  assert.throws(
    () => new ComputerUseObservationStore(8, { minimumStableRefCoverage: 0 }),
    /between 0.5 and 1/
  )
  assert.throws(
    () => new ComputerUseObservationStore(8, { fullByteLimit: 4_095 }),
    /at least 4096 bytes/
  )
  assert.throws(
    () => new ComputerUseObservationStore(8, { diffByteLimit: 64 * 1024 + 1 }),
    /must not exceed 65536/
  )
})

test("model observations are exact-shaped and byte-bounded", () => {
  const huge = "x".repeat(COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text)
  const store = new ComputerUseObservationStore(
    8,
    {
      diffByteLimit: 1,
      foldedElementLimit: 80,
      fullByteLimit: 8 * 1024,
      queryByteLimit: 8 * 1024
    },
    { refMatcher: confirmedStableRefMatcher }
  )
  const elements = Array.from(
    { length: 80 },
    (_, index) =>
      ({
        actions: ["press"],
        description: huge,
        index,
        nativeWindow: { nativeId: `native-${index}`, pid: 42 },
        ref: `ref-${index}`,
        resourceKey: "desktop-pid:42",
        role: "button",
        title: huge,
        value: huge
      }) as ComputerUseObservation["elements"][number]
  )
  const base = store.create({
    ...observationInput({
      application: {
        id: "com.example.fixture",
        name: "Fixture",
        pid: 42
      } as ComputerUseObservation["application"]
    }),
    elements
  })
  const full = store.project({ stateId: base.stateId })
  assert.equal(full.kind, "full")
  if (full.kind !== "full") throw new Error("expected bounded full view")
  assert.equal(Buffer.byteLength(JSON.stringify(full)) <= 8_192, true)
  assert.equal(full.truncation.byteLimit, 8_192)
  assert.equal(full.truncation.omittedElements > 0, true)
  assert.equal(full.truncation.truncatedFields > 0, true)
  assert.deepEqual(Object.keys(full).sort(), [
    "application",
    "capturedAt",
    "elements",
    "epoch",
    "hasMore",
    "kind",
    "reason",
    "sourceTruncated",
    "stateId",
    "totalElements",
    "truncation"
  ])
  assert.deepEqual(Object.keys(full.application).sort(), ["id", "name"])
  assert.deepEqual(Object.keys(full.elements[0]!).sort(), [
    "actions",
    "description",
    "index",
    "ref",
    "role",
    "title",
    "value"
  ])
  assert.equal(JSON.stringify(full).includes("nativeWindow"), false)
  assert.equal(JSON.stringify(full).includes("resourceKey"), false)
  assert.equal(JSON.stringify(full).includes('"pid"'), false)
  const stored = store.get(base.stateId)!
  assert.deepEqual(Object.keys(stored.application).sort(), ["id", "name"])
  assert.deepEqual(Object.keys(stored.elements[0]!).sort(), [
    "actions",
    "description",
    "index",
    "ref",
    "role",
    "title",
    "value"
  ])

  const expanded = store.expand({ limit: 80, stateId: base.stateId })
  assert.equal(Buffer.byteLength(JSON.stringify(expanded)) <= 8_192, true)
  assert.equal(expanded.truncation.omittedElements > 0, true)
  assert.equal(expanded.truncation.truncatedFields > 0, true)

  const successor = store.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: elements.map((element, index) => ({
      ...element,
      value: index === 0 ? `${huge}-changed` : element.value
    }))
  })
  const fallback = store.project({ baseStateId: base.stateId, stateId: successor.stateId })
  assert.equal(fallback.kind === "full" ? fallback.reason : null, "diff_over_budget")
  assert.equal(Buffer.byteLength(JSON.stringify(fallback)) <= 8_192, true)
})

test("observation plug points cannot overstate confidence or contradict canonical states", () => {
  const elements = (refs: readonly string[], value = "same") =>
    refs.map((ref, index) => ({
      actions: ["press" as const],
      index,
      ref,
      role: "button",
      value
    }))
  const ids = ["state-base", "state-successor"]
  const conservativeStore = new ComputerUseObservationStore(
    8,
    {},
    {
      idFactory: { createStateId: () => ids.shift() ?? "state-exhausted" },
      refMatcher: {
        match: () => ({
          confidence: 1,
          reason: "platform_fingerprint",
          stableRefs: ["stable"]
        })
      }
    }
  )
  const base = conservativeStore.create({
    ...observationInput(),
    elements: elements(["stable", "base-1", "base-2", "base-3"])
  })
  const successor = conservativeStore.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: elements(["stable", "next-1", "next-2", "next-3"])
  })
  assert.equal(base.stateId, "state-base")
  assert.equal(successor.stateId, "state-successor")
  const projection = conservativeStore.project({
    baseStateId: base.stateId,
    stateId: successor.stateId
  })
  assert.equal(projection.kind === "full" ? projection.reason : null, "low_identity_confidence")

  let id = 0
  const contradictoryStore = new ComputerUseObservationStore(
    8,
    {},
    {
      diffProjector: {
        project: () => ({ added: [], removed: [], updated: [] })
      },
      idFactory: { createStateId: () => `contradictory-${id++}` },
      refMatcher: confirmedStableRefMatcher
    }
  )
  const contradictoryBase = contradictoryStore.create({
    ...observationInput(),
    elements: elements(["stable"], "before")
  })
  const contradictorySuccessor = contradictoryStore.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: elements(["stable"], "after")
  })
  assert.throws(
    () =>
      contradictoryStore.project({
        baseStateId: contradictoryBase.stateId,
        stateId: contradictorySuccessor.stateId
      }),
    /contradicted the complete stored observations/
  )

  let unsafeReasonId = 0
  const unsafeReasonStore = new ComputerUseObservationStore(
    8,
    {},
    {
      idFactory: { createStateId: () => `unsafe-reason-${unsafeReasonId++}` },
      refMatcher: {
        match: () => ({
          confidence: 1,
          reason: "native-route:pid-42" as "stable_ref_overlap",
          stableRefs: ["stable"]
        })
      }
    }
  )
  const unsafeReasonBase = unsafeReasonStore.create({
    ...observationInput(),
    elements: elements(["stable"], "before")
  })
  const unsafeReasonSuccessor = unsafeReasonStore.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: elements(["stable"], "after")
  })
  assert.throws(
    () =>
      unsafeReasonStore.project({
        baseStateId: unsafeReasonBase.stateId,
        stateId: unsafeReasonSuccessor.stateId
      }),
    /unknown identity reason/
  )

  let injectedId = 0
  const injectedProjectionStore = new ComputerUseObservationStore(
    8,
    {},
    {
      diffProjector: {
        project: ({ successor }) => ({
          added: [],
          removed: [],
          updated: successor.elements
            .slice(0, 1)
            .map(
              (element) =>
                ({ ...element, pid: 42, resourceKey: "desktop-pid:42" }) as typeof element
            )
        })
      },
      idFactory: { createStateId: () => `injected-${injectedId++}` },
      refMatcher: confirmedStableRefMatcher
    }
  )
  const injectedBase = injectedProjectionStore.create({
    ...observationInput(),
    elements: elements(["stable"], "before")
  })
  const injectedSuccessor = injectedProjectionStore.create({
    ...observationInput({ capturedAt: 2, epoch: 1 }),
    elements: elements(["stable"], "after")
  })
  const injectedProjection = injectedProjectionStore.project({
    baseStateId: injectedBase.stateId,
    stateId: injectedSuccessor.stateId
  })
  assert.equal(injectedProjection.kind, "diff")
  if (injectedProjection.kind !== "diff") throw new Error("expected exact diff projection")
  assert.deepEqual(Object.keys(injectedProjection.updated[0]!).sort(), [
    "actions",
    "index",
    "ref",
    "role",
    "value"
  ])
  assert.equal(JSON.stringify(injectedProjection).includes("resourceKey"), false)
  assert.equal(JSON.stringify(injectedProjection).includes('"pid"'), false)

  const duplicateIdStore = new ComputerUseObservationStore(
    2,
    {},
    {
      idFactory: { createStateId: () => "duplicate" }
    }
  )
  duplicateIdStore.create(observationInput())
  assert.throws(() => duplicateIdStore.create(observationInput()), /already owned/)

  const reusedIds = ["first", "second", "first"]
  const evictedIdStore = new ComputerUseObservationStore(
    1,
    {},
    {
      idFactory: { createStateId: () => reusedIds.shift() ?? "exhausted" }
    }
  )
  evictedIdStore.create(observationInput())
  evictedIdStore.create(observationInput({ epoch: 1 }))
  assert.throws(() => evictedIdStore.create(observationInput({ epoch: 2 })), /already owned/)
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
    async identify() {
      throw new Error("unused")
    },
    async execute() {
      throw new Error("unused")
    },
    async observe() {
      throw new Error("unused")
    }
  }
  const manager = new ComputerUseSessionManager(backend)
  assert.throws(() =>
    manager.openSession({ observation: observation(), runId: "r", threadId: "t" })
  )
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
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onWrite(attempt) {
        writes.push(`${attempt.phase}:${attempt.result?.outcome ?? "pending"}`)
      }
    })
  )
  const { attempt } = await ledger.begin(actionAttemptInput("transaction-1"))
  await ledger.dispatched(attempt.attemptId)
  assert.equal((await ledger.cancel(attempt.attemptId)).outcome, "unknown")
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
    identify() {
      return Promise.resolve(targetIdentity(base))
    },
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
  const ledger = new ComputerUseActionLedger(actionLedgerPort())
  const coordinator = new ComputerUseTransactionCoordinator(backend, scheduler, sessions, ledger)
  const canonicalBase = await identifyAndObserve(coordinator)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: canonicalBase, runId: "r", threadId: "t" })
  let release!: () => void
  const blocker = scheduler.read(
    base.resourceKey,
    async () =>
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

test("transaction ids claim one local attempt without reserving twice", async () => {
  let reserves = 0
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onReserve() {
        reserves += 1
      }
    })
  )
  const first = await ledger.begin(actionAttemptInput("tx"))
  const duplicate = await ledger.begin(actionAttemptInput("tx"))
  assert.equal(first.status, "reserved")
  assert.equal(duplicate.status, "existing")
  assert.equal(duplicate.source, "local")
  assert.equal(duplicate.attempt, first.attempt)
  assert.equal(reserves, 1)
})

test("empty transaction ids are rejected before durable reserve", async () => {
  let reserves = 0
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onReserve() {
        reserves += 1
      }
    })
  )
  await assert.rejects(ledger.begin(actionAttemptInput("   ")))
  assert.equal(reserves, 0)
})

test("settled durable attempts replay their complete immutable result after restart", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const firstLedger = new ComputerUseActionLedger(actionLedgerPort({ attempts }))
  const { attempt } = await firstLedger.begin(actionAttemptInput("settled-restart"))
  await firstLedger.dispatched(attempt.attemptId)
  const original: ComputerUseTransactionResult = {
    baseStateId: "state-0",
    outcome: "worked",
    steps: [
      {
        action: { kind: "type_text", ref: "@e1", value: "hello" },
        evidence: {
          delivery: "semantic",
          noSideEffectProof: false,
          route: "ax_value",
          verification: "verified"
        },
        outcome: "worked"
      }
    ],
    successor: observation({
      elements: typeTextObservation().elements,
      epoch: 1,
      stateId: "state-1"
    })
  }
  const persisted = await firstLedger.settle(attempt.attemptId, original)
  original.steps[0]!.evidence.route = "mutated"
  original.successor!.window.nativeId = "mutated"

  const calls = { execute: 0, observe: 0 }
  const backend = unreachableComputerUseBackend(calls)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    new ComputerUseSessionManager(backend),
    new ComputerUseActionLedger(actionLedgerPort({ attempts }))
  )
  const replayed = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: "state-0",
    runId: "run-1",
    sessionId: "replacement-session",
    threadId: "thread-1",
    transactionId: "settled-restart"
  })

  assert.deepEqual(replayed, persisted)
  assert.equal(replayed.steps[0]!.evidence.route, "ax_value")
  assert.equal(replayed.successor!.window.nativeId, "w1")
  assert.equal(Object.isFrozen(replayed), true)
  assert.equal(Object.isFrozen(replayed.steps[0]!.evidence), true)
  assert.equal(Object.isFrozen(replayed.successor!.window), true)
  assert.deepEqual(calls, { execute: 0, observe: 0 })

  await assert.rejects(
    coordinator.execute({
      actions: [{ kind: "type_text", ref: "@e1", value: "again" }],
      baseStateId: replayed.successor!.stateId,
      runId: "run-1",
      sessionId: "replacement-session",
      threadId: "thread-1",
      transactionId: "new-after-restart"
    }),
    /state is missing or was evicted/
  )
  assert.deepEqual(calls, { execute: 0, observe: 0 })
})

test("durable replay rejects corrupt authorization, action, evidence, and successor facts", async () => {
  const sourceAttempts = new Map<string, ComputerUseActionAttempt>()
  const sourceLedger = new ComputerUseActionLedger(actionLedgerPort({ attempts: sourceAttempts }))
  const { attempt } = await sourceLedger.begin(actionAttemptInput("corrupt-restart"))
  await sourceLedger.dispatched(attempt.attemptId)
  await sourceLedger.settle(attempt.attemptId, {
    baseStateId: "state-0",
    outcome: "worked",
    steps: [
      {
        action: { kind: "type_text", ref: "@e1", value: "hello" },
        evidence: {
          delivery: "semantic",
          noSideEffectProof: false,
          route: "ax_value",
          verification: "verified"
        },
        outcome: "worked"
      }
    ],
    successor: observation({ epoch: 1, stateId: "state-1" })
  })
  const durable = sourceAttempts.get("corrupt-restart")!
  const corruptions: Array<{
    mutate(attempt: ComputerUseActionAttempt): void
    pattern: RegExp
  }> = [
    {
      mutate(attempt) {
        attempt.phase = "invalid" as ComputerUseActionAttempt["phase"]
      },
      pattern: /invalid phase/
    },
    {
      mutate(attempt) {
        attempt.authorization.window.pid = 0
      },
      pattern: /pid must be a positive integer/
    },
    {
      mutate(attempt) {
        attempt.result!.steps[0]!.action.value = "changed"
      },
      pattern: /not an ordered action prefix/
    },
    {
      mutate(attempt) {
        attempt.actions = [
          { kind: "press", ref: "@e1", value: "forbidden" }
        ] as unknown as readonly ComputerUseSemanticAction[]
      },
      pattern: /action attempt\.actions\[0\].*invalid action shape/
    },
    {
      mutate(attempt) {
        attempt.result!.steps[0]!.action = {
          kind: "type_text",
          ref: "@e1",
          scrollAmount: 1,
          value: "hello"
        } as unknown as ComputerUseSemanticAction
      },
      pattern: /durable result\.steps\[0\]\.action.*invalid action shape/
    },
    {
      mutate(attempt) {
        attempt.result!.steps[0]!.evidence.verification = "unverifiable"
      },
      pattern: /contradictory evidence/
    },
    {
      mutate(attempt) {
        delete attempt.result!.successor
      },
      pattern: /worked result requires a successor state/
    },
    {
      mutate(attempt) {
        attempt.result!.successor!.window.nativeId = "another-window"
      },
      pattern: /successor belongs to another window generation/
    },
    {
      mutate(attempt) {
        attempt.result!.successor!.resourceKey = "another-resource"
      },
      pattern: /successor belongs to another target resource/
    },
    {
      mutate(attempt) {
        attempt.result!.successor!.stateId = attempt.baseStateId
      },
      pattern: /successor reused its base state identity/
    },
    {
      mutate(attempt) {
        delete attempt.dispatchedAt
        attempt.revision = 1
      },
      pattern: /undispatched computer-use action attempt has an executed terminal outcome/i
    },
    {
      mutate(attempt) {
        attempt.result = {
          baseStateId: attempt.baseStateId,
          outcome: "cancelled_before_dispatch",
          steps: []
        }
      },
      pattern: /dispatched computer-use action attempt cannot be cancelled before dispatch/i
    }
  ]
  const calls = { execute: 0, observe: 0 }
  const backend = unreachableComputerUseBackend(calls)
  for (const corruption of corruptions) {
    const corrupted = structuredClone(durable)
    corruption.mutate(corrupted)
    const attempts = new Map([[corrupted.attemptId, corrupted]])
    const coordinator = new ComputerUseTransactionCoordinator(
      backend,
      new ComputerUseResourceScheduler(),
      new ComputerUseSessionManager(backend),
      new ComputerUseActionLedger(actionLedgerPort({ attempts }))
    )
    await assert.rejects(
      coordinator.execute({
        actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
        baseStateId: "state-0",
        runId: "run-1",
        sessionId: "replacement-session",
        threadId: "thread-1",
        transactionId: "corrupt-restart"
      }),
      corruption.pattern
    )
  }
  assert.deepEqual(calls, { execute: 0, observe: 0 })
})

test("durable queued and dispatched attempts settle without replay after restart", async () => {
  for (const phase of ["queued", "dispatched"] as const) {
    const attempts = new Map<string, ComputerUseActionAttempt>()
    const transactionId = `${phase}-restart`
    const firstLedger = new ComputerUseActionLedger(actionLedgerPort({ attempts }))
    const { attempt } = await firstLedger.begin(actionAttemptInput(transactionId))
    if (phase === "dispatched") await firstLedger.dispatched(attempt.attemptId)
    const calls = { execute: 0, observe: 0 }
    const backend = unreachableComputerUseBackend(calls)
    const coordinator = new ComputerUseTransactionCoordinator(
      backend,
      new ComputerUseResourceScheduler(),
      new ComputerUseSessionManager(backend),
      new ComputerUseActionLedger(actionLedgerPort({ attempts }))
    )

    const result = await coordinator.execute({
      actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
      baseStateId: "state-0",
      runId: "run-1",
      sessionId: "replacement-session",
      threadId: "thread-1",
      transactionId
    })

    assert.deepEqual(result, {
      baseStateId: "state-0",
      outcome: phase === "queued" ? "cancelled_before_dispatch" : "unknown",
      steps: []
    })
    assert.equal(attempts.get(transactionId)?.phase, "settled")
    assert.deepEqual(attempts.get(transactionId)?.result, result)
    assert.deepEqual(calls, { execute: 0, observe: 0 })
  }
})

test("durable identity mismatches refuse without rewriting or poisoning later recovery", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const firstLedger = new ComputerUseActionLedger(actionLedgerPort({ attempts }))
  await firstLedger.begin(actionAttemptInput("identity-mismatch"))
  let writes = 0
  const calls = { execute: 0, observe: 0 }
  const backend = unreachableComputerUseBackend(calls)
  const baseInput = {
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }] as const,
    baseStateId: "state-0",
    runId: "run-1",
    sessionId: "replacement-session",
    threadId: "thread-1",
    transactionId: "identity-mismatch"
  }
  const mismatches = [
    { ...baseInput, runId: "another-run" },
    { ...baseInput, threadId: "another-thread" },
    { ...baseInput, baseStateId: "another-state" },
    { ...baseInput, actions: [{ kind: "type_text", ref: "@e1", value: "changed" }] as const }
  ]
  for (const mismatch of mismatches) {
    const coordinator = new ComputerUseTransactionCoordinator(
      backend,
      new ComputerUseResourceScheduler(),
      new ComputerUseSessionManager(backend),
      new ComputerUseActionLedger(
        actionLedgerPort({
          attempts,
          onWrite() {
            writes += 1
          }
        })
      )
    )
    assert.deepEqual(await coordinator.execute(mismatch), {
      baseStateId: mismatch.baseStateId,
      outcome: "refused",
      steps: []
    })
  }

  assert.equal(attempts.get("identity-mismatch")?.phase, "queued")
  assert.equal(writes, 0)
  assert.deepEqual(calls, { execute: 0, observe: 0 })

  const recoveryCoordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    new ComputerUseSessionManager(backend),
    new ComputerUseActionLedger(
      actionLedgerPort({
        attempts,
        onWrite() {
          writes += 1
        }
      })
    )
  )
  assert.deepEqual(await recoveryCoordinator.execute(baseInput), {
    baseStateId: "state-0",
    outcome: "cancelled_before_dispatch",
    steps: []
  })
  assert.equal(attempts.get("identity-mismatch")?.phase, "settled")
  assert.equal(writes, 1)
  assert.deepEqual(calls, { execute: 0, observe: 0 })
})

test("a local duplicate cannot cancel an in-flight queued attempt", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  let writes = 0
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      attempts,
      onWrite() {
        writes += 1
      }
    })
  )
  await ledger.begin(actionAttemptInput("local-duplicate"))
  const calls = { execute: 0, observe: 0 }
  const backend = unreachableComputerUseBackend(calls)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    new ComputerUseSessionManager(backend),
    ledger
  )
  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: "state-0",
    runId: "run-1",
    sessionId: "session-1",
    threadId: "thread-1",
    transactionId: "local-duplicate"
  })

  assert.deepEqual(result, { baseStateId: "state-0", outcome: "refused", steps: [] })
  assert.equal(attempts.get("local-duplicate")?.phase, "queued")
  assert.equal(writes, 0)
  assert.deepEqual(calls, { execute: 0, observe: 0 })
})

test("failed durable transitions do not advance the in-memory attempt", async () => {
  const ledger = new ComputerUseActionLedger({
    read() {
      return Promise.resolve(undefined)
    },
    reserve() {
      return Promise.resolve({ status: "reserved" })
    },
    transition() {
      return Promise.reject(new Error("durable write failed"))
    }
  })
  const { attempt } = await ledger.begin(actionAttemptInput("failed-transition"))

  await assert.rejects(ledger.dispatched(attempt.attemptId), /durable write failed/)
  assert.equal(ledger.get(attempt.attemptId)?.phase, "queued")
  assert.equal(ledger.get(attempt.attemptId)?.result, undefined)
})

test("ledger rejects terminal outcomes that contradict durable dispatch evidence", async () => {
  let writes = 0
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onWrite() {
        writes += 1
      }
    })
  )
  const queued = await ledger.begin(actionAttemptInput("queued-worked"))
  await assert.rejects(
    ledger.settle(queued.attempt.attemptId, {
      baseStateId: "state-0",
      outcome: "worked",
      steps: [
        {
          action: { kind: "type_text", ref: "@e1", value: "hello" },
          evidence: {
            delivery: "semantic",
            noSideEffectProof: false,
            route: "ax_value",
            verification: "verified"
          },
          outcome: "worked"
        }
      ],
      successor: observation({ epoch: 1, stateId: "state-1" })
    }),
    /undispatched computer-use action attempt has an executed terminal outcome/i
  )
  assert.equal(ledger.get(queued.attempt.attemptId)?.phase, "queued")

  const dispatched = await ledger.begin(actionAttemptInput("dispatched-cancelled"))
  await ledger.dispatched(dispatched.attempt.attemptId)
  await assert.rejects(
    ledger.settle(dispatched.attempt.attemptId, {
      baseStateId: "state-0",
      outcome: "cancelled_before_dispatch",
      steps: []
    }),
    /dispatched computer-use action attempt cannot be cancelled before dispatch/i
  )
  assert.equal(ledger.get(dispatched.attempt.attemptId)?.phase, "dispatched")
  assert.equal(writes, 1)
})

test("cancelled CAS winner prevents a stale coordinator from dispatching", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  let interceptDispatch = true
  const port = actionLedgerPort({
    attempts,
    async beforeTransition(transition) {
      if (!interceptDispatch || transition.attempt.phase !== "dispatched") return
      interceptDispatch = false
      const claim = await competingLedger.find(transition.attempt.attemptId)
      assert.equal(claim?.attempt.phase, "queued")
      assert.equal(
        (await competingLedger.cancel(transition.attempt.attemptId)).outcome,
        "cancelled_before_dispatch"
      )
    }
  })
  const primaryLedger = new ComputerUseActionLedger(port)
  const competingLedger = new ComputerUseActionLedger(port)
  const raw = typeTextObservation()
  let backendDispatches = 0
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
    execute(request) {
      backendDispatches += 1
      return Promise.resolve({
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
      })
    },
    observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return Promise.resolve(value)
    }
  }
  const scheduler = new ComputerUseResourceScheduler()
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    scheduler,
    sessions,
    primaryLedger
  )
  const base = await identifyAndObserve(coordinator)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })

  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    threadId: "thread",
    transactionId: "cancel-wins-cas"
  })

  assert.equal(result.outcome, "cancelled_before_dispatch")
  assert.equal(backendDispatches, 0)
  assert.equal(scheduler.epoch(base.resourceKey), 0)
  assert.equal(attempts.get("cancel-wins-cas")?.phase, "settled")
  assert.equal(attempts.get("cancel-wins-cas")?.revision, 1)
})

test("dispatch CAS winner converts a stale queued cancellation to unknown", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const port = actionLedgerPort({ attempts })
  const dispatchOwner = new ComputerUseActionLedger(port)
  const staleOwner = new ComputerUseActionLedger(port)
  const { attempt } = await dispatchOwner.begin(actionAttemptInput("dispatch-wins-cas"))
  assert.equal((await staleOwner.find(attempt.attemptId))?.attempt.phase, "queued")

  const dispatch = await dispatchOwner.dispatched(attempt.attemptId)
  assert.equal(dispatch.status, "applied")
  assert.equal(dispatch.attempt.revision, 1)
  const cancellation = await staleOwner.cancel(attempt.attemptId)
  assert.equal(cancellation.outcome, "unknown")
  assert.equal(attempts.get(attempt.attemptId)?.revision, 2)
  assert.equal(attempts.get(attempt.attemptId)?.result?.outcome, "unknown")

  const staleSettlement = await dispatchOwner.settle(attempt.attemptId, {
    baseStateId: "state-0",
    outcome: "worked",
    steps: [
      {
        action: { kind: "type_text", ref: "@e1", value: "hello" },
        evidence: {
          delivery: "semantic",
          noSideEffectProof: false,
          route: "ax_value",
          verification: "verified"
        },
        outcome: "worked"
      }
    ],
    successor: observation({ epoch: 1, stateId: "state-1" })
  })
  assert.equal(staleSettlement.outcome, "unknown")
  assert.equal(attempts.get(attempt.attemptId)?.result?.outcome, "unknown")
  assert.equal(Object.isFrozen(dispatchOwner.get(attempt.attemptId)), true)
})

test("the first dispatched terminal CAS result is immutable", async () => {
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const port = actionLedgerPort({ attempts })
  const firstOwner = new ComputerUseActionLedger(port)
  const staleOwner = new ComputerUseActionLedger(port)
  const { attempt } = await firstOwner.begin(actionAttemptInput("terminal-cas"))
  await firstOwner.dispatched(attempt.attemptId)
  assert.equal((await staleOwner.find(attempt.attemptId))?.attempt.phase, "dispatched")
  const worked: ComputerUseTransactionResult = {
    baseStateId: "state-0",
    outcome: "worked",
    steps: [
      {
        action: { kind: "type_text", ref: "@e1", value: "hello" },
        evidence: {
          delivery: "semantic",
          noSideEffectProof: false,
          route: "ax_value",
          verification: "verified"
        },
        outcome: "worked"
      }
    ],
    successor: observation({ epoch: 1, stateId: "state-1" })
  }
  const [winner, stale] = await Promise.all([
    firstOwner.settle(attempt.attemptId, worked),
    staleOwner.settle(attempt.attemptId, {
      baseStateId: "state-0",
      outcome: "unknown",
      steps: []
    })
  ])

  assert.equal(winner.outcome, "worked")
  assert.equal(stale.outcome, "worked")
  assert.equal(attempts.get(attempt.attemptId)?.result?.outcome, "worked")
  assert.equal(attempts.get(attempt.attemptId)?.revision, 2)
})

test("CAS conflict cannot replace immutable attempt identity", async () => {
  let reserved!: ComputerUseActionAttempt
  const ledger = new ComputerUseActionLedger({
    read() {
      return Promise.resolve(undefined)
    },
    reserve(attempt) {
      reserved = attempt
      return Promise.resolve({ status: "reserved" })
    },
    transition(input) {
      const corrupt = structuredClone(input.attempt)
      corrupt.target.resourceKey = "another-resource"
      return Promise.resolve({ current: corrupt, status: "conflict" })
    }
  })
  const { attempt } = await ledger.begin(actionAttemptInput("corrupt-cas-conflict"))

  await assert.rejects(ledger.dispatched(attempt.attemptId), /changed immutable attempt identity/)
  assert.equal(ledger.get(attempt.attemptId), reserved)
  assert.equal(ledger.get(attempt.attemptId)?.phase, "queued")
  assert.equal(ledger.get(attempt.attemptId)?.revision, 0)
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
      return new Promise<void>((resolve) => {
        release = resolve
      })
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

test("capability matrices cannot be mutated into verified support", async () => {
  const first = await createJingleComputerUseNativeBackend(
    "windows-win32",
    recordingNativeBridge(() => probedMatrix("windows-win32")).bridge
  )
  const matrix = first.matrix
  assert.throws(() => {
    ;(matrix.capabilities[0] as { background: string }).background = "verified"
  })
  const second = await createJingleComputerUseNativeBackend(
    "windows-win32",
    recordingNativeBridge(() => probedMatrix("windows-win32")).bridge
  )
  assert.equal(second.matrix.capabilities[0]?.background, "unavailable")
})

test("latest settings-off wins while session disposal is pending", async () => {
  let releaseDispose!: () => void
  const disposeGate = new Promise<void>((resolve) => {
    releaseDispose = resolve
  })
  let disposeCalls = 0
  const backend: ComputerUseBackend = {
    matrix: probedMatrix("macos-quartz"),
    async disposeSession() {
      disposeCalls += 1
      await disposeGate
    },
    async identify() {
      throw new Error("unused")
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
    matrix: probedMatrix("macos-quartz"),
    async disposeSession() {
      disposeCalls += 1
      if (disposeCalls === 1) throw new Error("dispose failed")
    },
    async identify() {
      throw new Error("unused")
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
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
    new ComputerUseActionLedger(
      actionLedgerPort({
        onWrite(attempt) {
          writes.push(`${attempt.phase}:${attempt.result?.outcome ?? "pending"}`)
        }
      })
    )
  )
  const base = await identifyAndObserve(coordinator)
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

test("coordinator reports bounded causal diagnostics without action content", async () => {
  const base = typeTextObservation()
  const traces: ComputerUseTraceEvent[] = []
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
    identify() {
      return Promise.resolve(targetIdentity(base))
    },
    async execute() {
      throw Object.assign(new Error("secret action value must never be recorded"), {
        code: "helper_failed",
        nativeCode: "accessibility_permission_denied"
      })
    },
    async observe() {
      observeCalls += 1
      if (observeCalls > 1) {
        throw Object.assign(new Error("secret observed title must never be recorded"), {
          code: "observation_failed"
        })
      }
      return backendObservation(base)
    }
  }
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    new ComputerUseActionLedger(actionLedgerPort()),
    new ComputerUseObservationStore(),
    { record: (event) => traces.push(event) }
  )
  const canonicalBase = await identifyAndObserve(coordinator)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({
    observation: canonicalBase,
    runId: "run-trace",
    threadId: "thread-trace"
  })

  const result = await coordinator.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "top-secret-input" }],
    baseStateId: canonicalBase.stateId,
    runId: "run-trace",
    sessionId: grant.sessionId,
    threadId: "thread-trace",
    transactionId: "transaction-trace"
  })

  assert.equal(result.outcome, "unknown")
  assert.deepEqual(
    traces.map(({ dispatchOccurred, errorCode, nativeCode, operation }) => ({
      dispatchOccurred,
      errorCode,
      nativeCode,
      operation
    })),
    [
      {
        dispatchOccurred: true,
        errorCode: "helper_failed",
        nativeCode: "accessibility_permission_denied",
        operation: "execute_background"
      },
      {
        dispatchOccurred: true,
        errorCode: "observation_failed",
        nativeCode: undefined,
        operation: "observe_recovery"
      }
    ]
  )
  assert.equal(JSON.stringify(traces).includes("secret"), false)
  assert.equal(JSON.stringify(traces).includes("top-secret-input"), false)
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
      identify() {
        return Promise.resolve(targetIdentity(baseRaw))
      },
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
        const source = observeCalls === 1 ? baseRaw : replacement
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
      new ComputerUseActionLedger(actionLedgerPort())
    )
    const base = await identifyAndObserve(coordinator)
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
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
    new ComputerUseActionLedger(
      actionLedgerPort({
        onWrite(attempt) {
          writes.push(`${attempt.phase}:${attempt.result?.outcome ?? "pending"}`)
        }
      })
    )
  )
  const base = await identifyAndObserve(coordinator)
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
    matrix: probedMatrix("macos-quartz"),
    disposeSession: resolvedVoid,
    async identify() {
      throw new Error("unused")
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
    async execute(request) {
      const source = request.actions[0]!
      if (source.kind !== "type_text") throw new Error("expected type_text fixture action")
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
    new ComputerUseActionLedger(actionLedgerPort())
  )
  const base = await identifyAndObserve(coordinator)
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
    assert.deepEqual(calls[0]?.request, {
      environment,
      method: "probe",
      protocolVersion: 1,
      requestPermission: environment === "macos-quartz"
    })
    assert.equal(backend.matrix.environment, environment)
    assert.deepEqual(
      backend.matrix.capabilities.map((capability) => capability.action),
      COMPUTER_USE_NATIVE_ACTIONS
    )
  }
})

test("native capability probes reject environment and protocol mismatches", async () => {
  const base = probedMatrix("macos-quartz")
  const invalidMatrices: unknown[] = [
    { ...base, environment: "windows-win32" },
    { ...base, platform: "windows" },
    { ...base, protocolVersion: 2 },
    { ...base, unexpected: true }
  ]
  for (const matrix of invalidMatrices) {
    const { bridge } = recordingNativeBridge(() => matrix)
    await assert.rejects(createJingleComputerUseNativeBackend("macos-quartz", bridge), (error) => {
      assert.ok(error instanceof ComputerUseNativeProtocolError)
      assert.equal(error.code, "invalid_native_response")
      assert.equal(error.method, "probe")
      assert.match(error.message, /another environment or protocol/)
      return true
    })
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

test("native bridge keeps signals out of identify, observe, and execute JSON payloads", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...backendObservation } = base
  const controller = new AbortController()
  const { bridge, calls } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "identify") {
      return nativeOperationResponse("identify", targetIdentity(base))
    }
    if (request.method === "observe") {
      return nativeOperationResponse("observe", backendObservation)
    }
    if (request.method === "execute") {
      return nativeOperationResponse("execute", {
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
      })
    }
    return undefined
  })
  const backend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    bridge,
    controller.signal
  )
  const target = await backend.identify({
    applicationId: base.application.id,
    signal: controller.signal
  })
  await backend.observe({ signal: controller.signal, target })
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
    ["probe", "identify", "observe", "execute"]
  )
  for (const call of calls) {
    assert.equal(call.signal, controller.signal)
    assert.equal(JSON.stringify(call.request).includes("signal"), false)
    if (call.request.method !== "dispose_session") {
      assert.equal(call.request.environment, "macos-quartz")
      assert.equal(call.request.protocolVersion, 1)
    }
    if (
      call.request.method === "identify" ||
      call.request.method === "observe" ||
      call.request.method === "execute"
    ) {
      assert.equal(Object.hasOwn(call.request.request, "signal"), false)
    }
    if (call.request.method === "execute") {
      assert.equal(Object.isFrozen(call.request.request.actions), true)
      assert.equal(Object.isFrozen(call.request.request.actions[0]), true)
    }
  }
})

test("native action codec rejects invalid actions and rebuilds exact signal-free wire DTOs", async () => {
  const base = typeTextObservation()
  const { bridge, calls } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "execute") {
      return nativeOperationResponse("execute", {
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
      })
    }
    return undefined
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
  const invalidActions: unknown[] = [
    { kind: "press", ref: "@e1", value: "ignored" },
    { kind: "press", ref: "@e1", signal: new AbortController().signal },
    { kind: "set_value", ref: "@e1" },
    { keys: ["ENTER"], kind: "type_text", ref: "@e1", value: "hello" },
    { keys: [], kind: "keypress", ref: "@e1" },
    { kind: "scroll", ref: "@e1" },
    { kind: "scroll", ref: "@e1", scrollAmount: 1, value: "ignored" }
  ]

  for (const invalidAction of invalidActions) {
    await assert.rejects(
      backend.execute({
        actions: [invalidAction] as readonly ComputerUseSemanticAction[],
        authorization,
        base,
        delivery: "background"
      }),
      /Computer-use native execution action/
    )
  }
  assert.equal(calls.length, 0)

  await backend.execute({
    actions: [{ kind: "type_text", ref: "@e1", value: "hello" }],
    authorization,
    base: {
      ...base,
      metadata: {
        toJSON() {
          return { signal: {} }
        }
      },
      window: { ...base.window, signal: new AbortController().signal }
    } as unknown as ComputerUseObservation,
    delivery: "background"
  })
  assert.equal(calls.length, 1)
  assert.equal(JSON.stringify(calls[0]!.request).includes("signal"), false)
})

test("native operation responses reject missing or mismatched wire discriminators", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...observationResult } = base
  const action = { kind: "type_text", ref: "@e1", value: "hello" } as const
  const executionResult = {
    baseStateId: base.stateId,
    outcome: "worked",
    steps: [
      {
        action,
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
  const authorization = {
    expiresAt: Date.now() + 1_000,
    runId: "run",
    sessionId: "session",
    threadId: "thread",
    window: base.window
  }
  const invalidObserveResponses: unknown[] = [
    observationResult,
    { method: "observe", protocolVersion: 1, result: observationResult },
    nativeOperationResponse("observe", observationResult, "windows-win32"),
    nativeOperationResponse("execute", observationResult),
    { ...nativeOperationResponse("observe", observationResult), protocolVersion: 2 },
    { ...nativeOperationResponse("observe", observationResult), protocolVersion: true },
    { ...nativeOperationResponse("observe", observationResult), protocolVersion: "1" },
    { ...nativeOperationResponse("observe", observationResult), unexpected: true }
  ]
  for (const response of invalidObserveResponses) {
    const { bridge } = recordingNativeBridge((request) =>
      request.method === "probe" ? probedMatrix("macos-quartz") : response
    )
    const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
    await assert.rejects(
      backend.observe({ target: targetIdentity(base) }),
      /another environment or protocol/
    )
  }

  const invalidExecuteResponses: unknown[] = [
    executionResult,
    nativeOperationResponse("execute", executionResult, "linux-x11"),
    nativeOperationResponse("observe", executionResult),
    { ...nativeOperationResponse("execute", executionResult), protocolVersion: 2 },
    { ...nativeOperationResponse("execute", executionResult), protocolVersion: true },
    { ...nativeOperationResponse("execute", executionResult), protocolVersion: "1" },
    { ...nativeOperationResponse("execute", executionResult), unexpected: true }
  ]
  for (const response of invalidExecuteResponses) {
    const { bridge } = recordingNativeBridge((request) => {
      if (request.method === "probe") return probedMatrix("macos-quartz")
      if (request.method === "execute") return response
      return undefined
    })
    const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
    await assert.rejects(
      backend.execute({ actions: [action], authorization, base, delivery: "background" }),
      /another environment or protocol/
    )
  }
})

test("native observations are strictly decoded into bounded immutable facts", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...validObservation } = base
  const { bridge } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "observe") {
      return nativeOperationResponse("observe", validObservation)
    }
    return undefined
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
  const result = await backend.observe({ target: targetIdentity(base) })

  assert.deepEqual(result, validObservation)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.elements), true)
  assert.equal(Object.isFrozen(result.elements[0]), true)

  const invalidObservations: unknown[] = [
    { ...validObservation, unexpected: true },
    { ...validObservation, application: { id: validObservation.application.id } },
    { ...validObservation, application: { ...validObservation.application, id: " \n " } },
    { ...validObservation, resourceKey: "   " },
    {
      ...validObservation,
      resourceKey: " ".repeat(COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token + 1)
    },
    { ...validObservation, window: { ...validObservation.window, platform: "windows" } },
    { ...validObservation, window: { ...validObservation.window, generation: "\t" } },
    { ...validObservation, window: { ...validObservation.window, nativeId: "  " } },
    {
      ...validObservation,
      elements: [validObservation.elements[0], validObservation.elements[0]]
    },
    {
      ...validObservation,
      elements: [{ ...validObservation.elements[0], index: 7 }]
    },
    {
      ...validObservation,
      elements: [{ ...validObservation.elements[0], ref: "\n" }]
    },
    {
      ...validObservation,
      elements: [{ ...validObservation.elements[0], role: "  " }]
    },
    { ...validObservation, elements: Array(1) },
    {
      ...validObservation,
      elements: [
        {
          ...validObservation.elements[0],
          actions: ["type_text", "type_text"]
        }
      ]
    },
    {
      ...validObservation,
      elements: [{ ...validObservation.elements[0], actions: Array(1) }]
    },
    {
      ...validObservation,
      elements: [
        {
          ...validObservation.elements[0],
          unexpected: true
        }
      ]
    },
    {
      ...validObservation,
      elements: Array.from(
        { length: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.elements + 1 },
        (_, index) => ({
          actions: ["type_text"],
          index,
          ref: `@e${index}`,
          role: "text_field"
        })
      )
    }
  ]

  for (const invalidObservation of invalidObservations) {
    const invalid = recordingNativeBridge((request) =>
      request.method === "probe"
        ? probedMatrix("macos-quartz")
        : nativeOperationResponse("observe", invalidObservation)
    )
    const invalidBackend = await createJingleComputerUseNativeBackend(
      "macos-quartz",
      invalid.bridge
    )
    await assert.rejects(
      invalidBackend.observe({ target: targetIdentity(base) }),
      /Computer-use native/
    )
  }

  const oversized = recordingNativeBridge((request) =>
    request.method === "probe"
      ? probedMatrix("macos-quartz")
      : nativeOperationResponse("observe", {
          ...validObservation,
          application: {
            ...validObservation.application,
            name: "a".repeat(COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text + 1)
          },
          elements: [
            {
              ...validObservation.elements[0],
              title: `${"x".repeat(COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text - 1)}😀`
            }
          ]
        })
  )
  const oversizedBackend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    oversized.bridge
  )
  const bounded = await oversizedBackend.observe({ target: targetIdentity(base) })
  assert.equal(bounded.sourceTruncated, true)
  assert.equal(bounded.application.name.length, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text)
  assert.equal(bounded.elements[0]?.title?.length, COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text - 1)
})

test("native observations reject valid-shaped target drift at the backend boundary", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...validObservation } = base
  const target = targetIdentity(base)
  const drifts: unknown[] = [
    {
      ...validObservation,
      application: { ...validObservation.application, id: "com.example.other" }
    },
    { ...validObservation, resourceKey: "macos:42:g1:other-window" },
    {
      ...validObservation,
      window: { ...validObservation.window, generation: "g2" }
    },
    {
      ...validObservation,
      window: { ...validObservation.window, nativeId: "other-window" }
    },
    { ...validObservation, window: { ...validObservation.window, pid: 43 } }
  ]

  for (const drift of drifts) {
    const { bridge } = recordingNativeBridge((request) =>
      request.method === "probe"
        ? probedMatrix("macos-quartz")
        : nativeOperationResponse("observe", drift)
    )
    const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
    await assert.rejects(backend.observe({ target }), (error) => {
      assert.ok(error instanceof ComputerUseNativeProtocolError)
      assert.equal(error.code, "invalid_native_response")
      assert.equal(error.method, "observe")
      assert.match(error.message, /another target identity/)
      return true
    })
  }
})

test("native observations validate the dispatched target snapshot when callers mutate", async () => {
  const base = typeTextObservation()
  const { epoch: _epoch, stateId: _stateId, ...validObservation } = base
  const target = structuredClone(targetIdentity(base))
  const dispatchedTarget = structuredClone(target)
  let markObserveStarted: (() => void) | undefined
  const observeStarted = new Promise<void>((resolve) => {
    markObserveStarted = resolve
  })
  let releaseObserve: (() => void) | undefined
  const observeReleased = new Promise<void>((resolve) => {
    releaseObserve = resolve
  })
  const { bridge, calls } = recordingNativeBridge(async (request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    assert.equal(request.method, "observe")
    markObserveStarted?.()
    await observeReleased
    return nativeOperationResponse("observe", {
      ...validObservation,
      resourceKey: target.resourceKey,
      window: target.window
    })
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
  const observing = backend.observe({ target })

  await observeStarted
  target.resourceKey = "macos:43:g2:other-window"
  target.window = {
    ...target.window,
    generation: "g2",
    nativeId: "other-window",
    pid: 43
  }
  releaseObserve?.()

  await assert.rejects(observing, (error) => {
    assert.ok(error instanceof ComputerUseNativeProtocolError)
    assert.equal(error.method, "observe")
    assert.match(error.message, /another target identity/)
    return true
  })
  assert.deepEqual(calls[1]?.request, {
    environment: "macos-quartz",
    method: "observe",
    protocolVersion: 1,
    request: { target: dispatchedTarget }
  })
})

test("native identify response decoding fails closed with a typed protocol error", async () => {
  const { bridge } = recordingNativeBridge((request) =>
    request.method === "probe"
      ? probedMatrix("macos-quartz")
      : nativeOperationResponse("identify", { invalid: true })
  )
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)

  await assert.rejects(backend.identify({ applicationId: "com.example.editor" }), (error) => {
    assert.ok(error instanceof ComputerUseNativeProtocolError)
    assert.equal(error.code, "invalid_native_response")
    assert.equal(error.method, "identify")
    return true
  })
})

test("native identify rejects valid-shaped application and window selector drift", async () => {
  const base = typeTextObservation()
  const target = targetIdentity(base)
  const drifts = [
    { ...target, application: { ...target.application, id: "com.example.other" } },
    { ...target, window: { ...target.window, nativeId: "other-window" } }
  ]

  for (const drift of drifts) {
    const { bridge } = recordingNativeBridge((request) =>
      request.method === "probe"
        ? probedMatrix("macos-quartz")
        : nativeOperationResponse("identify", drift)
    )
    const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
    await assert.rejects(
      backend.identify({ applicationId: target.application.id, windowId: target.window.nativeId }),
      (error) => {
        assert.ok(error instanceof ComputerUseNativeProtocolError)
        assert.equal(error.method, "identify")
        assert.match(error.message, /another selector/)
        return true
      }
    )
  }
})

test("native identify validates the dispatched selector snapshot when callers mutate", async () => {
  const base = typeTextObservation()
  const target = targetIdentity(base)
  const request = {
    applicationId: target.application.id,
    windowId: target.window.nativeId
  }
  const dispatchedRequest = structuredClone(request)
  let markIdentifyStarted: (() => void) | undefined
  const identifyStarted = new Promise<void>((resolve) => {
    markIdentifyStarted = resolve
  })
  let releaseIdentify: (() => void) | undefined
  const identifyReleased = new Promise<void>((resolve) => {
    releaseIdentify = resolve
  })
  const { bridge, calls } = recordingNativeBridge(async (nativeInvocation) => {
    if (nativeInvocation.method === "probe") return probedMatrix("macos-quartz")
    assert.equal(nativeInvocation.method, "identify")
    markIdentifyStarted?.()
    await identifyReleased
    return nativeOperationResponse("identify", {
      ...target,
      application: { ...target.application, id: request.applicationId },
      window: { ...target.window, nativeId: request.windowId }
    })
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
  const identifying = backend.identify(request)

  await identifyStarted
  request.applicationId = "com.example.other"
  request.windowId = "other-window"
  releaseIdentify?.()

  await assert.rejects(identifying, (error) => {
    assert.ok(error instanceof ComputerUseNativeProtocolError)
    assert.equal(error.method, "identify")
    assert.match(error.message, /another selector/)
    return true
  })
  assert.deepEqual(calls[1]?.request, {
    environment: "macos-quartz",
    method: "identify",
    protocolVersion: 1,
    request: dispatchedRequest
  })
})

test("native bridge transport rejections retain their original error identity", async () => {
  const transportError = new TypeError("native transport disconnected")
  const { bridge } = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    throw transportError
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)

  await assert.rejects(
    backend.observe({ target: targetIdentity(typeTextObservation()) }),
    (error) => error === transportError
  )
})

test("native bridge in-flight aborts retain their original reason identity", async () => {
  const controller = new AbortController()
  const abortReason = new DOMException("native operation cancelled", "AbortError")
  let markObserveStarted: (() => void) | undefined
  const observeStarted = new Promise<void>((resolve) => {
    markObserveStarted = resolve
  })
  const { bridge } = recordingNativeBridge((request, signal) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    markObserveStarted?.()
    return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", bridge)
  const observing = backend.observe({
    signal: controller.signal,
    target: targetIdentity(typeTextObservation())
  })

  await observeStarted
  controller.abort(abortReason)

  await assert.rejects(observing, (error) => error === abortReason)
})

test("native execution results reject malformed action, status, route, and evidence facts", async () => {
  const base = typeTextObservation()
  const action = { kind: "type_text", ref: "@e1", value: "hello" } as const
  const authorization = {
    expiresAt: Date.now() + 1_000,
    runId: "run",
    sessionId: "session",
    threadId: "thread",
    window: base.window
  }
  const validStep = {
    action,
    evidence: {
      delivery: "semantic",
      noSideEffectProof: false,
      route: "ax_value",
      verification: "verified"
    },
    outcome: "worked"
  }
  const validResult = {
    baseStateId: base.stateId,
    outcome: "worked",
    steps: [validStep]
  }
  const responses: unknown[] = [
    { ...validResult, unexpected: true },
    { ...validResult, baseStateId: "another-state" },
    { ...validResult, outcome: "cancelled_before_dispatch" },
    { ...validResult, outcome: "unknown", steps: [] },
    { ...validResult, outcome: "unknown", steps: [{ ...validStep, outcome: "unknown" }] },
    { ...validResult, steps: [] },
    { ...validResult, outcome: "didnt" },
    { ...validResult, outcome: "refused" },
    {
      ...validResult,
      outcome: "unavailable",
      steps: [
        {
          ...validStep,
          evidence: { ...validStep.evidence, verification: "unverifiable" },
          outcome: "unknown"
        }
      ]
    },
    {
      ...validResult,
      outcome: "refused",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: true,
            verification: "failed"
          },
          outcome: "didnt"
        }
      ],
      stoppedAt: 0
    },
    {
      ...validResult,
      outcome: "unavailable",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: true,
            verification: "failed"
          },
          outcome: "refused"
        }
      ],
      stoppedAt: 0
    },
    {
      ...validResult,
      outcome: "refused",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: true,
            verification: "failed"
          },
          outcome: "refused"
        }
      ]
    },
    { ...validResult, stoppedAt: 1 },
    { ...validResult, outcome: "unknown", steps: Array(1), stoppedAt: 0 },
    { ...validResult, steps: [{ ...validStep, action: { ...action, unexpected: true } }] },
    { ...validResult, steps: [{ ...validStep, action: { ...action, ref: "@other" } }] },
    {
      ...validResult,
      steps: [{ ...validStep, evidence: { ...validStep.evidence, route: "global_input" } }]
    },
    {
      ...validResult,
      steps: [{ ...validStep, evidence: { ...validStep.evidence, unexpected: true } }]
    },
    {
      ...validResult,
      steps: [
        {
          ...validStep,
          evidence: { ...validStep.evidence, verification: "unverifiable" }
        }
      ]
    },
    {
      ...validResult,
      steps: [
        {
          ...validStep,
          evidence: { ...validStep.evidence, noSideEffectProof: true }
        }
      ]
    },
    {
      ...validResult,
      outcome: "unknown",
      steps: [{ ...validStep, outcome: "unknown" }],
      stoppedAt: 0
    },
    {
      ...validResult,
      outcome: "didnt",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: false,
            verification: "failed"
          },
          outcome: "didnt"
        }
      ]
    },
    {
      ...validResult,
      outcome: "refused",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: false,
            verification: "failed"
          },
          outcome: "refused"
        }
      ],
      stoppedAt: 0
    },
    {
      ...validResult,
      outcome: "unavailable",
      steps: [
        {
          ...validStep,
          evidence: {
            ...validStep.evidence,
            noSideEffectProof: false,
            verification: "failed"
          },
          outcome: "unavailable"
        }
      ],
      stoppedAt: 0
    },
    { ...validResult, steps: [validStep, validStep] }
  ]

  for (const response of responses) {
    const invalid = recordingNativeBridge((request) => {
      if (request.method === "probe") return probedMatrix("macos-quartz")
      if (request.method === "execute") {
        return nativeOperationResponse("execute", response)
      }
      return undefined
    })
    const backend = await createJingleComputerUseNativeBackend("macos-quartz", invalid.bridge)
    await assert.rejects(
      backend.execute({
        actions: [action],
        authorization,
        base,
        delivery: "background"
      }),
      (error) => {
        assert.ok(error instanceof ComputerUseNativeProtocolError)
        assert.equal(error.code, "invalid_native_response")
        assert.equal(error.method, "execute")
        assert.match(error.message, /Computer-use native/)
        return true
      }
    )
  }

  const valid = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "execute") {
      return nativeOperationResponse("execute", validResult)
    }
    return undefined
  })
  const backend = await createJingleComputerUseNativeBackend("macos-quartz", valid.bridge)
  const result = await backend.execute({
    actions: [action],
    authorization,
    base,
    delivery: "background"
  })
  assert.deepEqual(result, validResult)
  assert.equal(Object.isFrozen(result.steps[0]?.evidence), true)

  const targetMiss = {
    baseStateId: base.stateId,
    outcome: "didnt",
    steps: [
      {
        ...validStep,
        evidence: {
          ...validStep.evidence,
          noSideEffectProof: true,
          verification: "failed"
        },
        outcome: "didnt"
      }
    ],
    stoppedAt: 0
  }
  const targetMissHelper = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "execute") {
      return nativeOperationResponse("execute", targetMiss)
    }
    return undefined
  })
  const targetMissBackend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    targetMissHelper.bridge
  )
  const targetMissResult = await targetMissBackend.execute({
    actions: [action],
    authorization,
    base,
    delivery: "background"
  })
  assert.deepEqual(targetMissResult, targetMiss)
  assert.equal(computerUseResultAllowsForegroundRetry(targetMissResult, [action]), true)

  const secondAction = { ...action, value: "world" }
  const didntStep = {
    action: secondAction,
    evidence: {
      delivery: "semantic",
      noSideEffectProof: true,
      route: "ax_value",
      verification: "failed"
    },
    outcome: "didnt"
  }
  const earlyStop = {
    baseStateId: base.stateId,
    outcome: "unknown",
    steps: [validStep, didntStep],
    stoppedAt: 1
  }
  const helperShaped = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "execute") {
      return nativeOperationResponse("execute", earlyStop)
    }
    return undefined
  })
  const helperBackend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    helperShaped.bridge
  )
  assert.deepEqual(
    await helperBackend.execute({
      actions: [action, secondAction],
      authorization,
      base,
      delivery: "background"
    }),
    earlyStop
  )

  const contradictoryHelper = recordingNativeBridge((request) => {
    if (request.method === "probe") return probedMatrix("macos-quartz")
    if (request.method === "execute") {
      return nativeOperationResponse("execute", { ...earlyStop, outcome: "didnt" })
    }
    return undefined
  })
  const contradictoryBackend = await createJingleComputerUseNativeBackend(
    "macos-quartz",
    contradictoryHelper.bridge
  )
  await assert.rejects(
    contradictoryBackend.execute({
      actions: [action, secondAction],
      authorization,
      base,
      delivery: "background"
    }),
    /inconsistent didnt result/
  )

  await assert.rejects(
    backend.execute({
      actions: Array.from(
        { length: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions + 1 },
        () => action
      ),
      authorization,
      base,
      delivery: "background"
    }),
    /bounded non-empty action list/
  )
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

  await assert.rejects(
    backend.identify({
      applicationId: base.application.id,
      signal: operationController.signal
    }),
    /aborted/i
  )
  await assert.rejects(
    backend.observe({ signal: operationController.signal, target: targetIdentity(base) }),
    /aborted/i
  )
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

test("non-macOS activate returns unavailable without native dispatch", async () => {
  const environments = [
    { environment: "windows-win32", platform: "windows" },
    { environment: "linux-x11", platform: "linux" }
  ] as const

  for (const fixture of environments) {
    const base = activationObservation({
      window: {
        generation: "g1",
        nativeId: "w1",
        pid: 42,
        platform: fixture.platform
      }
    })
    const { bridge, calls } = recordingNativeBridge((request) => {
      if (request.method === "probe") return probedMatrix(fixture.environment)
      throw new Error("unavailable activate must not invoke the native bridge")
    })
    const backend = await createJingleComputerUseNativeBackend(fixture.environment, bridge)
    calls.length = 0

    const result = await backend.execute({
      actions: [{ kind: "activate", ref: "@root" }],
      authorization: {
        expiresAt: Date.now() + 1_000,
        runId: "run",
        sessionId: "session",
        threadId: "thread",
        window: base.window
      },
      base,
      delivery: "foreground"
    })

    assert.deepEqual(result, {
      baseStateId: base.stateId,
      outcome: "unavailable",
      steps: []
    })
    assert.equal(calls.length, 0)
  }
})

test("native capability matrices are canonical immutable copies", async () => {
  const matrix = probedMatrix("linux-x11")
  const { bridge } = recordingNativeBridge(() => matrix)
  const backend = await createJingleComputerUseNativeBackend("linux-x11", bridge)
  ;(matrix.capabilities as ComputerUseCapability[]).reverse()

  assert.deepEqual(
    backend.matrix.capabilities.map((capability) => capability.action),
    COMPUTER_USE_NATIVE_ACTIONS
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
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
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onWrite(attempt) {
        ledgerWrites.push(
          `${attempt.attemptId}:${attempt.phase}:${attempt.result?.outcome ?? "pending"}`
        )
      }
    })
  )
  const scheduler = new ComputerUseResourceScheduler()
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(backend, scheduler, sessions, ledger)
  const base = await identifyAndObserve(coordinator)
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

test("pre-aborted unsupported transactions settle as cancelled before dispatch", async () => {
  const raw = observation({
    elements: [
      {
        actions: ["scroll"],
        index: 0,
        ref: "@e1",
        role: "scroll_area"
      }
    ]
  })
  let backendDispatches = 0
  const backend: ComputerUseBackend = {
    matrix: {
      capabilities: [
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
    identify() {
      return Promise.resolve(targetIdentity(raw))
    },
    async execute() {
      backendDispatches += 1
      throw new Error("pre-aborted unsupported actions must not dispatch")
    },
    async observe() {
      const { epoch: _epoch, stateId: _stateId, ...value } = raw
      return value
    }
  }
  const ledgerWrites: string[] = []
  const ledger = new ComputerUseActionLedger(
    actionLedgerPort({
      onWrite(attempt) {
        ledgerWrites.push(
          `${attempt.attemptId}:${attempt.phase}:${attempt.result?.outcome ?? "pending"}`
        )
      }
    })
  )
  const sessions = new ComputerUseSessionManager(backend)
  const coordinator = new ComputerUseTransactionCoordinator(
    backend,
    new ComputerUseResourceScheduler(),
    sessions,
    ledger
  )
  const base = await identifyAndObserve(coordinator)
  await sessions.setEnabled(true)
  const grant = sessions.openSession({ observation: base, runId: "run", threadId: "thread" })
  const controller = new AbortController()
  controller.abort()

  const result = await coordinator.execute({
    actions: [{ kind: "scroll", ref: "@e1", scrollAmount: 1 }],
    baseStateId: base.stateId,
    runId: "run",
    sessionId: grant.sessionId,
    signal: controller.signal,
    threadId: "thread",
    transactionId: "pre-aborted-unsupported"
  })

  assert.deepEqual(result, {
    baseStateId: base.stateId,
    outcome: "cancelled_before_dispatch",
    steps: []
  })
  assert.equal(backendDispatches, 0)
  assert.deepEqual(ledgerWrites, ["pre-aborted-unsupported:settled:cancelled_before_dispatch"])
})

test("run release remains active while a durable reservation is pending", async () => {
  let resolveReservation!: (value: { status: "reserved" }) => void
  const reservation = new Promise<{ status: "reserved" }>((resolve) => {
    resolveReservation = resolve
  })
  const attempts = new Map<string, ComputerUseActionAttempt>()
  const ledger = new ComputerUseActionLedger({
    read: async () => undefined,
    reserve: async (attempt) => {
      attempts.set(attempt.attemptId, attempt)
      return reservation
    },
    transition: async ({ attempt, expectedPhase, expectedRevision }) => {
      const current = attempts.get(attempt.attemptId)
      assert.equal(current?.phase, expectedPhase)
      assert.equal(current?.revision, expectedRevision)
      attempts.set(attempt.attemptId, attempt)
      return { status: "applied" }
    }
  })

  const begin = ledger.begin(actionAttemptInput("release-during-reserve"))
  ledger.releaseRun("run-1")
  resolveReservation({ status: "reserved" })
  const claim = await begin
  assert.equal(claim.attempt.phase, "queued")
  assert.equal((await ledger.cancel(claim.attempt.attemptId)).outcome, "cancelled_before_dispatch")
  assert.equal(ledger.get(claim.attempt.attemptId), undefined)
})

test("run release prunes a settled durable replay that arrives from a pending reservation", async () => {
  const attemptInput = actionAttemptInput("released-durable-replay")
  const durableAttempts = new Map<string, ComputerUseActionAttempt>()
  const durableLedger = new ComputerUseActionLedger(actionLedgerPort({ attempts: durableAttempts }))
  const durableClaim = await durableLedger.begin(attemptInput)
  await durableLedger.cancel(durableClaim.attempt.attemptId)
  const durableAttempt = durableAttempts.get(durableClaim.attempt.attemptId)
  assert.equal(durableAttempt?.phase, "settled")

  let resolveReservation!: (value: { attempt: ComputerUseActionAttempt; status: "exists" }) => void
  const reservation = new Promise<{
    attempt: ComputerUseActionAttempt
    status: "exists"
  }>((resolve) => {
    resolveReservation = resolve
  })
  const replayLedger = new ComputerUseActionLedger({
    read: async () => undefined,
    reserve: async () => reservation,
    transition: async () => {
      throw new Error("settled replay must not transition")
    }
  })

  const begin = replayLedger.begin(attemptInput)
  replayLedger.releaseRun("run-1")
  resolveReservation({ attempt: durableAttempt!, status: "exists" })
  const replay = await begin

  assert.equal(replay.attempt.result?.outcome, "cancelled_before_dispatch")
  assert.equal(replayLedger.get(replay.attempt.attemptId), undefined)
})

import {
  JINGLE_HARNESS_CAPABILITY_CONTRACTS,
  type JingleHarnessCapabilityContract,
  type JingleHarnessState
} from "./harness-state"

export const JINGLE_HARNESS_HOOK_PHASES = ["agent_loop", "model_call"] as const
export type JingleHarnessHookPhase = (typeof JINGLE_HARNESS_HOOK_PHASES)[number]

export const JINGLE_HARNESS_HOOK_OBSERVABLE_SIGNALS = [
  "recording",
  "state",
  "stream",
  "trace"
] as const
export type JingleHarnessHookObservableSignal =
  (typeof JINGLE_HARNESS_HOOK_OBSERVABLE_SIGNALS)[number]

export const JINGLE_HARNESS_HOOK_FAILURE_SEMANTICS = ["core", "projection", "tool"] as const

export type JingleHarnessStateKey = keyof JingleHarnessState
export type JingleHarnessHookFailureSemantics = JingleHarnessCapabilityContract["failureSemantics"]
export type JingleHarnessHookWritePolicy = JingleHarnessCapabilityContract["writePolicy"]

export interface JingleHarnessHookContract<
  TPhase extends JingleHarnessHookPhase = JingleHarnessHookPhase
> {
  adapterStateKeys: readonly string[]
  failureSemantics: JingleHarnessHookFailureSemantics
  name: string
  observableSignals: readonly JingleHarnessHookObservableSignal[]
  phase: TPhase
  reads: readonly JingleHarnessStateKey[]
  runtimeStateKeys: readonly string[]
  writePolicy: JingleHarnessHookWritePolicy
  writes: readonly JingleHarnessStateKey[]
}

export type JingleHarnessHook<TPhase extends JingleHarnessHookPhase = JingleHarnessHookPhase> =
  JingleHarnessHookContract<TPhase>

function assertNonEmptyHookName(name: string): void {
  if (name.trim().length === 0) {
    throw new Error("[JingleHarnessHook] Hook name is required.")
  }
}

function assertHookPhase(phase: string): asserts phase is JingleHarnessHookPhase {
  if (!(JINGLE_HARNESS_HOOK_PHASES as readonly string[]).includes(phase)) {
    throw new Error(`[JingleHarnessHook] Unsupported hook phase: ${phase}`)
  }
}

function assertHookObservableSignal(
  signal: string
): asserts signal is JingleHarnessHookObservableSignal {
  if (!(JINGLE_HARNESS_HOOK_OBSERVABLE_SIGNALS as readonly string[]).includes(signal)) {
    throw new Error(`[JingleHarnessHook] Unsupported observable signal: ${signal}`)
  }
}

function assertHookFailureSemantics(
  failureSemantics: string
): asserts failureSemantics is JingleHarnessHookFailureSemantics {
  if (!(JINGLE_HARNESS_HOOK_FAILURE_SEMANTICS as readonly string[]).includes(failureSemantics)) {
    throw new Error(
      `[JingleHarnessHook] Unsupported failure semantics: ${failureSemantics}`
    )
  }
}

function readCapabilityContractsForWrite(
  stateKey: JingleHarnessStateKey
): JingleHarnessCapabilityContract[] {
  return Object.values(JINGLE_HARNESS_CAPABILITY_CONTRACTS).filter(
    (contract) => contract.stateKey === stateKey
  )
}

function assertKnownHarnessStateKey(stateKey: JingleHarnessStateKey): void {
  if (readCapabilityContractsForWrite(stateKey).length === 0) {
    throw new Error(`[JingleHarnessHook] Unsupported harness state key: ${String(stateKey)}`)
  }
}

function assertHookWriteContract(hook: JingleHarnessHook): void {
  if (hook.writes.length === 0) {
    if (hook.writePolicy !== "none") {
      throw new Error(
        `[JingleHarnessHook] Hook "${hook.name}" has no writes but declares writePolicy "${hook.writePolicy}".`
      )
    }
    return
  }

  for (const stateKey of hook.writes) {
    const contracts = readCapabilityContractsForWrite(stateKey)
    const matchesContract = contracts.some(
      (contract) =>
        contract.writePolicy === hook.writePolicy &&
        contract.failureSemantics === hook.failureSemantics
    )
    if (!matchesContract) {
      throw new Error(
        `[JingleHarnessHook] Hook "${hook.name}" write contract for "${String(stateKey)}" does not match harness state contract.`
      )
    }
  }
}

export function defineJingleHarnessHook<THook extends JingleHarnessHook>(hook: THook): THook {
  assertNonEmptyHookName(hook.name)
  assertHookPhase(hook.phase)
  assertHookFailureSemantics(hook.failureSemantics)
  for (const signal of hook.observableSignals) {
    assertHookObservableSignal(signal)
  }
  for (const stateKey of [...hook.reads, ...hook.writes]) {
    assertKnownHarnessStateKey(stateKey)
  }
  assertHookWriteContract(hook)
  return hook
}

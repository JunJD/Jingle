import type { NativeExtensionMainDefinition } from "@shared/native-extensions"
import type { ExtensionMainRef } from "./types"

export interface ExtensionMainDefinitionRegistryEntry {
  extensionName: string
  mainRef: ExtensionMainRef
}

export interface ExtensionMainDefinitionRegistryFailure {
  extensionName: string
  message: string
}

export interface ExtensionMainDefinitionRegistrySnapshot {
  definitions: ReadonlyArray<readonly [string, NativeExtensionMainDefinition]>
  failures: ReadonlyArray<ExtensionMainDefinitionRegistryFailure>
  pendingExtensionNames: readonly string[]
  revision: number
}

export interface ExtensionMainDefinitionRegistryOptions {
  entries: readonly ExtensionMainDefinitionRegistryEntry[]
  loadDefinition: (mainRef: ExtensionMainRef) => Promise<NativeExtensionMainDefinition>
  onError?: (input: {
    error: unknown
    extensionName: string
    phase: "dispose" | "load" | "shutdown"
  }) => void
  shutdownTimeoutMs?: number
  validateDefinition?: (extensionName: string, definition: NativeExtensionMainDefinition) => void
}

export interface UnavailableExtensionMainDefinition {
  extensionName: string
  state: "failed" | "missing" | "pending"
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000

const EMPTY_SNAPSHOT: ExtensionMainDefinitionRegistrySnapshot = Object.freeze({
  definitions: Object.freeze([]),
  failures: Object.freeze([]),
  pendingExtensionNames: Object.freeze([]),
  revision: 0
})

function freezeDefinition(
  definition: NativeExtensionMainDefinition
): NativeExtensionMainDefinition {
  const tools = definition.tools?.map((tool) => Object.freeze({ ...tool }))
  if (tools) {
    Object.freeze(tools)
  }

  const service = definition.service
    ? Object.freeze({
        ...definition.service,
        methods: Object.freeze([...definition.service.methods]) as string[]
      })
    : undefined

  return Object.freeze({
    ...(definition.dispose ? { dispose: definition.dispose } : {}),
    ...(service ? { service } : {}),
    ...(tools ? { tools } : {})
  })
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ExtensionMainDefinitionRegistry {
  private readonly abandonedLoadExtensionNames = new Set<string>()
  private readonly definitions = new Map<string, NativeExtensionMainDefinition>()
  private readonly disposedDefinitions = new WeakSet<NativeExtensionMainDefinition>()
  private readonly entries: readonly ExtensionMainDefinitionRegistryEntry[]
  private readonly failures = new Map<string, string>()
  private readonly pendingDefinitionLoads = new Map<string, Promise<void>>()
  private readonly pendingDisposals = new Map<Promise<void>, string>()
  private readonly pendingExtensionNames = new Set<string>()
  private activeDisposeWait: Promise<void> | null = null
  private disposed = false
  private snapshot = EMPTY_SNAPSHOT
  private started = false

  constructor(private readonly options: ExtensionMainDefinitionRegistryOptions) {
    const entryNames = new Set<string>()
    for (const entry of options.entries) {
      if (entryNames.has(entry.extensionName)) {
        throw new Error(
          `Extension main definition registry declares duplicate extension "${entry.extensionName}".`
        )
      }
      entryNames.add(entry.extensionName)
    }
    if (
      options.shutdownTimeoutMs !== undefined &&
      (!Number.isFinite(options.shutdownTimeoutMs) || options.shutdownTimeoutMs < 0)
    ) {
      throw new Error("Extension main definition registry shutdown timeout must be non-negative.")
    }
    this.entries = [...options.entries]
  }

  start(): void {
    if (this.started) {
      return
    }
    if (this.disposed) {
      throw new Error("Extension main definition registry is already disposed.")
    }
    this.started = true

    for (const entry of this.entries) {
      if (entry.mainRef.kind === "module" && entry.mainRef.trust !== "trusted") {
        continue
      }

      if (entry.mainRef.kind === "in-memory") {
        this.acceptDefinition(entry.extensionName, entry.mainRef.definition)
        continue
      }

      this.pendingExtensionNames.add(entry.extensionName)
      const loadPromise = Promise.resolve()
        .then(() => this.options.loadDefinition(entry.mainRef))
        .then(
          (definition) => this.acceptDefinition(entry.extensionName, definition),
          (error) => this.rejectDefinition(entry.extensionName, error)
        )
        .finally(() => {
          if (this.pendingDefinitionLoads.get(entry.extensionName) === loadPromise) {
            this.pendingDefinitionLoads.delete(entry.extensionName)
          }
        })
      this.pendingDefinitionLoads.set(entry.extensionName, loadPromise)
    }

    this.publishSnapshot()
  }

  readSnapshot(): ExtensionMainDefinitionRegistrySnapshot {
    this.assertStarted()
    return this.snapshot
  }

  getDefinition(extensionName: string): NativeExtensionMainDefinition | null {
    this.assertStarted()
    return this.definitions.get(extensionName) ?? null
  }

  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      const definitions = [...this.definitions.entries()]
      this.definitions.clear()
      this.failures.clear()
      this.pendingExtensionNames.clear()
      this.publishSnapshot()

      for (const [extensionName, definition] of definitions) {
        this.beginDefinitionDisposal(extensionName, definition)
      }
    }

    if (this.activeDisposeWait) {
      return this.activeDisposeWait
    }

    const disposeWait = this.waitForShutdownBarrier().finally(() => {
      if (this.activeDisposeWait === disposeWait) {
        this.activeDisposeWait = null
      }
    })
    this.activeDisposeWait = disposeWait
    return disposeWait
  }

  private acceptDefinition(extensionName: string, definition: NativeExtensionMainDefinition): void {
    this.pendingExtensionNames.delete(extensionName)
    if (this.disposed) {
      this.beginDefinitionDisposal(extensionName, definition)
      return
    }

    try {
      this.options.validateDefinition?.(extensionName, definition)
      const frozenDefinition = freezeDefinition(definition)
      this.definitions.set(extensionName, frozenDefinition)
      this.failures.delete(extensionName)
    } catch (error) {
      this.recordFailure(extensionName, error)
      this.beginDefinitionDisposal(extensionName, definition)
    }

    this.publishSnapshot()
  }

  private rejectDefinition(extensionName: string, error: unknown): void {
    this.pendingExtensionNames.delete(extensionName)
    if (this.disposed) {
      return
    }
    this.recordFailure(extensionName, error)
    this.publishSnapshot()
  }

  private recordFailure(extensionName: string, error: unknown): void {
    this.failures.set(extensionName, toErrorMessage(error))
    this.reportError({
      error,
      extensionName,
      phase: "load"
    })
  }

  private beginDefinitionDisposal(
    extensionName: string,
    definition: NativeExtensionMainDefinition
  ): void {
    if (!definition.dispose || this.disposedDefinitions.has(definition)) {
      return
    }
    this.disposedDefinitions.add(definition)

    const disposalPromise = Promise.resolve()
      .then(async () => {
        try {
          await definition.dispose?.()
        } catch (error) {
          this.reportError({
            error,
            extensionName,
            phase: "dispose"
          })
        }
      })
      .finally(() => {
        this.pendingDisposals.delete(disposalPromise)
      })
    this.pendingDisposals.set(disposalPromise, extensionName)
  }

  private async waitForShutdownBarrier(): Promise<void> {
    const timeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs

    while (true) {
      const pendingLoads = [...this.pendingDefinitionLoads.entries()].filter(
        ([extensionName]) => !this.abandonedLoadExtensionNames.has(extensionName)
      )
      const pendingDisposals = [...this.pendingDisposals.entries()]
      const pendingPromises = [
        ...pendingLoads.map(([, promise]) => promise),
        ...pendingDisposals.map(([promise]) => promise)
      ]
      if (pendingPromises.length === 0) {
        return
      }

      const didSettle = await settleWithinDeadline(pendingPromises, deadline)
      if (didSettle) {
        continue
      }

      const timedOutLoads = [...this.pendingDefinitionLoads.entries()].filter(
        ([extensionName]) => !this.abandonedLoadExtensionNames.has(extensionName)
      )
      const timedOutDisposals = [...this.pendingDisposals.entries()]
      for (const [extensionName] of timedOutLoads) {
        this.abandonedLoadExtensionNames.add(extensionName)
      }
      const timedOutExtensionNames = new Set([
        ...timedOutLoads.map(([extensionName]) => extensionName),
        ...timedOutDisposals.map(([, extensionName]) => extensionName)
      ])
      for (const extensionName of [...timedOutExtensionNames].sort()) {
        this.reportError({
          error: new Error(
            `Timed out after ${timeoutMs}ms waiting for extension main definition "${extensionName}" shutdown work.`
          ),
          extensionName,
          phase: "shutdown"
        })
      }
      return
    }
  }

  private reportError(input: {
    error: unknown
    extensionName: string
    phase: "dispose" | "load" | "shutdown"
  }): void {
    try {
      this.options.onError?.(input)
    } catch (error) {
      console.error("[ExtensionMainDefinitionRegistry] Error observer failed.", error)
    }
  }

  private publishSnapshot(): void {
    const revision = this.snapshot.revision + 1
    const definitions = [...this.definitions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([extensionName, definition]) => Object.freeze([extensionName, definition] as const))
    const failures = [...this.failures.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([extensionName, message]) => Object.freeze({ extensionName, message }))
    const pendingExtensionNames = [...this.pendingExtensionNames].sort()

    this.snapshot = Object.freeze({
      definitions: Object.freeze(definitions),
      failures: Object.freeze(failures),
      pendingExtensionNames: Object.freeze(pendingExtensionNames),
      revision
    })
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error("Extension main definition registry has not started.")
    }
  }
}

export function listUnavailableExtensionMainDefinitions(
  snapshot: ExtensionMainDefinitionRegistrySnapshot,
  requiredExtensionNames: Iterable<string>
): UnavailableExtensionMainDefinition[] {
  const availableExtensionNames = new Set(
    snapshot.definitions.map(([extensionName]) => extensionName)
  )
  const failedExtensionNames = new Set(snapshot.failures.map(({ extensionName }) => extensionName))
  const pendingExtensionNames = new Set(snapshot.pendingExtensionNames)

  return [...new Set(requiredExtensionNames)]
    .sort()
    .flatMap((extensionName): UnavailableExtensionMainDefinition[] => {
      if (availableExtensionNames.has(extensionName)) {
        return []
      }
      if (pendingExtensionNames.has(extensionName)) {
        return [{ extensionName, state: "pending" }]
      }
      if (failedExtensionNames.has(extensionName)) {
        return [{ extensionName, state: "failed" }]
      }
      return [{ extensionName, state: "missing" }]
    })
}

async function settleWithinDeadline(
  pendingPromises: readonly Promise<void>[],
  deadline: number
): Promise<boolean> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    return false
  }

  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.allSettled(pendingPromises).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), remainingMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

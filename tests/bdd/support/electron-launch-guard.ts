import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DEFAULT_LEASE_STALE_MS = 60_000
const MINIMUM_PROCESS_ID = 2

interface ProperLockfileModule {
  lock(
    path: string,
    options: {
      onCompromised: (error: Error) => void
      realpath: false
      retries: 0
      stale: number
      update: number
    }
  ): Promise<() => Promise<void>>
}

const properLockfile = createRequire(__filename)("proper-lockfile") as ProperLockfileModule

export interface BddElectronLease {
  compromised: Promise<Error>
  release(): Promise<void>
}

export interface BddElectronLeasePort {
  acquire(): Promise<BddElectronLease>
}

export interface BddElectronClosePort {
  close(): Promise<void>
  processId(): number
  waitForClose(timeoutMs: number): Promise<void>
}

export interface BddProcessTreePort {
  terminate(processId: number, timeoutMs: number): Promise<void>
}

export interface JingleBddElectronLeaseOptions {
  leasePath?: string
  staleMs?: number
}

export class BddElectronLeaseUnavailableError extends Error {
  readonly code = "bdd_electron_lease_unavailable"

  constructor() {
    super("Another Jingle BDD process already owns the Electron launch lease.")
    this.name = "BddElectronLeaseUnavailableError"
  }
}

export class BddElectronLeaseCompromisedError extends Error {
  readonly code = "bdd_electron_lease_compromised"

  constructor(cause: unknown) {
    super("The Jingle BDD Electron launch lease was compromised.", { cause })
    this.name = "BddElectronLeaseCompromisedError"
  }
}

export class BddElectronCloseUnconfirmedError extends Error {
  readonly code = "bdd_electron_close_unconfirmed"

  constructor(cause: unknown) {
    super("The Jingle BDD Electron process tree did not confirm exit.", { cause })
    this.name = "BddElectronCloseUnconfirmedError"
  }
}

export function getJingleBddElectronLeasePath(): string {
  const identity =
    typeof process.getuid === "function" ? String(process.getuid()) : userInfo().username
  return join(tmpdir(), `jingle-bdd-electron-${encodeURIComponent(identity)}.lease`)
}

export function createJingleBddElectronLeasePort(
  options: JingleBddElectronLeaseOptions = {}
): BddElectronLeasePort {
  const leasePath = options.leasePath ?? getJingleBddElectronLeasePath()
  const staleMs = options.staleMs ?? DEFAULT_LEASE_STALE_MS

  if (!Number.isFinite(staleMs) || staleMs < 2_000) {
    throw new Error("BDD Electron lease staleMs must be at least 2000 milliseconds.")
  }

  return {
    async acquire() {
      let compromisedError: Error | null = null
      let reportCompromised: (error: Error) => void = () => undefined
      const compromised = new Promise<Error>((resolve) => {
        reportCompromised = resolve
      })
      let releaseLock: () => Promise<void>
      try {
        releaseLock = await properLockfile.lock(leasePath, {
          onCompromised(error) {
            if (!compromisedError) {
              compromisedError = error
              reportCompromised(error)
            }
          },
          realpath: false,
          retries: 0,
          stale: staleMs,
          update: Math.max(1_000, Math.floor(staleMs / 3))
        })
      } catch (error) {
        if (isLockUnavailableError(error)) {
          throw new BddElectronLeaseUnavailableError()
        }
        throw error
      }

      let released = false
      return {
        compromised,
        async release() {
          if (released) {
            return
          }
          released = true

          try {
            await releaseLock()
          } catch (error) {
            if (!compromisedError) {
              throw error
            }
          }

          if (compromisedError) {
            throw compromisedError
          }
        }
      }
    }
  }
}

export class BddElectronLaunchGuard<TApplication> {
  private application: TApplication | null = null
  private closeFailure: BddElectronCloseUnconfirmedError | null = null
  private closePromise: Promise<void> | null = null
  private compromiseCleanup: Promise<void> | null = null
  private launchPromise: Promise<TApplication> | null = null
  private lease: BddElectronLease | null = null
  private terminalError: BddElectronLeaseCompromisedError | null = null

  constructor(private readonly leasePort: BddElectronLeasePort) {}

  launch(
    spawn: () => Promise<TApplication>,
    closeCompromisedApplication: (application: TApplication) => Promise<void>
  ): Promise<TApplication> {
    const blocker = this.terminalError ?? this.closeFailure
    if (blocker) {
      return Promise.reject(blocker)
    }
    if (this.closePromise) {
      return this.closePromise.then(() => this.launch(spawn, closeCompromisedApplication))
    }
    if (this.application) {
      return Promise.resolve(this.application)
    }
    if (this.launchPromise) {
      return this.launchPromise
    }

    const launchPromise = this.launchWithLease(spawn, closeCompromisedApplication)
    this.launchPromise = launchPromise
    void launchPromise.then(
      () => {
        if (this.launchPromise === launchPromise) {
          this.launchPromise = null
        }
      },
      () => {
        if (this.launchPromise === launchPromise) {
          this.launchPromise = null
        }
      }
    )
    return launchPromise
  }

  async restart(
    closeApplication: (application: TApplication) => Promise<void>,
    spawn: () => Promise<TApplication>,
    closeCompromisedApplication: (application: TApplication) => Promise<void>
  ): Promise<TApplication> {
    const blocker = this.terminalError ?? this.closeFailure
    if (blocker) {
      throw blocker
    }
    if (this.closePromise) {
      await this.closePromise
    }
    if (this.launchPromise) {
      await this.launchPromise
    }
    if (this.application) {
      const application = this.application
      try {
        await closeApplication(application)
      } catch (error) {
        this.closeFailure = new BddElectronCloseUnconfirmedError(error)
        throw this.closeFailure
      }
      if (this.application === application) {
        this.application = null
      }
      this.closeFailure = null
    }

    return this.launch(spawn, closeCompromisedApplication)
  }

  close(closeApplication: (application: TApplication) => Promise<void>): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }

    const closePromise = this.closeAndRelease(closeApplication)
    this.closePromise = closePromise
    void closePromise.then(
      () => {
        if (this.closePromise === closePromise) {
          this.closePromise = null
        }
      },
      () => {
        if (this.closePromise === closePromise) {
          this.closePromise = null
        }
      }
    )
    return closePromise
  }

  private async closeAndRelease(
    closeApplication: (application: TApplication) => Promise<void>
  ): Promise<void> {
    if (this.closeFailure) {
      throw this.closeFailure
    }
    if (this.launchPromise) {
      await this.launchPromise.catch(() => undefined)
    }
    if (this.compromiseCleanup) {
      await this.compromiseCleanup.catch(() => undefined)
    }

    if (this.application) {
      const application = this.application
      try {
        await closeApplication(application)
      } catch (error) {
        this.closeFailure = new BddElectronCloseUnconfirmedError(error)
        throw this.closeFailure
      }
      if (this.application === application) {
        this.application = null
      }
      this.closeFailure = null
    }

    try {
      await this.releaseLease()
    } catch (error) {
      this.terminalError ??= new BddElectronLeaseCompromisedError(error)
      throw this.terminalError
    }

    if (this.terminalError) {
      throw this.terminalError
    }
  }

  private async launchWithLease(
    spawn: () => Promise<TApplication>,
    closeCompromisedApplication: (application: TApplication) => Promise<void>
  ): Promise<TApplication> {
    if (!this.lease) {
      this.lease = await this.leasePort.acquire()
    }
    const lease = this.lease
    const spawnPromise = spawn()

    try {
      const outcome = await Promise.race([
        spawnPromise.then((application) => ({ application, kind: "application" }) as const),
        lease.compromised.then((error) => ({ error, kind: "compromised" }) as const)
      ])
      if (outcome.kind === "compromised") {
        const terminalError = this.beginCompromise(
          outcome.error,
          spawnPromise,
          closeCompromisedApplication
        )
        throw terminalError
      }

      const application = outcome.application
      this.application = application
      void lease.compromised.then((error) => {
        this.beginCompromise(error, Promise.resolve(application), closeCompromisedApplication)
      })
      return application
    } catch (error) {
      if (this.terminalError) {
        throw this.terminalError
      }
      try {
        await this.releaseLease()
      } catch (releaseError) {
        this.terminalError = new BddElectronLeaseCompromisedError(releaseError)
        throw new AggregateError(
          [error, this.terminalError],
          "BDD Electron launch failed and its lease could not be released."
        )
      }
      throw error
    }
  }

  private beginCompromise(
    cause: unknown,
    application: Promise<TApplication>,
    closeCompromisedApplication: (application: TApplication) => Promise<void>
  ): BddElectronLeaseCompromisedError {
    const terminalError =
      this.terminalError ?? (this.terminalError = new BddElectronLeaseCompromisedError(cause))
    if (!this.compromiseCleanup) {
      const cleanup = application.then(async (resolvedApplication) => {
        this.application = resolvedApplication
        await closeCompromisedApplication(resolvedApplication)
        if (this.application === resolvedApplication) {
          this.application = null
        }
      })
      this.compromiseCleanup = cleanup
      void cleanup.catch(() => undefined)
    }
    return terminalError
  }

  private async releaseLease(): Promise<void> {
    const lease = this.lease
    if (!lease) {
      return
    }
    await lease.release()
    if (this.lease === lease) {
      this.lease = null
    }
  }
}

export async function closeBddElectronApplication(
  application: BddElectronClosePort,
  processTree: BddProcessTreePort,
  timeoutMs: number
): Promise<void> {
  const closeObserved = observeBddElectronClose(application, timeoutMs)
  const closeRequested = application.close().then(
    () => ({ kind: "requested" }) as const,
    (error: unknown) => ({ error, kind: "request-failed" }) as const
  )
  const firstOutcome = await Promise.race([closeObserved, closeRequested])
  if (firstOutcome.kind === "closed") {
    return
  }
  if (firstOutcome.kind === "requested") {
    const observedOutcome = await closeObserved
    if (observedOutcome.kind === "closed") {
      return
    }
  }

  await terminateBddElectronApplication(application, processTree, timeoutMs)
}

export async function terminateBddElectronApplication(
  application: Pick<BddElectronClosePort, "processId" | "waitForClose">,
  processTree: BddProcessTreePort,
  timeoutMs: number
): Promise<void> {
  const closeObserved = observeBddElectronClose(application, timeoutMs)
  let terminationError: unknown = null
  try {
    await processTree.terminate(application.processId(), timeoutMs)
  } catch (error) {
    terminationError = error
  }

  const closeOutcome = await closeObserved
  if (closeOutcome.kind === "failed") {
    if (terminationError) {
      throw new AggregateError(
        [terminationError, closeOutcome.error],
        "Failed to terminate the BDD Electron process tree."
      )
    }
    throw closeOutcome.error
  }
  if (terminationError) {
    throw terminationError
  }
}

function observeBddElectronClose(
  application: Pick<BddElectronClosePort, "waitForClose">,
  timeoutMs: number
) {
  return application.waitForClose(timeoutMs).then(
    () => ({ kind: "closed" }) as const,
    (error: unknown) => ({ error, kind: "failed" }) as const
  )
}

export const systemBddProcessTreePort: BddProcessTreePort = {
  async terminate(processId, timeoutMs) {
    assertProcessId(processId)

    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/pid", String(processId), "/t", "/f"]).catch((error) => {
        if (!isMissingProcessError(error)) {
          throw error
        }
      })
      return
    }

    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid="])
    const descendants = collectDescendantProcessIds(stdout, processId)
    const processTree = [...descendants.reverse(), processId]
    for (const memberProcessId of processTree) {
      killProcess(memberProcessId)
    }
    await waitForProcessesToExit(processTree, timeoutMs)
  }
}

function assertProcessId(processId: number): void {
  if (
    !Number.isSafeInteger(processId) ||
    processId < MINIMUM_PROCESS_ID ||
    processId === process.pid
  ) {
    throw new Error("Refusing to terminate an invalid BDD Electron process tree.")
  }
}

function collectDescendantProcessIds(processList: string, rootProcessId: number): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const line of processList.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const processId = Number(match[1])
    const parentProcessId = Number(match[2])
    const children = childrenByParent.get(parentProcessId) ?? []
    children.push(processId)
    childrenByParent.set(parentProcessId, children)
  }

  const descendants: number[] = []
  const pending = [...(childrenByParent.get(rootProcessId) ?? [])]
  while (pending.length > 0) {
    const processId = pending.shift()
    if (processId === undefined) {
      continue
    }
    descendants.push(processId)
    pending.push(...(childrenByParent.get(processId) ?? []))
  }
  return descendants
}

function killProcess(processId: number): void {
  try {
    process.kill(processId, "SIGKILL")
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error
    }
  }
}

async function waitForProcessesToExit(processIds: number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (processIds.some(isProcessAlive)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out terminating the BDD Electron process tree.")
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false
    }
    throw error
  }
}

function isLockUnavailableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ELOCKED")
}

function isMissingProcessError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH")
}

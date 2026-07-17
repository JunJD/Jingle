import { randomUUID } from "node:crypto"
import type {
  ComputerUseAuthorizationGrant,
  ComputerUseBackend,
  ComputerUseObservation
} from "./contract"
import { ComputerUseAuthorizationRegistry } from "./authorization"

interface ActiveSession {
  abortController: AbortController
  runId: string
  sessionId: string
}

const MIN_SESSION_TTL_MS = 1_000
const MAX_SESSION_TTL_MS = 30 * 60_000

export class ComputerUseSessionManager {
  private readonly active = new Map<string, ActiveSession>()
  private readonly closing = new Map<string, Promise<void>>()
  private desiredEnabled = false
  private enabled = false
  private disabling: Promise<void> | null = null
  private enablementGeneration = 0

  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly authorization = new ComputerUseAuthorizationRegistry()
  ) {}

  isEnabled(): boolean {
    return this.enabled && !this.disabling
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const generation = ++this.enablementGeneration
    this.desiredEnabled = enabled
    if (enabled) {
      if (this.disabling) await this.disabling
      if (!this.enabled && this.active.size > 0) await this.startDisabling()
      if (this.desiredEnabled && this.enablementGeneration === generation) {
        this.enabled = true
      }
      return
    }
    this.enabled = false
    return this.startDisabling()
  }

  openSession(input: {
    observation: ComputerUseObservation
    runId: string
    threadId: string
    ttlMs?: number
  }): ComputerUseAuthorizationGrant {
    if (!this.isEnabled()) throw new Error("Computer use is disabled.")
    const ttlMs = input.ttlMs ?? MAX_SESSION_TTL_MS
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_SESSION_TTL_MS || ttlMs > MAX_SESSION_TTL_MS) {
      throw new Error("Computer-use session TTL must be between 1 second and 30 minutes.")
    }
    const sessionId = randomUUID()
    const grant: ComputerUseAuthorizationGrant = {
      expiresAt: Date.now() + ttlMs,
      runId: input.runId,
      sessionId,
      threadId: input.threadId,
      window: input.observation.window
    }
    this.authorization.grant(grant)
    this.active.set(sessionId, {
      abortController: new AbortController(),
      runId: input.runId,
      sessionId
    })
    return grant
  }

  assertAuthorized(input: {
    observation: ComputerUseObservation
    runId: string
    sessionId: string
    threadId: string
  }): ComputerUseAuthorizationGrant {
    if (!this.isEnabled()) throw new Error("Computer use is disabled.")
    return this.authorization.assertAuthorized(input)
  }

  async closeSession(sessionId: string): Promise<void> {
    const existingClose = this.closing.get(sessionId)
    if (existingClose) return existingClose
    const session = this.active.get(sessionId)
    if (!session) return
    session.abortController.abort(new Error("Computer-use session was closed."))
    this.authorization.revokeSession(sessionId)
    const close = this.backend
      .disposeSession(sessionId)
      .then(() => {
        this.active.delete(sessionId)
      })
      .finally(() => {
        if (this.closing.get(sessionId) === close) this.closing.delete(sessionId)
      })
    this.closing.set(sessionId, close)
    return close
  }

  signal(sessionId: string): AbortSignal {
    const session = this.active.get(sessionId)
    if (!session) throw new Error("Computer-use session is not active.")
    return session.abortController.signal
  }

  async closeRun(runId: string): Promise<void> {
    this.authorization.revokeRun(runId)
    const sessions = [...this.active.values()].filter((session) => session.runId === runId)
    await Promise.all(sessions.map((session) => this.closeSession(session.sessionId)))
  }

  private async disposeAll(): Promise<void> {
    this.authorization.clear()
    const sessions = [...this.active.values()]
    for (const session of sessions) {
      session.abortController.abort(new Error("Computer use was disabled."))
    }
    await Promise.all(sessions.map((session) => this.closeSession(session.sessionId)))
  }

  private startDisabling(): Promise<void> {
    if (this.disabling) return this.disabling
    this.disabling = this.disposeAll().finally(() => {
      this.disabling = null
    })
    return this.disabling
  }
}

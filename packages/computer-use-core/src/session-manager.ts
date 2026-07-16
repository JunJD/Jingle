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
  threadId: string
}

export class ComputerUseSessionManager {
  private readonly active = new Map<string, ActiveSession>()
  private enabled = false
  private disabling: Promise<void> | null = null

  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly authorization = new ComputerUseAuthorizationRegistry()
  ) {}

  isEnabled(): boolean {
    return this.enabled && !this.disabling
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      if (this.disabling) await this.disabling
      this.enabled = true
      return
    }
    this.enabled = false
    if (this.disabling) return this.disabling
    this.disabling = this.disposeAll().finally(() => {
      this.disabling = null
    })
    return this.disabling
  }

  openSession(input: {
    observation: ComputerUseObservation
    runId: string
    threadId: string
    ttlMs?: number
  }): ComputerUseAuthorizationGrant {
    if (!this.isEnabled()) throw new Error("Computer use is disabled.")
    const sessionId = randomUUID()
    const grant: ComputerUseAuthorizationGrant = {
      expiresAt: Date.now() + Math.max(1_000, input.ttlMs ?? 30 * 60_000),
      runId: input.runId,
      sessionId,
      threadId: input.threadId,
      window: input.observation.window
    }
    this.authorization.grant(grant)
    this.active.set(sessionId, {
      abortController: new AbortController(),
      runId: input.runId,
      sessionId,
      threadId: input.threadId
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
    this.active.get(sessionId)?.abortController.abort(
      new Error("Computer-use session was closed.")
    )
    this.authorization.revokeSession(sessionId)
    this.active.delete(sessionId)
    await this.backend.disposeSession(sessionId)
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
    const sessionIds = sessions.map((session) => session.sessionId)
    this.active.clear()
    await Promise.all(sessionIds.map((sessionId) => this.backend.disposeSession(sessionId)))
  }
}

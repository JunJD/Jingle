import type {
  ComputerUseAuthorizationGrant,
  ComputerUseObservation,
  ComputerUseWindowIdentity
} from "./contract"

function sameWindow(left: ComputerUseWindowIdentity, right: ComputerUseWindowIdentity): boolean {
  return (
    left.generation === right.generation &&
    left.nativeId === right.nativeId &&
    left.pid === right.pid &&
    left.platform === right.platform
  )
}

export class ComputerUseAuthorizationRegistry {
  private readonly grants = new Map<string, ComputerUseAuthorizationGrant>()

  grant(input: ComputerUseAuthorizationGrant): void {
    const window = Object.freeze({ ...input.window })
    this.grants.set(input.sessionId, Object.freeze({ ...input, window }))
  }

  assertAuthorized(input: {
    observation: ComputerUseObservation
    runId: string
    sessionId: string
    threadId: string
  }): ComputerUseAuthorizationGrant {
    const grant = this.grants.get(input.sessionId)
    if (!grant) throw new Error("Computer use is not authorized for this run session.")
    if (grant.expiresAt <= Date.now()) throw new Error("Computer-use authorization expired.")
    if (grant.runId !== input.runId || grant.threadId !== input.threadId) {
      throw new Error("Computer-use authorization belongs to another run.")
    }
    if (!sameWindow(grant.window, input.observation.window)) {
      throw new Error("Computer-use authorization does not match the observed window generation.")
    }
    return Object.freeze({ ...grant, window: Object.freeze({ ...grant.window }) })
  }

  revokeSession(sessionId: string): void {
    this.grants.delete(sessionId)
  }

  revokeRun(runId: string): void {
    for (const [sessionId, grant] of this.grants) {
      if (grant.runId === runId) this.grants.delete(sessionId)
    }
  }

  clear(): void {
    this.grants.clear()
  }
}

import { randomBytes } from "node:crypto"
import type { ExtensionRuntimeCacheWriterLease } from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeCacheWriterLease } from "@shared/extension-runtime-protocol"
import {
  activateExtensionRuntimeCacheWriterLease,
  releaseExtensionRuntimeCacheRetention,
  resetExtensionRuntimeCacheWriterLeases,
  revokeExtensionRuntimeCacheWrites
} from "../../../extension-runtime/cache-backend"

export interface ExtensionRuntimeCacheLeaseCoordinator {
  activate: (sessionId: string) => ExtensionRuntimeCacheWriterLease
  dispose: () => Promise<void>
  releaseRetention: (lease: ExtensionRuntimeCacheWriterLease) => Promise<void>
  revokeWrites: (lease: ExtensionRuntimeCacheWriterLease) => void
}

export class FileExtensionRuntimeCacheLeaseCoordinator implements ExtensionRuntimeCacheLeaseCoordinator {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly leases = new Map<string, ExtensionRuntimeCacheWriterLease>()
  private operationTail = Promise.resolve()

  constructor(private readonly cacheDir: string) {
    try {
      resetExtensionRuntimeCacheWriterLeases(cacheDir)
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }

  activate(sessionId: string): ExtensionRuntimeCacheWriterLease {
    if (this.disposed) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(
        new Error("Extension runtime cache lease coordinator is disposed.")
      )
    }
    try {
      const lease = normalizeExtensionRuntimeCacheWriterLease({
        sessionId,
        token: randomBytes(32).toString("hex")
      })
      activateExtensionRuntimeCacheWriterLease(this.cacheDir, lease)
      this.leases.set(sessionId, lease)
      return lease
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }

  revokeWrites(lease: ExtensionRuntimeCacheWriterLease): void {
    try {
      revokeExtensionRuntimeCacheWrites(this.cacheDir, lease)
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }

  releaseRetention(lease: ExtensionRuntimeCacheWriterLease): Promise<void> {
    return this.enqueue(async () => {
      try {
        await releaseExtensionRuntimeCacheRetention(this.cacheDir, lease)
        this.deleteLeaseIfCurrent(lease)
      } catch (cause) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
      }
    })
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.disposed = true
    this.disposePromise = this.enqueue(async () => {
      const failures: unknown[] = []
      for (const lease of Array.from(this.leases.values())) {
        try {
          await releaseExtensionRuntimeCacheRetention(this.cacheDir, lease)
          this.deleteLeaseIfCurrent(lease)
        } catch (cause) {
          failures.push(cause)
        }
      }
      if (failures.length > 0) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(
          new AggregateError(failures, "Extension runtime cache lease disposal failed.")
        )
      }
    }).catch((cause: unknown) => {
      this.disposePromise = null
      throw cause
    })
    return this.disposePromise
  }

  private deleteLeaseIfCurrent(lease: ExtensionRuntimeCacheWriterLease): void {
    if (this.leases.get(lease.sessionId)?.token === lease.token) {
      this.leases.delete(lease.sessionId)
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.catch(() => undefined)
    return result
  }
}

export class ExtensionRuntimeCacheLeaseCoordinatorError extends Error {
  readonly code = "runtime_cache_writer_lease_failed"

  constructor(cause: unknown) {
    super("Extension runtime cache writer lease coordination failed.", { cause })
    this.name = "ExtensionRuntimeCacheLeaseCoordinatorError"
  }
}

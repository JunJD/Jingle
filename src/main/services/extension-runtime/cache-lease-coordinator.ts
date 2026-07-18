import { randomBytes } from "node:crypto"
import type { ExtensionRuntimeCacheWriterLease } from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeCacheWriterLease } from "@shared/extension-runtime-protocol"
import {
  activateExtensionRuntimeCacheWriterLease,
  resetExtensionRuntimeCacheWriterLeases,
  revokeExtensionRuntimeCacheWriterLease
} from "../../../extension-runtime/cache-backend"

export interface ExtensionRuntimeCacheLeaseCoordinator {
  activate: (sessionId: string) => ExtensionRuntimeCacheWriterLease
  dispose: () => void
  revoke: (lease: ExtensionRuntimeCacheWriterLease) => void
}

export class FileExtensionRuntimeCacheLeaseCoordinator implements ExtensionRuntimeCacheLeaseCoordinator {
  private disposed = false
  private readonly leases = new Map<string, ExtensionRuntimeCacheWriterLease>()

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

  revoke(lease: ExtensionRuntimeCacheWriterLease): void {
    try {
      revokeExtensionRuntimeCacheWriterLease(this.cacheDir, lease)
      if (this.leases.get(lease.sessionId)?.token === lease.token) {
        this.leases.delete(lease.sessionId)
      }
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    try {
      resetExtensionRuntimeCacheWriterLeases(this.cacheDir)
      this.leases.clear()
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }
}

export class ExtensionRuntimeCacheLeaseCoordinatorError extends Error {
  readonly code = "runtime_cache_writer_lease_failed"

  constructor(cause: unknown) {
    super("Extension runtime cache writer lease coordination failed.", { cause })
    this.name = "ExtensionRuntimeCacheLeaseCoordinatorError"
  }
}

import { randomBytes } from "node:crypto"
import type {
  ExtensionRuntimeCacheExecutionPrincipal,
  ExtensionRuntimeCacheWriterLease
} from "@shared/extension-runtime-protocol"
import { normalizeExtensionRuntimeCacheWriterLease } from "@shared/extension-runtime-protocol"
import {
  activateExtensionRuntimeCacheWriterLease,
  releaseExtensionRuntimeCacheRetention,
  resetExtensionRuntimeCacheWriterLeases,
  revokeExtensionRuntimeCacheWrites,
  type RuntimeCacheFileBackendOptions
} from "../../../extension-runtime/cache-backend"

export interface ExtensionRuntimeCacheLeaseCoordinator {
  activate: (
    sessionId: string,
    principal: ExtensionRuntimeCacheExecutionPrincipal
  ) => Promise<ExtensionRuntimeCacheWriterLease>
  dispose: () => Promise<void>
  releaseRetention: (lease: ExtensionRuntimeCacheWriterLease) => Promise<void>
  revokeWrites: (lease: ExtensionRuntimeCacheWriterLease) => Promise<void>
}

export interface ExtensionRuntimeCacheLeaseCoordinatorOptions {
  lock?: NonNullable<RuntimeCacheFileBackendOptions["lock"]>
}

export class FileExtensionRuntimeCacheLeaseCoordinator implements ExtensionRuntimeCacheLeaseCoordinator {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly leases = new Map<string, ExtensionRuntimeCacheWriterLease>()
  private operationTail = Promise.resolve()

  constructor(
    private readonly cacheDir: string,
    private readonly options: ExtensionRuntimeCacheLeaseCoordinatorOptions = {}
  ) {
    try {
      resetExtensionRuntimeCacheWriterLeases(cacheDir)
    } catch (cause) {
      throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
    }
  }

  activate(
    sessionId: string,
    principal: ExtensionRuntimeCacheExecutionPrincipal
  ): Promise<ExtensionRuntimeCacheWriterLease> {
    return this.enqueue(async () => {
      if (this.disposed) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(
          new Error("Extension runtime cache lease coordinator is disposed.")
        )
      }
      try {
        const lease = normalizeExtensionRuntimeCacheWriterLease({
          principal,
          sessionId,
          token: randomBytes(32).toString("hex")
        })
        await activateExtensionRuntimeCacheWriterLease(this.cacheDir, lease, this.options.lock)
        this.leases.set(lease.token, lease)
        return lease
      } catch (cause) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
      }
    })
  }

  revokeWrites(lease: ExtensionRuntimeCacheWriterLease): Promise<void> {
    return this.enqueue(async () => {
      try {
        await revokeExtensionRuntimeCacheWrites(this.cacheDir, lease, this.options.lock)
      } catch (cause) {
        throw new ExtensionRuntimeCacheLeaseCoordinatorError(cause)
      }
    })
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
    if (this.leases.get(lease.token)?.sessionId === lease.sessionId) {
      this.leases.delete(lease.token)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    )
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

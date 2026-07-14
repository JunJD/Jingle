import { createHash, randomUUID } from "node:crypto"
import net from "node:net"
import process from "node:process"
import { realpath } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

const loopbackHost = "127.0.0.1"
const firstUnprivilegedPort = 1024
const unprivilegedPortCount = 65_536 - firstUnprivilegedPort
const heldLocksByToken = new Map()

export async function acquirePublishLock(targetPath) {
  const identity = await canonicalTargetIdentity(targetPath)
  const address = lockAddress(identity)
  const ownerToken = randomUUID()
  const server = net.createServer((socket) => socket.destroy())
  const lock = Object.freeze({ identity, ownerToken })
  const record = { address, error: null, lock, server, state: "acquiring" }

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen)
      server.listen({ exclusive: true, ...address }, resolveListen)
    })
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      const lockError = new Error(
        `Extension publish lock is unavailable for ${identity} at ${formatAddress(address)}. ` +
          "Another publisher or an unrelated local process may hold this address; no lock is removed automatically."
      )
      lockError.code = "JINGLE_EXTENSION_PUBLISH_LOCKED"
      lockError.publishLock = { address, identity }
      throw lockError
    }
    throw error
  }

  server.removeAllListeners("error")
  server.on("error", (error) => {
    record.error = error
  })
  record.state = "held"
  heldLocksByToken.set(ownerToken, record)
  return lock
}

export function assertPublishLockHeld(lock) {
  const record = ownedLockRecord(lock, lock?.ownerToken)
  if (record.state !== "held" || record.error !== null || !record.server.listening) {
    throw publishLockLostError(record)
  }
}

export async function releasePublishLock(lock, ownerToken) {
  const record = ownedLockRecord(lock, ownerToken)
  const releaseErrors = []
  if (record.state !== "held" || record.error !== null || !record.server.listening) {
    releaseErrors.push(publishLockLostError(record))
  }
  record.state = "releasing"

  releaseErrors.push(...(await closePublishLockServer(record.server)))
  const endpointReleased = !record.server.listening
  if (endpointReleased) {
    record.state = "released"
    heldLocksByToken.delete(ownerToken)
  } else {
    record.state = "release-failed"
    record.server.unref()
    releaseErrors.push(
      new Error(
        `Extension publish lock endpoint is still listening for ${record.lock.identity}; ` +
          "subsequent publishes remain blocked until this process exits"
      )
    )
  }

  if (releaseErrors.length > 0) {
    const releaseError = new AggregateError(
      releaseErrors,
      `Extension publish lock did not release cleanly for ${record.lock.identity}`
    )
    releaseError.code = "JINGLE_EXTENSION_PUBLISH_LOCK_RELEASE_FAILED"
    releaseError.publishLock = {
      address: record.address,
      endpointReleased,
      identity: record.lock.identity
    }
    throw releaseError
  }
}

export function formatPublishLockErrorDiagnostics(error) {
  const messages = new Set()
  const factsByEndpoint = new Map()

  visitError(error, (currentError) => {
    const facts = readPublishLockFacts(currentError)
    if (!facts) {
      return
    }
    if (currentError instanceof Error && currentError.message) {
      messages.add(currentError.message)
    }

    const endpoint = `${facts.address.host}:${facts.address.port}`
    const existing = factsByEndpoint.get(endpoint)
    if (!existing || typeof facts.endpointReleased === "boolean") {
      factsByEndpoint.set(endpoint, facts)
    }
  })

  return [
    ...[...messages].map((message) => `Publish lock error: ${message}`),
    ...[...factsByEndpoint.values()].map((facts) => {
      const endpointReleased =
        typeof facts.endpointReleased === "boolean" ? String(facts.endpointReleased) : "unknown"
      return (
        `Publish lock diagnostic: target=${facts.identity}; ` +
        `address=${facts.address.host}:${facts.address.port}; ` +
        `endpointReleased=${endpointReleased}`
      )
    })
  ]
}

async function canonicalTargetIdentity(targetPath) {
  const absolutePath = resolve(targetPath).normalize("NFC")
  const canonicalParent = await canonicalizePath(dirname(absolutePath))
  const canonicalPath = join(canonicalParent, basename(absolutePath)).normalize("NFC")
  return process.platform === "win32" || process.platform === "darwin"
    ? canonicalPath.toLowerCase()
    : canonicalPath
}

async function canonicalizePath(inputPath) {
  let existingPath = inputPath
  const missingSegments = []

  for (;;) {
    try {
      const existingRealPath = await realpath(existingPath)
      return join(existingRealPath, ...missingSegments).normalize("NFC")
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error
      }
      const parentPath = dirname(existingPath)
      if (parentPath === existingPath) {
        throw error
      }
      missingSegments.unshift(basename(existingPath))
      existingPath = parentPath
    }
  }
}

function lockAddress(identity) {
  const digest = createHash("sha256").update(identity).digest()
  return {
    host: loopbackHost,
    port: firstUnprivilegedPort + (digest.readUInt32BE(0) % unprivilegedPortCount)
  }
}

function ownedLockRecord(lock, ownerToken) {
  if (!lock || typeof lock !== "object" || typeof ownerToken !== "string") {
    throw publishLockOwnershipError(lock)
  }
  const record = heldLocksByToken.get(ownerToken)
  if (!record || record.lock !== lock || lock.ownerToken !== ownerToken) {
    throw publishLockOwnershipError(lock)
  }
  return record
}

function publishLockLostError(record) {
  const detail = record.error === null ? "" : `: ${errorMessage(record.error)}`
  const error = new Error(`Extension publish lock was lost for ${record.lock.identity}${detail}`)
  error.code = "JINGLE_EXTENSION_PUBLISH_LOCK_LOST"
  error.publishLock = { address: record.address, identity: record.lock.identity }
  return error
}

async function closePublishLockServer(server) {
  if (!server.listening) {
    return []
  }

  const closeErrors = []
  try {
    await closeServer(server)
  } catch (error) {
    closeErrors.push(error)
  }

  if (server.listening) {
    server.closeAllConnections?.()
    try {
      await closeServer(server)
    } catch (error) {
      closeErrors.push(error)
    }
  }
  return closeErrors
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)))
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function visitError(error, visitor, visited = new Set()) {
  if (!error || typeof error !== "object" || visited.has(error)) {
    return
  }
  visited.add(error)
  visitor(error)
  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) {
      visitError(nestedError, visitor, visited)
    }
  }
}

function readPublishLockFacts(error) {
  if (!error.publishLock || typeof error.publishLock !== "object") {
    return null
  }
  const { address, endpointReleased, identity } = error.publishLock
  if (
    !address ||
    typeof address !== "object" ||
    typeof address.host !== "string" ||
    typeof address.port !== "number" ||
    typeof identity !== "string"
  ) {
    return null
  }
  return { address, endpointReleased, identity }
}

function publishLockOwnershipError(lock) {
  const identity =
    lock && typeof lock === "object" && typeof lock.identity === "string"
      ? lock.identity
      : "unknown target"
  const error = new Error(`Extension publish lock release was rejected for ${identity}: not owner`)
  error.code = "JINGLE_EXTENSION_PUBLISH_LOCK_NOT_OWNER"
  return error
}

function formatAddress(address) {
  return `${address.host}:${address.port}`
}

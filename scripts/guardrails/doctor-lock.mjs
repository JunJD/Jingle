import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import process from "node:process"

function canonicalLockPath(lockPath) {
  const absolutePath = path.resolve(lockPath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  const canonicalPath = path.join(
    fs.realpathSync.native(path.dirname(absolutePath)),
    path.basename(absolutePath)
  )
  return process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath
}

function lockAddress(identity) {
  const digest = crypto.createHash("sha256").update(identity).digest()
  // Port collisions fail closed: publication integrity is preferable to lock availability.
  return {
    host: "127.0.0.1",
    port: 1024 + (digest.readUInt32BE(0) % 64_512)
  }
}

export async function acquireDoctorLock(lockPath) {
  const identity = canonicalLockPath(lockPath)
  const address = lockAddress(identity)
  const server = net.createServer((socket) => socket.destroy())
  const lock = { address, error: null, identity, server }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen({ exclusive: true, ...address }, resolve)
    })
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        `Jingle Doctor is already running for ${identity} (${address.host}:${address.port})`
      )
    }
    throw error
  }

  server.removeAllListeners("error")
  server.on("error", (error) => {
    lock.error = error
  })
  return lock
}

export function assertDoctorLockHeld(lock) {
  if (lock.error !== null || !lock.server.listening) {
    throw new Error(`Jingle Doctor lost its OS lock${lock.error === null ? "" : `: ${lock.error}`}`)
  }
}

export async function releaseDoctorLock(lock) {
  await new Promise((resolve, reject) => {
    lock.server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}

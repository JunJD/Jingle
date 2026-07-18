import assert from "node:assert/strict"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises"
import test from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BddElectronLaunchGuard,
  BddElectronCloseUnconfirmedError,
  BddElectronLeaseCompromisedError,
  BddElectronLeaseUnavailableError,
  closeBddElectronApplication,
  createJingleBddElectronLeasePort,
  systemBddProcessTreePort,
  terminateBddElectronApplication,
  type BddElectronLease,
  type BddElectronLeasePort
} from "../bdd/support/electron-launch-guard"

const LEASE_HOLDER_ENV = "JINGLE_BDD_ELECTRON_LEASE_HOLDER"
const LEASE_PATH_ENV = "JINGLE_BDD_ELECTRON_LEASE_PATH"

if (process.env[LEASE_HOLDER_ENV] === "1") {
  void runLeaseHolderProcess()
} else {
  test("a second process loses the lease before its Electron spawn callback", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "jingle-bdd-electron-lease-test-"))
    const leasePath = join(directory, "electron.lease")
    const holder = startLeaseHolderProcess(leasePath)
    let holderExited = false

    t.after(async () => {
      if (!holderExited) {
        holder.kill("SIGKILL")
      }
      await rm(directory, { force: true, recursive: true })
    })

    await waitForHolderReady(holder)

    let spawnCount = 0
    const losingGuard = new BddElectronLaunchGuard(
      createJingleBddElectronLeasePort({ leasePath, staleMs: 5_000 })
    )
    await assert.rejects(
      losingGuard.launch(
        async () => {
          spawnCount += 1
          return { processId: 1 }
        },
        async () => undefined
      ),
      BddElectronLeaseUnavailableError
    )
    assert.equal(spawnCount, 0)

    const holderExit = waitForHolderExit(holder)
    holder.stdin.end("release\n")
    const exitCode = await holderExit
    holderExited = true
    assert.equal(exitCode, 0)

    const winningGuard = new BddElectronLaunchGuard(
      createJingleBddElectronLeasePort({ leasePath, staleMs: 5_000 })
    )
    const application = await winningGuard.launch(
      async () => {
        spawnCount += 1
        return { processId: 2 }
      },
      async () => undefined
    )
    assert.deepEqual(application, { processId: 2 })
    assert.equal(spawnCount, 1)
    await winningGuard.close(async () => undefined)
  })

  test("a stale process lease is recovered within its configured bound", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "jingle-bdd-electron-stale-test-"))
    const leasePath = join(directory, "electron.lease")
    const lockPath = `${leasePath}.lock`
    t.after(() => rm(directory, { force: true, recursive: true }))

    await mkdir(lockPath)
    const oldTimestamp = new Date(Date.now() - 10_000)
    await utimes(lockPath, oldTimestamp, oldTimestamp)

    const lease = await createJingleBddElectronLeasePort({ leasePath, staleMs: 2_000 }).acquire()
    await lease.release()
  })

  test("a rejected launch releases the lease for the next launch attempt", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "jingle-bdd-electron-reject-test-"))
    const leasePath = join(directory, "electron.lease")
    t.after(() => rm(directory, { force: true, recursive: true }))

    const firstGuard = new BddElectronLaunchGuard(
      createJingleBddElectronLeasePort({ leasePath, staleMs: 5_000 })
    )
    await assert.rejects(
      firstGuard.launch(
        async () => {
          throw new Error("synthetic launch failure")
        },
        async () => undefined
      ),
      /synthetic launch failure/
    )

    const secondGuard = new BddElectronLaunchGuard(
      createJingleBddElectronLeasePort({ leasePath, staleMs: 5_000 })
    )
    assert.equal(
      await secondGuard.launch(
        async () => "launched",
        async () => undefined
      ),
      "launched"
    )
    await secondGuard.close(async () => undefined)
  })

  test("concurrent launch calls are single-flight", async () => {
    let acquireCount = 0
    let releaseCount = 0
    const leasePort: BddElectronLeasePort = {
      async acquire() {
        acquireCount += 1
        return {
          compromised: new Promise<Error>(() => undefined),
          async release() {
            releaseCount += 1
          }
        }
      }
    }
    const guard = new BddElectronLaunchGuard(leasePort)
    let finishLaunch: (application: { id: string }) => void = () => {
      throw new Error("Launch resolver was not installed.")
    }
    let spawnCount = 0
    const spawnApplication = () => {
      spawnCount += 1
      return new Promise<{ id: string }>((resolve) => {
        finishLaunch = resolve
      })
    }

    const firstLaunch = guard.launch(spawnApplication, async () => undefined)
    const secondLaunch = guard.launch(spawnApplication, async () => undefined)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(spawnCount, 1)
    finishLaunch({ id: "app" })

    const [firstApplication, secondApplication] = await Promise.all([firstLaunch, secondLaunch])
    assert.strictEqual(firstApplication, secondApplication)
    assert.equal(acquireCount, 1)
    assert.equal(releaseCount, 0)

    await guard.close(async () => undefined)
    assert.equal(releaseCount, 1)
  })

  test("restart keeps the same lease until final close", async () => {
    let acquireCount = 0
    let releaseCount = 0
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        acquireCount += 1
        return {
          compromised: new Promise<Error>(() => undefined),
          async release() {
            releaseCount += 1
          }
        }
      }
    })

    assert.equal(
      await guard.launch(
        async () => "first",
        async () => undefined
      ),
      "first"
    )
    const closed: string[] = []
    assert.equal(
      await guard.restart(
        async (application) => {
          closed.push(application)
        },
        async () => "second",
        async () => undefined
      ),
      "second"
    )
    assert.deepEqual(closed, ["first"])
    assert.equal(acquireCount, 1)
    assert.equal(releaseCount, 0)

    await guard.close(async (application) => {
      closed.push(application)
    })
    assert.deepEqual(closed, ["first", "second"])
    assert.equal(releaseCount, 1)
  })

  test("concurrent final close keeps the lease until the app has closed", async () => {
    let closeCount = 0
    let releaseCount = 0
    let finishClose: () => void = () => {
      throw new Error("Close resolver was not installed.")
    }
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        return {
          compromised: new Promise<Error>(() => undefined),
          async release() {
            releaseCount += 1
          }
        }
      }
    })
    await guard.launch(
      async () => "app",
      async () => undefined
    )

    const closeApplication = () => {
      closeCount += 1
      return new Promise<void>((resolve) => {
        finishClose = resolve
      })
    }
    const firstClose = guard.close(closeApplication)
    const secondClose = guard.close(closeApplication)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(closeCount, 1)
    assert.equal(releaseCount, 0)

    finishClose()
    await Promise.all([firstClose, secondClose])
    assert.equal(releaseCount, 1)
  })

  test("an unconfirmed process-tree exit retains the app owner and lease", async () => {
    let releaseCount = 0
    let replacementSpawnCount = 0
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        return createHealthyLease(() => {
          releaseCount += 1
        })
      }
    })
    await guard.launch(
      async () => "app",
      async () => undefined
    )

    await assert.rejects(
      guard.close(() =>
        closeBddElectronApplication(
          {
            close: async () => {
              throw new Error("graceful close failed")
            },
            processId: () => 42,
            async waitForClose() {
              throw new Error("process remained alive")
            }
          },
          {
            async terminate() {
              // The termination request was delivered but did not stop the process.
            }
          },
          5
        )
      ),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(releaseCount, 0)

    await assert.rejects(
      guard.launch(
        async () => {
          replacementSpawnCount += 1
          return "replacement"
        },
        async () => undefined
      ),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(replacementSpawnCount, 0)

    await assert.rejects(
      guard.close(async () => undefined),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(releaseCount, 0)
  })

  test("a running app is force-closed as soon as its lease is compromised", async () => {
    const controlledLease = createControlledLease()
    const forceClosed: string[] = []
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        return controlledLease.lease
      }
    })
    await guard.launch(
      async () => "app",
      async (application) => {
        forceClosed.push(application)
      }
    )

    controlledLease.compromise(new Error("synthetic compromise"))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(forceClosed, ["app"])
    await assert.rejects(
      guard.launch(
        async () => "replacement",
        async () => undefined
      ),
      BddElectronLeaseCompromisedError
    )
    await assert.rejects(
      guard.close(async () => undefined),
      BddElectronLeaseCompromisedError
    )
  })

  test("a pending spawn is closed when it returns after lease compromise", async () => {
    const controlledLease = createControlledLease()
    let finishSpawn: (application: string) => void = () => {
      throw new Error("Spawn resolver was not installed.")
    }
    let finishForcedClose: () => void = () => {
      throw new Error("Forced-close resolver was not installed.")
    }
    const forcedClose = new Promise<void>((resolve) => {
      finishForcedClose = resolve
    })
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        return controlledLease.lease
      }
    })
    const launch = guard.launch(
      () =>
        new Promise<string>((resolve) => {
          finishSpawn = resolve
        }),
      async () => {
        finishForcedClose()
      }
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    controlledLease.compromise(new Error("synthetic pending compromise"))
    await assert.rejects(launch, BddElectronLeaseCompromisedError)
    finishSpawn("late-app")
    await forcedClose
    await assert.rejects(
      guard.launch(
        async () => "replacement",
        async () => undefined
      ),
      BddElectronLeaseCompromisedError
    )
  })

  test("close timeout delegates the full process tree to the termination port", async () => {
    const terminatedProcessIds: number[] = []
    const waitTimeouts: number[] = []

    await closeBddElectronApplication(
      {
        close: () => new Promise<void>(() => undefined),
        processId: () => 42,
        async waitForClose(timeoutMs) {
          waitTimeouts.push(timeoutMs)
          if (waitTimeouts.length === 1) {
            throw new Error("graceful close timed out")
          }
        }
      },
      {
        async terminate(processId) {
          terminatedProcessIds.push(processId)
        }
      },
      5
    )

    assert.deepEqual(terminatedProcessIds, [42])
    assert.deepEqual(waitTimeouts, [5, 5])
  })

  test("a resolved graceful-close request still requires observed process exit", async () => {
    let waitCount = 0
    let terminationCount = 0
    await closeBddElectronApplication(
      {
        close: async () => undefined,
        processId: () => 42,
        async waitForClose() {
          waitCount += 1
          if (waitCount === 1) {
            throw new Error("close event was not observed")
          }
        }
      },
      {
        async terminate() {
          terminationCount += 1
        }
      },
      5
    )

    assert.equal(terminationCount, 1)
    assert.equal(waitCount, 2)
  })

  test("process-tree termination must be followed by observed process exit", async () => {
    await assert.rejects(
      terminateBddElectronApplication(
        {
          processId: () => 42,
          async waitForClose() {
            throw new Error("process remained alive")
          }
        },
        {
          async terminate() {
            // Delivery alone is not proof that the process exited.
          }
        },
        5
      ),
      /process remained alive/
    )
  })

  test("root exit cannot override a process-tree termination failure", async () => {
    let releaseCount = 0
    let replacementSpawnCount = 0
    let waitCount = 0
    const guard = new BddElectronLaunchGuard<string>({
      async acquire() {
        return createHealthyLease(() => {
          releaseCount += 1
        })
      }
    })
    await guard.launch(
      async () => "app",
      async () => undefined
    )

    await assert.rejects(
      guard.close(() =>
        closeBddElectronApplication(
          {
            close: async () => {
              throw new Error("graceful close failed")
            },
            processId: () => 42,
            async waitForClose() {
              waitCount += 1
              if (waitCount === 1) {
                throw new Error("graceful close was not observed")
              }
            }
          },
          {
            async terminate() {
              throw new Error("descendant termination failed")
            }
          },
          5
        )
      ),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(releaseCount, 0)

    await assert.rejects(
      guard.launch(
        async () => {
          replacementSpawnCount += 1
          return "replacement"
        },
        async () => undefined
      ),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(replacementSpawnCount, 0)

    await assert.rejects(
      guard.close(async () => undefined),
      BddElectronCloseUnconfirmedError
    )
    assert.equal(releaseCount, 0)
  })

  test("the system process-tree port terminates a pure Node parent and child", async (t) => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { spawn } = require("node:child_process")',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })',
          "process.stdout.write(`${child.pid}\\n`)",
          "setInterval(() => {}, 1000)"
        ].join("; ")
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    )
    let childProcessId = 0
    t.after(() => {
      killIfAlive(childProcessId)
      killIfAlive(parent.pid ?? 0)
    })

    childProcessId = await readFirstProcessId(parent)
    const parentExit = waitForHolderExit(parent)
    await systemBddProcessTreePort.terminate(parent.pid ?? 0, 5_000)
    await parentExit

    assert.equal(isProcessAliveForTest(parent.pid ?? 0), false)
    assert.equal(isProcessAliveForTest(childProcessId), false)
  })
}

async function runLeaseHolderProcess(): Promise<void> {
  const leasePath = process.env[LEASE_PATH_ENV]
  if (!leasePath) {
    throw new Error("Lease holder process did not receive a lease path.")
  }

  const lease = await createJingleBddElectronLeasePort({ leasePath, staleMs: 5_000 }).acquire()
  process.stdout.write("ready\n")
  process.stdin.resume()
  process.stdin.once("data", () => {
    void lease.release().then(
      () => {
        process.exitCode = 0
        process.stdin.pause()
      },
      (error: unknown) => {
        process.stderr.write(`${String(error)}\n`)
        process.exitCode = 1
        process.stdin.pause()
      }
    )
  })
}

function startLeaseHolderProcess(leasePath: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [require.resolve("tsx/cli"), __filename], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [LEASE_HOLDER_ENV]: "1",
      [LEASE_PATH_ENV]: leasePath
    },
    stdio: ["pipe", "pipe", "pipe"]
  })
}

function waitForHolderReady(holder: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8")
      if (stdout.includes("ready\n")) {
        cleanup()
        resolve()
      }
    }
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8")
    }
    const onExit = (code: number | null): void => {
      cleanup()
      reject(new Error(`Lease holder exited before ready (${String(code)}): ${stderr}`))
    }
    const cleanup = (): void => {
      holder.stdout.off("data", onStdout)
      holder.stderr.off("data", onStderr)
      holder.off("exit", onExit)
    }

    holder.stdout.on("data", onStdout)
    holder.stderr.on("data", onStderr)
    holder.once("exit", onExit)
  })
}

function waitForHolderExit(holder: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => holder.once("exit", resolve))
}

function readFirstProcessId(process: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8")
      const line = stdout.split("\n")[0]
      if (!/^\d+$/.test(line)) {
        return
      }
      cleanup()
      resolve(Number(line))
    }
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8")
    }
    const onExit = (code: number | null): void => {
      cleanup()
      reject(new Error(`Process-tree fixture exited before ready (${String(code)}): ${stderr}`))
    }
    const cleanup = (): void => {
      process.stdout.off("data", onStdout)
      process.stderr.off("data", onStderr)
      process.off("exit", onExit)
    }

    process.stdout.on("data", onStdout)
    process.stderr.on("data", onStderr)
    process.once("exit", onExit)
  })
}

function killIfAlive(processId: number): void {
  if (!isProcessAliveForTest(processId)) {
    return
  }
  process.kill(processId, "SIGKILL")
}

function isProcessAliveForTest(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId < 2 || processId === process.pid) {
    return false
  }
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return false
    }
    throw error
  }
}

function createHealthyLease(onRelease: () => void = () => undefined): BddElectronLease {
  return {
    compromised: new Promise<Error>(() => undefined),
    async release() {
      onRelease()
    }
  }
}

function createControlledLease(): {
  compromise: (error: Error) => void
  lease: BddElectronLease
} {
  let compromise: (error: Error) => void = () => {
    throw new Error("Compromise reporter was not installed.")
  }
  const compromised = new Promise<Error>((resolve) => {
    compromise = resolve
  })
  return {
    compromise,
    lease: {
      compromised,
      async release() {
        // The fake lease lets close surface the guard's permanent terminal state.
      }
    }
  }
}

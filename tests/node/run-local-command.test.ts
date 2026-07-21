import assert from "node:assert/strict"
import { join } from "node:path"
import test from "node:test"
import { LocalCommandError, runLocalCommand } from "../../scripts/lib/run-local-command.mjs"
import { createJinglePreviewInvocation } from "../../scripts/start-jingle-preview.mjs"

interface LocalCommandFailure {
  commandName: string
  failure: Readonly<{
    exitCode?: number | null
    kind: "exited" | "spawn-failed"
    signal?: NodeJS.Signals | null
    systemCode?: string
  }>
  message: string
}

function collectInspectableText(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || typeof value !== "object") return String(value)
  if (seen.has(value)) return "[circular]"
  seen.add(value)

  return Reflect.ownKeys(value)
    .map((key) => `${String(key)}:${collectInspectableText(Reflect.get(value, key), seen)}`)
    .join("\n")
}

test("passes preview configuration only through the child environment", () => {
  const sourceEnvironment = { PATH: "/example/bin", UNRELATED: "kept" }
  const previewExecutablePath = join("example", "Jingle.app", "Contents", "MacOS", "Electron")

  const invocation = createJinglePreviewInvocation(previewExecutablePath, sourceEnvironment)

  assert.deepEqual(invocation, {
    args: ["scripts/run-with-dotenv.mjs", "production", "--", "electron-vite", "preview"],
    command: "node",
    options: {
      displayName: "Jingle preview",
      env: {
        ELECTRON_EXEC_PATH: previewExecutablePath,
        JINGLE_REGISTER_DEV_PROTOCOL_CLIENT: "1",
        PATH: "/example/bin",
        UNRELATED: "kept"
      }
    }
  })
  assert.equal(
    invocation.args.some((argument) => argument.includes(previewExecutablePath)),
    false
  )
  assert.equal(
    invocation.args.some((argument) => argument.includes("ELECTRON_EXEC_PATH")),
    false
  )
  assert.equal(
    invocation.args.some((argument) => argument.includes("JINGLE_REGISTER_DEV_PROTOCOL_CLIENT")),
    false
  )
  assert.deepEqual(sourceEnvironment, { PATH: "/example/bin", UNRELATED: "kept" })
})

test("requires a static command display name", () => {
  assert.throws(
    () => runLocalCommand(process.execPath, ["-e", "process.exit(0)"]),
    /requires a static displayName/
  )
})

test("does not expose command arguments when a child exits unsuccessfully", async () => {
  const sensitiveArgument = "sensitive-fixture-value"

  await assert.rejects(
    runLocalCommand(process.execPath, ["-e", "process.exit(7)", sensitiveArgument], {
      displayName: "fixture command"
    }),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandError)
      const commandError = error as LocalCommandFailure
      assert.equal(commandError.message, "fixture command exited with code 7.")
      assert.equal(commandError.commandName, "fixture command")
      assert.deepEqual(commandError.failure, { exitCode: 7, kind: "exited", signal: null })
      assert.equal(collectInspectableText(commandError).includes(sensitiveArgument), false)
      return true
    }
  )
})

test("reports spawn failures without exposing command arguments", async () => {
  const sensitiveArgument = "another-sensitive-fixture-value"

  await assert.rejects(
    runLocalCommand(join(process.cwd(), "missing-local-command"), [sensitiveArgument], {
      displayName: "missing fixture"
    }),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandError)
      const commandError = error as LocalCommandFailure
      assert.equal(commandError.message, "missing fixture could not start (ENOENT).")
      assert.equal(commandError.commandName, "missing fixture")
      assert.deepEqual(commandError.failure, { kind: "spawn-failed", systemCode: "ENOENT" })
      assert.equal(collectInspectableText(commandError).includes(sensitiveArgument), false)
      assert.equal("cause" in commandError, false)
      return true
    }
  )
})

test("redacts arguments when spawn rejects synchronously", async () => {
  const sensitiveMarker = "synchronous-sensitive-fixture-value"
  const invalidArgument = `${sensitiveMarker}\0`

  await assert.rejects(
    runLocalCommand(process.execPath, [invalidArgument], { displayName: "invalid fixture" }),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandError)
      const commandError = error as LocalCommandFailure
      assert.equal(commandError.message, "invalid fixture could not start (ERR_INVALID_ARG_VALUE).")
      assert.deepEqual(commandError.failure, {
        kind: "spawn-failed",
        systemCode: "ERR_INVALID_ARG_VALUE"
      })
      assert.equal(collectInspectableText(commandError).includes(sensitiveMarker), false)
      assert.equal("cause" in commandError, false)
      return true
    }
  )
})

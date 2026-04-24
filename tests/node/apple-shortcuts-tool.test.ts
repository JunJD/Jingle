import assert from "node:assert/strict"
import test from "node:test"
import {
  APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS,
  listAppleShortcuts,
  normalizeAppleShortcutsCommandError,
  parseAppleShortcutsList,
  parseRunAppleShortcutRequest,
  runAppleShortcut
} from "../../src/main/services/apple-shortcuts"

test("parseAppleShortcutsList trims blank lines", () => {
  assert.deepEqual(parseAppleShortcutsList("打开App\n\n播放今日推荐\n"), [
    "打开App",
    "播放今日推荐"
  ])
})

test("parseRunAppleShortcutRequest requires a non-empty shortcut name", () => {
  assert.throws(() => parseRunAppleShortcutRequest({}), /name/)
  assert.throws(() => parseRunAppleShortcutRequest({ name: " " }), /name/)
})

test("listAppleShortcuts returns parsed shortcut names", async () => {
  const shortcutNames = await listAppleShortcuts({
    platform: "darwin",
    run: async (args) => {
      assert.deepEqual(args, ["list"])
      return {
        stderr: "",
        stdout: "打开App\n播放今日推荐\n"
      }
    }
  })

  assert.deepEqual(shortcutNames, ["打开App", "播放今日推荐"])
})

test("runAppleShortcut invokes shortcuts CLI with the provided name", async () => {
  const result = await runAppleShortcut(
    { name: "播放今日推荐" },
    {
      platform: "darwin",
      run: async (args) => {
        assert.deepEqual(args, ["run", "播放今日推荐"])
        return {
          stderr: "",
          stdout: "ok\n"
        }
      }
    }
  )

  assert.deepEqual(result, {
    name: "播放今日推荐",
    output: "ok"
  })
})

test("Apple Shortcuts service is macOS-only", async () => {
  await assert.rejects(
    () =>
      listAppleShortcuts({
        platform: "linux",
        run: async () => ({
          stderr: "",
          stdout: ""
        })
      }),
    /macOS/
  )
})

test("runAppleShortcut surfaces a bounded timeout error", async () => {
  const timeoutError = Object.assign(new Error("timed out"), {
    code: "ETIMEDOUT"
  })

  assert.equal(APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS, 15_000)
  assert.match(
    normalizeAppleShortcutsCommandError(timeoutError).message,
    new RegExp(`${APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS}ms`)
  )
})

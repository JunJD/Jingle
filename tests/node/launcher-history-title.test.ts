import assert from "node:assert/strict"
import test from "node:test"
import { getLauncherApplicationHistoryTitle } from "../../src/main/launcher/history-title"

test("application history title prefers the system display name", async () => {
  const title = await getLauncherApplicationHistoryTitle(
    "/Applications/WeChat.app",
    async () => "微信"
  )

  assert.equal(title, "微信")
})

test("application history title falls back to the bundle filename", async () => {
  const title = await getLauncherApplicationHistoryTitle(
    "/Applications/WeChat.app",
    async () => undefined
  )

  assert.equal(title, "WeChat")
})

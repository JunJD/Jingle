import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const originalHome = process.env.HOME
const originalOpenworkHome = process.env.OPENWORK_HOME

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

test("global workspace defaults to the Jingle documents folder", async () => {
  const testHome = mkdtempSync(join(tmpdir(), "jingle-default-workspace-home-"))
  const openworkHome = mkdtempSync(join(tmpdir(), "jingle-default-workspace-store-"))
  process.env.HOME = testHome
  process.env.OPENWORK_HOME = openworkHome

  try {
    const preferences = await import("../../src/main/preferences")
    const expectedWorkspacePath = join(testHome, "Documents", "Jingle")

    assert.equal(preferences.getGlobalWorkspacePath(), expectedWorkspacePath)
    assert.equal(existsSync(expectedWorkspacePath), true)

    const explicitWorkspacePath = join(openworkHome, "explicit-workspace")
    preferences.setGlobalWorkspacePath(explicitWorkspacePath)

    assert.equal(preferences.getGlobalWorkspacePath(), explicitWorkspacePath)
  } finally {
    restoreEnvValue("HOME", originalHome)
    restoreEnvValue("OPENWORK_HOME", originalOpenworkHome)
    rmSync(testHome, { force: true, recursive: true })
    rmSync(openworkHome, { force: true, recursive: true })
  }
})

test("agent config defaults follow-up behavior to queue and normalizes updates", async () => {
  const openworkHome = mkdtempSync(join(tmpdir(), "jingle-agent-config-store-"))
  process.env.OPENWORK_HOME = openworkHome

  try {
    const preferences = await import("../../src/main/preferences")
    assert.equal(preferences.getAgentConfig().followUpMode, "queue")
    assert.equal(preferences.setAgentConfig({ followUpMode: "steer" }).followUpMode, "steer")
  } finally {
    restoreEnvValue("OPENWORK_HOME", originalOpenworkHome)
    rmSync(openworkHome, { force: true, recursive: true })
  }
})

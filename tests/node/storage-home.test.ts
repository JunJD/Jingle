import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const originalJingleHome = process.env.JINGLE_HOME
const STORAGE_PATH_SCRIPT =
  "require('tsx/cjs'); const { getDbPath } = require('./src/main/storage.ts'); console.log(getDbPath())"

function restoreEnv(): void {
  restoreEnvValue("JINGLE_HOME", originalJingleHome)
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

test.afterEach(() => {
  restoreEnv()
})

test("JINGLE_HOME owns new Jingle storage paths", async () => {
  const jingleHome = mkdtempSync(join(tmpdir(), "jingle-home-storage-"))
  process.env.JINGLE_HOME = jingleHome

  try {
    const { getDbPath, getJingleDbPath, getJingleEnvFilePath, getJingleHomeDir } =
      await import("../../src/main/storage")

    assert.equal(getJingleHomeDir(), jingleHome)
    assert.equal(getJingleDbPath(), join(jingleHome, "jingle.sqlite"))
    assert.equal(getDbPath(), join(jingleHome, "jingle.sqlite"))
    assert.equal(getJingleEnvFilePath(), join(jingleHome, ".env"))
    assert.equal(existsSync(jingleHome), true)
  } finally {
    rmSync(jingleHome, { force: true, recursive: true })
  }
})

test("fresh installs default to ~/.jingle/jingle.sqlite", async () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), "jingle-fresh-home-"))

  try {
    const output = execFileSync(
      process.execPath,
      ["-e", STORAGE_PATH_SCRIPT],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: isolatedHome,
          JINGLE_HOME: ""
        }
      }
    ).trim()

    assert.equal(output, join(isolatedHome, ".jingle", "jingle.sqlite"))
  } finally {
    rmSync(isolatedHome, { force: true, recursive: true })
  }
})

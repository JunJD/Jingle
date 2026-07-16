import assert from "node:assert/strict"
import { test } from "node:test"
import { join, sep } from "node:path"
import { resolveNativeBinaryPath } from "../../src/main/services/native-binary-path"

function createCandidates() {
  return {
    appPath: join(
      sep,
      "Applications",
      "Jingle",
      "resources",
      "app.asar",
      "out",
      "native",
      "helper"
    ),
    compiledPath: join(
      sep,
      "Applications",
      "Jingle",
      "resources",
      "app.asar",
      "out",
      "native",
      "helper"
    ),
    cwdPath: join(sep, "tmp", "untrusted-project", "out", "native", "helper")
  }
}

test("packaged native helpers resolve only from the unpacked application bundle", () => {
  const candidates = createCandidates()
  const expected = candidates.appPath.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`
  )

  assert.equal(
    resolveNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === expected,
      isPackaged: true
    }),
    expected
  )
})

test("packaged native helpers never fall back to the process working directory", () => {
  const candidates = createCandidates()
  const inspected: string[] = []

  assert.equal(
    resolveNativeBinaryPath({
      candidates,
      exists: (candidate) => {
        inspected.push(candidate)
        return candidate === candidates.cwdPath
      },
      isPackaged: true
    }),
    null
  )
  assert.equal(inspected.includes(candidates.cwdPath), false)
})

test("packaged native helpers fail closed when only the asar entry exists", () => {
  const candidates = createCandidates()

  assert.equal(
    resolveNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === candidates.appPath,
      isPackaged: true
    }),
    null
  )
})

test("packaged native helpers replace the application asar segment nearest the binary", () => {
  const candidates = createCandidates()
  const ancestorAsarPath = join(sep, "Volumes", "app.asar", candidates.appPath)
  const scopedCandidates = {
    ...candidates,
    appPath: ancestorAsarPath
  }
  const expected = ancestorAsarPath.replace(
    `${sep}app.asar${sep}out${sep}native${sep}`,
    `${sep}app.asar.unpacked${sep}out${sep}native${sep}`
  )

  assert.equal(
    resolveNativeBinaryPath({
      candidates: scopedCandidates,
      exists: (candidate) => candidate === expected,
      isPackaged: true
    }),
    expected
  )
})

test("development native helpers preserve the working-directory build fallback", () => {
  const candidates = createCandidates()

  assert.equal(
    resolveNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === candidates.cwdPath,
      isPackaged: false
    }),
    candidates.cwdPath
  )
})

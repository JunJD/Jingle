import assert from "node:assert/strict"
import { join, sep } from "node:path"
import { test } from "node:test"
import { resolveAppleRemindersNativeBinaryPath } from "../../installable-extensions/apple-reminders/main/native-binary-path"

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
      "jingle-apple-reminders"
    ),
    compiledPath: join(
      sep,
      "Applications",
      "Jingle",
      "resources",
      "app.asar",
      "out",
      "resources",
      "installed-extensions",
      "apple-reminders",
      "native",
      "jingle-apple-reminders"
    ),
    cwdPath: join(sep, "tmp", "untrusted-project", "out", "native", "jingle-apple-reminders")
  }
}

test("packaged Apple Reminders resolves only an unpacked application-owned helper", () => {
  const candidates = createCandidates()
  const expected = candidates.appPath.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`
  )

  assert.equal(
    resolveAppleRemindersNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === expected,
      isPackaged: true
    }),
    expected
  )
})

test("packaged Apple Reminders never inspects the process working directory", () => {
  const candidates = createCandidates()
  const inspected: string[] = []

  assert.equal(
    resolveAppleRemindersNativeBinaryPath({
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

test("packaged Apple Reminders fails closed when only the asar entry exists", () => {
  const candidates = createCandidates()

  assert.equal(
    resolveAppleRemindersNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === candidates.appPath,
      isPackaged: true
    }),
    null
  )
})

test("packaged Apple Reminders rewrites the application asar segment nearest the helper", () => {
  const candidates = createCandidates()
  const ancestorAsarPath = join(sep, "Volumes", "app.asar", candidates.compiledPath)
  const scopedCandidates = {
    ...candidates,
    compiledPath: ancestorAsarPath
  }
  const expected = ancestorAsarPath.replace(
    `${sep}app.asar${sep}out${sep}resources${sep}`,
    `${sep}app.asar.unpacked${sep}out${sep}resources${sep}`
  )

  assert.equal(
    resolveAppleRemindersNativeBinaryPath({
      candidates: scopedCandidates,
      exists: (candidate) => candidate === expected,
      isPackaged: true
    }),
    expected
  )
})

test("development Apple Reminders preserves the working-directory build fallback", () => {
  const candidates = createCandidates()

  assert.equal(
    resolveAppleRemindersNativeBinaryPath({
      candidates,
      exists: (candidate) => candidate === candidates.cwdPath,
      isPackaged: false
    }),
    candidates.cwdPath
  )
})

import assert from "node:assert/strict"
import { join, sep } from "node:path"
import test from "node:test"
import { resolveRipgrepExecutablePath } from "@jingle/langchain-agent-harness/ripgrep-executable"

const binaryName = process.platform === "win32" ? "rg.exe" : "rg"
const packagedSuffix = join(
  "node_modules",
  `@vscode/ripgrep-${process.platform}-${process.arch}`,
  "bin",
  binaryName
)

test("leaves the development ripgrep executable path unchanged", () => {
  const developmentPath = join(sep, "workspace", packagedSuffix)

  assert.equal(
    resolveRipgrepExecutablePath({
      candidatePath: developmentPath,
      resourcesPath: join(sep, "Applications", "Jingle.app", "Contents", "Resources")
    }),
    developmentPath
  )
})

test("maps the nearest complete app.asar segment to app.asar.unpacked", () => {
  const packagedPath = join(
    sep,
    "Volumes",
    "app.asar",
    "Jingle.app",
    "Contents",
    "Resources",
    "app.asar",
    packagedSuffix
  )

  assert.equal(
    resolveRipgrepExecutablePath({
      candidatePath: packagedPath,
      resourcesPath: join(sep, "Volumes", "app.asar", "Jingle.app", "Contents", "Resources")
    }),
    join(
      sep,
      "Volumes",
      "app.asar",
      "Jingle.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      packagedSuffix
    )
  )
})

test("does not rewrite an already unpacked ripgrep executable path", () => {
  const unpackedPath = join(
    sep,
    "Applications",
    "Jingle.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    packagedSuffix
  )

  assert.equal(
    resolveRipgrepExecutablePath({
      candidatePath: unpackedPath,
      resourcesPath: join(sep, "Applications", "Jingle.app", "Contents", "Resources")
    }),
    unpackedPath
  )
})

test("does not rewrite a different app.asar tree", () => {
  const unrelatedPath = join(sep, "Volumes", "app.asar", packagedSuffix)

  assert.equal(
    resolveRipgrepExecutablePath({
      candidatePath: unrelatedPath,
      resourcesPath: join(sep, "Applications", "Jingle.app", "Contents", "Resources")
    }),
    unrelatedPath
  )
})

test("leaves the executable path unchanged outside Electron", () => {
  const candidatePath = join(sep, "Applications", "Jingle.app", "app.asar", packagedSuffix)

  assert.equal(resolveRipgrepExecutablePath({ candidatePath }), candidatePath)
})

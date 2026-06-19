import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LocalSandbox } from "../../src/main/agent/local-sandbox"

async function withWorkspace(run: (workspacePath: string) => Promise<void>): Promise<void> {
  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-local-sandbox-"))

  try {
    await run(workspacePath)
  } finally {
    await rm(workspacePath, { force: true, recursive: true })
  }
}

test("default filesystem searches resolve to the workspace root", async () => {
  await withWorkspace(async (workspacePath) => {
    await mkdir(join(workspacePath, "src"), { recursive: true })
    await writeFile(join(workspacePath, "src", "target.ts"), "export const marker = 'needle'\n")

    const sandbox = new LocalSandbox({ rootDir: workspacePath, virtualMode: false })

    const matches = await sandbox.grepRaw("needle")
    assert.ok(Array.isArray(matches))
    assert.deepEqual(
      matches.map((match) => match.path),
      [join(workspacePath, "src", "target.ts")]
    )

    const entries = await sandbox.lsInfo()
    assert.deepEqual(
      entries.map((entry) => entry.path),
      [join(workspacePath, "src/")]
    )
  })
})

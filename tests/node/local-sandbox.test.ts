import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LocalSandbox } from "../../src/main/agent/local-sandbox"

async function withWorkspace(run: (workspacePath: string) => Promise<void>): Promise<void> {
  const workspacePath = await mkdtemp(join(tmpdir(), "jingle-local-sandbox-"))

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

test("execute runs commands from an explicit workspace cwd", async () => {
  await withWorkspace(async (workspacePath) => {
    await mkdir(join(workspacePath, "src"), { recursive: true })
    const sandbox = new LocalSandbox({ rootDir: workspacePath, virtualMode: false })

    const result = await sandbox.execute("pwd && printf hello > out.txt", { cwd: "src" })

    assert.equal(result.exitCode, 0)
    assert.match(result.output, new RegExp(`${join(workspacePath, "src").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.equal(await readFile(join(workspacePath, "src", "out.txt"), "utf8"), "hello")
  })
})

test("execute can run from an approved cwd outside the workspace", async () => {
  await withWorkspace(async (workspacePath) => {
    const outsidePath = await mkdtemp(join(tmpdir(), "jingle-local-sandbox-outside-"))
    const sandbox = new LocalSandbox({ rootDir: workspacePath, virtualMode: false })

    try {
      const result = await sandbox.execute("printf hello > outside.txt", { cwd: outsidePath })

      assert.equal(result.exitCode, 0)
      assert.equal(await readFile(join(outsidePath, "outside.txt"), "utf8"), "hello")
    } finally {
      await rm(outsidePath, { force: true, recursive: true })
    }
  })
})

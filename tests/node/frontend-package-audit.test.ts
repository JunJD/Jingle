import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import test from "node:test"

const execFileAsync = promisify(execFile)
const auditScript = resolve("scripts/audit-frontend-package-relations.mjs")

test("frontend package audit distinguishes internal aliases from workspace packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-frontend-package-audit-"))

  try {
    await mkdir(join(root, "extensions", "ui", "src"), { recursive: true })
    await mkdir(join(root, "src", "shared"), { recursive: true })
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "jingle", dependencies: {}, devDependencies: {}, scripts: {} })
    )
    await writeFile(
      join(root, "extensions", "ui", "package.json"),
      JSON.stringify({ name: "@workspace/ui" })
    )
    await writeFile(join(root, "extensions", "ui", "src", "index.ts"), "export default 1\n")
    await writeFile(
      join(root, "tsconfig.base.json"),
      `{
        // The audit must accept the same JSONC syntax as TypeScript.
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "jingle/*": ["src/*"],
            "@workspace/*": ["extensions/*/src/index.ts"],
          },
        },
      }
`
    )
    await writeFile(join(root, "frontend.tsconfig.json"), '{ "extends": "./tsconfig.base.json" }\n')
    await writeFile(join(root, "src", "shared", "value.ts"), "export const value = 1\n")
    await writeFile(
      join(root, "src", "index.ts"),
      'import { value } from "jingle/shared/value"\nimport workspace from "@workspace/ui"\nimport missing from "missing-package"\nvoid value\nvoid workspace\nvoid missing\n'
    )

    const auditArgs = [
      auditScript,
      "--root",
      root,
      "--frontend",
      "src",
      "--tsconfig",
      "frontend.tsconfig.json"
    ]
    await assert.rejects(
      execFileAsync(process.execPath, [...auditArgs, "--json"]),
      (error: unknown) => {
        const stdout = (error as { stdout?: string }).stdout ?? ""
        const report = JSON.parse(stdout) as { missingDeclarations: string[] }
        assert.deepEqual(report.missingDeclarations, ["@workspace/ui", "missing-package"])
        return true
      }
    )
    await assert.rejects(execFileAsync(process.execPath, auditArgs), (error: unknown) => {
      const stdout = (error as { stdout?: string }).stdout ?? ""
      assert.match(stdout, /missing declarations:\n- @workspace\/ui\n- missing-package/)
      return true
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

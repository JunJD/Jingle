import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createIgnoredBackupPath,
  formatUsage,
  parseMigrateExtensionArgs,
  resolveMigrationRunPlan,
  runMigrateExtensionPlan
} from "../../scripts/migrate-extension.mjs"

test("extension migration harness parses shell apply verify options", () => {
  const options = parseMigrateExtensionArgs([
    "github",
    "--mode",
    "shell",
    "--apply",
    "--verify",
    "--typecheck-node",
    "--git-ref",
    "main",
    "--raycast-repo",
    "../raycast"
  ])

  assert.equal(options.target, "github")
  assert.equal(options.mode, "shell")
  assert.equal(options.apply, true)
  assert.equal(options.verify, true)
  assert.equal(options.typecheckNode, true)
  assert.equal(options.gitRef, "main")
  assert.equal(options.raycastRepo, "../raycast")
})

test("extension migration harness resolves known target preview and verification commands", () => {
  const plan = resolveMigrationRunPlan(
    parseMigrateExtensionArgs(["apple-reminders", "--verify", "--typecheck-node"]),
    {
      cwd: "/repo/openwork",
      env: {
        OPENWORK_RAYCAST_EXTENSIONS_REPO: "../raycast-source"
      }
    }
  )

  assert.equal(plan.extensionId, "apple-reminders")
  assert.equal(plan.extensionPath, "extensions/apple-reminders")
  assert.equal(plan.mode, "shell")
  assert.equal(plan.apply, false)
  assert.equal(plan.raycastRepo, "/repo/raycast-source")
  assert.deepEqual(plan.verifyCommands, [
    ["npm", "run", "check:extensions"],
    ["npm", "run", "check:guardrails"],
    ["npm", "run", "typecheck:node"]
  ])
  assert.equal(plan.previewArgs.includes("--target-extension-id"), true)
  assert.equal(plan.previewArgs.includes("apple-reminders"), true)
  assert.equal(plan.previewArgs.includes("--target-extension-title"), true)
  assert.equal(plan.previewArgs.includes("Apple Reminders"), true)
  assert.equal(plan.previewArgs.includes("--host-entry-mode"), true)
  assert.equal(plan.previewArgs.at(-1), "shell")
})

test("extension migration harness creates stable ignored backup paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-backup-"))
  try {
    const ignoredRoot = join(root, ".ignored-extensions")
    await mkdir(join(ignoredRoot, "github"), { recursive: true })

    const backup = createIgnoredBackupPath(
      ignoredRoot,
      "github",
      new Date("2026-06-02T12:34:56.000Z")
    )

    assert.equal(backup, join(ignoredRoot, "github-20260602-123456"))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("extension migration harness dry-run generates without applying package", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-dry-"))
  try {
    const outDir = join(root, ".ow-build", "extension-migration", "github", "shell")
    const plan = {
      apply: false,
      cwd: root,
      destinationDir: join(root, "extensions", "github"),
      extensionId: "github",
      extensionPath: "extensions/github",
      generatedPackageDir: join(outDir, "openwork-package"),
      ignoredRoot: join(root, ".ignored-extensions"),
      mode: "shell",
      outDir,
      previewArgs: ["scripts/preview-raycast-ai-migration.mjs"],
      verifyCommands: []
    }

    const commands: string[][] = []
    runMigrateExtensionPlan(plan as any, {
      execFileSync: (command: string, args: string[]) => {
        assert.equal(command, process.execPath)
        assert.deepEqual(args, plan.previewArgs)
        commands.push([command, ...args])
        mkdirSync(plan.generatedPackageDir, { recursive: true })
      }
    })

    assert.equal(existsSync(plan.destinationDir), false)
    assert.deepEqual(commands, [[process.execPath, ...plan.previewArgs]])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("extension migration harness refuses to clear repository source directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-outdir-"))
  try {
    for (const outDir of [
      root,
      join(root, "docs"),
      join(root, "src"),
      join(root, "extensions", "github")
    ]) {
      const plan = {
        apply: false,
        cwd: root,
        destinationDir: join(root, "extensions", "github"),
        extensionId: "github",
        extensionPath: "extensions/github",
        generatedPackageDir: join(outDir, "openwork-package"),
        ignoredRoot: join(root, ".ignored-extensions"),
        mode: "shell",
        outDir,
        previewArgs: ["scripts/preview-raycast-ai-migration.mjs"],
        verifyCommands: []
      }

      assert.throws(
        () => runMigrateExtensionPlan(plan as any, { execFileSync: () => undefined }),
        /Refusing to clear unsafe output directory/
      )
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("extension migration harness allows build and external output directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-safe-outdir-"))
  const externalRoot = await mkdtemp(join(tmpdir(), "openwork-extension-harness-external-outdir-"))
  try {
    for (const outDir of [
      join(root, ".ow-build", "extension-migration", "github", "shell"),
      join(externalRoot, "github-shell")
    ]) {
      const plan = {
        apply: false,
        cwd: root,
        destinationDir: join(root, "extensions", "github"),
        extensionId: "github",
        extensionPath: "extensions/github",
        generatedPackageDir: join(outDir, "openwork-package"),
        ignoredRoot: join(root, ".ignored-extensions"),
        mode: "shell",
        outDir,
        previewArgs: ["scripts/preview-raycast-ai-migration.mjs"],
        verifyCommands: []
      }

      runMigrateExtensionPlan(plan as any, {
        execFileSync: () => {
          mkdirSync(plan.generatedPackageDir, { recursive: true })
        }
      })
      assert.equal(existsSync(plan.generatedPackageDir), true)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
    await rm(externalRoot, { force: true, recursive: true })
  }
})

test("extension migration harness apply moves previous extension and runs verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-apply-"))
  try {
    const outDir = join(root, ".ow-build", "extension-migration", "github", "shell")
    const plan = {
      apply: true,
      cwd: root,
      destinationDir: join(root, "extensions", "github-generated"),
      extensionId: "github-generated",
      extensionPath: "extensions/github",
      generatedPackageDir: join(outDir, "openwork-package"),
      ignoredRoot: join(root, ".ignored-extensions"),
      mode: "shell",
      outDir,
      previewArgs: ["scripts/preview-raycast-ai-migration.mjs"],
      verifyCommands: [
        ["npm", "run", "check:extensions"],
        ["npm", "run", "check:guardrails"]
      ]
    }
    await mkdir(plan.destinationDir, { recursive: true })
    await writeFile(join(plan.destinationDir, "old.txt"), "old")

    const commands: string[][] = []
    runMigrateExtensionPlan(plan as any, {
      execFileSync: (command: string, args: string[]) => {
        commands.push([command, ...args])
        if (command === process.execPath) {
          mkdirSync(plan.generatedPackageDir, { recursive: true })
          writeFileSync(join(plan.generatedPackageDir, "new.txt"), "new")
        }
      }
    })

    assert.equal(await readFile(join(root, ".ignored-extensions", "github-generated", "old.txt"), "utf8"), "old")
    assert.equal(await readFile(join(plan.destinationDir, "new.txt"), "utf8"), "new")
    assert.deepEqual(commands, [
      [process.execPath, ...plan.previewArgs],
      ["npm", "run", "check:extensions"],
      ["npm", "run", "check:guardrails"]
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("extension migration harness refuses to apply shell output over live extension ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-extension-harness-live-shell-"))
  try {
    const outDir = join(root, ".ow-build", "extension-migration", "github", "shell")
    const plan = {
      apply: true,
      cwd: root,
      destinationDir: join(root, "extensions", "github"),
      extensionId: "github",
      extensionPath: "extensions/github",
      generatedPackageDir: join(outDir, "openwork-package"),
      ignoredRoot: join(root, ".ignored-extensions"),
      mode: "shell",
      outDir,
      previewArgs: ["scripts/preview-raycast-ai-migration.mjs"],
      verifyCommands: []
    }

    assert.throws(
      () => runMigrateExtensionPlan(plan as any, { execFileSync: () => undefined }),
      /Refusing to apply shell migration over live extension/
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("extension migration harness usage lists known targets", () => {
  const usage = formatUsage()
  assert.match(usage, /github -> extensions\/github/)
  assert.match(usage, /apple-reminders -> extensions\/apple-reminders/)
  assert.match(usage, /--target-extension-id apple-reminders-generated/)
  assert.doesNotMatch(usage, /apple-reminders --mode shell --apply/)
})

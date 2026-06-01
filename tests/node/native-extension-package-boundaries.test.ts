import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { validateNativeExtensionPackageBoundaries } from "../../scripts/native-extension-package-boundaries.mjs"

test("native extension package boundary check accepts declared package-local imports", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main.ts": [
        'import { defineNativeExtensionMain } from "@openwork/extension-api"',
        'import { helper } from "./domain/helper"',
        "void helper",
        "export const main = defineNativeExtensionMain({})"
      ].join("\n"),
      "extensions/fixture/domain/helper.ts": [
        'import { z } from "zod"',
        "void z",
        "export const helper = true"
      ].join("\n"),
      "extensions/fixture/src/.gitkeep": ""
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*",
        zod: "^4.0.0"
      }
    }
  })

  try {
    assert.deepEqual(validateNativeExtensionPackageBoundaries({ repoRoot }).errors, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check keeps main out of command source modules", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main.ts": [
        'import { helper } from "./main/tools"',
        "void helper",
        "export {}"
      ].join("\n"),
      "extensions/fixture/main/tools.ts": [
        'import { commandHelper } from "../src/helper"',
        "void commandHelper",
        "export const helper = true"
      ].join("\n"),
      "extensions/fixture/src/helper.ts": "export const commandHelper = true\n"
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /main entry cannot import command source modules/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check enforces package entry shape", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/src/helper.ts": "export const helper = true\n"
    },
    packageJson: {
      main: "./dist/main.js",
      name: "@openwork/extension-other",
      types: "./dist/manifest.d.ts",
      type: "commonjs"
    },
    skipDefaultEntries: true
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /must declare "name": "@openwork\/extension-fixture"/)
    assert.match(errors, /must declare "type": "module"/)
    assert.match(errors, /must declare "main": "\.\/main\.ts"/)
    assert.match(errors, /must declare "types": "\.\/manifest\.ts"/)
    assert.match(errors, /must provide a manifest entry file/)
    assert.match(errors, /must provide a runtime entry file/)
    assert.match(errors, /must provide a runtime metadata file/)
    assert.match(errors, /must provide a main-process entry file/)
    assert.match(errors, /must keep main-process code/)
    assert.match(errors, /must own its assets/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check enforces package entry identities", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        'const EXTENSION_ID = "other"',
        "export const manifest = defineNativeExtensionManifest({",
        "  commands: [],",
        "  name: EXTENSION_ID,",
        '  title: "Other"',
        "})"
      ].join("\n"),
      "extensions/fixture/runtime-metadata.ts": [
        'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
        "const IDENTITY = {",
        '  extensionId: "other"',
        "}",
        "export const runtimeMetadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [],",
        "  extensionName: IDENTITY.extensionId",
        "})"
      ].join("\n"),
      "extensions/fixture/runtime.ts": [
        'import { defineNativeExtensionRuntime } from "@openwork/extension-api"',
        "export const runtime = defineNativeExtensionRuntime({",
        "  commands: {},",
        '  extensionName: "other"',
        "})"
      ].join("\n")
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /manifest name must be "fixture", got "other"/)
    assert.match(errors, /runtime extensionName must be "fixture", got "other"/)
    assert.match(errors, /runtime metadata extensionName must be "fixture", got "other"/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check resolves local identity constants", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        'import { EXTENSION_ID } from "./identity"',
        "export const manifest = defineNativeExtensionManifest({",
        "  commands: [],",
        "  name: EXTENSION_ID,",
        '  title: "Fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/runtime-metadata.ts": [
        'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
        'import { EXTENSION_IDENTITY } from "./identity"',
        "export const runtimeMetadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [],",
        "  extensionName: EXTENSION_IDENTITY.extensionId",
        "})"
      ].join("\n"),
      "extensions/fixture/runtime.ts": [
        'import { defineNativeExtensionRuntime } from "@openwork/extension-api"',
        "export const runtime = defineNativeExtensionRuntime({",
        "  commands: {},",
        '  extensionName: "fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/identity.ts": [
        "export const EXTENSION_IDENTITY = {",
        '  extensionId: "fixture"',
        "}",
        "export const EXTENSION_ID = EXTENSION_IDENTITY.extensionId"
      ].join("\n"),
      "extensions/fixture/src/.gitkeep": ""
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    assert.deepEqual(validateNativeExtensionPackageBoundaries({ repoRoot }).errors, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check validates manifest asset references", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/assets/command.svg": "<svg />\n",
      "extensions/fixture/assets/icon.svg": "<svg />\n",
      "extensions/fixture/src/.gitkeep": "",
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        "export const manifest = defineNativeExtensionManifest({",
        "  capabilities: [],",
        "  commands: [",
        "    {",
        '      icon: "assets/command.svg",',
        '      mode: "view",',
        '      name: "open",',
        '      title: "Open"',
        "    }",
        "  ],",
        '  icon: "assets/icon.svg",',
        '  name: "fixture",',
        '  title: "Fixture"',
        "})"
      ].join("\n")
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    assert.deepEqual(validateNativeExtensionPackageBoundaries({ repoRoot }).errors, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects manifest assets outside the package assets directory", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        "export const manifest = defineNativeExtensionManifest({",
        "  capabilities: [],",
        "  commands: [",
        "    {",
        '      icon: "assets/missing.svg",',
        '      mode: "view",',
        '      name: "open",',
        '      title: "Open"',
        "    }",
        "  ],",
        '  icon: "icon.svg",',
        '  name: "fixture",',
        '  title: "Fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/src/.gitkeep": ""
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /package icon must use an assets\/\.\.\. package path/)
    assert.match(errors, /command "open" icon asset does not exist: assets\/missing\.svg/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check enforces package entry file and directory kinds", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/assets": "not a directory\n",
      "extensions/fixture/main/.gitkeep": "",
      "extensions/fixture/main.ts": "export {}\n",
      "extensions/fixture/src": "not a directory\n",
      "extensions/fixture/manifest.ts/nested.ts": "export {}\n",
      "extensions/fixture/runtime-metadata.ts": "export {}\n",
      "extensions/fixture/runtime.ts": "export {}\n"
    },
    packageJson: {},
    skipDefaultEntries: true
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /manifest\.ts:1 extension package must provide a manifest entry file/)
    assert.match(errors, /src:1 extension package must keep command\/source code under src\//)
    assert.match(errors, /assets:1 extension package must own its assets under assets\//)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects host private imports", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/src/view.tsx": 'import { something } from "@renderer/private"\nvoid something\n'
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    assert.match(
      validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n"),
      /host private aliases/
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects monorepo shared aliases", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/src/view.tsx": 'import type { SharedThing } from "@shared/private"\nexport type LocalThing = SharedThing\n'
    },
    packageJson: {
      dependencies: {}
    }
  })

  try {
    assert.match(
      validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n"),
      /host private aliases/
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects relative imports escaping the package", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/src/view.tsx": 'import "../../other/secret"\n'
    },
    packageJson: {
      dependencies: {}
    }
  })

  try {
    assert.match(
      validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n"),
      /relative imports must stay inside/
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects undeclared dependencies", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/src/view.tsx": 'import { Client } from "@notionhq/client"\nvoid Client\n'
    },
    packageJson: {
      dependencies: {}
    }
  })

  try {
    assert.match(
      validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n"),
      /undeclared dependency @notionhq\/client/
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check keeps runtime metadata static", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/runtime-metadata.ts": [
        'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
        'import { createIntent } from "./src/metadata"',
        "void createIntent",
        "export const metadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [],",
        '  extensionName: "fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/src/metadata.ts": [
        'import { runCommand } from "../runtime"',
        'import View from "./view"',
        "void runCommand",
        "void View",
        "export function createIntent() {",
        "  return []",
        "}"
      ].join("\n"),
      "extensions/fixture/src/view.tsx": "export default function View() { return null }\n"
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /runtime metadata cannot import runtime or main-process modules/)
    assert.match(errors, /runtime metadata cannot import UI component modules/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check keeps main entry out of runtime and UI modules", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main.ts": [
        'import { createTools } from "./main/tools"',
        "void createTools",
        "export {}"
      ].join("\n"),
      "extensions/fixture/main/tools.ts": [
        'import { runtime } from "../runtime"',
        'import View from "../ui/view"',
        "void runtime",
        "void View",
        "export function createTools() {",
        "  return []",
        "}"
      ].join("\n"),
      "extensions/fixture/src/.gitkeep": "",
      "extensions/fixture/ui/view.tsx": "export default function View() { return null }\n"
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /main entry cannot import runtime or runtime metadata modules/)
    assert.match(errors, /main entry cannot import UI component modules/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check aligns manifest runtime and metadata commands", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        "export const manifest = defineNativeExtensionManifest({",
        "  capabilities: [],",
        "  commands: [",
        "    {",
        '      mode: "view",',
        '      name: "open",',
        "      runtime: { viewport: { bodyHeight: 320 } },",
        '      title: "Open"',
        "    },",
        "    {",
        '      mode: "view",',
        '      name: "create",',
        "      runtime: { viewport: { bodyHeight: 320 } },",
        '      title: "Create"',
        "    }",
        "  ],",
        '  name: "fixture",',
        '  title: "Fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/runtime.ts": [
        'import { defineNativeExtensionRuntime } from "@openwork/extension-api"',
        "export const runtime = defineNativeExtensionRuntime({",
        "  commands: {",
        '    "create": { mode: "view", Component: () => null },',
        '    "open": { mode: "view", Component: () => null }',
        "  },",
        '  extensionName: "fixture"',
        "})"
      ].join("\n"),
      "extensions/fixture/runtime-metadata.ts": [
        'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
        "export const runtimeMetadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [",
        '    { name: "open" },',
        '    { name: "delete" }',
        "  ],",
        '  extensionName: "fixture"',
        "})"
      ].join("\n")
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /runtime commands must match manifest runtime commands/)
    assert.match(errors, /runtime metadata commands must match manifest runtime commands/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check aligns main entry with manifest capabilities", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main.ts": [
        'import { defineNativeExtensionMain } from "@openwork/extension-api"',
        "const service = {}",
        "export const main = defineNativeExtensionMain({",
        "  service",
        "})"
      ].join("\n"),
      "extensions/fixture/manifest.ts": [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        "export const manifest = defineNativeExtensionManifest({",
        "  aiCapability: {",
        '    guide: "Use Fixture for fixture data.",',
        '    id: "fixture",',
        "    instructions: [],",
        '    title: "Fixture",',
        "    toolDisplays: {",
        "      searchItems: {",
        '        description: "Search fixture items.",',
        '        title: "Search Items"',
        "      }",
        "    },",
        '    toolNames: ["searchItems"]',
        "  },",
        "  capabilities: [],",
        "  commands: [],",
        '  name: "fixture",',
        '  title: "Fixture"',
        "})"
      ].join("\n")
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /main entry must declare tools when manifest aiCapability\.toolNames/)
    assert.match(errors, /main entry cannot declare service unless manifest declares RPC/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check rejects source runtime package imports and declarations", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main.ts": [
        'import { getPreferenceValues } from "@raycast/api"',
        "void getPreferenceValues",
        "export {}"
      ].join("\n"),
      "extensions/fixture/src/view.tsx": [
        'import { useCachedPromise } from "@raycast/utils"',
        "void useCachedPromise",
        "export {}"
      ].join("\n")
    },
    packageJson: {
      dependencies: {
        "@raycast/api": "^1.104.5"
      },
      optionalDependencies: {
        "@raycast/utils": "^2.2.2"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n")
    assert.match(errors, /cannot declare source runtime package @raycast\/api in dependencies/)
    assert.match(errors, /cannot declare source runtime package @raycast\/utils in optionalDependencies/)
    assert.match(errors, /cannot import source runtime package @raycast\/api; use @openwork\/extension-api/)
    assert.match(errors, /cannot import source runtime package @raycast\/utils; use @openwork\/extension-utils/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check keeps Node and Electron APIs main-only", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "extensions/fixture/main/service.ts": 'import { execFile } from "node:child_process"\nvoid execFile\n',
      "extensions/fixture/src/view.tsx": 'import { readFile } from "node:fs"\nvoid readFile\n'
    },
    packageJson: {
      peerDependencies: {
        electron: "^39.0.0"
      }
    }
  })

  try {
    const errors = validateNativeExtensionPackageBoundaries({ repoRoot }).errors
    assert.match(errors.join("\n"), /Node built-ins are main-process only/)
    assert.equal(errors.some((error) => error.includes("main/service.ts")), false)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("native extension package boundary check follows package directory symlinks", async () => {
  const repoRoot = await createFixtureRepo({
    files: {
      "linked-extension/src/view.tsx": 'import { hidden } from "@renderer/private"\nvoid hidden\n'
    },
    packageJson: {
      dependencies: {
        "@openwork/extension-api": "workspace:*"
      }
    },
    rootDirectory: "linked-extension"
  })

  try {
    await mkdir(join(repoRoot, "extensions"), { recursive: true })
    await symlink(join(repoRoot, "linked-extension"), join(repoRoot, "extensions", "fixture"), "dir")
    assert.match(
      validateNativeExtensionPackageBoundaries({ repoRoot }).errors.join("\n"),
      /host private aliases/
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

async function createFixtureRepo(options: {
  files: Record<string, string>
  packageJson: Record<string, unknown>
  rootDirectory?: string
  skipDefaultEntries?: boolean
}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "openwork-extension-boundary-"))
  const extensionRoot = join(repoRoot, options.rootDirectory ?? "extensions/fixture")
  await mkdir(extensionRoot, { recursive: true })
  await writeFile(
    join(extensionRoot, "package.json"),
    JSON.stringify({
      main: "./main.ts",
      name: "@openwork/extension-fixture",
      type: "module",
      types: "./manifest.ts",
      ...options.packageJson
    }),
    "utf8"
  )

  if (!options.skipDefaultEntries) {
    await mkdir(join(extensionRoot, "main"), { recursive: true })
    await mkdir(join(extensionRoot, "assets"), { recursive: true })
    await writeFile(join(extensionRoot, "main.ts"), "export {}\n", "utf8")
    await writeFile(
      join(extensionRoot, "manifest.ts"),
      [
        'import { defineNativeExtensionManifest } from "@openwork/extension-api"',
        "export const manifest = defineNativeExtensionManifest({",
        "  capabilities: [],",
        "  commands: [],",
        '  name: "fixture",',
        '  title: "Fixture"',
        "})"
      ].join("\n"),
      "utf8"
    )
    await writeFile(
      join(extensionRoot, "runtime.ts"),
      [
        'import { defineNativeExtensionRuntime } from "@openwork/extension-api"',
        "export const runtime = defineNativeExtensionRuntime({",
        "  commands: {},",
        '  extensionName: "fixture"',
        "})"
      ].join("\n"),
      "utf8"
    )
    await writeFile(
      join(extensionRoot, "runtime-metadata.ts"),
      [
        'import { defineNativeExtensionRuntimeMetadata } from "@openwork/extension-api"',
        "export const runtimeMetadata = defineNativeExtensionRuntimeMetadata({",
        "  commands: [],",
        '  extensionName: "fixture"',
        "})"
      ].join("\n"),
      "utf8"
    )
  }

  for (const [relativePath, contents] of Object.entries(options.files)) {
    const absolutePath = join(repoRoot, relativePath)
    await mkdir(join(absolutePath, ".."), { recursive: true })
    await writeFile(absolutePath, contents, "utf8")
  }

  return repoRoot
}

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Command } from "@langchain/langgraph"
import { imageGenerationMain } from "../../extensions/image-generation/main"
import { imageGenerationManifest } from "../../extensions/image-generation/manifest"
import { createExtensionAiMiddleware } from "../../src/main/agent/extension-ai-middleware"
import { createExtensionAiSession } from "../../src/main/agent/extension-ai-runtime"
import { createToolPermissionRuntime } from "../../src/main/agent/tool-permission-runtime"
import { createDynamicExtensionToolApprovalPolicyProvider } from "../../src/main/extension-tools/permission"
import { ExtensionToolRegistry } from "../../src/main/extension-tools/registry"
import type { ResolvedExtensionAiCapability } from "../../src/shared/extension-sources"

const repoRoot = process.cwd()
const originalOpenworkHome = process.env.OPENWORK_HOME
const originalFetch = globalThis.fetch
let openworkHome = ""

async function loadDbModules() {
  const db = await import("../../src/main/db")
  const { listArtifacts } = await import("../../src/main/artifacts/service")
  return { ...db, listArtifacts }
}

function getImageGenerationTool(name: string) {
  const tool = imageGenerationMain.tools?.find((candidate) => candidate.name === name)
  assert.ok(tool, `Expected image generation tool "${name}"`)
  return tool
}

function createImageGenerationCapability(
  permissionMode: ResolvedExtensionAiCapability["permissionMode"] = "auto"
): ResolvedExtensionAiCapability {
  return {
    authStatus: "connected",
    capability: imageGenerationManifest.aiCapability!,
    displayName: "Image Generation",
    enabled: true,
    enabledToolNames: ["generateImage", "editImage"],
    extensionName: imageGenerationManifest.name,
    permissionMode,
    publicConfig: {},
    toolExposures: [
      {
        agentToolName: "ext__image__default__generateImage",
        display: {
          description: "Generate images from a prompt.",
          title: "Generate Image"
        },
        toolName: "generateImage"
      },
      {
        agentToolName: "ext__image__default__editImage",
        display: {
          description: "Edit images from a prompt.",
          title: "Edit Image"
        },
        toolName: "editImage"
      }
    ]
  }
}

function createImageGenerationRegistry(): ExtensionToolRegistry {
  const registry = new ExtensionToolRegistry({
    knownExtensionNames: [imageGenerationManifest.name]
  })
  registry.registerExtensionTools(imageGenerationManifest.name, imageGenerationMain.tools ?? [])
  return registry
}

function createImageGenerationMiddleware(input: {
  threadId: string
  workspacePath: string
}) {
  const registry = createImageGenerationRegistry()
  const session = createExtensionAiSession({
    aiCapabilities: [createImageGenerationCapability()],
    registry
  })

  return createExtensionAiMiddleware({
    aiCapabilityCatalog: [],
    getExtensionPreferences: () => ({
      apiKey: "sk-test",
      baseUrl: "https://images.example.test"
    }),
    session,
    threadId: input.threadId,
    workspacePath: input.workspacePath
  })
}

test.before(async () => {
  openworkHome = await mkdtemp(join(tmpdir(), "openwork-image-generation-ai-tools-"))
  process.env.OPENWORK_HOME = openworkHome

  execFileSync("node", ["scripts/run-prisma-openwork-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENWORK_HOME: openworkHome
    }
  })
})

test.beforeEach(async () => {
  globalThis.fetch = originalFetch
  const { closeDatabase, initializeDatabase } = await loadDbModules()
  await closeDatabase()
  await initializeDatabase()
})

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test.after(async () => {
  const { closeDatabase } = await loadDbModules()
  await closeDatabase()

  if (originalOpenworkHome === undefined) {
    delete process.env.OPENWORK_HOME
  } else {
    process.env.OPENWORK_HOME = originalOpenworkHome
  }

  if (openworkHome) {
    await rm(openworkHome, { force: true, recursive: true })
  }
})

test("image generation API fetch failures include the request stage and target", async () => {
  const generateImage = getImageGenerationTool("generateImage")
  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-image-workspace-"))

  globalThis.fetch = (async () => {
    throw new Error("fetch failed")
  }) as typeof fetch

  await assert.rejects(
    async () =>
      generateImage.handler(
        {
          extensionName: imageGenerationManifest.name,
          extensionPreferences: {
            apiKey: "sk-test",
            baseUrl: "https://images.example.test"
          },
          threadId: "thread-image-fetch-error",
          toolName: "generateImage",
          workspacePath
        },
        {
          model: "gpt-image-2",
          n: 1,
          prompt: "cat",
          quality: "medium",
          size: "1024x1024"
        }
      ),
    /Image API request failed while POST https:\/\/images\.example\.test\/v1\/images\/generations: fetch failed/
  )

  await rm(workspacePath, { force: true, recursive: true })
})

test("image generation tools are allowed in auto mode", async () => {
  const registry = createImageGenerationRegistry()
  const capability = createImageGenerationCapability("auto")
  const permissionRuntime = createToolPermissionRuntime({
    extensionToolPolicyProvider: createDynamicExtensionToolApprovalPolicyProvider({
      getBindings: () => registry.createAiCapabilityToolBindings([capability])
    }),
    permissionMode: "ask-to-edit"
  })

  const generateDecision = await permissionRuntime.evaluate({
    args: {
      args: {
        prompt: "a tiny watercolor house"
      },
      extensionName: imageGenerationManifest.name,
      toolName: "generateImage"
    },
    toolName: "callExtension"
  })

  assert.equal(generateDecision.disposition, "allow")

  const editDecision = await permissionRuntime.evaluate({
    args: {
      args: {
        imagePaths: ["input.png"],
        prompt: "make it brighter"
      },
      extensionName: imageGenerationManifest.name,
      toolName: "editImage"
    },
    toolName: "callExtension"
  })

  assert.equal(editDecision.disposition, "allow")
})

test("image generation callExtension stores generated images as artifacts", async () => {
  const { createThread, listArtifacts } = await loadDbModules()
  const threadId = "thread-image-artifact"
  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-image-workspace-"))
  await createThread(threadId)

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from("generated image bytes").toString("base64")
          }
        ]
      }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 200
      }
    )) as typeof fetch

  const middleware = createImageGenerationMiddleware({
    threadId,
    workspacePath
  })
  const callExtension = middleware.tools?.find((tool) => tool.name === "callExtension")
  assert.ok(callExtension)

  const result = await callExtension.invoke(
    {
      args: {
        prompt: "a small artifact"
      },
      extensionName: imageGenerationManifest.name,
      toolName: "generateImage"
    },
    {
      toolCall: {
        args: {},
        id: "tool-call-image",
        name: "callExtension",
        type: "tool_call"
      }
    }
  )

  assert.equal(result instanceof Command, true)
  const update = (result as unknown as Command).update as {
    artifacts?: {
      manifests?: Array<{
        artifactKey: string
        kind: string
        mimeType: string | null
        title: string
        toolCallId: string | null
      }>
    }
  }
  assert.deepEqual(update.artifacts?.manifests?.map((manifest) => manifest.title), [
    "Generated image"
  ])
  assert.equal(update.artifacts?.manifests?.[0]?.artifactKey, "tool-call-image:0")
  assert.equal(update.artifacts?.manifests?.[0]?.kind, "file")
  assert.equal(update.artifacts?.manifests?.[0]?.mimeType, "image/png")
  assert.equal(update.artifacts?.manifests?.[0]?.toolCallId, "tool-call-image")

  const artifacts = await listArtifacts(threadId)
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0]?.title, "Generated image")
  assert.equal(artifacts[0]?.kind, "file")
  assert.equal(artifacts[0]?.mimeType, "image/png")
  assert.equal(artifacts[0]?.toolCallId, "tool-call-image")
  assert.equal(artifacts[0]?.source.type, "managed-file-path")
  assert.deepEqual(
    await readFile(artifacts[0]?.source.type === "managed-file-path" ? artifacts[0].source.uri : ""),
    Buffer.from("generated image bytes")
  )

  await rm(workspacePath, { force: true, recursive: true })
})

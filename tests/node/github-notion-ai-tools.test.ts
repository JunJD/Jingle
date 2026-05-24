import assert from "node:assert/strict"
import test from "node:test"
import { createExtensionAiRuntime } from "../../src/main/agent/extension-ai-runtime"
import { ExtensionToolExecutor } from "../../src/main/extension-tools/executor"
import { createNativeExtensionToolRegistry } from "../../src/main/extension-tools/native-extension-tools"
import { nativeExtensionMainDefinitions } from "../../src/extensions/main"
import { nativeExtensionManifests } from "../../src/extensions"
import {
  resolveNativeExtensionAiCapabilityForExtensionName,
  resolveNativeExtensionAiCapabilitiesForRefs
} from "../../src/extensions/sources"

test("GitHub connected AI capability registers callable tools", () => {
  const capability = resolveNativeExtensionAiCapabilityForExtensionName("github", {
    preferencesByExtension: {
      github: {
        accessToken: "ghp_secret",
        apiBaseUrl: "https://api.github.com",
        defaultSearchTerms: "",
        numberOfResults: "25"
      }
    }
  })
  assert.ok(capability)

  const runtime = createExtensionAiRuntime({
    aiCapabilities: [capability],
    registry: createNativeExtensionToolRegistry({
      definitions: nativeExtensionMainDefinitions,
      manifests: nativeExtensionManifests
    }),
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    runtime.aiToolBindings
      .filter((binding) => binding.resolvedCapability.extensionName === "github")
      .map((binding) => binding.definition.name),
    [
      "listMyIssues",
      "listMyPullRequests",
      "searchIssues",
      "searchPullRequests",
      "searchRepositories",
      "listRepositories",
      "listNotifications",
      "listWorkflowRuns",
      "createIssue"
    ]
  )
})

test("Notion connected AI capability registers callable read tools", () => {
  const capability = resolveNativeExtensionAiCapabilityForExtensionName("notion", {
    preferencesByExtension: {
      notion: {
        accessToken: "secret_token",
        apiBaseUrl: "https://api.notion.com/v1"
      }
    }
  })
  assert.ok(capability)

  const runtime = createExtensionAiRuntime({
    aiCapabilities: [capability],
    registry: createNativeExtensionToolRegistry({
      definitions: nativeExtensionMainDefinitions,
      manifests: nativeExtensionManifests
    }),
    threadId: "thread-1",
    workspacePath: "/workspace"
  })

  assert.deepEqual(
    runtime.aiToolBindings
      .filter((binding) => binding.resolvedCapability.extensionName === "notion")
      .map((binding) => ({
        access: binding.definition.access,
        name: binding.definition.name
      })),
    [
      { access: "read", name: "searchPages" },
      { access: "read", name: "retrievePage" },
      { access: "read", name: "listBlockChildren" },
      { access: "read", name: "retrieveDataSource" },
      { access: "read", name: "queryDataSource" }
    ]
  )
})

test("missing GitHub auth still loads instructions without callable tools", () => {
  const [capability] = resolveNativeExtensionAiCapabilitiesForRefs(
    [
      {
        extensionName: "github",
        name: "GitHub",
        sourceId: "github",
        type: "extension-source"
      }
    ],
    {
      preferencesByExtension: {
        github: {
          accessToken: "",
          apiBaseUrl: "https://api.github.com"
        }
      }
    }
  )

  assert.equal(capability?.authStatus, "missing")
  assert.deepEqual(capability?.enabledToolNames, [])
  assert.deepEqual(capability?.toolExposures, [])
  assert.match(capability?.capability.instructions?.join("\n") ?? "", /GitHub/)
})

test("Notion search tool sends token, version header, and shared-content search body", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return new Response(
      JSON.stringify({
        has_more: false,
        next_cursor: null,
        results: [
          {
            id: "page-1",
            object: "page",
            properties: {
              Name: {
                title: [{ plain_text: "Roadmap" }],
                type: "title"
              }
            },
            url: "https://www.notion.so/page-1"
          }
        ]
      }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 200
      }
    )
  }

  try {
    const capability = resolveNativeExtensionAiCapabilityForExtensionName("notion", {
      preferencesByExtension: {
        notion: {
          accessToken: "secret_token",
          apiBaseUrl: "https://api.notion.com/v1"
        }
      }
    })
    assert.ok(capability)
    const registry = createNativeExtensionToolRegistry({
      definitions: nativeExtensionMainDefinitions,
      manifests: nativeExtensionManifests
    })
    const [binding] = registry
      .createAiCapabilityToolBindings([capability])
      .filter((candidate) => candidate.definition.name === "searchPages")
    assert.ok(binding)
    const executor = new ExtensionToolExecutor({
      bindings: [binding],
      getExtensionPreferences: () => ({
        accessToken: "secret_token",
        apiBaseUrl: "https://api.notion.com/v1"
      })
    })

    const output = await executor.executeAgentTool({
      agentToolName: binding.agentToolName,
      args: {
        filter: "page",
        limit: 5,
        query: "roadmap"
      },
      threadId: "thread-1",
      workspacePath: "/workspace"
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/search")
    assert.equal(requests[0]?.method, "POST")
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret_token")
    assert.equal(requests[0]?.headers.get("Notion-Version"), "2026-03-11")
    assert.deepEqual(requests[0]?.body, {
      filter: {
        property: "object",
        value: "page"
      },
      page_size: 5,
      query: "roadmap"
    })
    assert.match(output, /Roadmap/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

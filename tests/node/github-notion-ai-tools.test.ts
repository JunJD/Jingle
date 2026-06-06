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

test("GitHub current-user issue tool searches with viewer login", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []

  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)

    if (url.endsWith("/user")) {
      return jsonResponse({
        avatar_url: "",
        login: "JunJD"
      })
    }

    return jsonResponse({
      items: []
    })
  }

  try {
    await executeGitHubTool("listMyIssues", {
      includeRecentlyClosed: true,
      limit: 5,
      scope: ["created", "assigned"]
    })

    const searchQueries = requests
      .filter((request) => request.includes("/search/issues"))
      .map((request) => new URL(request).searchParams.get("q"))
    assert.deepEqual(searchQueries, [
      "is:issue author:JunJD archived:false is:open",
      "is:issue assignee:JunJD archived:false is:open",
      "is:issue author:JunJD archived:false is:closed",
      "is:issue assignee:JunJD archived:false is:closed"
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion connected AI capability registers callable tools", () => {
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
      { access: "read", name: "getPage" },
      { access: "read", name: "retrievePage" },
      { access: "read", name: "getPageMarkdown" },
      { access: "read", name: "listBlockChildren" },
      { access: "read", name: "getDatabases" },
      { access: "read", name: "retrieveDataSource" },
      { access: "read", name: "searchDatabase" },
      { access: "read", name: "queryDataSource" },
      { access: "write", name: "addToPage" },
      { access: "write", name: "createPage" },
      { access: "write", name: "createDatabasePage" }
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

test("Notion searchPages tool accepts legacy searchText input", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      has_more: false,
      next_cursor: null,
      object: "list",
      results: []
    })
  }

  try {
    await executeNotionTool("searchPages", {
      filter: "page",
      limit: 5,
      searchText: "roadmap"
    })

    assert.deepEqual(requests, [
      {
        body: {
          filter: {
            property: "object",
            value: "page"
          },
          page_size: 5,
          query: "roadmap"
        },
        method: "POST",
        url: "https://api.notion.com/v1/search"
      }
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion searchPages tool follows legacy searchText pagination", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    requests.push({
      body,
      method: init?.method ?? "GET",
      url: String(input)
    })

    if ((body as { start_cursor?: string } | null)?.start_cursor === "cursor-2") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [
          notionPage("page-2", "Second Roadmap", {
            parent_database_id: "database-1"
          })
        ]
      })
    }

    return jsonResponse({
      has_more: true,
      next_cursor: "cursor-2",
      object: "list",
      results: [
        notionPage("page-1", "First Roadmap", {
          parent_page_id: "parent-page-1"
        })
      ]
    })
  }

  try {
    const output = await executeNotionTool("searchPages", {
      searchText: "roadmap"
    })

    assert.deepEqual(requests, [
      {
        body: {
          page_size: 100,
          query: "roadmap",
          sort: {
            direction: "descending",
            timestamp: "last_edited_time"
          }
        },
        method: "POST",
        url: "https://api.notion.com/v1/search"
      },
      {
        body: {
          page_size: 100,
          query: "roadmap",
          sort: {
            direction: "descending",
            timestamp: "last_edited_time"
          },
          start_cursor: "cursor-2"
        },
        method: "POST",
        url: "https://api.notion.com/v1/search"
      }
    ])
    assert.match(output, /First Roadmap/)
    assert.match(output, /Second Roadmap/)
    assert.match(output, /parent-page-1/)
    assert.match(output, /database-1/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion read tools use Notion client endpoints", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url
    })

    if (url.includes("/blocks/block-1/children")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: []
      })
    }

    if (url.includes("/data_sources/data-source-1/query")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: []
      })
    }

    if (url.includes("/data_sources/data-source-1")) {
      return jsonResponse({
        id: "data-source-1",
        object: "data_source",
        title: [{ plain_text: "Tasks" }]
      })
    }

    if (url.includes("/pages/page-1")) {
      return jsonResponse({
        id: "page-1",
        object: "page",
        properties: {}
      })
    }

    return jsonResponse({ message: "Unexpected Notion request" }, 500)
  }

  try {
    await executeNotionTool("retrievePage", {
      pageId: "page-1"
    })
    await executeNotionTool("listBlockChildren", {
      blockId: "block-1",
      limit: 3
    })
    await executeNotionTool("retrieveDataSource", {
      dataSourceId: "data-source-1"
    })
    await executeNotionTool("queryDataSource", {
      dataSourceId: "data-source-1",
      filter: {
        property: "Status",
        status: {
          equals: "Doing"
        }
      },
      limit: 7,
      sorts: [
        {
          direction: "descending",
          timestamp: "last_edited_time"
        }
      ]
    })

    assert.deepEqual(
      requests.map((request) => ({
        body: request.body,
        method: request.method.toUpperCase(),
        url: request.url
      })),
      [
        {
          body: null,
          method: "GET",
          url: "https://api.notion.com/v1/pages/page-1"
        },
        {
          body: null,
          method: "GET",
          url: "https://api.notion.com/v1/blocks/block-1/children?page_size=3"
        },
        {
          body: null,
          method: "GET",
          url: "https://api.notion.com/v1/data_sources/data-source-1"
        },
        {
          body: {
            filter: {
              property: "Status",
              status: {
                equals: "Doing"
              }
            },
            page_size: 7,
            sorts: [
              {
                direction: "descending",
                timestamp: "last_edited_time"
              }
            ]
          },
          method: "POST",
          url: "https://api.notion.com/v1/data_sources/data-source-1/query"
        }
      ]
    )

    for (const request of requests) {
      assert.equal(request.headers.get("Authorization"), "Bearer secret_token")
      assert.equal(request.headers.get("Notion-Version"), "2026-03-11")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion compatible read aliases use Notion client endpoints", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url
    })

    if (url.includes("/blocks/page-1/children")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionParagraphBlock("block-1", "Alias content")]
      })
    }

    if (url.includes("/data_sources/data-source-1/query")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [
          {
            id: "page-2",
            object: "page",
            properties: {
              Name: {
                title: [{ plain_text: "Database Hit" }],
                type: "title"
              }
            },
            url: "https://www.notion.so/page-2"
          }
        ]
      })
    }

    if (url === "https://api.notion.com/v1/search") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [
          {
            id: "data-source-1",
            object: "data_source",
            title: [{ plain_text: "Tasks" }],
            url: "https://www.notion.so/data-source-1"
          }
        ]
      })
    }

    return jsonResponse({ message: "Unexpected Notion request" }, 500)
  }

  try {
    const pageOutput = await executeNotionTool("getPage", {
      pageId: "page-1"
    })
    const databasesOutput = await executeNotionTool("getDatabases", {
      limit: 10,
      query: "tasks",
      startCursor: "cursor-1"
    })
    const databaseSearchOutput = await executeNotionTool("searchDatabase", {
      databaseId: "data-source-1",
      limit: 7,
      query: "Hit",
      startCursor: "cursor-2"
    })

    assert.match(pageOutput, /Alias content/)
    assert.match(pageOutput, /"content":/)
    assert.match(databasesOutput, /Tasks/)
    assert.match(databaseSearchOutput, /Database Hit/)
    assert.deepEqual(
      requests.map((request) => ({
        body: request.body,
        method: request.method.toUpperCase(),
        url: request.url
      })),
      [
        {
          body: null,
          method: "GET",
          url: "https://api.notion.com/v1/blocks/page-1/children?page_size=100"
        },
        {
          body: {
            filter: {
              property: "object",
              value: "data_source"
            },
            page_size: 10,
            query: "tasks",
            start_cursor: "cursor-1"
          },
          method: "POST",
          url: "https://api.notion.com/v1/search"
        },
        {
          body: {
            filter: {
              and: [
                {
                  property: "title",
                  title: {
                    contains: "Hit"
                  }
                }
              ]
            },
            page_size: 7,
            start_cursor: "cursor-2"
          },
          method: "POST",
          url: "https://api.notion.com/v1/data_sources/data-source-1/query"
        }
      ]
    )

    for (const request of requests) {
      assert.equal(request.headers.get("Authorization"), "Bearer secret_token")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion getPageMarkdown tool returns page content as Markdown", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      has_more: false,
      next_cursor: null,
      object: "list",
      results: [
        {
          archived: false,
          has_children: false,
          id: "block-1",
          object: "block",
          paragraph: {
            rich_text: [
              {
                annotations: {
                  bold: false,
                  code: false,
                  color: "default",
                  italic: false,
                  strikethrough: false,
                  underline: false
                },
                href: null,
                plain_text: "Hello Markdown",
                text: {
                  content: "Hello Markdown",
                  link: null
                },
                type: "text"
              }
            ]
          },
          type: "paragraph"
        }
      ]
    })
  }

  try {
    const output = await executeNotionTool("getPageMarkdown", {
      pageId: "page-1"
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/blocks/page-1/children?page_size=100")
    assert.equal(requests[0]?.method, "GET")
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret_token")
    assert.match(output, /Hello Markdown/)
    assert.match(output, /"status":\s*"success"/)
    assert.match(output, /"blockCount":\s*1/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion getPageMarkdown tool returns empty page markdown", async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () =>
    jsonResponse({
      has_more: false,
      next_cursor: null,
      object: "list",
      results: []
    })

  try {
    const output = await executeNotionTool("getPageMarkdown", {
      pageId: "page-empty"
    })

    assert.match(output, /\*Page is empty\*/)
    assert.match(output, /"status":\s*"empty"/)
    assert.match(output, /"blockCount":\s*0/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion getPageMarkdown tool reads all paginated page blocks", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      method: init?.method ?? "GET",
      url
    })

    if (url.includes("start_cursor=cursor-2")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionParagraphBlock("block-2", "Second page block")]
      })
    }

    return jsonResponse({
      has_more: true,
      next_cursor: "cursor-2",
      object: "list",
      results: [notionParagraphBlock("block-1", "First page block")]
    })
  }

  try {
    const output = await executeNotionTool("getPageMarkdown", {
      pageId: "page-paginated"
    })

    assert.deepEqual(requests, [
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-paginated/children?page_size=100"
      },
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-paginated/children?start_cursor=cursor-2&page_size=100"
      }
    ])
    assert.match(output, /First page block/)
    assert.match(output, /Second page block/)
    assert.match(output, /"blockCount":\s*2/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion addToPage tool converts markdown and appends blocks", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      has_more: false,
      next_cursor: null,
      object: "list",
      results: [
        {
          id: "block-added",
          object: "block",
          type: "paragraph"
        }
      ]
    })
  }

  try {
    const output = await executeNotionTool("addToPage", {
      addDateDivider: true,
      content: "Hello **Notion**",
      pageId: "page-1",
      prepend: true
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/blocks/page-1/children")
    assert.equal(requests[0]?.method, "PATCH")
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret_token")

    const body = requests[0]?.body as {
      children: Array<Record<string, unknown>>
      position: Record<string, unknown>
    }
    assert.deepEqual(body.position, { type: "start" })
    assert.equal(body.children[0]?.type, "divider")
    assert.equal(body.children[1]?.type, "paragraph")
    assert.deepEqual(
      (body.children[1]?.paragraph as { rich_text: Array<Record<string, unknown>> }).rich_text[0]
        ?.type,
      "mention"
    )
    assert.equal(body.children[2]?.type, "paragraph")
    assert.match(output, /block-added|appendedBlockCount|page-1/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion createDatabasePage tool creates a page with markdown blocks", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      id: "page-created",
      object: "page",
      parent: {
        data_source_id: "data-source-1",
        type: "data_source_id"
      },
      properties: {
        title: {
          title: [{ plain_text: "Migration Plan" }],
          type: "title"
        }
      },
      url: "https://www.notion.so/page-created"
    })
  }

  try {
    const output = await executeNotionTool("createDatabasePage", {
      addDateDivider: true,
      content: "# Heading",
      dataSourceId: "data-source-1",
      title: "Migration Plan"
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/pages")
    assert.equal(requests[0]?.method, "POST")
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret_token")

    const body = requests[0]?.body as {
      children: Array<Record<string, unknown>>
      parent: Record<string, unknown>
      properties: Record<string, { title: Array<Record<string, unknown>> }>
    }
    assert.deepEqual(body.parent, {
      data_source_id: "data-source-1"
    })
    assert.deepEqual(body.properties.title.title[0], {
      text: {
        content: "Migration Plan"
      },
      type: "text"
    })
    assert.equal(body.children[0]?.type, "divider")
    assert.equal(body.children[1]?.type, "paragraph")
    assert.equal(body.children[2]?.type, "heading_1")
    assert.match(output, /Migration Plan|page-created/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion createPage tool maps legacy databaseId input to page creation", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      id: "page-created",
      object: "page",
      parent: {
        data_source_id: "data-source-1",
        type: "data_source_id"
      },
      properties: {
        title: {
          title: [{ plain_text: "Legacy Alias" }],
          type: "title"
        }
      },
      url: "https://www.notion.so/page-created"
    })
  }

  try {
    const output = await executeNotionTool("createPage", {
      content: "Alias **content**",
      databaseId: "data-source-1",
      title: "Legacy Alias"
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/pages")
    assert.equal(requests[0]?.method, "POST")
    assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret_token")

    const body = requests[0]?.body as {
      children: Array<Record<string, unknown>>
      parent: Record<string, unknown>
      properties: Record<string, { title: Array<Record<string, unknown>> }>
    }
    assert.deepEqual(body.parent, {
      data_source_id: "data-source-1"
    })
    assert.deepEqual(body.properties.title.title[0], {
      text: {
        content: "Legacy Alias"
      },
      type: "text"
    })
    assert.equal(body.children[0]?.type, "paragraph")
    assert.match(output, /Legacy Alias|page-created/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Notion createDatabasePage tool writes database properties", async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input)
    })

    return jsonResponse({
      id: "page-created",
      object: "page",
      properties: {
        Name: {
          title: [{ plain_text: "Migration Plan" }],
          type: "title"
        }
      }
    })
  }

  try {
    await executeNotionTool("createDatabasePage", {
      dataSourceId: "data-source-1",
      properties: {
        Due: {
          type: "date",
          value: "2026-06-01"
        },
        Priority: {
          type: "select",
          value: "High"
        },
        Project: {
          type: "relation",
          value: ["page-project"]
        },
        Reviewers: {
          type: "people",
          value: ["user-reviewer"]
        },
        Score: {
          type: "number",
          value: 3
        },
        Stage: {
          type: "status",
          value: "Doing"
        },
        Tags: {
          type: "multi_select",
          value: ["Migration", "Notion"]
        }
      },
      title: "Migration Plan",
      titlePropertyName: "Name"
    })

    const body = requests[0]?.body as {
      properties: Record<string, unknown>
    }
    assert.deepEqual(body.properties, {
      Due: {
        date: {
          start: "2026-06-01"
        }
      },
      Name: {
        title: [
          {
            text: {
              content: "Migration Plan"
            },
            type: "text"
          }
        ]
      },
      Priority: {
        select: {
          id: "High"
        }
      },
      Project: {
        relation: [
          {
            id: "page-project"
          }
        ]
      },
      Reviewers: {
        people: [
          {
            id: "user-reviewer"
          }
        ]
      },
      Score: {
        number: 3
      },
      Stage: {
        status: {
          id: "Doing"
        }
      },
      Tags: {
        multi_select: [
          {
            id: "Migration"
          },
          {
            id: "Notion"
          }
        ]
      }
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

async function executeNotionTool(toolName: string, args: Record<string, unknown>): Promise<string> {
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
    .filter((candidate) => candidate.definition.name === toolName)
  assert.ok(binding)

  const executor = new ExtensionToolExecutor({
    bindings: [binding],
    getExtensionPreferences: () => ({
      accessToken: "secret_token",
      apiBaseUrl: "https://api.notion.com/v1"
    })
  })

  return executor.executeAgentTool({
    agentToolName: binding.agentToolName,
    args,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
}

async function executeGitHubTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const capability = resolveNativeExtensionAiCapabilityForExtensionName("github", {
    preferencesByExtension: {
      github: {
        accessToken: "ghp_secret",
        apiBaseUrl: "https://github-api.example.test",
        defaultSearchTerms: "",
        numberOfResults: "25"
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
    .filter((candidate) => candidate.definition.name === toolName)
  assert.ok(binding)

  const executor = new ExtensionToolExecutor({
    bindings: [binding],
    getExtensionPreferences: () => ({
      accessToken: "ghp_secret",
      apiBaseUrl: "https://github-api.example.test",
      defaultSearchTerms: "",
      numberOfResults: "25"
    })
  })

  return executor.executeAgentTool({
    agentToolName: binding.agentToolName,
    args,
    threadId: "thread-1",
    workspacePath: "/workspace"
  })
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  })
}

function notionPage(
  id: string,
  title: string,
  parent: { parent_database_id?: string; parent_page_id?: string } = {}
): Record<string, unknown> {
  return {
    id,
    object: "page",
    parent: parent.parent_database_id
      ? {
          database_id: parent.parent_database_id,
          type: "database_id"
        }
      : parent.parent_page_id
        ? {
            page_id: parent.parent_page_id,
            type: "page_id"
          }
        : undefined,
    properties: {
      Name: {
        title: [{ plain_text: title }],
        type: "title"
      }
    },
    url: `https://www.notion.so/${id}`
  }
}

function notionParagraphBlock(id: string, text: string): Record<string, unknown> {
  return {
    archived: false,
    has_children: false,
    id,
    object: "block",
    paragraph: {
      rich_text: [
        {
          annotations: {
            bold: false,
            code: false,
            color: "default",
            italic: false,
            strikethrough: false,
            underline: false
          },
          href: null,
          plain_text: text,
          text: {
            content: text,
            link: null
          },
          type: "text"
        }
      ]
    },
    type: "paragraph"
  }
}

import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { notionMain } from "../../installable-extensions/notion/main"
import { createNotionTools } from "../../installable-extensions/notion/main/tools"
import { NOTION_IDENTITY } from "../../installable-extensions/notion/identity"
import { notionManifest } from "../../installable-extensions/notion/manifest"
import { createExtensionAiRuntime } from "../../src/main/agent/extension-ai-runtime"
import { parseToolInputWithSchema } from "../../src/main/agent/tool-input-schema"
import { createNativeExtensionToolRegistry } from "../../src/main/extension-tools/native-extension-tools"
import { resolveNativeExtensionAiCapabilityForExtensionNameFromManifests } from "../../src/extensions/sources"
import type { ExtensionToolContext, ExtensionToolDefinition } from "../../src/shared/extension-sources"
import type { NativeExtensionResolvedConnection } from "../../src/shared/native-extensions"

const toolContext: ExtensionToolContext = {
  extensionName: "notion",
  extensionPreferences: {
    accessToken: "secret-token"
  },
  threadId: "thread-1",
  toolName: "getPage",
  workspacePath: "/workspace"
}

function connectedExtensionConnection(extensionName: string): NativeExtensionResolvedConnection {
  return {
    connectionId: "default",
    extensionName,
    missingSecretNames: [],
    provider: extensionName,
    publicConfig: {},
    status: "connected"
  }
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(path)
      }

      return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
    })
  )

  return files.flat()
}

test("Notion client module reads connection secrets lazily", async () => {
  const module = await import("../../installable-extensions/notion/domain/client")

  assert.equal(typeof module.getNotionClient, "function")
})

test("Notion source uses api-key connection semantics instead of OAuth remnants", async () => {
  const root = join(process.cwd(), "installable-extensions/notion")
  const files = await listSourceFiles(root)
  const offenders: string[] = []

  for (const file of files) {
    const contents = await readFile(file, "utf8")
    if (/\b(OAuth|OAuthService|PKCEClient|notionService)\b/.test(contents)) {
      offenders.push(file.replace(`${root}/`, ""))
    }
  }

  assert.deepEqual(offenders, [])
})

test("Notion AI tools do not execute migrated source tool modules", async () => {
  const toolsSource = await readFile(
    join(process.cwd(), "installable-extensions/notion/main/tools.ts"),
    "utf8"
  )

  assert.equal(toolsSource.includes("runMigratedTool"), false)
  assert.equal(toolsSource.includes('import("../src/tools/'), false)
  assert.equal(toolsSource.includes("../src/utils/notion"), false)
})

test("Notion package does not expose the retired generated identity", async () => {
  const root = join(process.cwd(), "installable-extensions/notion")
  const files = await listSourceFiles(root)
  const offenders: string[] = []

  for (const file of files) {
    const relativePath = file.replace(`${root}/`, "")
    const contents = await readFile(file, "utf8")
    if (
      /(notion-generated|Notion Generated|NOTION_GENERATED|createNotionGenerated)/.test(contents)
    ) {
      offenders.push(relativePath)
    }
  }

  assert.deepEqual(offenders, [])
})

test("Notion identity is the migrated package's formal runtime identity", () => {
  assert.deepEqual(NOTION_IDENTITY, {
    aiToolHostRequestId: "notion-ai-tool-host-request",
    extensionId: "notion",
    extensionTitle: "Notion",
    providerId: "notion",
    subjectTerms: ["notion"]
  })
})

test("Notion AI tools expose page markdown reader", () => {
  assert.deepEqual(
    createNotionTools()
      .filter((tool) => tool.name === "getPage" || tool.name === "getPageMarkdown")
      .map((tool) => ({
        access: tool.access,
        name: tool.name
      })),
    [
      {
        access: "read",
        name: "getPage"
      },
      {
        access: "read",
        name: "getPageMarkdown"
      }
    ]
  )
})

test("Notion connected AI capability exposes the Notion tool surface", () => {
  const capability = resolveNativeExtensionAiCapabilityForExtensionNameFromManifests(
    "notion",
    [notionManifest],
    {
      getConnection: connectedExtensionConnection
    }
  )
  assert.ok(capability)

  const runtime = createExtensionAiRuntime({
    aiCapabilities: [capability],
    registry: createNativeExtensionToolRegistry({
      definitions: new Map([[notionManifest.name, notionMain]]),
      manifests: [notionManifest]
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
      { access: "read", name: "queryDataSource" },
      { access: "write", name: "addToPage" },
      { access: "write", name: "createDatabasePage" }
    ]
  )
  assert.equal(
    runtime.aiToolBindings.find(
      (binding) =>
        binding.resolvedCapability.extensionName === "notion" &&
        binding.definition.name === "searchPages"
    )?.agentToolName,
    "ext__notion__searchPages"
  )
})

test("Notion AI tool schemas reject retired tool and input aliases", async () => {
  const tools = createNotionTools()

  assert.equal(
    tools.some((tool) => tool.name === "searchDatabase"),
    false
  )
  assert.equal(
    tools.some((tool) => tool.name === "createPage"),
    false
  )
  await assert.rejects(
    executeParsedNotionTool("searchPages", {
      searchText: "roadmap"
    }),
    /Unrecognized key/
  )
  await assert.rejects(
    executeParsedNotionTool("queryDataSource", {
      databaseId: "database-1"
    }),
    /Unrecognized key|dataSourceId/
  )
  await assert.rejects(
    executeParsedNotionTool("createDatabasePage", {
      databaseId: "database-1",
      title: "Migration Plan"
    }),
    /Unrecognized key|dataSourceId/
  )
})

test("Notion AI tools honor custom API base URL preferences", async () => {
  const requests: Array<{ body?: unknown; method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    await executeNotionTool(
      "searchPages",
      {
        limit: 5,
        query: "proxy"
      },
      {
        apiBaseUrl: "https://notion-proxy.example.test/v1"
      }
    )
  })

  assert.equal(requests[0]?.url, "https://notion-proxy.example.test/v1/search")
})

test("Notion read tools use Notion client endpoints", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    await executeNotionTool("searchPages", {
      filter: "page",
      limit: 5,
      query: "roadmap",
      startCursor: "cursor-1"
    })
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

    assert.deepEqual(stripRequestBodies(requests), [
      {
        body: {
          filter: {
            property: "object",
            value: "page"
          },
          page_size: 5,
          query: "roadmap",
          start_cursor: "cursor-1"
        },
        method: "POST",
        url: "https://api.notion.com/v1/search"
      },
      {
        method: "GET",
        url: "https://api.notion.com/v1/pages/page-1"
      },
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/block-1/children?page_size=3"
      },
      {
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
    ])
  })
})

test("Notion write tools support add date divider and page properties", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    await executeNotionTool("addToPage", {
      addDateDivider: true,
      content: "Hello **Notion**",
      pageId: "page-1",
      prepend: true
    })
    await executeNotionTool("createDatabasePage", {
      addDateDivider: true,
      content: "# Heading",
      dataSourceId: "data-source-1",
      properties: {
        Blocked: {
          type: "checkbox",
          value: false
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
        Stage: {
          type: "status",
          value: "Doing"
        },
        Tags: {
          type: "multi_select",
          value: ["Migration", "Notion"]
        }
      },
      title: "Migration Plan"
    })

    assert.equal(requests[0]?.method, "PATCH")
    assert.equal(requests[0]?.url, "https://api.notion.com/v1/blocks/page-1/children")
    assert.deepEqual((requests[0]?.body as { position?: unknown }).position, {
      type: "start"
    })
    assert.deepEqual(
      ((requests[0]?.body as { children?: Array<Record<string, unknown>> }).children ?? [])[0],
      {
        divider: {},
        type: "divider"
      }
    )

    assert.equal(requests[1]?.method, "POST")
    assert.equal(requests[1]?.url, "https://api.notion.com/v1/pages")
    const createBody = requests[1]?.body as {
      children: Array<Record<string, unknown>>
      parent: Record<string, unknown>
      properties: Record<string, Record<string, unknown>>
    }
    assert.deepEqual(createBody.parent, {
      data_source_id: "data-source-1"
    })
    assert.deepEqual(createBody.children[0], {
      divider: {},
      type: "divider"
    })
    assert.deepEqual(createBody.properties.title, {
      title: [
        {
          text: {
            content: "Migration Plan"
          },
          type: "text"
        }
      ]
    })
    assert.deepEqual(createBody.properties.Blocked, {
      checkbox: false
    })
    assert.deepEqual(createBody.properties.Priority, {
      select: {
        id: "High"
      }
    })
    assert.deepEqual(createBody.properties.Project, {
      relation: [
        {
          id: "page-project"
        }
      ]
    })
    assert.deepEqual(createBody.properties.Reviewers, {
      people: [
        {
          id: "user-reviewer"
        }
      ]
    })
    assert.deepEqual(createBody.properties.Stage, {
      status: {
        id: "Doing"
      }
    })
    assert.deepEqual(createBody.properties.Tags, {
      multi_select: [{ id: "Migration" }, { id: "Notion" }]
    })
  })
})

test("Notion write tool confirmations are built from main tool inputs", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const tools = createNotionTools()
  const addToPage = tools.find((candidate) => candidate.name === "addToPage")
  const createDatabasePage = tools.find((candidate) => candidate.name === "createDatabasePage")
  assert.ok(addToPage?.approval?.confirmation)
  assert.ok(createDatabasePage?.approval?.confirmation)

  await withMockedFetch(requests, async () => {
    const addConfirmation = await addToPage.approval!.confirmation!(
      {
        content: "Append **this**",
        pageId: "page-1"
      },
      {
        ...toolContext,
        access: "write",
        capabilityDisplayName: "Notion",
        permissionMode: "ask-to-edit",
        toolTitle: "Add to Page"
      }
    )

    const createConfirmation = await createDatabasePage.approval!.confirmation!(
      {
        content: "Create **this**",
        dataSourceId: "data-source-1",
        title: "Generated Page"
      },
      {
        ...toolContext,
        access: "write",
        capabilityDisplayName: "Notion",
        permissionMode: "ask-to-edit",
        toolTitle: "Create Database Page"
      }
    )

    assert.deepEqual(addConfirmation, {
      info: [{ name: "content", value: "Append **this**" }],
      message: "Are you sure you want to add the content to the page?"
    })
    assert.deepEqual(createConfirmation, {
      info: [
        { name: "Title", value: "Generated Page" },
        { name: "Content", value: "Create **this**" },
        { name: "In data source", value: "Generated Data Source" }
      ],
      message: "Are you sure you want to create the page?"
    })
  })

  assert.deepEqual(stripRequestBodies(requests), [
    {
      method: "GET",
      url: "https://api.notion.com/v1/data_sources/data-source-1"
    }
  ])
})

test("Notion createDatabasePage supports migrated property wrappers", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const input = {
    addDateDivider: true,
    content: "## Migration notes",
    contentBlocks: [
      {
        type: "bookmark",
        url: "https://example.com/spec"
      }
    ],
    dataSourceId: "data-source-1",
    properties: {
      Blocked: {
        type: "checkbox",
        value: false
      },
      Due: {
        type: "date",
        value: "2026-06-01T09:30:00.000"
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
  }

  await withMockedFetch(requests, async () => {
    const output = await executeParsedNotionTool("createDatabasePage", input)

    assert.match(JSON.stringify(output), /page-created/)

    const createPageRequest = requests.find(
      (request) => request.url === "https://api.notion.com/v1/pages"
    )
    assert.ok(createPageRequest)
    const body = createPageRequest.body as { children: Array<Record<string, unknown>> }
    assert.equal(body.children[0]?.type, "divider")
    assert.equal(body.children[1]?.type, "paragraph")
    assert.deepEqual(body.children[2], {
      bookmark: {
        url: "https://example.com/spec"
      },
      type: "bookmark"
    })
    assert.equal(body.children[3]?.type, "heading_2")
  })
})

test("Notion getPage returns markdown content for AI", async () => {
  const requests: Array<{ method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    const output = await executeNotionTool("getPage", {
      pageId: "page-1"
    })

    assert.deepEqual(stripRequestBodies(requests), [
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-1/children?page_size=100"
      }
    ])
    assert.match(JSON.stringify(output), /Generated page content/)
    assert.deepEqual(output, {
      blockCount: 1,
      content: "Generated page content",
      pageId: "page-1",
      status: "success"
    })
  })
})

test("Notion getPageMarkdown reads all paginated page blocks", async () => {
  const requests: Array<{ method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    const output = await executeNotionTool("getPageMarkdown", {
      pageId: "page-paginated"
    })

    assert.deepEqual(stripRequestBodies(requests), [
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-paginated/children?page_size=100"
      },
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-paginated/children?start_cursor=cursor-2&page_size=100"
      }
    ])
    assert.match(JSON.stringify(output), /First page block/)
    assert.match(JSON.stringify(output), /Second page block/)
    assert.deepEqual(output, {
      blockCount: 2,
      markdown: "First page block\n\nSecond page block",
      pageId: "page-paginated",
      status: "success"
    })
  })
})

test("Notion getPageMarkdown returns empty markdown for empty pages", async () => {
  const requests: Array<{ method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    const output = await executeNotionTool("getPageMarkdown", {
      pageId: "page-empty"
    })

    assert.deepEqual(stripRequestBodies(requests), [
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-empty/children?page_size=100"
      }
    ])
    assert.deepEqual(output, {
      blockCount: 0,
      markdown: "*Page is empty*",
      pageId: "page-empty",
      status: "empty"
    })
  })
})

test("Notion getPage reports readable error content when the page request fails", async () => {
  const requests: Array<{ method: string; url: string }> = []

  await withMockedFetch(requests, async () => {
    const output = await executeNotionTool("getPage", {
      pageId: "page-fail"
    })

    assert.deepEqual(stripRequestBodies(requests), [
      {
        method: "GET",
        url: "https://api.notion.com/v1/blocks/page-fail/children?page_size=100"
      }
    ])
    assert.deepEqual(output, {
      content: "Missing page",
      status: "error"
    })
  })
})

test("Notion addToPage write failures are surfaced to the tool caller", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = () => {}
  console.warn = () => {}

  try {
    await withMockedFetch(requests, async () => {
      await assert.rejects(
        () =>
          executeNotionTool("addToPage", {
            content: "hello",
            pageId: "page-fail"
          }),
        /Missing page/
      )

      assert.deepEqual(
        requests.map((request) => ({
          method: request.method,
          url: request.url
        })),
        [
          {
            method: "PATCH",
            url: "https://api.notion.com/v1/blocks/page-fail/children"
          }
        ]
      )
    })
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
})

async function executeNotionTool(
  toolName: string,
  input: Record<string, unknown>,
  extensionPreferences: Record<string, unknown> = {}
): Promise<unknown> {
  const tool = createNotionTools().find((candidate) => candidate.name === toolName)
  assert.ok(tool)

  return (tool as ExtensionToolDefinition).handler(
    {
      ...toolContext,
      extensionPreferences: {
        ...toolContext.extensionPreferences,
        ...extensionPreferences
      },
      toolName
    },
    input
  )
}

async function executeParsedNotionTool(
  toolName: string,
  input: Record<string, unknown>,
  extensionPreferences: Record<string, unknown> = {}
): Promise<unknown> {
  const tool = createNotionTools().find((candidate) => candidate.name === toolName)
  assert.ok(tool)
  const parsedInput = await parseToolInputWithSchema(`notion:${toolName}`, tool.inputSchema, input)

  return (tool as ExtensionToolDefinition).handler(
    {
      ...toolContext,
      extensionPreferences: {
        ...toolContext.extensionPreferences,
        ...extensionPreferences
      },
      toolName
    },
    parsedInput
  )
}

async function withMockedFetch<T>(
  requests: Array<{ body?: unknown; method: string; url: string }>,
  callback: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? "GET",
      url
    })

    if (url.includes("page-fail")) {
      return jsonResponse(
        {
          code: "object_not_found",
          message: "Missing page",
          object: "error",
          status: 404
        },
        404
      )
    }

    if (url.includes("page-empty")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: []
      })
    }

    if (url.includes("start_cursor=cursor-2")) {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionParagraphBlock("block-2", "Second page block")]
      })
    }

    if (url.includes("page-paginated")) {
      return jsonResponse({
        has_more: true,
        next_cursor: "cursor-2",
        object: "list",
        results: [notionParagraphBlock("block-1", "First page block")]
      })
    }

    if (url.includes("/pages/page-1") && (init?.method ?? "GET") === "GET") {
      return jsonResponse({
        id: "page-1",
        object: "page",
        properties: {}
      })
    }

    if (url.includes("/data_sources/data-source-1")) {
      return jsonResponse({
        has_more: false,
        id: "data-source-1",
        next_cursor: null,
        object: "data_source",
        results: [],
        title: [{ plain_text: "Generated Data Source" }]
      })
    }

    if (url === "https://api.notion.com/v1/search") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [
          {
            id: "page-1",
            object: "page",
            properties: {
              Name: {
                title: [{ plain_text: "Roadmap" }],
                type: "title"
              }
            }
          }
        ]
      })
    }

    if (url === "https://api.notion.com/v1/pages") {
      return jsonResponse({
        id: "page-created",
        object: "page",
        url: "https://www.notion.so/page-created"
      })
    }

    return jsonResponse({
      has_more: false,
      next_cursor: null,
      object: "list",
      results: [notionParagraphBlock("block-1", "Generated page content")]
    })
  }

  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  })
}

function stripRequestBodies(
  requests: Array<{ body?: unknown; method: string; url: string }>
): Array<{ body?: unknown; method: string; url: string }> {
  return requests.map((request) =>
    request.body === undefined || request.body === null
      ? {
          method: request.method,
          url: request.url
        }
      : request
  )
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

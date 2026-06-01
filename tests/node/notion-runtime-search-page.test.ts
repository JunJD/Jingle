import assert from "node:assert/strict"
import test from "node:test"
import { createElement, type ReactElement } from "react"
import {
  createExtensionRuntimeLaunchProps,
  ExtensionRuntimeNavigationProvider,
  type ExtensionRuntimeHostRequestInput,
  type ExtensionRuntimeSdkContextValue
} from "@openwork/extension-api/host-runtime"
import { notionRuntime } from "../../extensions/notion/runtime"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchProps,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormSurfaceSnapshot,
  ExtensionListSurfaceSnapshot,
  ExtensionVisualNode
} from "../../src/shared/extension-runtime-protocol"

type NotionFetchRequest = {
  body: unknown
  method: string
  url: string
}

type MockNotionState = {
  assigneeIds: string[]
  dueStart: string
  isBlocked: boolean
  priorityId: "high" | "low"
  tagIds: string[]
  taskStatusId: "doing" | "done"
}

const NOTION_VIEW_COMMAND_NAMES = [
  "search-page",
  "create-database-page",
  "add-text-to-page",
  "quick-capture"
] as const

test("Notion search-page renders search results from the migrated Notion client", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const snapshot = renderer.getSnapshot()
    assertListSnapshot(snapshot)
    assert.equal(snapshot.extensionName, "notion")
    assert.deepEqual(
      snapshot.sections.map((section) => ({
        items: section.items.map((item) => item.title),
        title: section.title
      })),
      [
        {
          items: ["Runtime Notes"],
          title: "Search"
        }
      ]
    )
    assert.deepEqual(snapshot.pagination, {
      hasMore: false,
      isLoading: false
    })
  })

  assert.deepEqual(fetchRequests.map((request) => request.url).sort(), [
    "https://api.notion.com/v1/search",
    "https://api.notion.com/v1/users"
  ])
  assert.deepEqual(fetchRequests.find((request) => request.url.endsWith("/search"))?.body, {
    page_size: 25,
    query: "",
    sort: {
      direction: "descending",
      timestamp: "last_edited_time"
    }
  })
  assert.equal(hostRequests.filter((request) => request.capability === "storage").length, 3)
})

test("Notion search-page opens page detail and records the recent page", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const listSnapshot = renderer.getSnapshot()
    assertListSnapshot(listSnapshot)
    const pageItem = listSnapshot.sections.flatMap((section) => section.items)[0]
    assert.equal(pageItem?.title, "Runtime Notes")
    const previewAction = pageItem?.actions.find((action) => action.title === "Preview Page")
    assert.ok(previewAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: previewAction.id,
        revision: listSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const detailSnapshot = renderer.getSnapshot()
    assert.equal(detailSnapshot?.kind, "detail")
    if (detailSnapshot?.kind !== "detail") {
      return
    }
    assert.equal(detailSnapshot.canPop, true)
    assert.equal(detailSnapshot.navigationTitle, "Runtime Notes")
    assert.match(detailSnapshot.markdown ?? "", /# Runtime Notes/)
    assert.match(detailSnapshot.markdown ?? "", /Body from official Notion migration/)

    const storedRecentPages = JSON.parse(String(storage.get("RECENT_PAGES"))) as Array<{
      id: string
      type: string
    }>
    assert.deepEqual(
      storedRecentPages.map((page) => ({ id: page.id, type: page.type })),
      [
        {
          id: "page-generated-1",
          type: "page"
        }
      ]
    )
  })

  assert.deepEqual(fetchRequests.map((request) => request.url).sort(), [
    "https://api.notion.com/v1/blocks/page-generated-1/children?page_size=100",
    "https://api.notion.com/v1/pages/page-generated-1",
    "https://api.notion.com/v1/search",
    "https://api.notion.com/v1/users"
  ])
  assert.equal(
    hostRequests.some(
      (request) =>
        request.capability === "storage" &&
        request.method === "set" &&
        request.payload.key === "RECENT_PAGES"
    ),
    true
  )
})

test("Notion page action registers a quicklink through the runtime host", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            open_in: {
              bundleId: "notion.id",
              name: "Notion"
            }
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const snapshot = renderer.getSnapshot()
    assertListSnapshot(snapshot)
    const pageItem = snapshot.sections.flatMap((section) => section.items)[0]
    assert.equal(pageItem?.title, "Runtime Notes")
    const quicklinkAction = pageItem?.actions.find((action) => action.title === "Create Quicklink")
    assert.ok(quicklinkAction)
    assert.deepEqual(quicklinkAction.shortcut, {
      key: "l",
      modifiers: ["cmd"]
    })

    assert.equal(
      await renderer.dispatchEvent({
        actionId: quicklinkAction.id,
        revision: snapshot.revision,
        type: "action.execute"
      }),
      true
    )
  })

  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "quicklinks")
      .map((request) => request.payload),
    [
      {
        extensionName: "notion",
        link: "notion://www.notion.so/page-generated-1",
        name: "Runtime Notes",
        shortcut: {
          key: "l",
          modifiers: ["cmd"],
          platform: "macOS"
        }
      }
    ]
  )
})

test("Notion search-page restores pinned and recent pages from extension storage", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "PINNED_PAGES",
      JSON.stringify([
        {
          id: "page-pinned-generated",
          pinned_time: 1,
          type: "page"
        }
      ])
    ],
    [
      "RECENT_PAGES",
      JSON.stringify([
        {
          id: "page-recent-generated",
          last_visited_time: 2,
          type: "page"
        }
      ])
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const snapshot = renderer.getSnapshot()
    assertListSnapshot(snapshot)
    assert.deepEqual(
      snapshot.sections.map((section) => ({
        items: section.items.map((item) => item.title),
        title: section.title
      })),
      [
        {
          items: ["Pinned Generated Page"],
          title: "Pinned"
        },
        {
          items: ["Recent Generated Page"],
          title: "Recent"
        },
        {
          items: ["Runtime Notes"],
          title: "Search"
        }
      ]
    )
  })

  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "storage" && request.method === "get")
      .map((request) => request.payload.key),
    ["PINNED_PAGES", "RECENT_PAGES"]
  )
  assert.equal(
    fetchRequests.some(
      (request) => request.url === "https://api.notion.com/v1/pages/page-pinned-generated"
    ),
    true
  )
  assert.equal(
    fetchRequests.some(
      (request) => request.url === "https://api.notion.com/v1/pages/page-recent-generated"
    ),
    true
  )
})

test("Notion search-page can pin and unpin a page through LocalStorage", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const listSnapshot = renderer.getSnapshot()
    assertListSnapshot(listSnapshot)
    const pageItem = listSnapshot.sections.flatMap((section) => section.items)[0]
    assert.equal(pageItem?.title, "Runtime Notes")
    const pinAction = pageItem?.actions.find((action) => action.title === "Pin Page")
    assert.ok(pinAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: pinAction.id,
        revision: listSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const pinnedPages = JSON.parse(String(storage.get("PINNED_PAGES"))) as Array<{
      id: string
      type: string
    }>
    assert.deepEqual(
      pinnedPages.map((page) => ({ id: page.id, type: page.type })),
      [
        {
          id: "page-generated-1",
          type: "page"
        }
      ]
    )

    const pinnedSnapshot = renderer.getSnapshot()
    assertListSnapshot(pinnedSnapshot)
    const pinnedItem = pinnedSnapshot.sections.flatMap((section) => section.items)[0]
    const unpinAction = pinnedItem?.actions.find((action) => action.title === "Unpin Page")
    assert.ok(unpinAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: unpinAction.id,
        revision: pinnedSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.deepEqual(JSON.parse(String(storage.get("PINNED_PAGES"))), [])
  })
})

test("Notion search-page opens Notion links with the configured desktop app target", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            open_in: {
              bundleId: "notion.id",
              name: "Notion"
            },
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const listSnapshot = renderer.getSnapshot()
    assertListSnapshot(listSnapshot)
    const pageItem = listSnapshot.sections.flatMap((section) => section.items)[0]
    assert.equal(pageItem?.title, "Runtime Notes")
    const openInAppAction = pageItem?.actions.find((action) => action.title === "Open in App")
    assert.ok(openInAppAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: openInAppAction.id,
        revision: listSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const shellRequest = hostRequests.find(
    (request) => request.capability === "shell" && request.method === "open-external"
  )
  assert.deepEqual(shellRequest?.payload, {
    allowedUrlSchemes: ["notion"],
    application: {
      bundleId: "notion.id",
      name: "Notion"
    },
    url: "notion://www.notion.so/page-generated-1"
  })
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "navigation" && request.method === "hide-launcher"
    ),
    true
  )
})

test("Notion database list renders visible property accessories and metadata tag items", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    ["list-dropdown", "created_time"],
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          properties: {
            multi_select: {},
            people: {},
            status: {}
          }
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          },
          extensionPreferences: {
            accessToken: "secret-token",
            properties_in_page_previews: true
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSearchSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSearchSnapshot)
    const databaseItem = databaseSearchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    assert.ok(databaseItem)
    const navigateAction = databaseItem.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: databaseSearchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    assert.equal(databaseSnapshot.canPop, true)
    assert.equal(databaseSnapshot.navigationTitle, "Generated Tasks")
    assert.equal(databaseSnapshot.searchBarAccessory?.value, "created_time")
    assert.deepEqual(
      databaseSnapshot.sections.flatMap((section) => section.items.map((item) => item.title)),
      ["Generated Database Task"]
    )
    const taskAccessories = databaseSnapshot.sections[0]?.items[0]?.accessories ?? []
    assert.equal(
      taskAccessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Migration"
      ),
      true
    )
    assert.equal(
      taskAccessories.some((accessory) => visualIncludesText(accessory, "Alex Chen")),
      true
    )
    assert.equal(
      taskAccessories.some((accessory) => accessory.kind === "text" && accessory.text === "Doing"),
      true
    )

    const previewAction = databaseSnapshot.sections[0]?.items[0]?.actions.find(
      (action) => action.title === "Preview Page"
    )
    assert.ok(previewAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: previewAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const detailSnapshot = renderer.getSnapshot()
    assertDetailSnapshot(detailSnapshot)
    assert.equal(detailSnapshot.navigationTitle, "Generated Database Task")
    assert.match(detailSnapshot.markdown ?? "", /\\*Page is empty\\*/)
    assert.match(detailSnapshot.markdown ?? "", /\*\*Tags\*\*: Migration/)
    assert.match(detailSnapshot.markdown ?? "", /\*\*Assignee\*\*: Alex Chen/)
    assert.match(detailSnapshot.markdown ?? "", /\*\*Related\*\*: page-related-generated/)
    const showMetadataAction = detailSnapshot.actions.find(
      (action) => action.title === "Show Metadata"
    )
    assert.ok(showMetadataAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: showMetadataAction.id,
        revision: detailSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()

    const metadataSnapshot = renderer.getSnapshot()
    assertDetailSnapshot(metadataSnapshot)
    assert.deepEqual(
      metadataSnapshot.metadata
        .filter((entry) => ["Tags", "Assignee", "Status"].includes(entry.title))
        .map((entry) => ({ text: entry.text, title: entry.title }))
        .sort((left, right) => left.title.localeCompare(right.title)),
      [
        {
          text: "Alex Chen",
          title: "Assignee"
        },
        {
          text: "Doing",
          title: "Status"
        },
        {
          text: "Migration",
          title: "Tags"
        }
      ]
    )
  })

  assert.equal(
    fetchRequests.some(
      (request) =>
        request.url === "https://api.notion.com/v1/data_sources/data-source-generated-1/query" &&
        request.method === "POST" &&
        Array.isArray((request.body as { sorts?: unknown }).sorts) &&
        (request.body as { sorts: Array<{ timestamp?: unknown }> }).sorts[0]?.timestamp ===
          "created_time"
    ),
    true
  )
  assert.equal(
    fetchRequests.some(
      (request) =>
        request.url === "https://api.notion.com/v1/blocks/page-database-task-1/children?page_size=100" &&
        request.method === "GET"
    ),
    true
  )
})

test("Notion database list edits status through quick property actions", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          properties: {
            status: {}
          }
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    const taskItem = databaseSnapshot.sections[0]?.items[0]
    assert.equal(taskItem?.title, "Generated Database Task")
    assert.equal(
      taskItem?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Doing"
      ),
      true
    )
    const editPropertyAction = taskItem?.actions.find((action) => action.title === "Edit Property")
    assert.ok(editPropertyAction)
    const setStatusAction = editPropertyAction.children?.find(
      (action) => action.title === "Set Status"
    )
    assert.ok(setStatusAction)
    const setDoneAction = setStatusAction.children?.find((action) => action.title === "Done")
    assert.ok(setDoneAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: setDoneAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const refreshedSnapshot = renderer.getSnapshot()
    assertListSnapshot(refreshedSnapshot)
    const refreshedAccessories = refreshedSnapshot.sections[0]?.items[0]?.accessories ?? []
    assert.equal(
      refreshedAccessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Done"
      ),
      true
    )
  })

  const updateRequest = fetchRequests.find(
    (request) =>
      request.url === "https://api.notion.com/v1/pages/page-database-task-1" &&
      request.method === "PATCH"
  )
  assert.deepEqual(
    (
      updateRequest?.body as
        | {
            properties?: {
              status?: {
                status?: {
                  id?: string
                }
              }
            }
          }
        | undefined
    )?.properties?.status,
    {
      status: {
        id: "done"
      }
    }
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Updating Property", "Property Updated"]
  )
})

test("Notion database list saves visible properties and kanban view settings", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          properties: {
            multi_select: {},
            status: {}
          }
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    const taskItem = databaseSnapshot.sections[0]?.items[0]
    assert.equal(
      taskItem?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Migration"
      ),
      true
    )
    const showHidePropertiesAction = taskItem?.actions.find(
      (action) => action.title === "Show/Hide Properties"
    )
    assert.ok(showHidePropertiesAction)
    const hideTagsAction = showHidePropertiesAction.children?.find(
      (action) => action.title === "Tags  ✓"
    )
    assert.ok(hideTagsAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: hideTagsAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.deepEqual(JSON.parse(String(storage.get("DATABASES_VIEWS"))), {
      "data-source-generated-1": {
        properties: {
          status: {}
        }
      }
    })

    const hiddenSnapshot = renderer.getSnapshot()
    assertListSnapshot(hiddenSnapshot)
    const setViewTypeAction = hiddenSnapshot.sections[0]?.items[0]?.actions.find(
      (action) => action.title === "Set View Type"
    )
    assert.ok(setViewTypeAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: setViewTypeAction.id,
        revision: hiddenSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const formSnapshot = renderer.getSnapshot()
    assertFormSnapshot(formSnapshot)
    assert.equal(formSnapshot.navigationTitle, "Set View Type")
    const nameField = formSnapshot.fields.find((field) => field.id === "name")
    assert.equal(nameField?.kind, "text-field")
    const viewTypeField = formSnapshot.fields.find((field) => field.id === "type")
    assert.equal(viewTypeField?.kind, "dropdown")
    assert.equal(viewTypeField?.kind === "dropdown" ? viewTypeField.value : undefined, "list")
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "view-name",
        fieldId: "name",
        type: "form.field.change",
        value: "Generated Board"
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "view-type",
        fieldId: "type",
        type: "form.field.change",
        value: "kanban"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const kanbanSnapshot = renderer.getSnapshot()
    assertFormSnapshot(kanbanSnapshot)
    const kanbanPropertyField = kanbanSnapshot.fields.find(
      (field) => field.id === "kanban::property_id"
    )
    assert.equal(kanbanPropertyField?.kind, "dropdown")
    assert.equal(
      kanbanPropertyField?.kind === "dropdown" ? kanbanPropertyField.value : undefined,
      "status"
    )
    const completedField = kanbanSnapshot.fields.find(
      (field) => field.id === "kanban::completed_ids"
    )
    assert.equal(completedField?.kind, "tag-picker")
    assert.deepEqual(completedField?.kind === "tag-picker" ? completedField.value : undefined, [
      "done"
    ])
    const saveAction = kanbanSnapshot.actions.find((action) => action.title === "Save View")
    assert.ok(saveAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: saveAction.id,
        revision: kanbanSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.deepEqual(JSON.parse(String(storage.get("DATABASES_VIEWS"))), {
      "data-source-generated-1": {
        kanban: {
          backlog_ids: ["_select_null_"],
          canceled_ids: [],
          completed_ids: ["done"],
          not_started_ids: ["doing"],
          property_id: "status",
          started_ids: []
        },
        name: "Generated Board",
        properties: {
          status: {}
        },
        sort_by: {},
        type: "kanban"
      }
    })

    const kanbanListSnapshot = renderer.getSnapshot()
    assertListSnapshot(kanbanListSnapshot)
    assert.equal(kanbanListSnapshot.navigationTitle, "Generated Board")
    assert.deepEqual(
      kanbanListSnapshot.sections.map((section) => section.title),
      ["Doing"]
    )
  })
})

test("Notion database list edits multi-select and people through quick property actions", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          properties: {
            multi_select: {},
            people: {}
          }
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    const taskItem = databaseSnapshot.sections[0]?.items[0]
    assert.equal(taskItem?.title, "Generated Database Task")
    assert.equal(
      taskItem?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Migration"
      ),
      true
    )
    assert.equal(
      taskItem?.accessories.some((accessory) => visualIncludesText(accessory, "Alex Chen")),
      true
    )

    const editPropertyAction = taskItem?.actions.find((action) => action.title === "Edit Property")
    assert.ok(editPropertyAction)
    const setTagsAction = editPropertyAction.children?.find((action) => action.title === "Set Tags")
    assert.ok(setTagsAction)
    const addPriorityAction = setTagsAction.children?.find((action) => action.title === "Priority")
    assert.ok(addPriorityAction)
    const setAssigneeAction = editPropertyAction.children?.find(
      (action) => action.title === "Set Assignee"
    )
    assert.ok(setAssigneeAction)
    const removeAlexAction = setAssigneeAction.children?.find(
      (action) => action.title === "Alex Chen  ✓"
    )
    assert.ok(removeAlexAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: addPriorityAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const tagUpdatedSnapshot = renderer.getSnapshot()
    assertListSnapshot(tagUpdatedSnapshot)
    assert.equal(
      tagUpdatedSnapshot.sections[0]?.items[0]?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Priority"
      ),
      true
    )

    assert.equal(
      await renderer.dispatchEvent({
        actionId: removeAlexAction.id,
        revision: tagUpdatedSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const peopleUpdatedSnapshot = renderer.getSnapshot()
    assertListSnapshot(peopleUpdatedSnapshot)
    assert.equal(
      peopleUpdatedSnapshot.sections[0]?.items[0]?.accessories.some((accessory) =>
        visualIncludesText(accessory, "Alex Chen")
      ),
      false
    )
  })

  const updateRequests = fetchRequests.filter(
    (request) =>
      request.url === "https://api.notion.com/v1/pages/page-database-task-1" &&
      request.method === "PATCH"
  )
  assert.deepEqual(
    (
      updateRequests[0]?.body as
        | {
            properties?: {
              multi_select?: {
                multi_select?: Array<{
                  id?: string
                }>
              }
            }
          }
        | undefined
    )?.properties?.multi_select,
    {
      multi_select: [
        {
          id: "migration"
        },
        {
          id: "priority"
        }
      ]
    }
  )
  assert.deepEqual(
    (
      updateRequests[1]?.body as
        | {
            properties?: {
              people?: {
                people?: Array<{
                  id?: string
                }>
              }
            }
          }
        | undefined
    )?.properties?.people,
    {
      people: []
    }
  )
})

test("Notion database list edits checkbox, select, and date through quick property actions", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          properties: {
            blocked: {},
            due: {},
            priority_select: {}
          }
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    const taskItem = databaseSnapshot.sections[0]?.items[0]
    assert.equal(taskItem?.title, "Generated Database Task")
    assert.equal(
      taskItem?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "Low"
      ),
      true
    )
    assert.equal(
      taskItem?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "High"
      ),
      false
    )

    const editPropertyAction = taskItem?.actions.find((action) => action.title === "Edit Property")
    assert.ok(editPropertyAction)
    const checkBlockedAction = editPropertyAction.children?.find(
      (action) => action.title === "Check Blocked"
    )
    assert.ok(checkBlockedAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: checkBlockedAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const blockedSnapshot = renderer.getSnapshot()
    assertListSnapshot(blockedSnapshot)
    const blockedEditPropertyAction = blockedSnapshot.sections[0]?.items[0]?.actions.find(
      (action) => action.title === "Edit Property"
    )
    assert.ok(blockedEditPropertyAction)
    const blockedSetPriorityAction = blockedEditPropertyAction.children?.find(
      (action) => action.title === "Set Priority"
    )
    assert.ok(blockedSetPriorityAction)
    const highPriorityAction = blockedSetPriorityAction.children?.find(
      (action) => action.title === "High"
    )
    assert.ok(highPriorityAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: highPriorityAction.id,
        revision: blockedSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const prioritySnapshot = renderer.getSnapshot()
    assertListSnapshot(prioritySnapshot)
    assert.equal(
      prioritySnapshot.sections[0]?.items[0]?.accessories.some(
        (accessory) => accessory.kind === "text" && accessory.text === "High"
      ),
      true
    )
    const priorityEditPropertyAction = prioritySnapshot.sections[0]?.items[0]?.actions.find(
      (action) => action.title === "Edit Property"
    )
    assert.ok(priorityEditPropertyAction)
    const prioritySetDueAction = priorityEditPropertyAction.children?.find(
      (action) => action.title === "Set Due"
    )
    assert.ok(prioritySetDueAction)
    const noDateAction = prioritySetDueAction.children?.find((action) => action.title === "No Date")
    assert.ok(noDateAction)
    const dueNowAction = noDateAction.children?.find((action) => action.title === "Now")
    assert.ok(dueNowAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: dueNowAction.id,
        revision: prioritySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const updateRequests = fetchRequests.filter(
    (request) =>
      request.url === "https://api.notion.com/v1/pages/page-database-task-1" &&
      request.method === "PATCH"
  )
  assert.deepEqual(
    (
      updateRequests[0]?.body as
        | {
            properties?: {
              blocked?: {
                checkbox?: boolean
              }
            }
          }
        | undefined
    )?.properties?.blocked,
    {
      checkbox: true
    }
  )
  assert.deepEqual(
    (
      updateRequests[1]?.body as
        | {
            properties?: {
              priority_select?: {
                select?: {
                  id?: string
                }
              }
            }
          }
        | undefined
    )?.properties?.priority_select,
    {
      select: {
        id: "high"
      }
    }
  )
  const dueStart = (
    updateRequests[2]?.body as
      | {
          properties?: {
            due?: {
              date?: {
                start?: unknown
              }
            }
          }
        }
      | undefined
  )?.properties?.due?.date?.start
  assert.equal(typeof dueStart, "string")
})

test("Notion database list archives a page after confirmation", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "RECENT_PAGES",
      JSON.stringify([
        {
          id: "page-database-task-1",
          last_visited_time: 1,
          type: "page"
        }
      ])
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const databaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(databaseSnapshot)
    const taskItem = databaseSnapshot.sections[0]?.items[0]
    const deleteAction = taskItem?.actions.find((action) => action.title === "Delete Page")
    assert.ok(deleteAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: deleteAction.id,
        revision: databaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const deleteRequest = fetchRequests.find(
    (request) =>
      request.url === "https://api.notion.com/v1/pages/page-database-task-1" &&
      request.method === "PATCH" &&
      (request.body as { archived?: unknown } | undefined)?.archived === true
  )
  assert.ok(deleteRequest)
  assert.equal(
    hostRequests.some(
      (request) =>
        request.capability === "dialog" &&
        request.method === "confirm-alert" &&
        request.payload.title === "Delete Page"
    ),
    true
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Deleting page", "Page deleted"]
  )
  assert.deepEqual(JSON.parse(String(storage.get("RECENT_PAGES"))), [])
})

test("Notion search results archive a database after confirmation", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "RECENT_PAGES",
      JSON.stringify([
        {
          id: "data-source-generated-1",
          last_visited_time: 1,
          type: "database"
        }
      ])
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const deleteAction = databaseItem?.actions.find((action) => action.title === "Delete Database")
    assert.ok(deleteAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: deleteAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const deleteRequest = fetchRequests.find(
    (request) =>
      request.url === "https://api.notion.com/v1/data_sources/data-source-generated-1" &&
      request.method === "PATCH" &&
      (request.body as { in_trash?: unknown } | undefined)?.in_trash === true
  )
  assert.ok(deleteRequest)
  assert.equal(
    hostRequests.some(
      (request) =>
        request.capability === "dialog" &&
        request.method === "confirm-alert" &&
        request.payload.title === "Delete Database"
    ),
    true
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Deleting database", "Database deleted"]
  )
  assert.deepEqual(JSON.parse(String(storage.get("RECENT_PAGES"))), [])
})

test("Notion add-text-to-page submits markdown and keeps the launcher open", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "add-text-to-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["add-text-to-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "add-text-to-page",
          launchProps: {
            arguments: {
              text: "## Migration note"
            }
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const formSnapshot = renderer.getSnapshot()
    assertFormSnapshot(formSnapshot)
    const pageField = formSnapshot.fields.find((field) => field.id === "page")
    assert.equal(pageField?.kind, "dropdown")
    assert.equal(pageField?.kind === "dropdown" ? pageField.searchable : undefined, true)
    assert.deepEqual(
      pageField?.kind === "dropdown"
        ? pageField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Runtime Notes",
          value: "page-generated-1"
        }
      ]
    )
    assert.equal(
      await renderer.dispatchEvent({
        fieldId: "page",
        query: "Migration",
        type: "form.dropdown.search"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(searchedSnapshot)
    const searchedPageField = searchedSnapshot.fields.find((field) => field.id === "page")
    assert.deepEqual(
      searchedPageField?.kind === "dropdown"
        ? searchedPageField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Migration Search Result",
          value: "page-search-generated"
        }
      ]
    )
    assert.equal(
      searchedPageField?.kind === "dropdown" ? searchedPageField.value : undefined,
      ""
    )
    const textField = formSnapshot.fields.find((field) => field.id === "textToAppend")
    assert.equal(textField?.kind, "text-area")
    assert.equal(textField?.kind === "text-area" ? textField.value : undefined, "## Migration note")

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-page",
        fieldId: "page",
        type: "form.field.change",
        value: "page-search-generated"
      }),
      true
    )
    const selectedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(selectedSnapshot)
    const selectedPageField = selectedSnapshot.fields.find((field) => field.id === "page")
    assert.equal(
      selectedPageField?.kind === "dropdown" ? selectedPageField.value : undefined,
      "page-search-generated"
    )
    const submitAction = selectedSnapshot.actions.find(
      (action) => action.title === "Add Text to Page"
    )
    assert.ok(submitAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        revision: selectedSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const appendRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/blocks/page-search-generated/children"
  )
  assert.equal(appendRequest?.method, "PATCH")
  assert.equal(
    (appendRequest?.body as { after?: unknown } | undefined)?.after,
    undefined
  )
  assert.deepEqual((appendRequest?.body as { position?: unknown } | undefined)?.position, {
    type: "end"
  })
  assert.equal(
    Array.isArray((appendRequest?.body as { children?: unknown[] } | undefined)?.children),
    true
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Adding content to the page", "Added text to page"]
  )
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "navigation" && request.method === "hide-launcher"
    ),
    false
  )
})

test("Notion add-text-to-page prepends content using the current Notion position API", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "add-text-to-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["add-text-to-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "add-text-to-page"
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const formSnapshot = renderer.getSnapshot()
    assertFormSnapshot(formSnapshot)
    const pageField = formSnapshot.fields.find((field) => field.id === "page")
    assert.equal(pageField?.kind, "dropdown")
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-page",
        fieldId: "page",
        type: "form.field.change",
        value: "page-generated-1"
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-content",
        fieldId: "textToAppend",
        type: "form.field.change",
        value: "This is prepended content"
      }),
      true
    )

    const selectedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(selectedSnapshot)
    const submitAction = selectedSnapshot.actions.find(
      (action) => action.title === "Add Text to Page"
    )
    assert.ok(submitAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        formValues: {
          addDateDivider: true,
          page: "page-generated-1",
          prepend: true,
          textToAppend: "This is prepended content"
        },
        revision: selectedSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const appendRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/blocks/page-generated-1/children"
  )
  assert.equal(appendRequest?.method, "PATCH")
  assert.equal(
    (appendRequest?.body as { after?: unknown } | undefined)?.after,
    undefined
  )
  assert.deepEqual((appendRequest?.body as { position?: unknown } | undefined)?.position, {
    type: "start"
  })
  assert.equal(
    Array.isArray((appendRequest?.body as { children?: unknown[] } | undefined)?.children),
    true
  )
  assert.equal(
    (appendRequest?.body as { children?: unknown[] } | undefined)?.children?.[0] &&
      "divider" in
        ((appendRequest?.body as { children?: unknown[] } | undefined)?.children?.[0] as Record<
          string,
          unknown
        >),
    true
  )
  assert.equal(
    fetchRequests.some(
      (request) =>
        request.method === "GET" &&
        request.url === "https://api.notion.com/v1/blocks/page-generated-1/children?page_size=100"
    ),
    false
  )
})

test("Notion create-database-page loads schema, reads clipboard, creates a page, and closes the launcher", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "create-database-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["create-database-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "create-database-page",
          commandPreferences: {
            closeAfterCreate: true,
            useClipboard: "title"
          },
          registerToastAction: renderer.registerToastAction
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertFormSnapshot(initialSnapshot)
    assert.equal(initialSnapshot.navigationTitle, "Create Database Page")
    const databaseField = initialSnapshot.fields.find((field) => field.id === "database")
    assert.equal(databaseField?.kind, "dropdown")
    assert.deepEqual(
      databaseField?.kind === "dropdown"
        ? databaseField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Generated Tasks",
          value: "data-source-generated-1"
        }
      ]
    )

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-database",
        fieldId: "database",
        type: "form.field.change",
        value: "data-source-generated-1"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const loadedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(loadedSnapshot)
    const titleField = loadedSnapshot.fields.find((field) => field.id === "property::title::title")
    assert.equal(titleField?.kind, "text-field")
    assert.equal(
      titleField?.kind === "text-field" ? titleField.value : undefined,
      "Clipboard generated title"
    )

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-page-content",
        fieldId: "content",
        type: "form.field.change",
        value: "Body from generated create"
      }),
      true
    )
    const readySnapshot = renderer.getSnapshot()
    assertFormSnapshot(readySnapshot)
    const createQuicklinkAction = readySnapshot.actions.find(
      (action) => action.title === "Create Quicklink to Command as Configured"
    )
    assert.ok(createQuicklinkAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: createQuicklinkAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )

    const submitAction = readySnapshot.actions.find(
      (action) => action.title === "Create Page and Close"
    )
    assert.ok(submitAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const createPageRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/pages"
  )
  assert.equal(createPageRequest?.method, "POST")
  assert.deepEqual((createPageRequest?.body as { parent?: unknown } | undefined)?.parent, {
    database_id: "database-generated-1"
  })
  assert.equal(
    (
      createPageRequest?.body as
        | {
            properties?: {
              title?: {
                title?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }
          }
        | undefined
    )?.properties?.title?.title?.[0]?.text?.content,
    "Clipboard generated title"
  )
  assert.equal(
    (
      createPageRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content,
    "Body from generated create"
  )
  const createPageQuicklink = hostRequests.find((request) => request.capability === "quicklinks")
    ?.payload
  assert.ok(createPageQuicklink)
  assert.equal(createPageQuicklink.extensionName, "notion")
  assert.equal(createPageQuicklink.name, "Create new page in Generated Tasks")
  assert.equal(createPageQuicklink.shortcut, undefined)
  const createPageQuicklinkUrl = new URL(createPageQuicklink.link)
  assert.equal(createPageQuicklinkUrl.protocol, "openwork:")
  assert.equal(createPageQuicklinkUrl.hostname, "extensions")
  assert.equal(createPageQuicklinkUrl.pathname, "/notion/create-database-page")
  assert.deepEqual(
    JSON.parse(String(createPageQuicklinkUrl.searchParams.get("launchContext"))),
    {
      defaults: {
        content: "Body from generated create",
        database: "data-source-generated-1",
        "property::title::title": "Clipboard generated title"
      },
      visiblePropIds: [
        "multi_select",
        "status",
        "relation",
        "priority_select",
        "title",
        "due",
        "blocked",
        "people"
      ]
    }
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Creating page", "Page created"]
  )
  const pageCreatedToast = hostRequests
    .filter((request) => request.capability === "toast")
    .find((request) => request.payload.title === "Page created")?.payload
  assert.deepEqual(pageCreatedToast?.primaryAction, {
    id: "toast-action-0",
    shortcut: {
      key: "o",
      modifiers: ["cmd"]
    },
    title: "Open Page"
  })
  assert.deepEqual(pageCreatedToast?.secondaryAction, {
    id: "toast-action-1",
    shortcut: {
      key: "c",
      modifiers: ["cmd", "shift"]
    },
    title: "Copy URL"
  })
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "clipboard" && request.method === "read-text"
    ),
    true
  )
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "navigation" && request.method === "hide-launcher"
    ),
    true
  )
})

test("Notion create-database-page respects visible property ordering and relation fields", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          create_properties: ["title", "relation", "people", "multi_select"]
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "create-database-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["create-database-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "create-database-page"
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertFormSnapshot(initialSnapshot)
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-database",
        fieldId: "database",
        type: "form.field.change",
        value: "data-source-generated-1"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const loadedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(loadedSnapshot)
    assert.deepEqual(
      loadedSnapshot.fields
        .filter((field) => field.kind !== "separator" && field.kind !== "message")
        .map((field) => ({ id: field.id, kind: field.kind, title: field.title })),
      [
        {
          id: "database",
          kind: "dropdown",
          title: "Database"
        },
        {
          id: "property::title::title",
          kind: "text-field",
          title: "Name"
        },
        {
          id: "property::relation::relation",
          kind: "tag-picker",
          title: "Related"
        },
        {
          id: "property::people::people",
          kind: "tag-picker",
          title: "Assignee"
        },
        {
          id: "property::multi_select::multi_select",
          kind: "tag-picker",
          title: "Tags"
        },
        {
          id: "content",
          kind: "text-area",
          title: "Page Content"
        }
      ]
    )

    const relationField = loadedSnapshot.fields.find(
      (field) => field.id === "property::relation::relation"
    )
    assert.equal(relationField?.kind, "tag-picker")
    assert.deepEqual(
      relationField?.kind === "tag-picker"
        ? relationField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Generated Related Page",
          value: "page-related-generated"
        }
      ]
    )

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-title",
        fieldId: "property::title::title",
        type: "form.field.change",
        value: "Created with relations"
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-relation",
        fieldId: "property::relation::relation",
        type: "form.field.change",
        value: ["page-related-generated"]
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-people",
        fieldId: "property::people::people",
        type: "form.field.change",
        value: ["user-1"]
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-tag",
        fieldId: "property::multi_select::multi_select",
        type: "form.field.change",
        value: ["migration"]
      }),
      true
    )

    const readySnapshot = renderer.getSnapshot()
    assertFormSnapshot(readySnapshot)
    const submitAction = readySnapshot.actions.find((action) => action.title === "Create Page")
    assert.ok(submitAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const createPageRequest = fetchRequests.findLast(
    (request) => request.url === "https://api.notion.com/v1/pages"
  )
  const properties = (
    createPageRequest?.body as
      | {
          properties?: Record<string, unknown>
        }
      | undefined
  )?.properties
  assert.deepEqual(properties?.relation, {
    relation: [
      {
        id: "page-related-generated"
      }
    ]
  })
  assert.deepEqual(properties?.people, {
    people: [
      {
        id: "user-1"
      }
    ]
  })
  assert.deepEqual(properties?.multi_select, {
    multi_select: [
      {
        id: "migration"
      }
    ]
  })
})

test("Notion create-database-page preserves explicit false checkbox values", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>([
    [
      "DATABASES_VIEWS",
      JSON.stringify({
        "data-source-generated-1": {
          create_properties: ["title", "blocked"]
        }
      })
    ]
  ])

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "create-database-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["create-database-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "create-database-page"
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-database",
        fieldId: "database",
        type: "form.field.change",
        value: "data-source-generated-1"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-title",
        fieldId: "property::title::title",
        type: "form.field.change",
        value: "Created with explicit false"
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-blocked",
        fieldId: "property::checkbox::blocked",
        type: "form.field.change",
        value: false
      }),
      true
    )

    const readySnapshot = renderer.getSnapshot()
    assertFormSnapshot(readySnapshot)
    const submitAction = readySnapshot.actions.find((action) => action.title === "Create Page")
    assert.ok(submitAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const createPageRequest = fetchRequests.findLast(
    (request) => request.url === "https://api.notion.com/v1/pages"
  )
  const properties = (
    createPageRequest?.body as
      | {
          properties?: Record<string, unknown>
        }
      | undefined
  )?.properties
  assert.deepEqual(properties?.blocked, {
    checkbox: false
  })
})

test("Notion pushed create page form submits and pops back to database list", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "search-page",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["search-page"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandPreferences: {
            primaryAction: "openwork"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "database",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchSnapshot = renderer.getSnapshot()
    assertListSnapshot(searchSnapshot)
    const databaseItem = searchSnapshot.sections
      .flatMap((section) => section.items)
      .find((item) => item.title === "Generated Tasks")
    const navigateAction = databaseItem?.actions.find(
      (action) => action.title === "Navigate to Database"
    )
    assert.ok(navigateAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: navigateAction.id,
        revision: searchSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    assert.equal(
      await renderer.dispatchEvent({
        query: "No matching generated task",
        type: "list.query.change"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const emptyDatabaseSnapshot = renderer.getSnapshot()
    assertListSnapshot(emptyDatabaseSnapshot)
    assert.equal(emptyDatabaseSnapshot.emptyView?.title, "No pages found")
    const createAction = emptyDatabaseSnapshot.emptyView?.actions.find(
      (action) => action.title === "Create New Page"
    )
    assert.ok(createAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: createAction.id,
        revision: emptyDatabaseSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const createFormSnapshot = renderer.getSnapshot()
    assertFormSnapshot(createFormSnapshot)
    assert.equal(createFormSnapshot.canPop, true)
    assert.equal(createFormSnapshot.navigationTitle, "Create New Page")
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "set-title",
        fieldId: "property::title::title",
        type: "form.field.change",
        value: "Created from pushed form"
      }),
      true
    )

    const readySnapshot = renderer.getSnapshot()
    assertFormSnapshot(readySnapshot)
    const submitAction = readySnapshot.actions.find((action) => action.title === "Create Page")
    assert.ok(submitAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: submitAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const poppedSnapshot = renderer.getSnapshot()
    assertListSnapshot(poppedSnapshot)
    assert.equal(poppedSnapshot.navigationTitle, "Generated Tasks")
  })

  const createPageRequest = fetchRequests.findLast(
    (request) => request.url === "https://api.notion.com/v1/pages"
  )
  assert.equal(
    (
      createPageRequest?.body as
        | {
            properties?: {
              title?: {
                title?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }
          }
        | undefined
    )?.properties?.title?.title?.[0]?.text?.content,
    "Created from pushed form"
  )
})

test("Notion quick-capture extracts a selected URL page and appends it to Notion", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "quick-capture",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["quick-capture"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "quick-capture",
          launchProps: {
            fallbackText: "https://example.com/article"
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertFormSnapshot(initialSnapshot)
    const urlField = initialSnapshot.fields.find((field) => field.id === "url")
    assert.equal(urlField?.kind, "text-field")
    assert.equal(
      urlField?.kind === "text-field" ? urlField.value : undefined,
      "https://example.com/article"
    )
    const captureAsField = initialSnapshot.fields.find((field) => field.id === "captureAs")
    assert.equal(captureAsField?.kind, "dropdown")
    assert.deepEqual(
      captureAsField?.kind === "dropdown"
        ? captureAsField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Bookmark",
          value: "url"
        },
        {
          title: "Full Page",
          value: "full"
        },
        {
          title: "Summarize Page with AI",
          value: "ai"
        }
      ]
    )
    const pageField = initialSnapshot.fields.find((field) => field.id === "page")
    assert.equal(pageField?.kind, "dropdown")
    assert.equal(pageField?.kind === "dropdown" ? pageField.searchable : undefined, true)

    assert.equal(
      await renderer.dispatchEvent({
        fieldId: "page",
        query: "Migration",
        type: "form.dropdown.search"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const searchedSnapshot = renderer.getSnapshot()
    assertFormSnapshot(searchedSnapshot)
    const searchedPageField = searchedSnapshot.fields.find((field) => field.id === "page")
    assert.deepEqual(
      searchedPageField?.kind === "dropdown"
        ? searchedPageField.items.map((item) => ({ title: item.title, value: item.value }))
        : [],
      [
        {
          title: "Migration Search Result",
          value: "page-search-generated"
        }
      ]
    )

    assert.equal(
      await renderer.dispatchEvent({
        changeId: "capture-full-page",
        fieldId: "captureAs",
        type: "form.field.change",
        value: "full"
      }),
      true
    )
    assert.equal(
      await renderer.dispatchEvent({
        changeId: "select-capture-page",
        fieldId: "page",
        type: "form.field.change",
        value: "page-search-generated"
      }),
      true
    )

    const readySnapshot = renderer.getSnapshot()
    assertFormSnapshot(readySnapshot)
    const captureAction = readySnapshot.actions.find((action) => action.title === "Capture")
    assert.ok(captureAction)

    assert.equal(
      await renderer.dispatchEvent({
        actionId: captureAction.id,
        revision: readySnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const appendRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/blocks/page-search-generated/children"
  )
  assert.equal(appendRequest?.method, "PATCH")
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                    link?: {
                      url?: string
                    }
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content,
    "Generated Article"
  )
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                    link?: {
                      url?: string
                    }
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.link?.url,
    "https://example.com/article"
  )
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[1]?.paragraph?.rich_text?.[0]?.text?.content,
    "Generated article body for quick capture."
  )
  assert.equal(
    fetchRequests.some((request) => request.url === "https://example.com/article"),
    true
  )
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "clipboard" && request.method === "read-selected-text"
    ),
    false
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Capturing content to page", "Captured content to page"]
  )
  assert.equal(
    hostRequests.some(
      (request) => request.capability === "navigation" && request.method === "hide-launcher"
    ),
    true
  )
})

test("Notion quick-capture can summarize a selected URL with AI", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "quick-capture",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["quick-capture"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "quick-capture",
          launchProps: {
            fallbackText: "https://example.com/article",
            launchContext: {
              defaults: {
                captureAs: "ai",
                objectType: "page",
                pageId: "page-generated-1"
              }
            }
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertFormSnapshot(initialSnapshot)
    const captureAsField = initialSnapshot.fields.find((field) => field.id === "captureAs")
    assert.equal(captureAsField?.kind, "dropdown")
    assert.equal(captureAsField?.kind === "dropdown" ? captureAsField.value : undefined, "ai")

    const captureAction = initialSnapshot.actions.find((action) => action.title === "Capture")
    assert.ok(captureAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: captureAction.id,
        revision: initialSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const aiRequest = hostRequests.find(
    (request) => request.capability === "ai" && request.method === "ask"
  )
  assert.ok(aiRequest)
  assert.match(aiRequest.payload.prompt, /Summarize the page content/)
  assert.match(aiRequest.payload.prompt, /Generated article body for quick capture\./)

  const appendRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/blocks/page-generated-1/children"
  )
  assert.equal(appendRequest?.method, "PATCH")
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[1]?.paragraph?.rich_text?.[0]?.text?.content,
    "Generated AI summary for quick capture."
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Capturing content to page", "Captured content to page"]
  )
})

test("Notion quick-capture honors quicklink launch context defaults", async () => {
  const fetchRequests: NotionFetchRequest[] = []
  const hostRequests: ExtensionRuntimeHostRequestInput[] = []
  const storage = new Map<string, unknown>()

  await withMockedNotionFetch(fetchRequests, async () => {
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: "quick-capture",
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands["quick-capture"]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName: "quick-capture",
          launchProps: {
            fallbackText: "https://example.com/article",
            launchContext: {
              defaults: {
                captureAs: "full",
                objectType: "page",
                pageId: "page-generated-1"
              }
            }
          }
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const initialSnapshot = renderer.getSnapshot()
    assertFormSnapshot(initialSnapshot)
    const captureAsField = initialSnapshot.fields.find((field) => field.id === "captureAs")
    assert.equal(captureAsField?.kind, "dropdown")
    assert.equal(captureAsField?.kind === "dropdown" ? captureAsField.value : undefined, "full")
    assert.equal(
      initialSnapshot.fields.some((field) => field.id === "page"),
      false
    )

    const captureAction = initialSnapshot.actions.find((action) => action.title === "Capture")
    assert.ok(captureAction)
    assert.equal(
      await renderer.dispatchEvent({
        actionId: captureAction.id,
        revision: initialSnapshot.revision,
        type: "action.execute"
      }),
      true
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()
  })

  const appendRequest = fetchRequests.find(
    (request) => request.url === "https://api.notion.com/v1/blocks/page-generated-1/children"
  )
  assert.equal(appendRequest?.method, "PATCH")
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                    link?: {
                      url?: string
                    }
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content,
    "Generated Article"
  )
  assert.equal(
    (
      appendRequest?.body as
        | {
            children?: Array<{
              paragraph?: {
                rich_text?: Array<{
                  text?: {
                    content?: string
                  }
                }>
              }
            }>
          }
        | undefined
    )?.children?.[1]?.paragraph?.rich_text?.[0]?.text?.content,
    "Generated article body for quick capture."
  )
  assert.equal(
    fetchRequests.some((request) => request.url === "https://api.notion.com/v1/pages/page-generated-1"),
    true
  )
  assert.deepEqual(
    hostRequests
      .filter((request) => request.capability === "toast")
      .map((request) => request.payload.title),
    ["Capturing content to page", "Captured content to page"]
  )
})

for (const commandName of NOTION_VIEW_COMMAND_NAMES) {
  test(`Notion ${commandName} without auth renders a connection prompt`, async () => {
    const hostRequests: ExtensionRuntimeHostRequestInput[] = []
    const storage = new Map<string, unknown>()
    const renderer = createExtensionRuntimeRenderer(
      {
        commandName,
        extensionName: "notion"
      },
      {
        onHostRequest: (request) =>
          resolveNotionHostRequest(request, hostRequests, storage)
      }
    )

    const command = notionRuntime.commands[commandName]
    assert.equal(command.mode, "view")
    renderer.render(
      withRuntimeProvider(
        (context) => createElement(command.Component, createExtensionRuntimeLaunchProps(context)),
        hostRequests,
        storage,
        {
          commandName,
          extensionPreferences: {}
        }
      )
    )
    await renderer.flushSnapshots()
    await renderer.flushSnapshots()

    const snapshot = renderer.getSnapshot()
    assertListSnapshot(snapshot)
    assert.equal(snapshot.emptyView?.title, "Connection Required")
    assert.equal(
      snapshot.emptyView?.description,
      "Connect this extension in Settings before using this command."
    )
    assert.deepEqual(
      snapshot.emptyView?.actions.map((action) => action.title),
      ["Open Extension Settings"]
    )
  })
}

function withRuntimeProvider(
  element: ReactElement | ((context: ExtensionRuntimeSdkContextValue) => ReactElement),
  hostRequests: ExtensionRuntimeHostRequestInput[],
  storage: Map<string, unknown>,
  options: {
    commandName?: string
    commandPreferences?: Record<string, unknown>
    extensionPreferences?: Record<string, unknown>
    launchProps?: ExtensionRuntimeLaunchProps
    registerToastAction?: ExtensionRuntimeSdkContextValue["registerToastAction"]
  } = {}
): ReactElement {
  const requestHost: ExtensionRuntimeSdkContextValue["requestHost"] = (request) =>
    resolveNotionHostRequest(request, hostRequests, storage)
  const value: Omit<ExtensionRuntimeSdkContextValue, "navigation"> = {
    commandName: options.commandName ?? "search-page",
    commandPreferences: options.commandPreferences ?? {},
    extensionName: "notion",
    extensionPreferences: options.extensionPreferences ?? {
      accessToken: "secret-token"
    },
    initialAction: "open",
    launchProps: options.launchProps,
    locale: "zh-CN",
    mode: "view",
    registerToastAction: options.registerToastAction,
    requestHost,
    seedQuery: ""
  }

  return createElement(
    ExtensionRuntimeNavigationProvider,
    {
      value
    },
    typeof element === "function" ? element(value as ExtensionRuntimeSdkContextValue) : element
  )
}

async function withMockedNotionFetch<T>(
  requests: NotionFetchRequest[],
  callback: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch
  const state: MockNotionState = {
    assigneeIds: ["user-1"],
    dueStart: "2026-05-28",
    isBlocked: false,
    priorityId: "low",
    tagIds: ["migration"],
    taskStatusId: "doing"
  }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method,
      url
    })

    if (url === "https://api.notion.com/v1/search") {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (isDataSourceSearchBody(body)) {
        return jsonResponse({
          has_more: false,
          next_cursor: null,
          object: "list",
          results: [notionDataSource()]
        })
      }

      if (isDatabaseSearchQuery(body)) {
        return jsonResponse({
          has_more: false,
          next_cursor: null,
          object: "list",
          results: [notionDataSource()]
        })
      }

      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results:
          typeof body === "object" &&
          body !== null &&
          "query" in body &&
          body.query === "Migration"
            ? [notionStoredPage("page-search-generated", "Migration Search Result")]
            : [notionSearchPage()]
      })
    }

    if (url === "https://example.com/article") {
      return new Response(
        [
          "<!doctype html>",
          "<html>",
          "<head><title>Generated Article</title></head>",
          "<body>",
          "<article>",
          "<h1>Generated Article</h1>",
          "<p>Generated article body for quick capture.</p>",
          "</article>",
          "</body>",
          "</html>"
        ].join(""),
        {
          headers: {
            "Content-Type": "text/html"
          },
          status: 200
        }
      )
    }

    if (url === "https://api.notion.com/v1/users") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionUser(), notionUserTwo()]
      })
    }

    if (
      url.startsWith("https://api.notion.com/v1/blocks/page-generated-1/children") ||
      url.startsWith("https://api.notion.com/v1/blocks/page-search-generated/children") ||
      url.startsWith("https://api.notion.com/v1/blocks/page-database-task-1/children")
    ) {
      if (method === "PATCH") {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        return jsonResponse({
          has_more: false,
          next_cursor: null,
          object: "list",
          results: Array.isArray((body as { children?: unknown[] } | undefined)?.children)
            ? (body as { children: unknown[] }).children.map((child, index) => ({
                ...normalizeAppendedBlock(child),
                archived: false,
                created_by: {
                  id: "user-1",
                  object: "user"
                },
                created_time: "2026-05-26T10:00:00.000Z",
                has_children: false,
                id: `block-appended-${index + 1}`,
                last_edited_by: {
                  id: "user-1",
                  object: "user"
                },
                last_edited_time: "2026-05-26T12:00:00.000Z",
                object: "block",
                parent: {
                  page_id: "page-generated-1",
                  type: "page_id"
                }
              }))
            : []
        })
      }

      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: url.includes("page-database-task-1") ? [] : [notionParagraphBlock()]
      })
    }

    if (url === "https://api.notion.com/v1/data_sources/data-source-generated-1") {
      if (method === "PATCH") {
        return jsonResponse({
          ...notionDataSource(),
          in_trash: true
        })
      }

      return jsonResponse(notionDataSource())
    }

    if (url === "https://api.notion.com/v1/data_sources/data-source-related-generated") {
      return jsonResponse(notionRelatedDataSource())
    }

    if (url === "https://api.notion.com/v1/data_sources/data-source-generated-1/query") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionDatabaseTaskPage(state)]
      })
    }

    if (url === "https://api.notion.com/v1/data_sources/data-source-related-generated/query") {
      return jsonResponse({
        has_more: false,
        next_cursor: null,
        object: "list",
        results: [notionStoredPage("page-related-generated", "Generated Related Page")]
      })
    }

    if (url === "https://api.notion.com/v1/pages") {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse(notionCreatedPage(body))
    }

    if (url === "https://api.notion.com/v1/pages/page-generated-1") {
      return jsonResponse(notionSearchPage())
    }

    if (url === "https://api.notion.com/v1/pages/page-pinned-generated") {
      return jsonResponse(notionStoredPage("page-pinned-generated", "Pinned Generated Page"))
    }

    if (url === "https://api.notion.com/v1/pages/page-recent-generated") {
      return jsonResponse(notionStoredPage("page-recent-generated", "Recent Generated Page"))
    }

    if (url === "https://api.notion.com/v1/pages/page-database-task-1") {
      if (method === "PATCH") {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        if ((body as { archived?: unknown } | undefined)?.archived === true) {
          return jsonResponse({
            ...notionDatabaseTaskPage(state),
            archived: true
          })
        }
        const nextStatusId = readStatusIdPatch(body)
        if (nextStatusId === "doing" || nextStatusId === "done") {
          state.taskStatusId = nextStatusId
        }
        const nextTagIds = readMultiSelectIdsPatch(body)
        if (nextTagIds) {
          state.tagIds = nextTagIds
        }
        const nextAssigneeIds = readPeopleIdsPatch(body)
        if (nextAssigneeIds) {
          state.assigneeIds = nextAssigneeIds
        }
        const nextBlocked = readCheckboxPatch(body)
        if (nextBlocked !== undefined) {
          state.isBlocked = nextBlocked
        }
        const nextPriorityId = readSelectIdPatch(body)
        if (nextPriorityId === "high" || nextPriorityId === "low") {
          state.priorityId = nextPriorityId
        }
        const nextDueStart = readDateStartPatch(body)
        if (nextDueStart) {
          state.dueStart = nextDueStart
        }
        return jsonResponse(notionDatabaseTaskPage(state))
      }

      return jsonResponse(notionDatabaseTaskPage(state))
    }

    return jsonResponse(
      {
        code: "object_not_found",
        message: `Unexpected Notion API request: ${url}`,
        object: "error",
        status: 404
      },
      404
    )
  }

  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function normalizeAppendedBlock(block: unknown): Record<string, unknown> {
  if (
    typeof block !== "object" ||
    block === null ||
    !("type" in block) ||
    typeof block.type !== "string"
  ) {
    return {}
  }

  const normalizedBlock = { ...(block as Record<string, unknown>) }
  const blockContent = normalizedBlock[block.type]
  if (typeof blockContent !== "object" || blockContent === null || !("rich_text" in blockContent)) {
    return normalizedBlock
  }

  normalizedBlock[block.type] = {
    ...(blockContent as Record<string, unknown>),
    rich_text: Array.isArray(blockContent.rich_text)
      ? blockContent.rich_text.map(normalizeRichTextItem)
      : []
  }
  return normalizedBlock
}

function normalizeRichTextItem(item: unknown): Record<string, unknown> {
  if (typeof item !== "object" || item === null) {
    return {}
  }

  const richText = item as {
    href?: unknown
    plain_text?: unknown
    text?: {
      content?: unknown
      link?: {
        url?: unknown
      }
    }
  }
  const content = typeof richText.text?.content === "string" ? richText.text.content : ""
  return {
    ...richText,
    href: typeof richText.href === "string" ? richText.href : (richText.text?.link?.url ?? null),
    plain_text: typeof richText.plain_text === "string" ? richText.plain_text : content
  }
}

function resolveNotionHostRequest(
  request: ExtensionRuntimeHostRequestInput,
  hostRequests: ExtensionRuntimeHostRequestInput[],
  storage: Map<string, unknown>
): Promise<ExtensionHostResponse> {
  hostRequests.push(request)

  if (request.capability === "storage") {
    if (request.method === "get") {
      return Promise.resolve(createHostResponse(storage.get(request.payload.key)))
    }

    if (request.method === "set") {
      storage.set(request.payload.key, request.payload.value)
      return Promise.resolve(createHostResponse(null))
    }

    if (request.method === "remove") {
      storage.delete(request.payload.key)
      return Promise.resolve(createHostResponse(null))
    }
  }

  if (
    request.capability === "navigation" ||
    request.capability === "quicklinks" ||
    request.capability === "shell" ||
    request.capability === "toast"
  ) {
    return Promise.resolve(createHostResponse(null))
  }

  if (request.capability === "dialog" && request.method === "confirm-alert") {
    return Promise.resolve(createHostResponse(true))
  }

  if (request.capability === "ai" && request.method === "ask") {
    return Promise.resolve(createHostResponse("Generated AI summary for quick capture."))
  }

  if (request.capability === "clipboard" && request.method === "read-text") {
    return Promise.resolve(createHostResponse("Clipboard generated title"))
  }

  return Promise.resolve({
    error: {
      code: "unexpected_host_request",
      message: `Unexpected host request: ${request.capability}.${request.method}`
    },
    id: "unexpected-host-request",
    ok: false
  })
}

function visualIncludesText(visual: ExtensionVisualNode, text: string): boolean {
  if (visual.kind === "text") {
    return visual.text === text
  }

  if (visual.kind === "inline") {
    return visual.children.some((child) => visualIncludesText(child, text))
  }

  return false
}

function notionSearchPage(): Record<string, unknown> {
  return {
    archived: false,
    created_by: {
      id: "user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    icon: null,
    id: "page-generated-1",
    last_edited_by: {
      id: "user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "page",
    parent: {
      type: "workspace",
      workspace: true
    },
    properties: {
      Name: {
        id: "title",
        title: [
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
            plain_text: "Runtime Notes",
            text: {
              content: "Runtime Notes",
              link: null
            },
            type: "text"
          }
        ],
        type: "title"
      }
    },
    public_url: null,
    url: "https://www.notion.so/page-generated-1"
  }
}

function notionStoredPage(id: string, title: string): Record<string, unknown> {
  return {
    ...notionSearchPage(),
    id,
    properties: {
      Name: notionTitleProperty(title)
    },
    url: `https://www.notion.so/${id}`
  }
}

function notionDataSource(): Record<string, unknown> {
  return {
    archived: false,
    cover: null,
    created_by: {
      id: "user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    database_parent: {
      database_id: "database-generated-1",
      type: "database_id"
    },
    description: [],
    icon: null,
    id: "data-source-generated-1",
    in_trash: false,
    is_inline: false,
    last_edited_by: {
      id: "user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "data_source",
    parent: {
      database_id: "database-generated-1",
      type: "database_id"
    },
    properties: {
      Assignee: {
        description: null,
        id: "people",
        name: "Assignee",
        people: {},
        type: "people"
      },
      Blocked: {
        checkbox: {},
        description: null,
        id: "blocked",
        name: "Blocked",
        type: "checkbox"
      },
      Due: {
        date: {},
        description: null,
        id: "due",
        name: "Due",
        type: "date"
      },
      Name: {
        description: null,
        id: "title",
        name: "Name",
        title: {},
        type: "title"
      },
      Priority: {
        description: null,
        id: "priority_select",
        name: "Priority",
        select: {
          options: [
            {
              color: "red",
              description: null,
              id: "high",
              name: "High"
            },
            {
              color: "gray",
              description: null,
              id: "low",
              name: "Low"
            }
          ]
        },
        type: "select"
      },
      Related: {
        description: null,
        id: "relation",
        name: "Related",
        relation: {
          data_source_id: "data-source-related-generated",
          database_id: "database-related-generated",
          dual_property: {}
        },
        type: "relation"
      },
      Status: {
        description: null,
        id: "status",
        name: "Status",
        status: {
          groups: [],
          options: [
            {
              color: "blue",
              description: null,
              id: "doing",
              name: "Doing"
            },
            {
              color: "green",
              description: null,
              id: "done",
              name: "Done"
            }
          ]
        },
        type: "status"
      },
      Tags: {
        description: null,
        id: "multi_select",
        multi_select: {
          options: [
            {
              color: "purple",
              description: null,
              id: "migration",
              name: "Migration"
            },
            {
              color: "red",
              description: null,
              id: "priority",
              name: "Priority"
            }
          ]
        },
        name: "Tags",
        type: "multi_select"
      }
    },
    public_url: null,
    title: [
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
        plain_text: "Generated Tasks",
        text: {
          content: "Generated Tasks",
          link: null
        },
        type: "text"
      }
    ],
    url: "https://www.notion.so/database-generated-1"
  }
}

function notionRelatedDataSource(): Record<string, unknown> {
  return {
    ...notionDataSource(),
    id: "data-source-related-generated",
    parent: {
      database_id: "database-related-generated",
      type: "database_id"
    },
    properties: {
      Name: {
        description: null,
        id: "title",
        name: "Name",
        title: {},
        type: "title"
      }
    },
    title: [
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
        plain_text: "Generated Related",
        text: {
          content: "Generated Related",
          link: null
        },
        type: "text"
      }
    ],
    url: "https://www.notion.so/database-related-generated"
  }
}

function notionDatabaseTaskPage(
  state: MockNotionState = {
    assigneeIds: ["user-1"],
    dueStart: "2026-05-28",
    isBlocked: false,
    priorityId: "low",
    tagIds: ["migration"],
    taskStatusId: "doing"
  }
): Record<string, unknown> {
  const resolvedState: MockNotionState = {
    assigneeIds: state.assigneeIds ?? ["user-1"],
    tagIds: state.tagIds ?? ["migration"],
    dueStart: state.dueStart ?? "2026-05-28",
    isBlocked: state.isBlocked ?? false,
    priorityId: state.priorityId ?? "low",
    taskStatusId: state.taskStatusId
  }
  const status =
    resolvedState.taskStatusId === "done"
      ? {
          color: "green",
          id: "done",
          name: "Done"
        }
      : {
          color: "blue",
          id: "doing",
          name: "Doing"
        }

  return {
    ...notionSearchPage(),
    id: "page-database-task-1",
    last_edited_time: "2026-05-27T08:00:00.000Z",
    parent: {
      data_source_id: "data-source-generated-1",
      database_id: "database-generated-1",
      type: "data_source_id"
    },
    properties: {
      Assignee: {
        id: "people",
        people: resolvedState.assigneeIds.map((id) => ({
          id,
          object: "user"
        })),
        type: "people"
      },
      Blocked: {
        checkbox: resolvedState.isBlocked,
        id: "blocked",
        type: "checkbox"
      },
      Due: {
        date: {
          end: null,
          start: resolvedState.dueStart,
          time_zone: null
        },
        id: "due",
        type: "date"
      },
      Name: notionTitleProperty("Generated Database Task"),
      Priority: {
        id: "priority_select",
        select:
          resolvedState.priorityId === "high"
            ? {
                color: "red",
                id: "high",
                name: "High"
              }
            : {
                color: "gray",
                id: "low",
                name: "Low"
              },
        type: "select"
      },
      Related: {
        id: "relation",
        relation: [
          {
            id: "page-related-generated"
          }
        ],
        type: "relation"
      },
      Status: {
        id: "status",
        status,
        type: "status"
      },
      Tags: {
        id: "multi_select",
        multi_select: resolvedState.tagIds.map((id) =>
          id === "priority"
            ? {
                color: "red",
                id: "priority",
                name: "Priority"
              }
            : {
                color: "purple",
                id: "migration",
                name: "Migration"
              }
        ),
        type: "multi_select"
      }
    },
    url: "https://www.notion.so/page-database-task-1"
  }
}

function notionCreatedPage(createBody?: unknown): Record<string, unknown> {
  const title = readCreatePageTitle(createBody) ?? "Clipboard generated title"
  return {
    ...notionSearchPage(),
    id: "page-created-generated",
    parent: {
      database_id: "database-generated-1",
      type: "database_id"
    },
    properties: {
      title: notionTitleProperty(title)
    },
    url: "https://www.notion.so/page-created-generated"
  }
}

function readCreatePageTitle(createBody: unknown): string | undefined {
  if (typeof createBody !== "object" || createBody === null || !("properties" in createBody)) {
    return undefined
  }

  const properties = (createBody as { properties?: Record<string, unknown> }).properties
  const title = properties?.title as
    | {
        title?: Array<{
          text?: {
            content?: unknown
          }
        }>
      }
    | undefined

  return typeof title?.title?.[0]?.text?.content === "string"
    ? title.title[0].text.content
    : undefined
}

function readStatusIdPatch(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const status = properties?.status as
    | {
        status?: {
          id?: unknown
        }
      }
    | undefined

  return typeof status?.status?.id === "string" ? status.status.id : undefined
}

function readMultiSelectIdsPatch(body: unknown): string[] | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const multiSelect = properties?.multi_select as
    | {
        multi_select?: Array<{
          id?: unknown
        }>
      }
    | undefined

  return Array.isArray(multiSelect?.multi_select)
    ? multiSelect.multi_select.flatMap((option) =>
        typeof option.id === "string" ? [option.id] : []
      )
    : undefined
}

function readPeopleIdsPatch(body: unknown): string[] | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const people = properties?.people as
    | {
        people?: Array<{
          id?: unknown
        }>
      }
    | undefined

  return Array.isArray(people?.people)
    ? people.people.flatMap((person) => (typeof person.id === "string" ? [person.id] : []))
    : undefined
}

function readCheckboxPatch(body: unknown): boolean | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const blocked = properties?.blocked as
    | {
        checkbox?: unknown
      }
    | undefined

  return typeof blocked?.checkbox === "boolean" ? blocked.checkbox : undefined
}

function readSelectIdPatch(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const priority = properties?.priority_select as
    | {
        select?: {
          id?: unknown
        } | null
      }
    | undefined

  return typeof priority?.select?.id === "string" ? priority.select.id : undefined
}

function readDateStartPatch(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("properties" in body)) {
    return undefined
  }

  const properties = (body as { properties?: Record<string, unknown> }).properties
  const due = properties?.due as
    | {
        date?: {
          start?: unknown
        }
      }
    | undefined

  return typeof due?.date?.start === "string" ? due.date.start : undefined
}

function notionTitleProperty(title: string): Record<string, unknown> {
  return {
    id: "title",
    title: [
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
        plain_text: title,
        text: {
          content: title,
          link: null
        },
        type: "text"
      }
    ],
    type: "title"
  }
}

function notionUser(): Record<string, unknown> {
  return {
    avatar_url: "https://example.com/alex.png",
    id: "user-1",
    name: "Alex Chen",
    object: "user",
    person: {
      email: "alex@example.com"
    },
    type: "person"
  }
}

function notionUserTwo(): Record<string, unknown> {
  return {
    avatar_url: "https://example.com/blair.png",
    id: "user-2",
    name: "Blair Lee",
    object: "user",
    person: {
      email: "blair@example.com"
    },
    type: "person"
  }
}

function notionParagraphBlock(): Record<string, unknown> {
  return {
    archived: false,
    created_by: {
      id: "user-1",
      object: "user"
    },
    created_time: "2026-05-26T10:00:00.000Z",
    has_children: false,
    id: "block-generated-1",
    last_edited_by: {
      id: "user-1",
      object: "user"
    },
    last_edited_time: "2026-05-26T12:00:00.000Z",
    object: "block",
    paragraph: {
      color: "default",
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
          plain_text: "Body from official Notion migration",
          text: {
            content: "Body from official Notion migration",
            link: null
          },
          type: "text"
        }
      ]
    },
    parent: {
      page_id: "page-generated-1",
      type: "page_id"
    },
    type: "paragraph"
  }
}

function isDataSourceSearchBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "filter" in body &&
    typeof body.filter === "object" &&
    body.filter !== null &&
    "value" in body.filter &&
    body.filter.value === "data_source"
  )
}

function isDatabaseSearchQuery(body: unknown): boolean {
  return typeof body === "object" && body !== null && "query" in body && body.query === "database"
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  })
}

function createHostResponse(result: unknown): ExtensionHostResponse {
  return {
    id: "notion-host-response",
    ok: true,
    result
  }
}

function assertListSnapshot(
  snapshot: ReturnType<ReturnType<typeof createExtensionRuntimeRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionListSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "list")
}

function assertFormSnapshot(
  snapshot: ReturnType<ReturnType<typeof createExtensionRuntimeRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionFormSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "form")
}

function assertDetailSnapshot(
  snapshot: ReturnType<ReturnType<typeof createExtensionRuntimeRenderer>["getSnapshot"]>
): asserts snapshot is ExtensionDetailSurfaceSnapshot {
  assert.ok(snapshot)
  assert.equal(snapshot.kind, "detail")
}

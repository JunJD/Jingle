import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { notionRuntimeMetadata } from "../../extensions/notion/runtime-metadata"
import { listNativeExtensionQuicklinkAliases } from "../../src/extensions"
import {
  normalizeExtensionQuicklinkRecord,
  parseExtensionQuicklinkCommandUrl
} from "../../src/shared/extension-quicklinks"
import { ExtensionIcon } from "../../src/renderer/src/extensions/ExtensionIcon"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  getLauncherSearchResultsViewportHeight
} from "../../src/renderer/src/launcher-shell/home-surface"
import { buildLauncherSearchShellItems } from "../../src/renderer/src/launcher-shell/search-items"
import { resolveLauncherCommand } from "../../src/renderer/src/launcher-shell/pages"
import { FALLBACK_SHELL_CONFIG } from "../../src/shared/launcher"
import {
  createEmptyLauncherSearchResultsBySource,
  createLauncherSearchPageStore,
  groupLauncherSearchResultsBySource,
  mergeLauncherSearchResults,
  resolveVisibleLauncherSearchResultsBySource,
  shouldPreviewLauncherSearchResults
} from "../../src/renderer/src/launcher-shell/hooks/launcher-search-page-store-core"
import type { LauncherHistoryItem } from "../../src/shared/launcher-history"
import type { LauncherSearchResult } from "../../src/shared/launcher-search"
import type { LocalStartItem } from "../../src/shared/local-start"

const extensionQuicklinkAliases = listNativeExtensionQuicklinkAliases()

function createSearchResult(
  input: Partial<LauncherSearchResult> & Pick<LauncherSearchResult, "id" | "source" | "title">
): LauncherSearchResult {
  return {
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    kind: "file",
    score: 1,
    subtitle: "",
    ...input
  }
}

function createHistoryItem(
  id: string,
  overrides: Partial<LauncherHistoryItem> = {}
): LauncherHistoryItem {
  return {
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    historyKey: `history:${id}`,
    id,
    kind: "history",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    pin: false,
    subtitle: "",
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    useCount: 1,
    ...overrides
  }
}

function createIdleItem(id: string): LocalStartItem {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    kind: "file",
    lastUsedAt: null,
    path: `/tmp/${id}`,
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    useCount: 0
  }
}

test("search responses ignore stale request ids", () => {
  const store = createLauncherSearchPageStore()

  const staleRequestId = store.getState().beginSearchRequest()
  const activeRequestId = store.getState().beginSearchRequest()

  store
    .getState()
    .applySearchResults(staleRequestId, "doc", "files", [
      createSearchResult({ id: "stale", source: "files", title: "stale" })
    ])
  store
    .getState()
    .applySearchResults(activeRequestId, "doc", "files", [
      createSearchResult({ id: "active", source: "files", title: "active" })
    ])

  assert.deepEqual(store.getState().searchState, {
    query: "doc",
    resultsBySource: {
      files: [createSearchResult({ id: "active", source: "files", title: "active" })]
    }
  })
})

test("batched search commits all source buckets once a launcher search transaction settles", () => {
  const store = createLauncherSearchPageStore()
  const requestId = store.getState().beginSearchRequest()
  const fileResult = createSearchResult({ id: "doc", source: "files", title: "Project Doc" })
  const appResult = createSearchResult({ id: "code", source: "applications", title: "Code" })

  store
    .getState()
    .applySearchResultsBySource(
      requestId,
      "project",
      groupLauncherSearchResultsBySource([fileResult, appResult])
    )

  assert.deepEqual(store.getState().searchState, {
    query: "project",
    resultsBySource: {
      applications: [appResult],
      quicklinks: [],
      files: [fileResult],
      threads: [],
      "browser-history": []
    }
  })
})

test("batched search commits empty source buckets so loading can finish with no results", () => {
  const store = createLauncherSearchPageStore()
  const requestId = store.getState().beginSearchRequest()

  store
    .getState()
    .applySearchResultsBySource(requestId, "missing", createEmptyLauncherSearchResultsBySource())

  assert.deepEqual(store.getState().searchState, {
    query: "missing",
    resultsBySource: {
      applications: [],
      quicklinks: [],
      files: [],
      threads: [],
      "browser-history": []
    }
  })
})

test("batched search responses ignore stale request ids", () => {
  const store = createLauncherSearchPageStore()
  const staleRequestId = store.getState().beginSearchRequest()
  const activeRequestId = store.getState().beginSearchRequest()
  const staleResult = createSearchResult({ id: "stale", source: "files", title: "Stale" })
  const activeResult = createSearchResult({ id: "active", source: "files", title: "Active" })

  store
    .getState()
    .applySearchResultsBySource(
      staleRequestId,
      "doc",
      groupLauncherSearchResultsBySource([staleResult])
    )
  store
    .getState()
    .applySearchResultsBySource(
      activeRequestId,
      "doc",
      groupLauncherSearchResultsBySource([activeResult])
    )

  assert.deepEqual(store.getState().searchState, {
    query: "doc",
    resultsBySource: {
      applications: [],
      quicklinks: [],
      files: [activeResult],
      threads: [],
      "browser-history": []
    }
  })
})

test("resolveVisibleLauncherSearchResultsBySource filters cached trailing refinements", () => {
  const searchState = {
    query: "project",
    resultsBySource: {
      files: [
        createSearchResult({ id: "docs", source: "files", title: "Project Docs" }),
        createSearchResult({ id: "notes", source: "files", title: "Meeting Notes" })
      ]
    }
  }

  const visible = resolveVisibleLauncherSearchResultsBySource(searchState, "project docs")

  assert.deepEqual(visible, {
    files: [createSearchResult({ id: "docs", source: "files", title: "Project Docs" })]
  })
})

test("resolveVisibleLauncherSearchResultsBySource keeps cached matches while broadening query", () => {
  const searchState = {
    query: "project docs",
    resultsBySource: {
      files: [createSearchResult({ id: "docs", source: "files", title: "Project Docs" })]
    }
  }

  const visible = resolveVisibleLauncherSearchResultsBySource(searchState, "project")

  assert.deepEqual(visible, {
    files: [createSearchResult({ id: "docs", source: "files", title: "Project Docs" })]
  })
})

test("broadened cached search results stay visible as non-executable preview rows", () => {
  const searchState = {
    query: "project docs",
    resultsBySource: {
      files: [
        createSearchResult({
          availability: "ready",
          id: "docs",
          score: 10,
          source: "files",
          title: "Project Docs"
        })
      ]
    }
  }
  assert.equal(shouldPreviewLauncherSearchResults(searchState, "project"), true)
  assert.equal(shouldPreviewLauncherSearchResults(searchState, "project docs"), false)
  assert.equal(shouldPreviewLauncherSearchResults(searchState, "project docs today"), false)

  const [searchItem] = buildLauncherSearchShellItems(
    appCopy["zh-CN"],
    "zh-CN",
    searchState.resultsBySource.files,
    { preview: true }
  )

  assert.equal(searchItem?.availability, "planned")
  assert.equal(searchItem?.presentation.listActionLabel, appCopy["zh-CN"].launcher.planned)
  assert.equal(searchItem?.presentation.primaryActionLabel, appCopy["zh-CN"].launcher.planned)
})

test("mergeLauncherSearchResults orders by source priority, score, and de-duplicates per source key", () => {
  const merged = mergeLauncherSearchResults(
    {
      files: [
        createSearchResult({ id: "shared", score: 100, source: "files", title: "A" }),
        createSearchResult({ id: "file-only", score: 80, source: "files", title: "B" }),
        createSearchResult({ id: "file-only", score: 1, source: "files", title: "Duplicate" })
      ],
      applications: [
        createSearchResult({ id: "app-low", score: 1, source: "applications", title: "D" }),
        createSearchResult({ id: "app-high", score: 2, source: "applications", title: "C" })
      ],
      threads: [
        createSearchResult({ id: "thread", score: 900, source: "threads", title: "Thread" })
      ]
    },
    10
  )

  assert.deepEqual(
    merged.map((result) => `${result.source}:${result.id}`),
    [
      "applications:app-high",
      "applications:app-low",
      "files:shared",
      "files:file-only",
      "threads:thread"
    ]
  )
})

test("mergeLauncherSearchResults caps thread results after app and file results", () => {
  const merged = mergeLauncherSearchResults(
    {
      "browser-history": [
        createSearchResult({
          id: "browser",
          score: 10,
          source: "browser-history",
          title: "Browser"
        })
      ],
      files: [createSearchResult({ id: "file", score: 10, source: "files", title: "File" })],
      threads: Array.from({ length: 5 }, (_, index) =>
        createSearchResult({
          id: `thread-${index}`,
          kind: "history",
          score: 10,
          source: "threads",
          title: `Thread ${index}`
        })
      ),
      applications: [
        createSearchResult({ id: "app", score: 10, source: "applications", title: "App" })
      ]
    },
    20
  )

  assert.deepEqual(
    merged.map((result) => `${result.source}:${result.id}`),
    [
      "applications:app",
      "files:file",
      "threads:thread-0",
      "threads:thread-1",
      "threads:thread-2",
      "browser-history:browser"
    ]
  )
})

test("non-empty launcher search uses a fixed results viewport instead of result-count height", () => {
  const copy = appCopy["zh-CN"]
  const oneResultSurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "todo",
    searchResults: [createSearchResult({ id: "todo-1", source: "files", title: "Todo" })],
    windowMode: "default"
  })
  const manyResultsSurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "todo",
    searchResults: Array.from({ length: 12 }, (_, index) =>
      createSearchResult({
        id: `todo-${index}`,
        score: 12 - index,
        source: "files",
        title: `Todo ${index}`
      })
    ),
    windowMode: "default"
  })

  assert.equal(
    getLauncherHomeSurfaceResultsHeight(oneResultSurface, FALLBACK_SHELL_CONFIG),
    getLauncherHomeSurfaceResultsHeight(manyResultsSurface, FALLBACK_SHELL_CONFIG)
  )
  assert.equal(
    getLauncherSearchResultsViewportHeight(FALLBACK_SHELL_CONFIG),
    FALLBACK_SHELL_CONFIG.resultItemHeight * FALLBACK_SHELL_CONFIG.maxVisibleResults
  )
})

test("home idle and search surfaces both keep a footer", () => {
  const copy = appCopy["zh-CN"]
  const historySurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [createHistoryItem("wechat")],
    idleItems: [],
    locale: "zh-CN",
    query: "",
    searchResults: [],
    windowMode: "default"
  })
  const searchSurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "todo",
    searchResults: [createSearchResult({ id: "todo-1", source: "files", title: "Todo" })],
    windowMode: "default"
  })

  assert.equal(historySurface.body.kind, "history-grid")
  assert.equal(historySurface.chrome.footerVisible, true)
  assert.equal(searchSurface.chrome.footerVisible, true)
})

test("high confidence extension intents become the primary launcher result", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "translate hello to chinese",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(surface.items[0]?.title, "翻译")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "translate",
    extensionName: "translate",
    kind: "extension-command"
  })
  assert.equal(
    surface.items.some((item) => item.id.startsWith("use-with:translate:")),
    false
  )
})

test("exact extension command matches become the primary launcher result", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "todo",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(surface.items[0]?.title, "待办列表")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "index",
    extensionName: "todo-list",
    kind: "extension-command"
  })
  assert.deepEqual(surface.items[0]?.presentation.icon, {
    extensionName: "todo-list",
    icon: "assets/icon.svg",
    iconName: "todo",
    type: "extension"
  })
  assert.equal(surface.items.filter((item) => item.id.startsWith("use-with:todo-list:")).length, 1)
})

test("packaged extension commands keep asset icons with glyph fallbacks in launcher results", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "github my issues",
    searchResults: [],
    windowMode: "default"
  })

  const myIssuesItem = surface.items.find(
    (item) =>
      item.commandRef?.kind === "extension-command" &&
      item.commandRef.extensionName === "github" &&
      item.commandRef.commandName === "my-issues"
  )

  assert.deepEqual(myIssuesItem?.presentation.icon, {
    extensionName: "github",
    icon: "assets/icon.svg",
    iconName: "github",
    type: "extension"
  })

  assert.ok(myIssuesItem)
  assert.equal(myIssuesItem.presentation.icon.type, "extension")
  const initialIconMarkup = renderToStaticMarkup(
    createElement(ExtensionIcon, {
      extensionName: myIssuesItem.presentation.icon.extensionName,
      icon: myIssuesItem.presentation.icon.icon,
      iconName: myIssuesItem.presentation.icon.iconName
    })
  )
  assert.match(initialIconMarkup, /<svg/)
  assert.match(initialIconMarkup, /<img/)
  assert.match(initialIconMarkup, /relative inline-flex shrink-0 items-center justify-center/)
  assert.match(initialIconMarkup, /position:absolute/)
  assert.match(initialIconMarkup, /object-fit:contain/)
  assert.match(initialIconMarkup, /openwork-extension-asset:\/\/github\/assets\/icon\.svg/)
})

test("Notion search intent becomes the primary launcher result", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "搜索 notion 页面",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(surface.items[0]?.title, "Search Notion")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "search-page",
    extensionName: "notion",
    kind: "extension-command"
  })
  assert.deepEqual(surface.items[0]?.commandOpenOptions, {
    seedQuery: "搜索 notion 页面"
  })
  assert.deepEqual(surface.items[0]?.presentation.icon, {
    extensionName: "notion",
    icon: "assets/notion-logo.png",
    iconName: "notion",
    type: "extension"
  })

  assert.equal(surface.items[0]?.presentation.icon.type, "extension")
  const initialIconMarkup = renderToStaticMarkup(
    createElement(ExtensionIcon, {
      extensionName: surface.items[0].presentation.icon.extensionName,
      icon: surface.items[0].presentation.icon.icon,
      iconName: surface.items[0].presentation.icon.iconName
    })
  )
  assert.match(initialIconMarkup, /<img/)
  assert.match(initialIconMarkup, /openwork-extension-asset:\/\/notion\/assets\/notion-logo\.png/)
})

test("Notion natural language intents route to the matching commands", () => {
  const copy = appCopy["zh-CN"]
  const createSurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "新建 notion 页面",
    searchResults: [],
    windowMode: "default"
  })
  const addTextSurface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "追加内容到 notion 页面",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(createSurface.items[0]?.title, "Create Page")
  assert.deepEqual(createSurface.items[0]?.commandRef, {
    commandName: "create-database-page",
    extensionName: "notion",
    kind: "extension-command"
  })
  assert.equal(addTextSurface.items[0]?.title, "Add Text to Page")
  assert.deepEqual(addTextSurface.items[0]?.commandRef, {
    commandName: "add-text-to-page",
    extensionName: "notion",
    kind: "extension-command"
  })
})

test("Notion key command aliases resolve matching commands", () => {
  const match = resolveLauncherCommand({
    altKey: false,
    ctrlKey: false,
    key: " ",
    metaKey: false,
    query: "notion quick capture",
    shiftKey: false
  })

  assert.deepEqual(match, {
    address: {
      commandName: "quick-capture",
      extensionName: "notion",
      kind: "extension-command"
    },
    match: {
      commandName: "quick-capture",
      openOptions: {
        seedQuery: ""
      }
    }
  })
  assert.equal(
    resolveLauncherCommand({
      altKey: false,
      ctrlKey: false,
      key: "Enter",
      metaKey: false,
      query: "notion quick capture",
      shiftKey: false
    }),
    null
  )
})

test("Notion quick capture intent forwards URL as fallback text", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "保存 https://example.com/article 到 notion",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(surface.items[0]?.title, "Quick Capture")
  assert.deepEqual(surface.items[0]?.commandRef, {
    commandName: "quick-capture",
    extensionName: "notion",
    kind: "extension-command"
  })
  assert.deepEqual(surface.items[0]?.commandOpenOptions, {
    launchProps: {
      fallbackText: "https://example.com/article"
    },
    seedQuery: "保存 https://example.com/article 到 notion"
  })
})

test("retired generated Notion subject stays out of launcher intent resolution", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "搜索 notion-generated 页面",
    searchResults: [],
    windowMode: "default"
  })

  assert.notEqual(surface.items[0]?.commandRef?.kind, "extension-command")
})

test("retired generated Notion subject stays out of launcher command resolution", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "新建 notion-generated 页面",
    searchResults: [],
    windowMode: "default"
  })

  assert.notEqual(surface.items[0]?.commandRef?.kind, "extension-command")
})

test("Notion launcher intent metadata is owned by the formal Notion package", () => {
  const copy = appCopy["zh-CN"]
  const notionSearch = notionRuntimeMetadata.commands.find(
    (command) => command.name === "search-page"
  )?.search
  const buildNotionIntentItems = notionSearch?.buildIntentItems
  assert.ok(buildNotionIntentItems)

  for (const [query, commandName] of [
    ["notion search page", "search-page"],
    ["notion create page", "create-database-page"],
    ["notion quick capture https://example.com/spec", "quick-capture"],
    ["notion add text", "add-text-to-page"]
  ] as const) {
    const notionIntents = buildNotionIntentItems({
      copy,
      locale: "zh-CN",
      query
    })

    assert.equal(notionIntents[0]?.commandName, commandName)
    assert.deepEqual(notionIntents[0]?.presentation.icon, {
      extensionName: "notion",
      icon: "assets/notion-logo.png",
      iconName: "notion",
      type: "extension"
    })
  }
})

test("retired generated Notion key aliases do not resolve", () => {
  assert.equal(
    resolveLauncherCommand({
      altKey: false,
      ctrlKey: false,
      key: " ",
      metaKey: false,
      query: "quick capture",
      shiftKey: false
    }),
    null
  )

  assert.equal(
    resolveLauncherCommand({
      altKey: false,
      ctrlKey: false,
      key: " ",
      metaKey: false,
      query: "notion-generated quick capture",
      shiftKey: false
    }),
    null
  )
})

test("quicklink search results can open extension commands with launch context", () => {
  const command = parseExtensionQuicklinkCommandUrl(
    "openwork://extensions/HenriChabrand/notion/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D"
  )
  assert.deepEqual(command, {
    commandName: "create-database-page",
    extensionName: "notion",
    launchProps: {
      launchContext: {
        defaults: {
          title: "Spec"
        }
      }
    }
  })

  const items = buildLauncherSearchShellItems(appCopy["zh-CN"], "zh-CN", [
    createSearchResult({
      action: {
        executor: "internal",
        target: command!,
        type: "open-extension-command"
      },
      id: "quicklink-1",
      kind: "url",
      source: "quicklinks",
      subtitle: "notion",
      title: "Create Notion page"
    })
  ])

  assert.deepEqual(items[0]?.commandRef, {
    commandName: "create-database-page",
    extensionName: "notion",
    kind: "extension-command"
  })
  assert.deepEqual(items[0]?.commandOpenOptions, {
    launchProps: {
      launchContext: {
        defaults: {
          title: "Spec"
        }
      }
    }
  })
  assert.deepEqual(items[0]?.presentation.icon, {
    extensionName: "notion",
    icon: "assets/notion-logo.png",
    iconName: "notion",
    type: "extension"
  })
  assert.equal(items[0]?.presentation.categoryLabel, "快捷链接")
  assert.equal(items[0]?.presentation.listActionLabel, "打开")
  assert.equal(items[0]?.presentation.primaryActionLabel, "打开")
  assert.equal(items[0]?.subtitle, "快捷链接 · notion")
  assert.equal(items[0]?.trailingLabel, "快捷链接")
})

test("generic quicklink search results use quicklink icon and locale type labels", () => {
  const createGenericQuicklinkResult = (): LauncherSearchResult =>
    createSearchResult({
      action: {
        executor: "shell",
        target: {
          url: "https://example.com/spec"
        },
        type: "open-url"
      },
      id: "quicklink-generic",
      kind: "url",
      source: "quicklinks",
      subtitle: "https://example.com/spec",
      title: "Spec page"
    })

  const zhItems = buildLauncherSearchShellItems(appCopy["zh-CN"], "zh-CN", [
    createGenericQuicklinkResult()
  ])
  const enItems = buildLauncherSearchShellItems(appCopy["en-US"], "en-US", [
    createGenericQuicklinkResult()
  ])

  assert.deepEqual(zhItems[0]?.presentation.icon, {
    name: "bookmark",
    type: "glyph"
  })
  assert.equal(zhItems[0]?.presentation.categoryLabel, "快捷链接")
  assert.equal(zhItems[0]?.presentation.listActionLabel, "打开")
  assert.equal(zhItems[0]?.presentation.primaryActionLabel, "打开")
  assert.equal(zhItems[0]?.subtitle, "快捷链接 · https://example.com/spec")
  assert.equal(zhItems[0]?.trailingLabel, "快捷链接")

  assert.equal(enItems[0]?.presentation.categoryLabel, "Quicklink")
  assert.equal(enItems[0]?.presentation.listActionLabel, "Open")
  assert.equal(enItems[0]?.presentation.primaryActionLabel, "Open")
  assert.equal(enItems[0]?.subtitle, "Quicklink · https://example.com/spec")
  assert.equal(enItems[0]?.trailingLabel, "Quicklink")
})

test("legacy generated Notion quicklink URLs open the formal Notion command", () => {
  const legacyQuicklink = normalizeExtensionQuicklinkRecord(
    {
      createdAt: "2026-05-27T00:00:00.000Z",
      extensionName: "notion-generated",
      id: "quicklink-legacy-notion-generated-create",
      link: "openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
      name: "Create generated Notion page",
      updatedAt: "2026-05-27T00:00:00.000Z"
    },
    { aliases: extensionQuicklinkAliases }
  )
  const command = parseExtensionQuicklinkCommandUrl(
    "openwork://extensions/notion-generated/create-database-page?launchContext=%7B%22defaults%22%3A%7B%22title%22%3A%22Spec%22%7D%7D",
    { aliases: extensionQuicklinkAliases }
  )
  assert.deepEqual(command, {
    commandName: "create-database-page",
    extensionName: "notion",
    launchProps: {
      launchContext: {
        defaults: {
          title: "Spec"
        }
      }
    }
  })

  const items = buildLauncherSearchShellItems(appCopy["zh-CN"], "zh-CN", [
    createSearchResult({
      action: {
        executor: "internal",
        target: command!,
        type: "open-extension-command"
      },
      id: legacyQuicklink.id,
      kind: "url",
      source: "quicklinks",
      subtitle: legacyQuicklink.extensionName ?? "",
      title: legacyQuicklink.name
    })
  ])

  assert.deepEqual(items[0]?.commandRef, {
    commandName: "create-database-page",
    extensionName: "notion",
    kind: "extension-command"
  })
  assert.deepEqual(items[0]?.presentation.icon, {
    extensionName: "notion",
    icon: "assets/notion-logo.png",
    iconName: "notion",
    type: "extension"
  })
  assert.equal(items[0]?.presentation.categoryLabel, "快捷链接")
  assert.equal(items[0]?.subtitle, "快捷链接 · notion")
  assert.equal(items[0]?.trailingLabel, "快捷链接")
  assert.equal(items[0]?.title, "Create Notion page")
})

test("retired generated Notion command search results do not resolve formal package icons", () => {
  const items = buildLauncherSearchShellItems(appCopy["zh-CN"], "zh-CN", [
    createSearchResult({
      action: {
        executor: "internal",
        target: {
          commandName: "search-page",
          extensionName: "notion-generated"
        },
        type: "open-extension-command"
      },
      id: "quicklink-notion-generated-search",
      kind: "url",
      source: "quicklinks",
      subtitle: "notion-generated",
      title: "Search Notion"
    })
  ])

  assert.deepEqual(items[0]?.presentation.icon, {
    name: "bookmark",
    type: "glyph"
  })
  assert.equal(items[0]?.presentation.categoryLabel, "快捷链接")
  assert.equal(items[0]?.trailingLabel, "快捷链接")
  assert.notDeepEqual(items[0]?.presentation.icon, {
    extensionName: "notion",
    icon: "assets/notion-logo.png",
    iconName: "notion",
    type: "extension"
  })
})

test("generic AI intent stays primary when no extension intent matches", () => {
  const copy = appCopy["zh-CN"]
  const surface = buildLauncherHomeSurfaceModel({
    copy,
    historyItems: [],
    idleItems: [],
    locale: "zh-CN",
    query: "整理本周计划",
    searchResults: [],
    windowMode: "default"
  })

  assert.equal(surface.items[0]?.kind, "ai")
})

test("moveSelection wraps around the visible item ids", () => {
  const store = createLauncherSearchPageStore()

  store.getState().moveSelection(["a", "b", "c"], 0, -1)
  assert.equal(store.getState().selectedItemId, "c")

  store.getState().moveSelection(["a", "b", "c"], 2, 1)
  assert.equal(store.getState().selectedItemId, "a")
})

test("local idle and history updates stay pure and synchronous", () => {
  const store = createLauncherSearchPageStore()
  const historyItems = [
    createHistoryItem("older", {
      lastUsedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }),
    createHistoryItem("newer", {
      lastUsedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    })
  ]

  store.getState().applyIdleState({
    historyItems,
    idleItems: [createIdleItem("recent-file")],
    useWithDisabledCommandKeys: ["files:open"],
    windowMode: "compact"
  })
  store.getState().setHistoryItemPinnedLocal("older", true, "2026-01-03T00:00:00.000Z")
  store.getState().removeHistoryItemLocal("newer")
  store.getState().requestHomeInputSelection()

  assert.equal(store.getState().windowMode, "compact")
  assert.deepEqual(store.getState().useWithDisabledCommandKeys, ["files:open"])
  assert.deepEqual(
    store.getState().idleItems.map((item) => item.id),
    ["recent-file"]
  )
  assert.deepEqual(
    store.getState().historyItems.map((item) => item.id),
    ["older"]
  )
  assert.equal(store.getState().homeInputSelectionRequestVersion, 1)
})

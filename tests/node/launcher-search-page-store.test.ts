import assert from "node:assert/strict"
import test from "node:test"
import { appCopy } from "../../src/renderer/src/lib/i18n/messages"
import {
  buildLauncherHomeSurfaceModel,
  getLauncherHomeSurfaceResultsHeight,
  getLauncherSearchResultsViewportHeight
} from "../../src/renderer/src/launcher-shell/home-surface"
import { buildLauncherSearchShellItems } from "../../src/renderer/src/launcher-shell/search-items"
import { FALLBACK_SHELL_CONFIG } from "../../src/shared/launcher"
import {
  createLauncherSearchPageStore,
  mergeLauncherSearchResults,
  resolveVisibleLauncherSearchResultsBySource,
  shouldPreviewLauncherSearchResults
} from "../../src/renderer/src/launcher-shell/hooks/launcher-search-page-store-core"
import type { LauncherHistoryItem } from "../../src/shared/launcher-history"
import type { LauncherSearchResult } from "../../src/shared/launcher-search"
import type { LocalStartItem } from "../../src/shared/local-start"

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
    searchState.resultsBySource.files,
    { preview: true }
  )

  assert.equal(searchItem?.availability, "planned")
  assert.equal(searchItem?.presentation.listActionLabel, appCopy["zh-CN"].launcher.planned)
  assert.equal(searchItem?.presentation.primaryActionLabel, appCopy["zh-CN"].launcher.planned)
})

test("mergeLauncherSearchResults orders by score, source priority, and de-duplicates per source key", () => {
  const merged = mergeLauncherSearchResults(
    {
      files: [
        createSearchResult({ id: "shared", score: 10, source: "files", title: "A" }),
        createSearchResult({ id: "file-only", score: 8, source: "files", title: "B" })
      ],
      applications: [
        createSearchResult({ id: "shared", score: 10, source: "applications", title: "C" }),
        createSearchResult({ id: "app-only", score: 9, source: "applications", title: "D" })
      ]
    },
    10
  )

  assert.deepEqual(
    merged.map((result) => `${result.source}:${result.id}`),
    ["applications:shared", "files:shared", "applications:app-only", "files:file-only"]
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

  assert.notEqual(
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

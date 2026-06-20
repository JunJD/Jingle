import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8")
}

function readCssRule(cssSource: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const ruleMatch = new RegExp(`(?:^|\\n)${escapedSelector} \\{`).exec(cssSource)
  const ruleStart = ruleMatch?.index == null ? -1 : ruleMatch.index + (ruleMatch[0][0] === "\n" ? 1 : 0)
  assert.ok(ruleStart >= 0, `${selector} style should exist`)
  const ruleEnd = cssSource.indexOf("\n}", ruleStart)
  assert.ok(ruleEnd > ruleStart, `${selector} style should close`)

  return cssSource.slice(ruleStart, ruleEnd + 2)
}

test("launcher AI composer participates in page layout instead of message bottom inset", async () => {
  const [pageSource, conversationSource, messagesSource, scrollHookSource, cssSource] =
    await Promise.all([
      readWorkspaceFile("src/renderer/src/ai-core/LauncherAiPage.tsx"),
      readWorkspaceFile("src/renderer/src/ai-core/LauncherAiConversation.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/Messages.tsx"),
      readWorkspaceFile("src/renderer/src/components/chat/useVirtualChatScrollIntent.ts"),
      readWorkspaceFile("src/renderer/src/index.css")
    ])

  assert.doesNotMatch(pageSource, /composerOverlayRef/)
  assert.doesNotMatch(pageSource, /measuredComposerOverlayHeight/)
  assert.doesNotMatch(pageSource, /estimatedComposerOverlayHeight/)
  assert.doesNotMatch(pageSource, /AI_COMPOSER_BOTTOM_GAP/)
  assert.doesNotMatch(pageSource, /launcher-ai-composer-overlay/)
  assert.doesNotMatch(cssSource, /launcher-ai-composer-overlay/)
  assert.doesNotMatch(conversationSource, /bottomInset/)
  assert.doesNotMatch(messagesSource, /bottomInset/)
  assert.doesNotMatch(scrollHookSource, /bottomInset/)
  assert.doesNotMatch(scrollHookSource, /jumpToLatestBottomPx/)

  const mainIndex = pageSource.indexOf('className="launcher-ai-main min-w-0 flex-1"')
  const footerIndex = pageSource.indexOf('className="launcher-ai-composer-footer', mainIndex)
  const chromeCloseIndex = pageSource.indexOf("</LauncherChrome>", mainIndex)
  assert.ok(mainIndex >= 0, "launcher AI main container should exist")
  assert.ok(
    footerIndex > mainIndex && footerIndex < chromeCloseIndex,
    "composer footer should live inside launcher-ai-main before LauncherChrome closes"
  )

  const conversationCall = pageSource.match(/<LauncherAiConversation[\s\S]*?\/>/)
  assert.ok(conversationCall, "LauncherAiPage should render LauncherAiConversation")
  assert.doesNotMatch(conversationCall[0], /bottomInset=/)
})

test("renderer entry keeps bootstrap side effects out of the React refresh boundary", async () => {
  const [mainSource, rootSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/main.tsx"),
    readWorkspaceFile("src/renderer/src/RendererRoot.tsx")
  ])

  assert.match(
    mainSource,
    /ReactDOM\.createRoot\(document\.getElementById\("root"\)!\)\.render\(\s*<RendererRoot resolvedWindowKind=\{resolvedWindowKind\} windowKind=\{windowKind\} \/>\s*\)/
  )
  assert.match(mainSource, /import \{ RendererRoot \} from "\.\/RendererRoot"/)
  assert.doesNotMatch(mainSource, /export function RendererRoot/)
  assert.doesNotMatch(mainSource, /export const RendererRoot/)
  assert.doesNotMatch(mainSource, /export default/)
  assert.doesNotMatch(mainSource, /__jingleRendererRoot/)
  assert.equal(mainSource.match(/ReactDOM\.createRoot/g)?.length, 1)
  assert.match(rootSource, /export function RendererRoot/)
  assert.doesNotMatch(rootSource, /ReactDOM\.createRoot/)
  assert.doesNotMatch(rootSource, /bootstrapRenderer/)
})

test("launcher AI sidebar search opens thread search overlay backed by launcher search", async () => {
  const pageSource = await readWorkspaceFile("src/renderer/src/ai-core/LauncherAiPage.tsx")

  assert.doesNotMatch(pageSource, /handleOpenSidebarSearch/)
  assert.match(pageSource, /window\.api\.launcher\s*\.\s*search/)
  assert.match(pageSource, /sources:\s*\[\s*"threads"\s*\]/)
  assert.match(pageSource, /threadMetadataSource:\s*AI_THREAD_SOURCE/)
  assert.doesNotMatch(pageSource, /launcherThreadIdSet/)
  assert.match(pageSource, /LauncherAiThreadSearchOverlay/)
  assert.doesNotMatch(pageSource, /openThreadSearch[\s\S]*?setIsThreadSearchLoading\(true\)/)
  assert.match(
    pageSource,
    /if \(nextTrimmedThreadSearchQuery === trimmedThreadSearchQuery\) \{\s*return\s*\}/
  )

  const sidebarPanelCall = pageSource.match(/<LauncherAiSidebarPanel[\s\S]*?\/>/)
  assert.ok(sidebarPanelCall, "LauncherAiPage should render LauncherAiSidebarPanel")
  assert.match(sidebarPanelCall[0], /onOpenSearch=\{openThreadSearch\}/)
})

test("launcher AI sidebar consumes sidebar view model instead of metadata workspace grouping", async () => {
  const [sidebarSource, pageSource, storeSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiSidebarPanel.tsx"),
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiPage.tsx"),
    readWorkspaceFile("src/renderer/src/lib/history-shell-store-core.ts")
  ])
  const metadataWorkspaceAccessPattern = new RegExp(
    ["metadata", "\\?\\.", "workspace", "Path"].join("")
  )

  assert.match(sidebarSource, /sidebarView\?\.projectGroups/)
  assert.match(sidebarSource, /mapSidebarProjectGroup/)
  assert.match(sidebarSource, /ProjectSectionActions/)
  assert.match(sidebarSource, /onSetSidebarOrganizeMode/)
  assert.match(sidebarSource, /onSetSidebarSortBy/)
  assert.doesNotMatch(sidebarSource, metadataWorkspaceAccessPattern)
  assert.doesNotMatch(sidebarSource, /groupLauncherAiSidebarThreads/)
  assert.doesNotMatch(pageSource, /mapThreadToLauncherAiSidebarItem/)
  assert.match(pageSource, /sidebarView=\{sidebarView\}/)
  assert.match(storeSource, /api\.threadSidebar\.getView/)
  assert.match(storeSource, /api\.threadSidebar\.setOrganizeMode/)
  assert.match(storeSource, /api\.threadSidebar\.setSortBy/)
  assert.match(storeSource, /api\.workspace\.selectFolder/)
  assert.match(storeSource, /api\.threadWorkspace\.addProject/)
})

test("launcher AI sidebar section headings keep clipping scoped to text", async () => {
  const cssSource = await readWorkspaceFile("src/renderer/src/index.css")

  const sectionRule = readCssRule(cssSource, ".launcher-ai-sidebar-panel__section")
  const itemRowRule = readCssRule(cssSource, ".launcher-ai-sidebar-panel__item-row")
  const sectionItemRule = readCssRule(
    cssSource,
    '.launcher-ai-sidebar-panel__item-row[data-variant="section"] .launcher-ai-sidebar-panel__item'
  )
  const titleRule = readCssRule(cssSource, ".launcher-ai-sidebar-panel__item-title")
  const itemChevronRule = readCssRule(cssSource, ".launcher-ai-sidebar-panel__item-chevron")
  const sectionChevronRule = readCssRule(
    cssSource,
    '.launcher-ai-sidebar-panel__item-row[data-variant="section"]\n  .launcher-ai-sidebar-panel__item-chevron'
  )
  const itemChevronRevealRule = readCssRule(
    cssSource,
    ".launcher-ai-sidebar-panel__item-row:hover .launcher-ai-sidebar-panel__item-chevron"
  )
  const itemChevronOpenRule = readCssRule(
    cssSource,
    ".launcher-ai-sidebar-panel__item-chevron[data-open]"
  )

  assert.match(sectionRule, /scrollbar-gutter:\s*stable/)
  assert.match(itemRowRule, /flex:\s*0 0 auto/)
  assert.match(sectionItemRule, /min-height:\s*28px/)
  assert.match(sectionItemRule, /overflow:\s*visible/)
  assert.match(sectionItemRule, /font-size:\s*var\(--ow-font-meta\)/)
  assert.match(sectionItemRule, /font-weight:\s*600/)
  assert.doesNotMatch(sectionItemRule, /text-overflow:\s*ellipsis/)
  assert.match(titleRule, /overflow:\s*hidden/)
  assert.match(titleRule, /text-overflow:\s*ellipsis/)
  assert.match(itemChevronRule, /display:\s*block/)
  assert.match(itemChevronRule, /width:\s*20px/)
  assert.match(itemChevronRule, /height:\s*20px/)
  assert.match(itemChevronRule, /opacity:\s*0/)
  assert.match(itemChevronRule, /stroke-width:\s*1\.85/)
  assert.match(itemChevronRule, /transform-box:\s*fill-box/)
  assert.match(itemChevronRule, /transform-origin:\s*center/)
  assert.match(sectionChevronRule, /justify-self:\s*start/)
  assert.match(itemChevronRevealRule, /opacity:\s*1/)
  assert.doesNotMatch(itemChevronRevealRule, /data-open/)
  assert.doesNotMatch(itemChevronRevealRule, /data-active/)
  assert.doesNotMatch(itemChevronRevealRule, /focus-within/)
  assert.doesNotMatch(itemChevronOpenRule, /opacity:\s*1/)
})

test("launcher AI sidebar thread context menu reuses owned actions and disables unowned items", async () => {
  const [sidebarSource, pageSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiSidebarPanel.tsx"),
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiPage.tsx")
  ])

  assert.match(sidebarSource, /ContextMenuTrigger asChild/)
  assert.match(sidebarSource, /ContextMenu onOpenChange=\{onMenuOpenChange\}/)
  assert.match(sidebarSource, /isThreadContextMenuOpen/)
  assert.match(sidebarSource, /onTogglePinned\(thread\.id, !thread\.isPinned\)/)
  assert.match(sidebarSource, /onCopySessionId\(thread\.id\)/)
  assert.match(sidebarSource, /onCopyWorkingDirectory\(workspacePath\)/)
  assert.match(sidebarSource, /onRevealInFinder\(workspacePath\)/)
  assert.match(sidebarSource, /ProjectFolderMenu/)
  assert.match(sidebarSource, /launcher-ai-sidebar-panel__item-action/)
  assert.match(sidebarSource, /event\.stopPropagation\(\)/)
  assert.match(sidebarSource, /onCreateChat\(group\.workspacePath\)/)
  assert.match(sidebarSource, /void actions\.onRevealInFinder\(workspacePath\)/)
  assert.match(sidebarSource, /onArchive\(thread\.id\)/)
  assert.match(sidebarSource, /disabled>\s*[\s\S]*?\{labels\.pinProject\}/)
  assert.match(sidebarSource, /disabled>\s*[\s\S]*?\{labels\.renameProject\}/)
  assert.match(sidebarSource, /disabled>\s*[\s\S]*?\{labels\.removeProject\}/)
  assert.match(sidebarSource, /disabled>\s*\{labels\.renameChat\}/)
  assert.match(sidebarSource, /disabled>\s*\{labels\.markAsUnread\}/)
  assert.match(sidebarSource, /disabled>\s*\{labels\.copyDeeplink\}/)
  assert.match(sidebarSource, /disabled>\s*\{labels\.branchIntoNewWorktree\}/)
  assert.match(sidebarSource, /archiveAllChats: labels\.sidebarArchiveAllChats/)
  assert.match(sidebarSource, /addProject: labels\.addProject/)
  assert.match(sidebarSource, /projectOptions: labels\.projectOptions/)
  assert.match(pageSource, /workspaceKind: "project"/)
  assert.match(pageSource, /workspacePath: nextWorkspacePath/)
  const projectThreadAction = pageSource.match(
    /const createProjectSidebarThread = useCallback\([\s\S]*?const branchSidebarThread = useCallback/
  )
  assert.ok(projectThreadAction, "project thread action should exist")
  assert.match(
    projectThreadAction[0],
    /startFreshDraft\(\{[\s\S]*?workspaceKind: "project"[\s\S]*?workspacePath: nextWorkspacePath[\s\S]*?\}\)/
  )
  assert.doesNotMatch(projectThreadAction[0], /createThread\(/)
  assert.match(pageSource, /projectActions=\{sidebarProjectActions\}/)
  assert.match(pageSource, /setThreadArchived\(nextThreadId, true\)/)
  assert.match(pageSource, /window\.api\.openTargets\.open\(\{ folderPath: nextWorkspacePath, targetId: "finder" \}\)/)
  assert.match(pageSource, /window\.api\.aiSessionWindows\.openPinned\(\{ threadId: nextThreadId \}\)/)
})

test("launcher AI sidebar rows share one list item shell across chats and projects", async () => {
  const [sidebarSource, cssSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiSidebarPanel.tsx"),
    readWorkspaceFile("src/renderer/src/index.css")
  ])
  const itemRowRule = cssSource.match(/\.launcher-ai-sidebar-panel__item-row\s*\{[\s\S]*?\n\}/)
  const itemRule = cssSource.match(/\.launcher-ai-sidebar-panel__item\s*\{[\s\S]*?\n\}/)
  const itemActionRule = cssSource.match(
    /\.launcher-ai-sidebar-panel__item-action\s*\{[\s\S]*?\n\}/
  )
  const itemActionsRule = cssSource.match(
    /\.launcher-ai-sidebar-panel__item-actions\s*\{[\s\S]*?\n\}/
  )
  const itemActionHoverRule = cssSource.match(
    /\.launcher-ai-sidebar-panel__item-row:hover \.launcher-ai-sidebar-panel__item-action\s*\{[\s\S]*?\n\}/
  )
  const itemActionsHoverRule = cssSource.match(
    /\.launcher-ai-sidebar-panel__item-row:hover \.launcher-ai-sidebar-panel__item-actions\s*\{[\s\S]*?\n\}/
  )
  const itemIconRule = cssSource.match(
    /\.launcher-ai-sidebar-panel__item-icon > svg\s*\{[\s\S]*?\n\}/
  )

  assert.match(sidebarSource, /const SidebarRow = forwardRef/)
  assert.match(sidebarSource, /function SectionHeading[\s\S]*?<SidebarRow/)
  assert.match(sidebarSource, /function ThreadRow[\s\S]*?<SidebarRow/)
  assert.match(sidebarSource, /function ProjectFolderRow[\s\S]*?<SidebarRow/)
  assert.match(sidebarSource, /depth="child"/)
  assert.match(sidebarSource, /actions=\{\s*<>/)
  assert.match(sidebarSource, /variant="section"/)
  assert.match(sidebarSource, /onPress=\{onToggle\}/)
  assert.doesNotMatch(sidebarSource, /launcher-ai-sidebar-panel__thread(?:\b|__)/)
  assert.doesNotMatch(
    sidebarSource,
    /launcher-ai-sidebar-panel__section-(?:heading|tools|tool|title|chevron)/
  )
  assert.doesNotMatch(
    sidebarSource,
    /launcher-ai-sidebar-panel__project-(?:row|action|actions|chevron|title|icon|meta)/
  )

  assert.ok(itemRowRule, "shared item row style should exist")
  assert.ok(itemRule, "shared item button style should exist")
  assert.ok(itemActionsRule, "shared item actions container style should exist")
  assert.ok(itemActionRule, "shared item action style should exist")
  assert.ok(itemActionsHoverRule, "shared item actions hover style should exist")
  assert.ok(itemActionHoverRule, "shared item action hover style should exist")
  assert.ok(itemIconRule, "shared item icon style should exist")
  assert.match(itemRowRule[0], /position:\s*relative/)
  assert.match(itemRule[0], /grid-column:\s*1 \/ -1/)
  assert.match(itemActionsRule[0], /pointer-events:\s*none/)
  assert.match(itemActionsHoverRule[0], /pointer-events:\s*auto/)
  assert.match(itemActionRule[0], /pointer-events:\s*none/)
  assert.match(itemActionHoverRule[0], /pointer-events:\s*auto/)
  assert.match(itemIconRule[0], /width:\s*15px/)
  assert.match(itemIconRule[0], /height:\s*15px/)
  assert.match(itemIconRule[0], /stroke-width:\s*1\.55/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__section-heading/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__section-tool/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__section-title/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__section-chevron/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__project-row/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__project-action/)
  assert.doesNotMatch(cssSource, /launcher-ai-sidebar-panel__thread(?:\b|__)/)
  assert.doesNotMatch(cssSource, /item-actions:focus-within/)
})

test("launcher AI thread search overlay stays idle before query input", async () => {
  const overlaySource = await readWorkspaceFile(
    "src/renderer/src/ai-core/LauncherAiThreadSearchOverlay.tsx"
  )

  assert.match(overlaySource, /if \(!trimmedQuery\) \{\s*return "idle"\s*\}/)
  assert.match(overlaySource, /visibleState === "loading"/)
})

test("launcher AI thread loading copy distinguishes restore from opening", async () => {
  const [navigationSource, conversationSource, messagesSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/ai-core/useLauncherAiThreadNavigation.ts"),
    readWorkspaceFile("src/renderer/src/ai-core/LauncherAiConversation.tsx"),
    readWorkspaceFile("src/renderer/src/lib/i18n/messages.ts")
  ])

  assert.match(
    navigationSource,
    /export type LauncherAiThreadLoadingReason = "opening" \| "restoring"/
  )
  assert.match(navigationSource, /reason: shouldStartFreshThread \? null : "restoring"/)
  assert.match(navigationSource, /reason: LauncherAiThreadLoadingReason = "opening"/)
  assert.match(navigationSource, /await activateThread\(restoredThreadId, "restoring"\)/)
  assert.match(
    navigationSource,
    /if \(!restoredThreadId\) \{[\s\S]*?setTarget\(\{[\s\S]*?kind: "draft"/
  )
  assert.match(navigationSource, /const navigationVersionRef = useRef\(0\)/)
  const startFreshDraftBody = navigationSource.match(
    /const startFreshDraft = useCallback\([\s\S]*?const updateFreshDraft = useCallback/
  )
  assert.ok(startFreshDraftBody, "startFreshDraft should exist")
  assert.match(
    startFreshDraftBody[0],
    /const activeThreadId = resolveActiveThreadId\(\)[\s\S]*?setTarget\({[\s\S]*?kind: "draft"/
  )
  assert.doesNotMatch(startFreshDraftBody[0], /const threads = await listAiThreads\(\)/)
  assert.match(conversationSource, /copy\.launcher\.restoringThread/)
  assert.match(conversationSource, /copy\.launcher\.openingThread/)
  assert.doesNotMatch(conversationSource, /copy\.launcher\.loadingThread/)
  assert.doesNotMatch(messagesSource, /loadingThread/)
})

test("chat tool details stay out of the collapsed streaming render path", async () => {
  const [actionMessageSource, actionViewSource, agentToolSource] = await Promise.all([
    readWorkspaceFile("src/renderer/src/components/chat/ActionMessage.tsx"),
    readWorkspaceFile("src/renderer/src/components/chat/action-message-view.ts"),
    readWorkspaceFile("src/renderer/src/components/agent-ui/Tool.tsx")
  ])

  assert.match(
    actionViewSource,
    /const hasDetail = definition\.renderDetail \? definition\.hasDetail\(componentProps\) : false/
  )
  assert.doesNotMatch(actionViewSource, /definition\.hasDetail\?\.\(componentProps\) \?\? true/)
  assert.match(actionMessageSource, /const canExpandDetail = hasDetail && !approvalRequest/)
  assert.match(
    actionMessageSource,
    /if \(!canExpandDetail \|\| !isExpanded\) \{\s*return null\s*\}/
  )
  assert.match(actionMessageSource, /definition\.renderDetail\?\.\(/)
  assert.ok(
    actionMessageSource.indexOf("if (!canExpandDetail || !isExpanded)") <
      actionMessageSource.indexOf("definition.renderDetail?.("),
    "detail render should be gated by expand state"
  )
  assert.match(actionMessageSource, /detail=\{detailContent\}/)
  assert.match(actionMessageSource, /hasDetail=\{canExpandDetail\}/)
  assert.match(agentToolSource, /hasDetail,\s*icon,/)
  assert.doesNotMatch(agentToolSource, /Boolean\(detail\)/)
})

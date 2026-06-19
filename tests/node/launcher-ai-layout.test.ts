import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const repoRoot = process.cwd()

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8")
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

test("launcher AI thread search overlay stays idle before query input", async () => {
  const overlaySource = await readWorkspaceFile(
    "src/renderer/src/ai-core/LauncherAiThreadSearchOverlay.tsx"
  )

  assert.match(overlaySource, /if \(!trimmedQuery\) \{\s*return "idle"\s*\}/)
  assert.match(overlaySource, /visibleState === "loading"/)
})

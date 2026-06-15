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

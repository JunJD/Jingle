import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function source(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("renderer loading always projects an explicit window kind", async () => {
  const loader = await source("src/main/windows/load-renderer-window.ts")
  const renderer = await source("src/renderer/src/main.tsx")
  assert.match(loader, /const rendererQuery = \{\s*window: windowKind,/)
  assert.match(loader, /rendererUrl\.searchParams\.set\("window", windowKind\)/)
  assert.match(renderer, /if \(!windowKind \|\| !supportedWindowKinds\.has\(windowKind\)\)/)
  assert.doesNotMatch(renderer, /windowKind \?\? "main"/)
})

test("desktop lifecycle routes durable entry points to Main and keeps the resident process", async () => {
  const main = await source("src/main/index.ts")
  const secondInstance = main.match(
    /app\.on\("second-instance"[\s\S]*?\n {2}\}\)\n\n {2}app\.on\("open-url"/
  )
  const openUrl = main.match(/app\.on\("open-url"[\s\S]*?\n {2}\}\)\n\n {2}app\.whenReady/)

  assert.ok(secondInstance)
  assert.ok(openUrl)
  assert.match(secondInstance[0], /protocolUrl && handleOpenUrl\(protocolUrl\)\.kind === "handled"/)
  assert.match(secondInstance[0], /showMain\(\)/)
  assert.match(openUrl[0], /handleOpenUrl\(rawUrl\)\.kind === "unhandled"[\s\S]*?showMain\(\)/)
  assert.match(main, /app\.on\("activate"[\s\S]*?showMain\(\)/)
  assert.match(main, /openMainWindow: showMain/)
  const allClosed = main.match(/app\.on\("window-all-closed"[\s\S]*?\n\}\)/)
  assert.ok(allClosed)
  assert.doesNotMatch(allClosed[0], /app\.quit\(\)/)
})

test("custom URL handling claims only canonical OAuth callbacks", async () => {
  const main = await source("src/main/index.ts")
  const handler = main.match(
    /function handleOpenUrl\(rawUrl: string\): OpenUrlHandling \{[\s\S]*?\n\}/
  )

  assert.ok(handler)
  assert.match(handler[0], /if \(!isJingleOAuthCallbackUrl\(rawUrl\)\)/)
  assert.match(handler[0], /return \{ kind: "unhandled" \}/)
  assert.match(
    handler[0],
    /pendingOAuthCallbackUrl = rawUrl[\s\S]*?return \{ kind: "handled", owner: "oauth" \}/
  )
  assert.match(
    handler[0],
    /mainCompositionRoot\.handleOAuthCallback\(rawUrl\)[\s\S]*?return \{ kind: "handled", owner: "oauth" \}/
  )
})

test("cold start requests Primary Main before restoring session windows", async () => {
  const main = await source("src/main/index.ts")
  const compositionRoot = await source("src/main/composition-root.ts")
  const mainOpen = main.indexOf(
    "showMain()",
    main.indexOf("mainCompositionRoot.registerIpcHandlers()")
  )
  const serviceStartup = main.indexOf("mainCompositionRoot.startServices()")
  const sessionRestore = main.indexOf("mainCompositionRoot.restoreThreadWindows()")
  const startServices = compositionRoot.match(
    /startServices\(\): void \{[\s\S]*?\n {2}\}\n\n {2}async dispose/
  )

  assert.notEqual(mainOpen, -1)
  assert.notEqual(serviceStartup, -1)
  assert.notEqual(sessionRestore, -1)
  assert.equal(mainOpen < serviceStartup && serviceStartup < sessionRestore, true)
  assert.ok(startServices)
  assert.doesNotMatch(startServices[0], /ThreadWindowService|restoreThreadWindows/)
})

test("workflow events refresh each durable window sidebar through one owner", async () => {
  const [mainWindow, workflowController, launcherPage] = await Promise.all([
    source("src/renderer/src/ai-core/MainWindowApp.tsx"),
    source("src/renderer/src/ai-core/use-launcher-ai-workflow-controller.ts"),
    source("src/renderer/src/ai-core/LauncherAiPage.tsx")
  ])
  const durableWindowWorkflowListener = mainWindow.match(
    /window\.api\.threadWorkflow\.onChanged\(\(\) => \{[\s\S]*?\n {6}\}\)/
  )
  const workflowEventListener = workflowController.match(
    /window\.api\.threadWorkflow\.onChanged\(\(event\) => \{[\s\S]*?\n {6}\}\)/
  )
  const sidebarProjection = workflowController.match(
    /const refreshSidebarProjection = useCallback\(async \(\): Promise<void> => \{[\s\S]*?\n {2}\}, \[[^\]]+\]\)/
  )

  assert.ok(durableWindowWorkflowListener)
  assert.equal(durableWindowWorkflowListener[0].match(/loadSidebarView\(\)/g)?.length, 1)
  assert.ok(workflowEventListener)
  assert.match(
    workflowEventListener[0],
    /event\.threadId !== threadId\) \{\s*void refreshSidebarProjection\(\)\s*return/
  )
  assert.match(workflowEventListener[0], /void refresh\(\)/)
  assert.ok(sidebarProjection)
  assert.match(sidebarProjection[0], /if \(mode === "main"\) \{\s*return\s*\}/)
  assert.equal(sidebarProjection[0].match(/loadSidebarView\(\)/g)?.length, 1)
  assert.match(workflowController, /const \{ mode \} = useAiCoreThreads\(\)/)

  assert.match(launcherPage, /if \(!threadId\) \{\s*return\s*\}\s*\n\s*void loadThreads\(\)/)
  assert.match(
    launcherPage,
    /if \(!isSidebarOpen && !isSidebarPreviewVisible\) \{\s*return\s*\}\s*\n\s*void loadThreads\(\)/
  )
})

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
  assert.match(main, /app\.on\("second-instance"[\s\S]*?showMain\(\)/)
  assert.match(main, /app\.on\("activate"[\s\S]*?showMain\(\)/)
  assert.match(main, /openMainWindow: showMain/)
  const allClosed = main.match(/app\.on\("window-all-closed"[\s\S]*?\n\}\)/)
  assert.ok(allClosed)
  assert.doesNotMatch(allClosed[0], /app\.quit\(\)/)
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

import {
  World,
  type IWorldOptions,
  setDefaultTimeout,
  setWorldConstructor
} from "@cucumber/cucumber"
import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { _electron as electron, type ElectronApplication, type Page } from "playwright"

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 90_000
const ELECTRON_CLOSE_TIMEOUT_MS = 10_000
const REPO_ROOT = process.cwd()
const PRISMA_OPENWORK_DB_SCRIPT_PATH = join(REPO_ROOT, "scripts/run-prisma-openwork-db.mjs")
const ELECTRON_MODULE_ID = require.resolve("electron")
const ELECTRON_PATH_FILE = require.resolve("electron/path.txt")
const electronExecutablePath = join(
  dirname(ELECTRON_PATH_FILE),
  "dist",
  readFileSync(ELECTRON_PATH_FILE, "utf8").trim()
)

setDefaultTimeout(DEFAULT_TIMEOUT_MS)

async function readWindowKind(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => document.body?.dataset.window ?? null)
  } catch {
    return null
  }
}

async function resolveWindowByKind(
  electronApp: ElectronApplication,
  windowKind: "main" | "launcher" | "settings"
): Promise<Page> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if ((await readWindowKind(page)) === windowKind) {
        return page
      }
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      break
    }

    await electronApp
      .waitForEvent("window", { timeout: Math.min(remaining, 250) })
      .catch(() => null)
  }

  throw new Error(`Window "${windowKind}" did not finish bootstrapping within 30 seconds.`)
}

async function listWindowKinds(electronApp: ElectronApplication): Promise<string[]> {
  const kinds = await Promise.all(electronApp.windows().map((page) => readWindowKind(page)))
  return kinds.filter((kind): kind is string => Boolean(kind))
}

async function prepareDatabase(openworkHome: string): Promise<void> {
  const databasePath = join(openworkHome, "openwork.sqlite")

  try {
    await execFileAsync(process.execPath, [PRISMA_OPENWORK_DB_SCRIPT_PATH, "migrate", "deploy"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENWORK_HOME: openworkHome
      }
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : String(error)
    throw new Error(`Failed to prepare BDD database for file:${databasePath}.\n${message}`)
  }
}

async function launchElectronApp(options: Parameters<typeof electron.launch>[0]) {
  const cachedElectronModule = require.cache[ELECTRON_MODULE_ID]

  if (!cachedElectronModule) {
    return electron.launch(options)
  }

  const previousExports = cachedElectronModule.exports
  cachedElectronModule.exports = electronExecutablePath

  try {
    return await electron.launch(options)
  } finally {
    cachedElectronModule.exports = previousExports
  }
}

async function closeElectronApp(electronApp: ElectronApplication): Promise<void> {
  const process = electronApp.process()
  let timeout: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      electronApp.close(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out closing Electron app.")),
          ELECTRON_CLOSE_TIMEOUT_MS
        )
      })
    ])
  } catch {
    process.kill()
    await electronApp.waitForEvent("close", { timeout: ELECTRON_CLOSE_TIMEOUT_MS }).catch(() => {})
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export class OpenworkWorld extends World {
  private electronApp: ElectronApplication | null = null
  private page: Page | null = null
  private openworkHome: string | null = null
  private extensionRuntimeFixtures: Record<string, unknown> = {}
  private scenarioObjects = new Map<string, unknown>()
  private scenarioValues = new Map<string, string>()
  private cleanupCallbacks: Array<() => Promise<void> | void> = []
  private agentRuntimeMode: "default" | "scripted" = "default"

  constructor(options: IWorldOptions) {
    super(options)
  }

  prepareOpenworkHome(): string {
    if (!this.openworkHome) {
      this.openworkHome = mkdtempSync(join(tmpdir(), "openwork-bdd-"))
      process.env.OPENWORK_HOME = this.openworkHome
    }

    return this.openworkHome
  }

  useScriptedAgentRuntime(): void {
    if (this.electronApp) {
      throw new Error("Scripted agent runtime must be selected before launching Openwork.")
    }

    this.agentRuntimeMode = "scripted"
  }

  setExtensionRuntimeFixture(key: string, value: unknown): void {
    if (this.electronApp) {
      throw new Error("Extension runtime fixtures must be configured before launching Openwork.")
    }

    this.extensionRuntimeFixtures[key] = value
  }

  async launchApp(): Promise<void> {
    if (this.electronApp) {
      return
    }

    const openworkHome = this.prepareOpenworkHome()
    await prepareDatabase(openworkHome)

    this.electronApp = await launchElectronApp({
      args: ["."],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CI: "1",
        OPENWORK_BDD: "1",
        OPENWORK_BDD_AGENT_RUNTIME: this.agentRuntimeMode === "scripted" ? "scripted" : "",
        OPENWORK_BDD_EXTENSION_RUNTIME_FIXTURES: JSON.stringify(this.extensionRuntimeFixtures),
        OPENWORK_HOME: openworkHome,
        OPENWORK_REMOTE_DEBUGGING_PORT: ""
      }
    })

    this.page = await resolveWindowByKind(this.electronApp, "launcher")
  }

  getOpenworkHome(): string {
    if (!this.openworkHome) {
      throw new Error("BDD OPENWORK_HOME is not available before launch.")
    }

    return this.openworkHome
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("BDD page is not available. Launch the app before using page steps.")
    }

    return this.page
  }

  async getPageByKind(windowKind: "main" | "launcher" | "settings"): Promise<Page> {
    if (!this.electronApp) {
      throw new Error("BDD Electron app is not available. Launch the app before using page steps.")
    }

    if (windowKind === "launcher") {
      return this.getPage()
    }

    return resolveWindowByKind(this.electronApp, windowKind)
  }

  async getWindowKinds(): Promise<string[]> {
    if (!this.electronApp) {
      throw new Error("BDD Electron app is not available. Launch the app before using page steps.")
    }

    return listWindowKinds(this.electronApp)
  }

  async isWindowVisible(windowKind: "main" | "launcher" | "settings"): Promise<boolean> {
    if (!this.electronApp) {
      throw new Error("BDD Electron app is not available. Launch the app before using page steps.")
    }

    const page = await this.getPageByKind(windowKind)
    const browserWindow = await this.electronApp.browserWindow(page)

    return browserWindow.evaluate((window) => window.isVisible())
  }

  async getApplicationMenuAccelerator(itemLabel: string): Promise<string | null> {
    if (!this.electronApp) {
      throw new Error("BDD Electron app is not available. Launch the app before using page steps.")
    }

    return this.electronApp.evaluate(({ Menu }, label) => {
      const menu = Menu.getApplicationMenu()
      if (!menu) {
        return null
      }

      const queue = [...menu.items] as Array<{
        accelerator?: string | null
        label?: string
        submenu?: { items: unknown[] } | null
      }>

      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) {
          continue
        }

        if (item.label === label) {
          return item.accelerator ?? null
        }

        if (item.submenu) {
          queue.push(
            ...(item.submenu.items as Array<{
              accelerator?: string | null
              label?: string
              submenu?: { items: unknown[] } | null
            }>)
          )
        }
      }

      return null
    }, itemLabel)
  }

  async evaluateInMain<TResult, TArg>(
    pageFunction: (electron: typeof import("electron"), arg: TArg) => TResult | Promise<TResult>,
    arg: TArg
  ): Promise<TResult> {
    if (!this.electronApp) {
      throw new Error("BDD Electron app is not available. Launch the app before using main eval.")
    }

    return this.electronApp.evaluate(
      pageFunction as never,
      arg as Parameters<ElectronApplication["evaluate"]>[1]
    ) as Promise<TResult>
  }

  async closeApp(): Promise<void> {
    if (this.electronApp) {
      await closeElectronApp(this.electronApp)
      this.electronApp = null
    }

    try {
      const { closeDatabase } = await import("../../../src/main/db")
      await closeDatabase()
    } catch {
      // Test process may not have opened its own Prisma client.
    }

    this.page = null
    this.extensionRuntimeFixtures = {}
    this.scenarioObjects.clear()
    this.scenarioValues.clear()

    if (this.openworkHome) {
      rmSync(this.openworkHome, { force: true, recursive: true })
      this.openworkHome = null
    }

    delete process.env.OPENWORK_HOME
  }

  async restartApp(): Promise<void> {
    if (!this.openworkHome) {
      throw new Error("BDD OPENWORK_HOME is not available before restart.")
    }

    if (this.electronApp) {
      await closeElectronApp(this.electronApp)
      this.electronApp = null
    }

    try {
      const { closeDatabase } = await import("../../../src/main/db")
      await closeDatabase()
    } catch {
      // Test process may not have opened its own Prisma client.
    }

    this.page = null
    await this.launchApp()
  }

  getScenarioValue(key: string): string {
    const value = this.scenarioValues.get(key)
    if (!value) {
      throw new Error(`Scenario value "${key}" is not available.`)
    }

    return value
  }

  setScenarioValue(key: string, value: string): void {
    this.scenarioValues.set(key, value)
  }

  getScenarioObject<T>(key: string): T {
    if (!this.scenarioObjects.has(key)) {
      throw new Error(`Scenario object "${key}" is not available.`)
    }

    return this.scenarioObjects.get(key) as T
  }

  setScenarioObject(key: string, value: unknown): void {
    this.scenarioObjects.set(key, value)
  }

  addCleanup(callback: () => Promise<void> | void): void {
    this.cleanupCallbacks.push(callback)
  }

  async runCleanups(): Promise<void> {
    const callbacks = this.cleanupCallbacks.splice(0).reverse()
    for (const callback of callbacks) {
      await callback()
    }
  }
}

setWorldConstructor(OpenworkWorld)

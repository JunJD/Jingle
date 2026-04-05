import {
  World,
  type IWorldOptions,
  setDefaultTimeout,
  setWorldConstructor
} from "@cucumber/cucumber"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { _electron as electron, type ElectronApplication, type Page } from "playwright"

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 90_000
const REPO_ROOT = process.cwd()
const PRISMA_SCHEMA_PATH = resolve(REPO_ROOT, "prisma/schema.prisma")
const PRISMA_CLI_PATH = require.resolve("prisma/build/index.js")

setDefaultTimeout(DEFAULT_TIMEOUT_MS)

async function readWindowKind(page: Page): Promise<string | null> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 })
    return await page.evaluate(() => document.body.dataset.window ?? null)
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

    await electronApp.waitForEvent("window", { timeout: remaining }).catch(() => null)
  }

  throw new Error(`Window "${windowKind}" did not finish bootstrapping within 30 seconds.`)
}

async function listWindowKinds(electronApp: ElectronApplication): Promise<string[]> {
  const kinds = await Promise.all(electronApp.windows().map((page) => readWindowKind(page)))
  return kinds.filter((kind): kind is string => Boolean(kind))
}

async function prepareDatabase(openworkHome: string): Promise<void> {
  const databaseUrl = `file:${join(openworkHome, "openwork.sqlite")}`

  try {
    await execFileAsync(
      process.execPath,
      [PRISMA_CLI_PATH, "migrate", "deploy", "--schema", PRISMA_SCHEMA_PATH],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl
        }
      }
    )
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : String(error)
    throw new Error(`Failed to prepare BDD database for ${databaseUrl}.\n${message}`)
  }
}

export class OpenworkWorld extends World {
  private electronApp: ElectronApplication | null = null
  private page: Page | null = null
  private openworkHome: string | null = null
  private scenarioValues = new Map<string, string>()

  constructor(options: IWorldOptions) {
    super(options)
  }

  async launchApp(): Promise<void> {
    if (this.electronApp) {
      return
    }

    this.openworkHome = mkdtempSync(join(tmpdir(), "openwork-bdd-"))
    await prepareDatabase(this.openworkHome)

    this.electronApp = await electron.launch({
      args: ["."],
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CI: "1",
        OPENWORK_BDD: "1",
        OPENWORK_HOME: this.openworkHome
      }
    })

    this.page = await resolveWindowByKind(this.electronApp, "launcher")
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

  async closeApp(): Promise<void> {
    if (this.electronApp) {
      await this.electronApp.close()
      this.electronApp = null
    }

    this.page = null
    this.scenarioValues.clear()

    if (this.openworkHome) {
      rmSync(this.openworkHome, { force: true, recursive: true })
      this.openworkHome = null
    }
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
}

setWorldConstructor(OpenworkWorld)

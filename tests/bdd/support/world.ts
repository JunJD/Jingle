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

async function resolveMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if ((await readWindowKind(page)) === "main") {
        return page
      }
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      break
    }

    await electronApp.waitForEvent("window", { timeout: remaining }).catch(() => null)
  }

  throw new Error("Main window did not finish bootstrapping within 30 seconds.")
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
        OPENWORK_HOME: this.openworkHome
      }
    })

    this.page = await resolveMainWindow(this.electronApp)
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("BDD page is not available. Launch the app before using page steps.")
    }

    return this.page
  }

  async closeApp(): Promise<void> {
    if (this.electronApp) {
      await this.electronApp.close()
      this.electronApp = null
    }

    this.page = null

    if (this.openworkHome) {
      rmSync(this.openworkHome, { force: true, recursive: true })
      this.openworkHome = null
    }
  }
}

setWorldConstructor(OpenworkWorld)

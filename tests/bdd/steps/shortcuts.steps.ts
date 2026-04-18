import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type {
  GlobalShortcutAvailability,
  ResolvedShortcutBinding,
  ShortcutSettings
} from "../../../src/shared/shortcuts/settings"
import type { ShortcutChord } from "../../../src/shared/shortcuts/model"
import { OpenworkWorld } from "../support/world"

type ShortcutSource = ResolvedShortcutBinding["source"]

function serializeChord(chord: ShortcutChord): string {
  return [...chord.modifiers, chord.code ?? chord.key].join("+")
}

function parseShortcutLabel(label: string): ShortcutChord {
  if (label === "Ctrl+Alt+K") {
    return {
      modifiers: ["ctrl", "alt"],
      key: "K",
      code: "KeyK"
    }
  }

  throw new Error(`Unsupported BDD shortcut label: ${label}`)
}

async function readBootstrapState(world: OpenworkWorld): Promise<{
  bindings: ResolvedShortcutBinding[]
  settings: ShortcutSettings
}> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(() => {
    return {
      bindings: (
        window as typeof window & {
          api: {
            shortcuts: {
              initialResolvedBindings: ResolvedShortcutBinding[]
              initialSettings: ShortcutSettings
            }
          }
        }
      ).api.shortcuts.initialResolvedBindings,
      settings: (
        window as typeof window & {
          api: {
            shortcuts: {
              initialSettings: ShortcutSettings
            }
          }
        }
      ).api.shortcuts.initialSettings
    }
  })
}

async function readShortcutSettings(world: OpenworkWorld): Promise<ShortcutSettings> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          shortcuts: {
            getSettings: () => Promise<ShortcutSettings>
          }
        }
      }
    ).api.shortcuts.getSettings()
  })
}

async function setShortcutSettings(
  world: OpenworkWorld,
  settings: Partial<ShortcutSettings>
): Promise<ShortcutSettings> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (updates) => {
    return (
      window as typeof window & {
        api: {
          shortcuts: {
            setSettings: (updates: Partial<ShortcutSettings>) => Promise<ShortcutSettings>
          }
        }
      }
    ).api.shortcuts.setSettings(updates)
  }, settings)
}

async function readResolvedBindings(world: OpenworkWorld): Promise<ResolvedShortcutBinding[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          shortcuts: {
            getResolvedBindings: () => Promise<ResolvedShortcutBinding[]>
          }
        }
      }
    ).api.shortcuts.getResolvedBindings()
  })
}

async function readGlobalAvailability(world: OpenworkWorld): Promise<GlobalShortcutAvailability[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: {
          shortcuts: {
            getGlobalAvailability: () => Promise<GlobalShortcutAvailability[]>
          }
        }
      }
    ).api.shortcuts.getGlobalAvailability()
  })
}

function findResolvedBinding(
  bindings: ResolvedShortcutBinding[],
  commandId: string
): ResolvedShortcutBinding {
  const binding = bindings.find((candidate) => candidate.commandId === commandId)

  if (!binding) {
    throw new Error(`Resolved shortcut binding "${commandId}" was not found.`)
  }

  return binding
}

function findAvailability(
  records: GlobalShortcutAvailability[],
  commandId: string
): GlobalShortcutAvailability {
  const record = records.find((candidate) => candidate.commandId === commandId)

  if (!record) {
    throw new Error(`Global shortcut availability "${commandId}" was not found.`)
  }

  return record
}

function getOverride(settings: ShortcutSettings, commandId: string) {
  return settings.overrides.find((override) => override.commandId === commandId) ?? null
}

When("我读取 shortcuts bootstrap 状态", async function (this: OpenworkWorld) {
  const bootstrapState = await readBootstrapState(this)

  this.setScenarioValue("shortcuts.bootstrapState", JSON.stringify(bootstrapState))
})

When("我读取 shortcuts 当前设置", async function (this: OpenworkWorld) {
  const settings = await readShortcutSettings(this)
  const bindings = await readResolvedBindings(this)

  this.setScenarioValue("shortcuts.currentSettings", JSON.stringify(settings))
  this.setScenarioValue("shortcuts.resolvedBindings", JSON.stringify(bindings))
})

When("我开始监听 shortcuts settingsChanged 事件", async function (this: OpenworkWorld) {
  const page = await this.getPageByKind("launcher")

  await page.evaluate(() => {
    const stateWindow = window as typeof window & {
      __bddShortcutSettingsChangedEvents?: ShortcutSettings[]
      api: {
        shortcuts: {
          onSettingsChanged: (callback: (settings: ShortcutSettings) => void) => () => void
        }
      }
    }

    stateWindow.__bddShortcutSettingsChangedEvents = []
    stateWindow.api.shortcuts.onSettingsChanged((settings) => {
      stateWindow.__bddShortcutSettingsChangedEvents?.push(settings)
    })
  })
})

When(
  "我把 launcher.toggle 快捷键设置为 {string}",
  async function (this: OpenworkWorld, shortcutLabel: string) {
    const settings = await setShortcutSettings(this, {
      overrides: [
        {
          commandId: "launcher.toggle",
          chord: parseShortcutLabel(shortcutLabel)
        }
      ]
    })

    this.setScenarioValue("shortcuts.currentSettings", JSON.stringify(settings))
  }
)

When("我重置 shortcuts 设置", async function (this: OpenworkWorld) {
  const settings = await setShortcutSettings(this, { overrides: [] })

  this.setScenarioValue("shortcuts.currentSettings", JSON.stringify(settings))
})

When("我读取 shortcuts global availability", async function (this: OpenworkWorld) {
  const records = await readGlobalAvailability(this)

  this.setScenarioValue("shortcuts.globalAvailability", JSON.stringify(records))
})

Then("shortcuts bootstrap 设置应等于当前设置", function (this: OpenworkWorld) {
  const bootstrapState = JSON.parse(this.getScenarioValue("shortcuts.bootstrapState")) as {
    settings: ShortcutSettings
  }
  const currentSettings = JSON.parse(
    this.getScenarioValue("shortcuts.currentSettings")
  ) as ShortcutSettings

  expect(bootstrapState.settings).toEqual(currentSettings)
})

Then(
  "shortcuts resolved bindings 包含命令 {string} 来源为 {string}",
  function (this: OpenworkWorld, commandId: string, source: ShortcutSource) {
    const bindings = JSON.parse(
      this.getScenarioValue("shortcuts.resolvedBindings")
    ) as ResolvedShortcutBinding[]
    const binding = findResolvedBinding(bindings, commandId)

    expect(binding.source).toBe(source)
  }
)

Then(
  "shortcuts 当前设置中 launcher.toggle 快捷键应为 {string}",
  function (this: OpenworkWorld, expectedChord: string) {
    const settings = JSON.parse(
      this.getScenarioValue("shortcuts.currentSettings")
    ) as ShortcutSettings
    const override = getOverride(settings, "launcher.toggle")

    expect(override?.chord ? serializeChord(override.chord) : null).toBe(expectedChord)
  }
)

Then(
  "shortcuts 最近一次 settingsChanged 事件中 launcher.toggle 快捷键应为 {string}",
  async function (this: OpenworkWorld, expectedChord: string) {
    const page = await this.getPageByKind("launcher")

    const events = await page.waitForFunction(() => {
      const receivedEvents = (
        window as typeof window & {
          __bddShortcutSettingsChangedEvents?: ShortcutSettings[]
        }
      ).__bddShortcutSettingsChangedEvents

      return receivedEvents && receivedEvents.length > 0 ? receivedEvents : null
    })
    const eventSettings = (await events.jsonValue()) as ShortcutSettings[]
    const latestEvent = eventSettings[eventSettings.length - 1]
    const override = latestEvent ? getOverride(latestEvent, "launcher.toggle") : null

    expect(override?.chord ? serializeChord(override.chord) : null).toBe(expectedChord)
  }
)

Then("shortcuts 当前设置不包含 launcher.toggle override", function (this: OpenworkWorld) {
  const settings = JSON.parse(
    this.getScenarioValue("shortcuts.currentSettings")
  ) as ShortcutSettings

  expect(getOverride(settings, "launcher.toggle")).toBeNull()
})

Then(
  "shortcuts global availability 包含命令 {string}",
  function (this: OpenworkWorld, commandId: string) {
    const records = JSON.parse(
      this.getScenarioValue("shortcuts.globalAvailability")
    ) as GlobalShortcutAvailability[]

    expect(records.some((record) => record.commandId === commandId)).toBe(true)
  }
)

Then(
  "shortcuts global availability 中 {string} accelerator 应为非空字符串",
  function (this: OpenworkWorld, commandId: string) {
    const records = JSON.parse(
      this.getScenarioValue("shortcuts.globalAvailability")
    ) as GlobalShortcutAvailability[]
    const record = findAvailability(records, commandId)

    expect(typeof record.accelerator).toBe("string")
    expect(record.accelerator?.length).toBeGreaterThan(0)
  }
)

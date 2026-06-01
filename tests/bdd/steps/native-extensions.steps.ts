import { DataTable, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent
} from "../../../src/shared/native-extensions"
import { OpenworkWorld } from "../support/world"

type NativeExtensionPageApi = {
  nativeExtensions: {
    getCommandPreferences: (
      extensionName: string,
      commandName: string
    ) => Promise<Record<string, unknown>>
    getPreferences: (extensionName: string) => Promise<Record<string, unknown>>
    invoke: (request: NativeExtensionInvokeRequest) => Promise<unknown>
    listSettingsSchemas: () => Promise<InstalledNativeExtensionSettingsSchema[]>
    onPreferencesChanged: (
      callback: (event: NativeExtensionPreferencesChangedEvent) => void
    ) => () => void
    setCommandPreferences: (
      extensionName: string,
      commandName: string,
      nextRecord: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    setPreferences: (
      extensionName: string,
      nextRecord: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
  }
}

async function invokeNativeExtension(
  world: OpenworkWorld,
  extensionName: string,
  method: string
): Promise<void> {
  const page = await world.getPageByKind("launcher")

  try {
    await page.evaluate(
      async (input) => {
        return (
          window as typeof window & {
            api: NativeExtensionPageApi
          }
        ).api.nativeExtensions.invoke({
          extensionName: input.extensionName,
          method: input.method,
          payload: {}
        })
      },
      { extensionName, method }
    )
    world.setScenarioValue("nativeExtensions.invokeError", "")
  } catch (error) {
    world.setScenarioValue(
      "nativeExtensions.invokeError",
      error instanceof Error ? error.message : String(error)
    )
  }
}

function parsePreferenceTable(table: DataTable): Record<string, unknown> {
  return Object.fromEntries(
    table.hashes().map((row) => {
      const value = row["value"]
      if (value === "true") {
        return [row["key"], true]
      }
      if (value === "false") {
        return [row["key"], false]
      }
      return [row["key"], value]
    })
  )
}

function findSchema(
  schemas: InstalledNativeExtensionSettingsSchema[],
  extensionName: string
): InstalledNativeExtensionSettingsSchema {
  const schema = schemas.find((candidate) => candidate.extName === extensionName)
  if (!schema) {
    throw new Error(`Native extension schema "${extensionName}" was not found.`)
  }
  return schema
}

async function readSchemas(world: OpenworkWorld): Promise<InstalledNativeExtensionSettingsSchema[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    return (
      window as typeof window & {
        api: NativeExtensionPageApi
      }
    ).api.nativeExtensions.listSettingsSchemas()
  })
}

async function setExtensionPreferences(
  world: OpenworkWorld,
  extensionName: string,
  nextRecord: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: NativeExtensionPageApi
        }
      ).api.nativeExtensions.setPreferences(input.extensionName, input.nextRecord)
    },
    { extensionName, nextRecord }
  )
}

async function readExtensionPreferences(
  world: OpenworkWorld,
  extensionName: string
): Promise<Record<string, unknown>> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputExtensionName) => {
    return (
      window as typeof window & {
        api: NativeExtensionPageApi
      }
    ).api.nativeExtensions.getPreferences(inputExtensionName)
  }, extensionName)
}

async function setCommandPreferences(
  world: OpenworkWorld,
  extensionName: string,
  commandName: string,
  nextRecord: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: NativeExtensionPageApi
        }
      ).api.nativeExtensions.setCommandPreferences(
        input.extensionName,
        input.commandName,
        input.nextRecord
      )
    },
    { commandName, extensionName, nextRecord }
  )
}

async function readCommandPreferences(
  world: OpenworkWorld,
  extensionName: string,
  commandName: string
): Promise<Record<string, unknown>> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: NativeExtensionPageApi
        }
      ).api.nativeExtensions.getCommandPreferences(input.extensionName, input.commandName)
    },
    { commandName, extensionName }
  )
}

When("我读取 native extensions 设置 schema", async function (this: OpenworkWorld) {
  const schemas = await readSchemas(this)

  this.setScenarioValue("nativeExtensions.schemas", JSON.stringify(schemas))
})

When(
  "我把 native extension {string} preferences 设置为:",
  async function (this: OpenworkWorld, extensionName: string, table: DataTable) {
    const record = await setExtensionPreferences(this, extensionName, parsePreferenceTable(table))

    this.setScenarioValue("nativeExtensions.extensionPreferences", JSON.stringify(record))
  }
)

When(
  "我读取 native extension {string} preferences",
  async function (this: OpenworkWorld, extensionName: string) {
    const record = await readExtensionPreferences(this, extensionName)

    this.setScenarioValue("nativeExtensions.extensionPreferences", JSON.stringify(record))
  }
)

When(
  "我把 native extension {string} command {string} preferences 设置为:",
  async function (
    this: OpenworkWorld,
    extensionName: string,
    commandName: string,
    table: DataTable
  ) {
    const record = await setCommandPreferences(
      this,
      extensionName,
      commandName,
      parsePreferenceTable(table)
    )

    this.setScenarioValue("nativeExtensions.commandPreferences", JSON.stringify(record))
  }
)

When(
  "我读取 native extension {string} command {string} preferences",
  async function (this: OpenworkWorld, extensionName: string, commandName: string) {
    const record = await readCommandPreferences(this, extensionName, commandName)

    this.setScenarioValue("nativeExtensions.commandPreferences", JSON.stringify(record))
  }
)

When(
  "我开始在 Launcher 和 Settings 监听 native extension preference 事件",
  async function (this: OpenworkWorld) {
    for (const windowKind of ["launcher", "settings"] as const) {
      const page = await this.getPageByKind(windowKind)

      await page.evaluate(() => {
        const stateWindow = window as typeof window & {
          __bddNativeExtensionPreferenceEvents?: NativeExtensionPreferencesChangedEvent[]
          api: NativeExtensionPageApi
        }

        stateWindow.__bddNativeExtensionPreferenceEvents = []
        stateWindow.api.nativeExtensions.onPreferencesChanged((event) => {
          stateWindow.__bddNativeExtensionPreferenceEvents?.push(event)
        })
      })
    }
  }
)

When(
  "我调用 native extension {string} RPC method {string}",
  async function (this: OpenworkWorld, extensionName: string, method: string) {
    await invokeNativeExtension(this, extensionName, method)
  }
)

Then(
  "native extensions schema 包含 extension {string} 标题为 {string}",
  function (this: OpenworkWorld, extensionName: string, title: string) {
    const schemas = JSON.parse(
      this.getScenarioValue("nativeExtensions.schemas")
    ) as InstalledNativeExtensionSettingsSchema[]
    const schema = findSchema(schemas, extensionName)

    expect(schema.title).toBe(title)
  }
)

Then(
  "native extensions schema 不包含 extension {string}",
  function (this: OpenworkWorld, extensionName: string) {
    const schemas = JSON.parse(
      this.getScenarioValue("nativeExtensions.schemas")
    ) as InstalledNativeExtensionSettingsSchema[]

    expect(schemas.some((schema) => schema.extName === extensionName)).toBe(false)
  }
)

Then(
  "native extensions schema 中 extension {string} 包含 command {string} 标题为 {string}",
  function (this: OpenworkWorld, extensionName: string, commandName: string, title: string) {
    const schemas = JSON.parse(
      this.getScenarioValue("nativeExtensions.schemas")
    ) as InstalledNativeExtensionSettingsSchema[]
    const schema = findSchema(schemas, extensionName)
    const command = schema.commands.find((candidate) => candidate.name === commandName)

    expect(command?.title).toBe(title)
  }
)

Then(
  "native extensions schema 中 extension {string} 包含 preference {string}",
  function (this: OpenworkWorld, extensionName: string, preferenceName: string) {
    const schemas = JSON.parse(
      this.getScenarioValue("nativeExtensions.schemas")
    ) as InstalledNativeExtensionSettingsSchema[]
    const schema = findSchema(schemas, extensionName)

    expect(schema.preferences.some((preference) => preference.name === preferenceName)).toBe(true)
  }
)

Then(
  "native extensions schema 中 command {string} 包含 preference {string}",
  function (this: OpenworkWorld, commandId: string, preferenceName: string) {
    const [extensionName, commandName] = commandId.split(":")
    const schemas = JSON.parse(
      this.getScenarioValue("nativeExtensions.schemas")
    ) as InstalledNativeExtensionSettingsSchema[]
    const schema = findSchema(schemas, extensionName)
    const command = schema.commands.find((candidate) => candidate.name === commandName)

    expect(command?.preferences.some((preference) => preference.name === preferenceName)).toBe(true)
  }
)

Then(
  "native extension preferences 中 {string} 应为 {string}",
  function (this: OpenworkWorld, key: string, value: string) {
    const record = JSON.parse(
      this.getScenarioValue("nativeExtensions.extensionPreferences")
    ) as Record<string, unknown>

    expect(record[key]).toBe(value)
  }
)

Then(
  "native command preferences 中 {string} 应为 {string}",
  function (this: OpenworkWorld, key: string, value: string) {
    const record = JSON.parse(
      this.getScenarioValue("nativeExtensions.commandPreferences")
    ) as Record<string, unknown>

    expect(record[key]).toBe(value)
  }
)

Then(
  "native command preferences 中 {string} 应为布尔值 false",
  function (this: OpenworkWorld, key: string) {
    const record = JSON.parse(
      this.getScenarioValue("nativeExtensions.commandPreferences")
    ) as Record<string, unknown>

    expect(record[key]).toBe(false)
  }
)

Then(
  "{word} 最近一次 native extension preference 事件应为 command {string}",
  async function (this: OpenworkWorld, windowLabel: string, commandId: string) {
    const windowKind = windowLabel === "Launcher" ? "launcher" : "settings"
    const [extensionName, commandName] = commandId.split(":")
    const page = await this.getPageByKind(windowKind)

    const events = await page.waitForFunction(() => {
      const receivedEvents = (
        window as typeof window & {
          __bddNativeExtensionPreferenceEvents?: NativeExtensionPreferencesChangedEvent[]
        }
      ).__bddNativeExtensionPreferenceEvents

      return receivedEvents && receivedEvents.length > 0 ? receivedEvents : null
    })
    const eventRecords = (await events.jsonValue()) as NativeExtensionPreferencesChangedEvent[]
    const latestEvent = eventRecords[eventRecords.length - 1]

    expect(latestEvent).toEqual({
      commandName,
      extensionName,
      scope: "command"
    })
  }
)

Then(
  "native extension invoke 错误应包含 {string}",
  function (this: OpenworkWorld, expectedMessage: string) {
    expect(this.getScenarioValue("nativeExtensions.invokeError")).toContain(expectedMessage)
  }
)

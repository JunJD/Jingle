import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { AppLocale } from "../../../src/shared/i18n"
import type { LauncherWindowMode } from "../../../src/shared/launcher-settings"
import { OpenworkWorld } from "../support/world"

async function setAgentLocale(world: OpenworkWorld, locale: AppLocale): Promise<AppLocale> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputLocale) => {
    const config = await (
      window as typeof window & {
        api: {
          settings: {
            setAgentConfig: (updates: { locale: AppLocale }) => Promise<{ locale: AppLocale }>
          }
        }
      }
    ).api.settings.setAgentConfig({ locale: inputLocale })

    return config.locale
  }, locale)
}

async function getAgentLocale(world: OpenworkWorld): Promise<AppLocale> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    const config = await (
      window as typeof window & {
        api: {
          settings: {
            getAgentConfig: () => Promise<{ locale: AppLocale }>
          }
        }
      }
    ).api.settings.getAgentConfig()

    return config.locale
  })
}

async function setLauncherWindowMode(
  world: OpenworkWorld,
  windowMode: LauncherWindowMode
): Promise<LauncherWindowMode> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputWindowMode) => {
    const settings = await (
      window as typeof window & {
        api: {
          settings: {
            setLauncherSettings: (updates: {
              windowMode: LauncherWindowMode
            }) => Promise<{ windowMode: LauncherWindowMode }>
          }
        }
      }
    ).api.settings.setLauncherSettings({ windowMode: inputWindowMode })

    return settings.windowMode
  }, windowMode)
}

async function getLauncherWindowMode(world: OpenworkWorld): Promise<LauncherWindowMode> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async () => {
    const settings = await (
      window as typeof window & {
        api: {
          settings: {
            getLauncherSettings: () => Promise<{ windowMode: LauncherWindowMode }>
          }
        }
      }
    ).api.settings.getLauncherSettings()

    return settings.windowMode
  })
}

When(
  "我通过 settings API 将语言设置为 {string}",
  async function (this: OpenworkWorld, locale: AppLocale) {
    expect(await setAgentLocale(this, locale)).toBe(locale)
  }
)

When(
  "我通过 settings API 将 launcher 窗口模式设置为 {string}",
  async function (this: OpenworkWorld, windowMode: LauncherWindowMode) {
    expect(await setLauncherWindowMode(this, windowMode)).toBe(windowMode)
  }
)

Then(
  "settings:getAgentConfig 语言应为 {string}",
  async function (this: OpenworkWorld, expectedLocale: AppLocale) {
    expect(await getAgentLocale(this)).toBe(expectedLocale)
  }
)

Then(
  "settings:getLauncherSettings 窗口模式应为 {string}",
  async function (this: OpenworkWorld, expectedWindowMode: LauncherWindowMode) {
    expect(await getLauncherWindowMode(this)).toBe(expectedWindowMode)
  }
)

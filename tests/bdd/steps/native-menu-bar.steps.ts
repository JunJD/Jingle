import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type {
  NativeMenuBarActionEvent,
  NativeMenuBarState
} from "../../../src/shared/native-menu-bar"
import { JingleWorld } from "../support/world"

interface NativeMenuBarBddProbe {
  getStates: () => NativeMenuBarState[]
  selectItem: (event: NativeMenuBarActionEvent) => void
  setState: (state: NativeMenuBarState) => void
  clearState: (commandKey: string) => void
}

async function getNativeMenuBarSnapshot(world: JingleWorld): Promise<NativeMenuBarState[]> {
  return world.evaluateInMain((_, _unused) => {
    const probe = (
      globalThis as typeof globalThis & {
        __JINGLE_BDD_NATIVE_MENU_BAR__?: NativeMenuBarBddProbe
      }
    ).__JINGLE_BDD_NATIVE_MENU_BAR__

    if (!probe) {
      throw new Error("Native menu bar BDD probe is not available.")
    }

    return probe.getStates()
  }, null)
}

async function setNativeMenuBarState(world: JingleWorld, state: NativeMenuBarState): Promise<void> {
  await world.evaluateInMain(
    (_, inputState) => {
      const probe = (
        globalThis as typeof globalThis & {
          __JINGLE_BDD_NATIVE_MENU_BAR__?: NativeMenuBarBddProbe
        }
      ).__JINGLE_BDD_NATIVE_MENU_BAR__

      if (!probe) {
        throw new Error("Native menu bar BDD probe is not available.")
      }

      probe.setState(inputState)
    },
    state
  )
}

async function clearNativeMenuBarState(world: JingleWorld, commandKey: string): Promise<void> {
  await world.evaluateInMain(
    (_, inputCommandKey) => {
      const probe = (
        globalThis as typeof globalThis & {
          __JINGLE_BDD_NATIVE_MENU_BAR__?: NativeMenuBarBddProbe
        }
      ).__JINGLE_BDD_NATIVE_MENU_BAR__

      if (!probe) {
        throw new Error("Native menu bar BDD probe is not available.")
      }

      probe.clearState(inputCommandKey)
    },
    commandKey
  )
}

When("我开始监听 native menu bar itemSelected 事件", async function (this: JingleWorld) {
  const page = await this.getPageByKind("launcher")

  await page.evaluate(() => {
    const stateWindow = window as typeof window & {
      __bddNativeMenuBarEvents?: NativeMenuBarActionEvent[]
      __bddNativeMenuBarUnsubscribe?: (() => void) | undefined
      api: {
        nativeMenuBar: {
          onItemSelected: (callback: (event: NativeMenuBarActionEvent) => void) => () => void
        }
      }
    }

    stateWindow.__bddNativeMenuBarUnsubscribe?.()
    stateWindow.__bddNativeMenuBarEvents = []
    stateWindow.__bddNativeMenuBarUnsubscribe = stateWindow.api.nativeMenuBar.onItemSelected(
      (event) => {
        stateWindow.__bddNativeMenuBarEvents?.push(event)
      }
    )
  })
})

When(
  "我通过 native menu bar API 设置命令 {string} 的状态",
  async function (this: JingleWorld, commandKey: string) {
    const state: NativeMenuBarState = {
      commandKey,
      isLoading: false,
      sections: [
        {
          items: [
            {
              id: "bdd-native-item",
              subtitle: "BDD Native Menu Subtitle",
              title: "BDD Native Menu Item"
            }
          ],
          title: "BDD Native Menu Section"
        }
      ],
      title: "BDD Native Menu",
      tooltip: "BDD Native Menu Tooltip"
    }

    await setNativeMenuBarState(this, state)
    this.setScenarioValue("nativeMenuBar.commandKey", commandKey)
  }
)

When(
  "我在主进程触发 native menu bar 命令 {string} 选择项目 {string}",
  async function (this: JingleWorld, commandKey: string, itemId: string) {
    await this.evaluateInMain(
      (_, input) => {
        const probe = (
          globalThis as typeof globalThis & {
            __JINGLE_BDD_NATIVE_MENU_BAR__?: NativeMenuBarBddProbe
          }
        ).__JINGLE_BDD_NATIVE_MENU_BAR__

        if (!probe) {
          throw new Error("Native menu bar BDD probe is not available.")
        }

        probe.selectItem(input)
      },
      { commandKey, itemId }
    )
  }
)

When(
  "我通过 native menu bar API 清理命令 {string} 的状态",
  async function (this: JingleWorld, commandKey: string) {
    await clearNativeMenuBarState(this, commandKey)
  }
)

Then(
  "native menu bar 测试快照包含命令 {string}",
  async function (this: JingleWorld, commandKey: string) {
    const states = await getNativeMenuBarSnapshot(this)

    expect(states.some((state) => state.commandKey === commandKey)).toBe(true)
  }
)

Then(
  "native menu bar 测试快照不包含命令 {string}",
  async function (this: JingleWorld, commandKey: string) {
    const states = await getNativeMenuBarSnapshot(this)

    expect(states.some((state) => state.commandKey === commandKey)).toBe(false)
  }
)

Then(
  "native menu bar 命令 {string} 的第 {int} 个项目标题应为 {string}",
  async function (this: JingleWorld, commandKey: string, position: number, title: string) {
    const states = await getNativeMenuBarSnapshot(this)
    const state = states.find((candidate) => candidate.commandKey === commandKey)
    const item = state?.sections.flatMap((section) => section.items)[position - 1]

    expect(item?.title).toBe(title)
  }
)

Then(
  "native menu bar 最近事件 commandKey 应为 {string}",
  async function (this: JingleWorld, commandKey: string) {
    const page = await this.getPageByKind("launcher")
    const lastEvent = await page.evaluate(() => {
      return (
        window as typeof window & {
          __bddNativeMenuBarEvents?: NativeMenuBarActionEvent[]
        }
      ).__bddNativeMenuBarEvents?.at(-1)
    })

    expect(lastEvent?.commandKey).toBe(commandKey)
  }
)

Then(
  "native menu bar 最近事件 itemId 应为 {string}",
  async function (this: JingleWorld, itemId: string) {
    const page = await this.getPageByKind("launcher")
    const lastEvent = await page.evaluate(() => {
      return (
        window as typeof window & {
          __bddNativeMenuBarEvents?: NativeMenuBarActionEvent[]
        }
      ).__bddNativeMenuBarEvents?.at(-1)
    })

    expect(lastEvent?.itemId).toBe(itemId)
  }
)

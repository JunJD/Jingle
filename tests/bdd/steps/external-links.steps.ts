import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { JingleWorld } from "../support/world"

interface ExternalLinksCallProbe {
  calls: string[]
  originalOpenExternal?: (url: string) => Promise<void>
}

interface ExternalLinksInvocationResult {
  error?: string
  ok: boolean
}

async function installExternalLinksProbe(world: JingleWorld): Promise<void> {
  await world.evaluateInMain(({ shell }) => {
    const globalWithProbe = globalThis as typeof globalThis & {
      __JINGLE_BDD_EXTERNAL_LINKS__?: ExternalLinksCallProbe
    }

    if (globalWithProbe.__JINGLE_BDD_EXTERNAL_LINKS__) {
      globalWithProbe.__JINGLE_BDD_EXTERNAL_LINKS__.calls = []
      return
    }

    const probe: ExternalLinksCallProbe = {
      calls: [],
      originalOpenExternal: shell.openExternal.bind(shell)
    }

    shell.openExternal = async (url: string): Promise<void> => {
      probe.calls.push(url)
    }

    globalWithProbe.__JINGLE_BDD_EXTERNAL_LINKS__ = probe
  }, undefined)
}

async function listExternalLinksCalls(world: JingleWorld): Promise<string[]> {
  return world.evaluateInMain(() => {
    const probe = (globalThis as typeof globalThis & {
      __JINGLE_BDD_EXTERNAL_LINKS__?: ExternalLinksCallProbe
    }).__JINGLE_BDD_EXTERNAL_LINKS__

    if (probe === undefined) {
      return []
    }

    return probe.calls
  }, undefined)
}

async function invokeExternalLink(
  world: JingleWorld,
  url: string
): Promise<ExternalLinksInvocationResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputUrl) => {
    try {
      await (
        window as typeof window & {
          electron: {
            openExternal: (url: string) => Promise<void>
          }
        }
      ).electron.openExternal(inputUrl)

      return {
        ok: true
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      }
    }
  }, url)
}

When("我开始记录 external link 打开请求", async function (this: JingleWorld) {
  await installExternalLinksProbe(this)
})

When(
  "我通过 external links API 打开链接 {string}",
  async function (this: JingleWorld, url: string) {
    const result = await invokeExternalLink(this, url)
    this.setScenarioValue("externalLinks.latestResult", JSON.stringify(result))
  }
)

Then("external links 最近结果应成功", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("externalLinks.latestResult")
  ) as ExternalLinksInvocationResult

  expect(result).toEqual({ ok: true })
})

Then("external links 最近结果应失败", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("externalLinks.latestResult")
  ) as ExternalLinksInvocationResult

  expect(result.ok).toBe(false)
})

Then(
  "external links 最近错误应包含 {string}",
  function (this: JingleWorld, errorFragment: string) {
    const result = JSON.parse(
      this.getScenarioValue("externalLinks.latestResult")
    ) as ExternalLinksInvocationResult

    expect(result.error).toContain(errorFragment)
  }
)

Then(
  "external links 最近调用 URL 应为 {string}",
  async function (this: JingleWorld, expectedUrl: string) {
    const calls = await listExternalLinksCalls(this)

    expect(calls.at(-1)).toBe(expectedUrl)
  }
)

Then(
  "external links 打开请求数量应为 {int}",
  async function (this: JingleWorld, expectedCount: number) {
    const calls = await listExternalLinksCalls(this)

    expect(calls).toHaveLength(expectedCount)
  }
)

import { Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import { OpenworkWorld } from "../support/world"

interface ExternalLinksCallProbe {
  calls: string[]
  originalOpenExternal?: (url: string) => Promise<void>
}

interface ExternalLinksInvocationResult {
  error?: string
  ok: boolean
}

async function installExternalLinksProbe(world: OpenworkWorld): Promise<void> {
  await world.evaluateInMain(({ shell }) => {
    const globalWithProbe = globalThis as typeof globalThis & {
      __OPENWORK_BDD_EXTERNAL_LINKS__?: ExternalLinksCallProbe
    }

    if (globalWithProbe.__OPENWORK_BDD_EXTERNAL_LINKS__) {
      globalWithProbe.__OPENWORK_BDD_EXTERNAL_LINKS__.calls = []
      return
    }

    const probe: ExternalLinksCallProbe = {
      calls: [],
      originalOpenExternal: shell.openExternal.bind(shell)
    }

    shell.openExternal = async (url: string): Promise<void> => {
      probe.calls.push(url)
    }

    globalWithProbe.__OPENWORK_BDD_EXTERNAL_LINKS__ = probe
  }, undefined)
}

async function listExternalLinksCalls(world: OpenworkWorld): Promise<string[]> {
  return world.evaluateInMain(() => {
    return (
      (globalThis as typeof globalThis & {
        __OPENWORK_BDD_EXTERNAL_LINKS__?: ExternalLinksCallProbe
      }).__OPENWORK_BDD_EXTERNAL_LINKS__?.calls ?? []
    )
  }, undefined)
}

async function invokeExternalLink(
  world: OpenworkWorld,
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

When("我开始记录 external link 打开请求", async function (this: OpenworkWorld) {
  await installExternalLinksProbe(this)
})

When(
  "我通过 external links API 打开链接 {string}",
  async function (this: OpenworkWorld, url: string) {
    const result = await invokeExternalLink(this, url)
    this.setScenarioValue("externalLinks.latestResult", JSON.stringify(result))
  }
)

Then("external links 最近结果应成功", function (this: OpenworkWorld) {
  const result = JSON.parse(
    this.getScenarioValue("externalLinks.latestResult")
  ) as ExternalLinksInvocationResult

  expect(result).toEqual({ ok: true })
})

Then("external links 最近结果应失败", function (this: OpenworkWorld) {
  const result = JSON.parse(
    this.getScenarioValue("externalLinks.latestResult")
  ) as ExternalLinksInvocationResult

  expect(result.ok).toBe(false)
})

Then(
  "external links 最近错误应包含 {string}",
  function (this: OpenworkWorld, errorFragment: string) {
    const result = JSON.parse(
      this.getScenarioValue("externalLinks.latestResult")
    ) as ExternalLinksInvocationResult

    expect(result.error).toContain(errorFragment)
  }
)

Then(
  "external links 最近调用 URL 应为 {string}",
  async function (this: OpenworkWorld, expectedUrl: string) {
    const calls = await listExternalLinksCalls(this)

    expect(calls.at(-1)).toBe(expectedUrl)
  }
)

Then(
  "external links 打开请求数量应为 {int}",
  async function (this: OpenworkWorld, expectedCount: number) {
    const calls = await listExternalLinksCalls(this)

    expect(calls).toHaveLength(expectedCount)
  }
)

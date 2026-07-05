import { Given, Then, When } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type {
  ArtifactActionId,
  ArtifactActionResolution,
  ArtifactRecord
} from "../../../src/shared/artifacts"
import { seedManagedFileArtifactFixture } from "../support/artifact-fixtures"
import { JingleWorld } from "../support/world"

type ArtifactFileReadResult = {
  content?: string
  error?: string
  modified_at?: string
  size?: number
  success: boolean
}

type ArtifactsPageApi = {
  artifacts: {
    list: (threadId: string) => Promise<ArtifactRecord[]>
    open: (artifactId: string, action?: ArtifactActionId) => Promise<ArtifactActionResolution>
    readBinaryFile: (artifactId: string) => Promise<ArtifactFileReadResult>
    readFile: (artifactId: string) => Promise<ArtifactFileReadResult>
  }
}

function parseByteList(bytes: string): Buffer {
  return Buffer.from(bytes.split(",").map((value) => Number(value.trim())))
}

async function readArtifacts(world: JingleWorld, threadId: string): Promise<ArtifactRecord[]> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputThreadId) => {
    return (
      window as typeof window & {
        api: ArtifactsPageApi
      }
    ).api.artifacts.list(inputThreadId)
  }, threadId)
}

async function readArtifactText(
  world: JingleWorld,
  artifactId: string
): Promise<ArtifactFileReadResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputArtifactId) => {
    return (
      window as typeof window & {
        api: ArtifactsPageApi
      }
    ).api.artifacts.readFile(inputArtifactId)
  }, artifactId)
}

async function readArtifactBinary(
  world: JingleWorld,
  artifactId: string
): Promise<ArtifactFileReadResult> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(async (inputArtifactId) => {
    return (
      window as typeof window & {
        api: ArtifactsPageApi
      }
    ).api.artifacts.readBinaryFile(inputArtifactId)
  }, artifactId)
}

async function openArtifact(
  world: JingleWorld,
  artifactId: string,
  action: ArtifactActionId
): Promise<ArtifactActionResolution> {
  const page = await world.getPageByKind("launcher")

  return page.evaluate(
    async (input) => {
      return (
        window as typeof window & {
          api: ArtifactsPageApi
        }
      ).api.artifacts.open(input.artifactId, input.action)
    },
    { action, artifactId }
  )
}

Given(
  "存在标题为 {string} 且内容为 {string} 的托管文本 artifact",
  async function (this: JingleWorld, title: string, content: string) {
    const fixture = await seedManagedFileArtifactFixture({
      content,
      fileName: "artifact.txt",
      mimeType: "text/plain",
      jingleHome: this.getJingleHome(),
      title
    })

    this.setScenarioValue("artifacts.threadId", fixture.threadId)
    this.setScenarioValue("artifacts.latestArtifactId", fixture.artifactId)
    this.setScenarioValue("artifacts.latestManagedPath", fixture.managedPath)
  }
)

Given(
  "存在标题为 {string} 且字节为 {string} 的托管二进制 artifact",
  async function (this: JingleWorld, title: string, bytes: string) {
    const fixture = await seedManagedFileArtifactFixture({
      content: parseByteList(bytes),
      fileName: "artifact.bin",
      mimeType: "application/octet-stream",
      jingleHome: this.getJingleHome(),
      title
    })

    this.setScenarioValue("artifacts.threadId", fixture.threadId)
    this.setScenarioValue("artifacts.latestArtifactId", fixture.artifactId)
    this.setScenarioValue("artifacts.latestManagedPath", fixture.managedPath)
  }
)

When("我读取当前 artifact 线程的 artifacts 列表", async function (this: JingleWorld) {
  const threadId = this.getScenarioValue("artifacts.threadId")
  const artifacts = await readArtifacts(this, threadId)

  this.setScenarioValue("artifacts.latestList", JSON.stringify(artifacts))
})

When("我读取最新 artifact 的文本内容", async function (this: JingleWorld) {
  const artifactId = this.getScenarioValue("artifacts.latestArtifactId")
  const result = await readArtifactText(this, artifactId)

  this.setScenarioValue("artifacts.latestTextReadResult", JSON.stringify(result))
})

When("我读取最新 artifact 的二进制内容", async function (this: JingleWorld) {
  const artifactId = this.getScenarioValue("artifacts.latestArtifactId")
  const result = await readArtifactBinary(this, artifactId)

  this.setScenarioValue("artifacts.latestBinaryReadResult", JSON.stringify(result))
})

When(
  "我以 {string} action 打开最新 artifact",
  async function (this: JingleWorld, action: ArtifactActionId) {
    const artifactId = this.getScenarioValue("artifacts.latestArtifactId")
    const result = await openArtifact(this, artifactId, action)

    this.setScenarioValue("artifacts.latestOpenResult", JSON.stringify(result))
  }
)

Then(
  "artifacts 列表包含标题为 {string} 类型为 {string} 的 artifact",
  function (this: JingleWorld, title: string, kind: ArtifactRecord["kind"]) {
    const artifacts = JSON.parse(this.getScenarioValue("artifacts.latestList")) as ArtifactRecord[]

    expect(
      artifacts.some((artifact) => artifact.title === title && artifact.kind === kind)
    ).toBe(true)
  }
)

Then("最新 artifact 文本读取结果应成功", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("artifacts.latestTextReadResult")
  ) as ArtifactFileReadResult

  expect(result.success).toBe(true)
})

Then(
  "最新 artifact 文本读取内容应为 {string}",
  function (this: JingleWorld, content: string) {
    const result = JSON.parse(
      this.getScenarioValue("artifacts.latestTextReadResult")
    ) as ArtifactFileReadResult

    expect(result.content).toBe(content)
  }
)

Then("最新 artifact 二进制读取结果应成功", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("artifacts.latestBinaryReadResult")
  ) as ArtifactFileReadResult

  expect(result.success).toBe(true)
})

Then(
  "最新 artifact 二进制读取内容应为 {string}",
  function (this: JingleWorld, content: string) {
    const result = JSON.parse(
      this.getScenarioValue("artifacts.latestBinaryReadResult")
    ) as ArtifactFileReadResult

    expect(result.content).toBe(content)
  }
)

Then(
  "最新 artifact open 结果类型应为 {string}",
  function (this: JingleWorld, type: ArtifactActionResolution["type"]) {
    const result = JSON.parse(
      this.getScenarioValue("artifacts.latestOpenResult")
    ) as ArtifactActionResolution

    expect(result.type).toBe(type)
  }
)

Then("最新 artifact open 结果 uri 应为托管 artifact 路径", function (this: JingleWorld) {
  const result = JSON.parse(
    this.getScenarioValue("artifacts.latestOpenResult")
  ) as ArtifactActionResolution
  const managedPath = this.getScenarioValue("artifacts.latestManagedPath")

  expect(result).toEqual({
    type: "download",
    uri: managedPath
  })
})

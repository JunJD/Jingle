import { Given, Then, When, type DataTable } from "@cucumber/cucumber"
import assert from "node:assert/strict"
import { Bash, InMemoryFs, type BashExecResult, type InitialFiles } from "just-bash"
import type { MutationPredictionChange } from "../../../src/shared/mutation-prediction"
import { RecordingFs } from "../../../src/main/agent/recording-fs"
import { OpenworkWorld } from "../support/world"

const WORKSPACE_ROOT = "/workspace"

interface RecordingFsWorld extends OpenworkWorld {
  recordingFsState?: RecordingFsScenarioState
}

interface RecordingFsScenarioState {
  changes: MutationPredictionChange[]
  ignoreGitMetadata: boolean
  result: BashExecResult | null
}

function getState(world: RecordingFsWorld): RecordingFsScenarioState {
  if (!world.recordingFsState) {
    world.recordingFsState = {
      changes: [],
      ignoreGitMetadata: false,
      result: null
    }
  }

  return world.recordingFsState
}

function toWorkspacePath(filePath: string): string {
  return filePath.startsWith("/") ? filePath : `${WORKSPACE_ROOT}/${filePath}`
}

function createShouldTrackPath(ignoreGitMetadata: boolean): (path: string) => boolean {
  if (!ignoreGitMetadata) {
    return () => true
  }

  return (path) => !path.split("/").includes(".git")
}

async function runScenarioCommand(
  world: RecordingFsWorld,
  initialFiles: InitialFiles,
  command: string
): Promise<void> {
  const state = getState(world)
  const recordingFs = new RecordingFs(new InMemoryFs(initialFiles), {
    shouldTrackPath: createShouldTrackPath(state.ignoreGitMetadata)
  })
  const bash = new Bash({ fs: recordingFs, cwd: WORKSPACE_ROOT })

  state.result = await bash.exec(command)
  state.changes = await recordingFs.collectChanges()
}

function tableToInitialFiles(table: DataTable): InitialFiles {
  const rows = table.hashes() as Array<{ 内容: string; 路径: string }>
  const files: InitialFiles = {}

  for (const row of rows) {
    files[toWorkspacePath(row["路径"])] = row["内容"]
  }

  return files
}

function tableToExpectedChanges(table: DataTable): MutationPredictionChange[] {
  return (table.hashes() as Array<{ 变更类型: string; 路径: string }>).map((row) => ({
    changeType: row["变更类型"] as MutationPredictionChange["changeType"],
    path: toWorkspacePath(row["路径"])
  }))
}

Given("一个 RecordingFs 工作目录是空的", function (this: RecordingFsWorld) {
  const state = getState(this)
  state.result = null
  state.changes = []
  state.ignoreGitMetadata = false
  this.setScenarioValue("recordingFs.initialFiles", JSON.stringify({}))
})

Given(
  "一个 RecordingFs 工作目录包含这些文件:",
  function (this: RecordingFsWorld, table: DataTable) {
    const state = getState(this)
    state.result = null
    state.changes = []
    state.ignoreGitMetadata = false
    this.setScenarioValue("recordingFs.initialFiles", JSON.stringify(tableToInitialFiles(table)))
  }
)

Given("RecordingFs 会忽略 Git 元数据目录", function (this: RecordingFsWorld) {
  const state = getState(this)
  state.ignoreGitMetadata = true
})

When("我在该工作目录执行 Bash 命令:", async function (this: RecordingFsWorld, command: string) {
  const state = getState(this)
  try {
    const storedInitialFiles = this.getScenarioValue("recordingFs.initialFiles")
    const initialFiles = storedInitialFiles ? (JSON.parse(storedInitialFiles) as InitialFiles) : {}

    await runScenarioCommand(this, initialFiles, command)
  } finally {
    state.ignoreGitMetadata = false
  }
})

Then("Bash 退出码应为 {int}", function (this: RecordingFsWorld, exitCode: number) {
  const state = getState(this)
  assert.ok(state.result, "Expected a Bash execution result, but no command has run.")
  assert.equal(state.result.exitCode, exitCode)
})

Then("最终变更文件应为空", function (this: RecordingFsWorld) {
  const state = getState(this)
  assert.deepEqual(state.changes, [])
})

Then("最终变更文件应为:", function (this: RecordingFsWorld, table: DataTable) {
  const state = getState(this)
  assert.deepEqual(state.changes, tableToExpectedChanges(table))
})

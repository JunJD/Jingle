import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildSync } from "esbuild"
import {
  JustBashMutationPredictor,
  resolveMutationPredictorWorkerPath
} from "../../src/main/agent/mutation-predictor"
import type { MutationPrediction } from "../../src/shared/mutation-prediction"

function buildWorkerForTests(): void {
  const workerSource = path.resolve("src/main/agent/mutation-predictor-worker.ts")
  const workerOutDir = path.resolve("out/main")
  mkdirSync(workerOutDir, { recursive: true })
  buildSync({
    bundle: true,
    entryPoints: [workerSource],
    external: ["just-bash"],
    format: "esm",
    outfile: path.join(workerOutDir, "mutation-predictor-worker.mjs"),
    platform: "node",
    target: "node18"
  })
}

buildWorkerForTests()

async function withWorkspace(
  run: (workspacePath: string) => Promise<void>,
  prefix = "openwork-mutation-predictor-"
): Promise<void> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    await run(workspacePath)
  } finally {
    await rm(workspacePath, { force: true, recursive: true })
  }
}

function hasChange(
  prediction: MutationPrediction,
  fileName: string,
  changeType: "create" | "modify" | "delete"
): boolean {
  return prediction.changes.some(
    (change) => change.changeType === changeType && change.path.endsWith(`/${fileName}`)
  )
}

test("predicts python3 version through the ESM just-bash worker", async () => {
  await withWorkspace(async (workspacePath) => {
    const predictor = new JustBashMutationPredictor({ workspacePath, timeoutMs: 10_000 })

    const prediction = await predictor.predictExecute("python3 --version")

    assert.equal(prediction.status, "predicted")
    assert.equal(prediction.exitCode, 0)
    assert.deepEqual(prediction.changes, [])
  })
})

test("predicts python3 file writes through the ESM just-bash worker", async () => {
  await withWorkspace(async (workspacePath) => {
    const predictor = new JustBashMutationPredictor({ workspacePath, timeoutMs: 10_000 })

    const prediction = await predictor.predictExecute(
      `python3 -c "open('python-output.txt', 'w').write('hello')"`
    )

    assert.equal(prediction.status, "predicted")
    assert.equal(prediction.exitCode, 0)
    assert.equal(hasChange(prediction, "python-output.txt", "create"), true)
  })
})

test("predicts js-exec file writes through the ESM just-bash worker", async () => {
  await withWorkspace(async (workspacePath) => {
    const predictor = new JustBashMutationPredictor({ workspacePath, timeoutMs: 10_000 })

    const prediction = await predictor.predictExecute(
      `js-exec -c "require('fs').writeFileSync('js-output.txt', 'hello')"`
    )

    assert.equal(prediction.status, "predicted")
    assert.equal(prediction.exitCode, 0)
    assert.equal(hasChange(prediction, "js-output.txt", "create"), true)
  })
})

test("downgrades to unknown targets when the worker is unavailable", async () => {
  await withWorkspace(async (workspacePath) => {
    const predictor = new JustBashMutationPredictor({
      workspacePath,
      workerPath: path.join(workspacePath, "missing-worker.mjs")
    })

    const prediction = await predictor.predictExecute("touch fallback.txt")

    assert.equal(prediction.status, "simulation_error")
    assert.equal(prediction.confidence, "none")
    assert.deepEqual(prediction.changes, [])
    assert.match(prediction.summary, /target files are unknown/i)
  })
})

test("resolves the source worker path for node tests", () => {
  assert.equal(path.basename(resolveMutationPredictorWorkerPath()), "mutation-predictor-worker.mjs")
})

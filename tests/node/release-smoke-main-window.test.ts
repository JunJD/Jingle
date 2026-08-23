import assert from "node:assert/strict"
import test from "node:test"
import { selectReleaseSmokeMainWebContents } from "../../src/main/release-smoke-main-window"
import { PRIMARY_MAIN_WINDOW_ID } from "../../src/shared/durable-window"

interface CandidateOptions {
  destroyed?: boolean
  identity?: { kind: string; windowId?: string } | null
  loading?: boolean
  type?: string
  url?: string
}

function createCandidate(options: CandidateOptions = {}) {
  return {
    getType: () => options.type ?? "window",
    getURL: () => options.url ?? "file:///app/out/renderer/index.html?window=main",
    identity:
      "identity" in options
        ? (options.identity ?? null)
        : { kind: "main", windowId: PRIMARY_MAIN_WINDOW_ID },
    isDestroyed: () => options.destroyed ?? false,
    isLoading: () => options.loading ?? false
  }
}

const getIdentity = (candidate: ReturnType<typeof createCandidate>) => candidate.identity

test("selects the canonical primary Main renderer without depending on its file path", () => {
  const main = createCandidate({
    url: "file:///C:/Users/RUNNER~1/AppData/Local/Temp/resources/app.asar/out/renderer/index.html?window=main"
  })
  assert.equal(selectReleaseSmokeMainWebContents([main], getIdentity), main)
})

test("waits through splash, loading, destroyed, and non-window contents", () => {
  for (const candidate of [
    createCandidate({ url: "file:///app/resources/splash.html" }),
    createCandidate({ loading: true }),
    createCandidate({ destroyed: true }),
    createCandidate({ type: "backgroundPage" })
  ]) {
    assert.equal(selectReleaseSmokeMainWebContents([candidate], getIdentity), null)
  }
})

test("rejects a forged query when the canonical window identity differs", () => {
  for (const identity of [
    { kind: "thread-window", windowId: "thread-1" },
    { kind: "main", windowId: "not-primary" },
    { kind: "settings" },
    null
  ]) {
    const candidate = createCandidate({ identity })
    assert.equal(selectReleaseSmokeMainWebContents([candidate], getIdentity), null)
  }
})

test("requires the packaged file page and a unique primary Main identity", () => {
  assert.equal(
    selectReleaseSmokeMainWebContents(
      [createCandidate({ url: "https://example.com/?window=main" })],
      getIdentity
    ),
    null
  )
  assert.equal(
    selectReleaseSmokeMainWebContents(
      [createCandidate({ url: "file:///app/out/renderer/index.html?window=settings" })],
      getIdentity
    ),
    null
  )
  assert.throws(
    () => selectReleaseSmokeMainWebContents([createCandidate(), createCandidate()], getIdentity),
    /multiple primary main renderer windows/
  )
})

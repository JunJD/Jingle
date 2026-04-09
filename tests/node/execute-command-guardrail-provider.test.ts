import assert from "node:assert/strict"
import test from "node:test"
import type { ExecuteCommandPolicy } from "../../src/shared/execute-command-policy"
import type { MutationPrediction } from "../../src/shared/mutation-prediction"
import { createExecuteCommandGuardrailProvider } from "../../src/main/agent/execute-command-guardrail-provider"

function buildPolicy(overrides: Partial<ExecuteCommandPolicy> = {}): ExecuteCommandPolicy {
  return {
    command: "echo hello",
    profile: "read_only",
    disposition: "allow",
    summary: "Read-only command allowed without approval (echo).",
    reason: "echo is an allowlisted read-only command.",
    commands: ["echo"],
    ...overrides
  }
}

function buildPrediction(overrides: Partial<MutationPrediction> = {}): MutationPrediction {
  return {
    command: "echo hello > file.txt",
    status: "predicted",
    confidence: "medium",
    summary: "Predicted 1 file change: create file.txt.",
    changes: [{ changeType: "create", path: "file.txt" }],
    durationMs: 12,
    exitCode: 0,
    stderr: null,
    ...overrides
  }
}

function buildRequest(command: string) {
  return {
    toolName: "execute",
    toolInput: { command },
    threadId: "thread-1",
    workspacePath: "/workspace",
    timestamp: "2026-04-06T12:00:00.000Z"
  }
}

test("read-only commands bypass prediction and stay allowed", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy()
      }
    },
    predictor: {
      async predictExecute() {
        predictorCalls += 1
        return buildPrediction()
      }
    }
  })

  const decision = await provider.evaluate(buildRequest("pwd"))

  assert.equal(decision.allow, true)
  assert.equal(predictorCalls, 0)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "read_only")
  assert.equal(decision.metadata?.mutationPrediction, undefined)
})

test("predictable mutations require a successful prediction before they are allowed", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: "echo hello > file.txt",
          commands: ["echo"],
          disposition: "require_approval",
          profile: "predictable_mutation",
          reason: "Command writes to local files through shell redirection.",
          summary: "Command may modify workspace files and requires approval (echo)."
        })
      }
    },
    predictor: {
      async predictExecute() {
        predictorCalls += 1
        return buildPrediction()
      }
    }
  })

  const decision = await provider.evaluate(buildRequest("echo hello > file.txt"))

  assert.equal(decision.allow, true)
  assert.equal(predictorCalls, 1)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "predictable_mutation")
  assert.equal(decision.metadata?.mutationPrediction?.status, "predicted")
})

test("predictable mutations are denied when target files cannot be predicted", async () => {
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: "sed -i 's/a/b/' file.txt",
          commands: ["sed"],
          disposition: "require_approval",
          profile: "predictable_mutation",
          reason: "sed command uses in-place editing.",
          summary: "Command may modify workspace files and requires approval (sed)."
        })
      }
    },
    predictor: {
      async predictExecute() {
        return buildPrediction({
          status: "simulation_error",
          confidence: "none",
          summary: "Simulation failed before file targets could be predicted.",
          changes: [],
          exitCode: null
        })
      }
    }
  })

  const decision = await provider.evaluate(buildRequest("sed -i 's/a/b/' file.txt"))

  assert.equal(decision.allow, false)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "predictable_mutation")
  assert.equal(decision.metadata?.mutationPrediction?.status, "simulation_error")
  assert.match(decision.reasons?.[0]?.message ?? "", /target files could not be predicted/i)
})

test("host-unsafe commands are denied before prediction runs", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: "npm run dev",
          commands: ["npm"],
          disposition: "deny",
          profile: "host_unsafe",
          reason: "npm commands are outside the controlled shell profile.",
          summary: "Command blocked by the controlled shell policy (npm)."
        })
      }
    },
    predictor: {
      async predictExecute() {
        predictorCalls += 1
        return buildPrediction()
      }
    }
  })

  const decision = await provider.evaluate(buildRequest("npm run dev"))

  assert.equal(decision.allow, false)
  assert.equal(predictorCalls, 0)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "host_unsafe")
})

test("network read commands are denied when they target localhost", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: "curl http://127.0.0.1:3000",
          commands: ["curl"],
          disposition: "allow",
          profile: "network_read",
          reason: "curl command performs a public HTTP GET/HEAD request without local file writes.",
          summary: "Public network read command allowed without approval (curl).",
          networkTargets: ["http://127.0.0.1:3000/"]
        })
      }
    },
    predictor: {
      async predictExecute() {
        predictorCalls += 1
        return buildPrediction()
      }
    }
  })

  const decision = await provider.evaluate(buildRequest("curl http://127.0.0.1:3000"))

  assert.equal(decision.allow, false)
  assert.equal(predictorCalls, 0)
  assert.match(decision.reasons?.[0]?.message ?? "", /private-network/i)
})

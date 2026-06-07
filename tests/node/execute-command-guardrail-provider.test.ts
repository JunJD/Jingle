import assert from "node:assert/strict"
import test from "node:test"
import type { ExecuteCommandPolicy } from "../../src/shared/execute-command-policy"
import type { MutationPrediction } from "../../src/shared/mutation-prediction"
import { createExecuteCommandGuardrailProvider } from "../../src/main/agent/execute-command-guardrail-provider"
import { JustBashExecuteCommandClassifier } from "../../src/main/agent/execute-command-classifier"

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

test("managed process commands require approval without mutation prediction", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: "python3 -m http.server",
          commands: ["python3"],
          disposition: "require_approval",
          profile: "managed_process",
          reason: "python3 -m http.server starts a managed process and requires approval.",
          summary: "Managed process command requires approval (python3)."
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

  const decision = await provider.evaluate(buildRequest("python3 -m http.server"))

  assert.equal(decision.allow, true)
  assert.equal(predictorCalls, 0)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "managed_process")
  assert.equal(decision.metadata?.executeCommandPolicy?.disposition, "require_approval")
  assert.equal(decision.metadata?.mutationPrediction, undefined)
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

test("predictable mutations become unknown commands when the predictor marks them unsupported", async () => {
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: `python3 -c "open('notes.txt', 'w').write('hello')"`,
          commands: ["python3"],
          disposition: "require_approval",
          profile: "predictable_mutation",
          reason: "python3 inline code execution requires mutation prediction and approval.",
          summary: "Command may modify workspace files and requires approval (python3)."
        })
      }
    },
    predictor: {
      async predictExecute() {
        return buildPrediction({
          command: `python3 -c "open('notes.txt', 'w').write('hello')"`,
          status: "unsupported_command",
          confidence: "none",
          summary:
            "Simulator could not execute this command in just-bash, so target files are unknown.",
          changes: [],
          exitCode: 127
        })
      }
    }
  })

  const decision = await provider.evaluate(
    buildRequest(`python3 -c "open('notes.txt', 'w').write('hello')"`)
  )

  assert.equal(decision.allow, true)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "unknown_command")
  assert.equal(decision.metadata?.executeCommandPolicy?.disposition, "require_approval")
  assert.equal(decision.metadata?.mutationPrediction?.status, "unsupported_command")
  assert.match(decision.metadata?.executeCommandPolicy?.reason ?? "", /requires user approval/i)
})

test("unknown side-effect shell commands require approval without mutation prediction", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: {
      classify() {
        return buildPolicy({
          command: `sh -c "npm run build"`,
          commands: ["sh"],
          disposition: "require_approval",
          profile: "unknown_command",
          reason: "sh 是未知副作用操作，需要用户确认后才能执行。",
          summary: "Unknown command requires approval (sh)."
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

  const decision = await provider.evaluate(buildRequest(`sh -c "npm run build"`))

  assert.equal(decision.allow, true)
  assert.equal(predictorCalls, 0)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "unknown_command")
  assert.equal(decision.metadata?.executeCommandPolicy?.disposition, "require_approval")
  assert.match(decision.metadata?.executeCommandPolicy?.reason ?? "", /未知副作用操作/)
})

test("shell wrapper redirections require approval without mutation prediction", async () => {
  let predictorCalls = 0
  const provider = createExecuteCommandGuardrailProvider({
    classifier: new JustBashExecuteCommandClassifier(),
    predictor: {
      async predictExecute() {
        predictorCalls += 1
        return buildPrediction()
      }
    }
  })

  const decision = await provider.evaluate(buildRequest(`sh -c "echo hello" > out.txt`))

  assert.equal(decision.allow, true)
  assert.equal(predictorCalls, 0)
  assert.equal(decision.metadata?.executeCommandPolicy?.profile, "unknown_command")
  assert.equal(decision.metadata?.executeCommandPolicy?.disposition, "require_approval")
  assert.match(decision.metadata?.executeCommandPolicy?.reason ?? "", /未知副作用操作/)
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

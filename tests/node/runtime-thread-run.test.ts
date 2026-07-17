import assert from "node:assert/strict"
import test from "node:test"
import { createAgentRunHandle } from "../../src/main/agent/runtime"
import { createJingleCheckpointerManager } from "../../packages/langchain-agent-harness/src/checkpointer-manager"
import type { RuntimeRunLifecycleControllerContract } from "../../packages/langchain-agent-harness/src/runtime-contract"
import type { RuntimeExecutionCapabilities } from "../../packages/langchain-agent-harness/src/runtime-capabilities"
import type { RuntimeToolApprovalDecision } from "../../packages/langchain-agent-harness/src/runtime-operation"
import { RuntimeThreadBusyError } from "../../packages/langchain-agent-harness/src/runtime-execution-context"
import { createRuntime } from "../../packages/langchain-agent-harness/src/runtime"
import {
  createRuntimeThreadInvokeRun,
  createRuntimeThreadResumeRun
} from "../../packages/langchain-agent-harness/src/runtime-thread-run"
import { createRuntimeThreadFactory } from "../../packages/langchain-agent-harness/src/runtime-thread-factory"
import { createRuntimeThreadFromControls } from "../../packages/langchain-agent-harness/src/runtime-thread-implementation"
import { createRuntimeThreadContext } from "../../packages/langchain-agent-harness/src/runtime-thread-context"
import { createRuntimeThreadRunLifecycleControlFromController } from "../../packages/langchain-agent-harness/src/runtime-thread-lifecycle"
import { createRuntimeThreadStreamDrainControlFromController } from "../../packages/langchain-agent-harness/src/runtime-thread-stream"
import { createRuntimeThreadTerminalReferee } from "../../packages/langchain-agent-harness/src/runtime-thread-terminal"
import type {
  RuntimeThreadOperationControl,
  RuntimeThreadInvokeRun,
  RuntimeThreadRunLifecycleControl,
  RuntimeThreadStreamControl
} from "../../packages/langchain-agent-harness/src/runtime-thread"

interface Deferred<T> {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test("JingleCheckpointerManager shares one in-flight creation per thread", async () => {
  const creation = createDeferred<{ close(): Promise<void> }>()
  let closeCount = 0
  let creationCount = 0
  const checkpointer = {
    close: async () => {
      closeCount += 1
    }
  }
  const manager = createJingleCheckpointerManager({
    createCheckpointer: async () => {
      creationCount += 1
      return creation.promise
    }
  })

  const first = manager.get("thread-shared-creation")
  const second = manager.get("thread-shared-creation")
  await Promise.resolve()
  assert.equal(creationCount, 1)

  creation.resolve(checkpointer)
  assert.equal(await first, checkpointer)
  assert.equal(await second, checkpointer)

  await Promise.all([
    manager.close("thread-shared-creation"),
    manager.close("thread-shared-creation")
  ])
  assert.equal(closeCount, 1)
})

test("JingleCheckpointerManager takes ownership when close races creation", async () => {
  const firstCreation = createDeferred<{ close(): Promise<void> }>()
  const replacementCreation = createDeferred<{ close(): Promise<void> }>()
  const closeCounts = new Map<string, number>()
  let creationCount = 0
  const createCheckpointer = (id: string) => ({
    close: async () => {
      closeCounts.set(id, (closeCounts.get(id) ?? 0) + 1)
    }
  })
  const manager = createJingleCheckpointerManager({
    createCheckpointer: async () => {
      creationCount += 1
      return creationCount === 1 ? firstCreation.promise : replacementCreation.promise
    }
  })

  const pendingGet = manager.get("thread-close-during-creation")
  await Promise.resolve()
  const closing = manager.close("thread-close-during-creation")
  const rejectedGet = assert.rejects(pendingGet, /closed during creation/)
  let closeSettled = false
  void closing.then(() => {
    closeSettled = true
  })
  await Promise.resolve()
  assert.equal(closeSettled, false)

  firstCreation.resolve(createCheckpointer("first"))
  await closing
  await rejectedGet
  assert.equal(closeCounts.get("first"), 1)

  const replacementGet = manager.get("thread-close-during-creation")
  await Promise.resolve()
  assert.equal(creationCount, 2)
  const replacement = createCheckpointer("replacement")
  replacementCreation.resolve(replacement)
  assert.equal(await replacementGet, replacement)
  await manager.close("thread-close-during-creation")
  assert.equal(closeCounts.get("replacement"), 1)
})

test("JingleCheckpointerManager closeAll owns out-of-order late creations", async () => {
  const firstCreation = createDeferred<{ close(): Promise<void> }>()
  const secondCreation = createDeferred<{ close(): Promise<void> }>()
  const postCloseAllCreation = createDeferred<{ close(): Promise<void> }>()
  const firstClose = createDeferred<void>()
  const events: string[] = []
  let creationCount = 0
  let flushCount = 0
  const manager = createJingleCheckpointerManager({
    createCheckpointer: async () => {
      creationCount += 1
      if (creationCount === 1) return firstCreation.promise
      if (creationCount === 2) return secondCreation.promise
      return postCloseAllCreation.promise
    },
    flushOnCloseAll: [
      async () => {
        flushCount += 1
        events.push("flush")
      }
    ]
  })

  const firstGet = manager.get("thread-close-all-first")
  const secondGet = manager.get("thread-close-all-second")
  await Promise.resolve()
  assert.equal(creationCount, 2)

  const firstCloseAll = manager.closeAll()
  const secondCloseAll = manager.closeAll()
  const postCloseAllGet = manager.get("thread-created-after-close-all")
  const rejectedFirstGet = assert.rejects(firstGet, /closed during creation/)
  const rejectedSecondGet = assert.rejects(secondGet, /closed during creation/)
  let closeAllSettled = false
  void firstCloseAll.then(() => {
    closeAllSettled = true
  })

  secondCreation.resolve({
    close: async () => {
      events.push("close:second")
    }
  })
  await Promise.resolve()
  assert.equal(closeAllSettled, false)
  assert.equal(creationCount, 2)

  firstCreation.resolve({
    close: async () => {
      events.push("close:first")
      await firstClose.promise
    }
  })
  await Promise.resolve()
  assert.equal(closeAllSettled, false)
  assert.equal(flushCount, 0)

  firstClose.resolve()
  await Promise.all([firstCloseAll, secondCloseAll, rejectedFirstGet, rejectedSecondGet])
  assert.deepEqual(events, ["close:second", "close:first", "flush"])
  assert.equal(flushCount, 1)

  await Promise.resolve()
  assert.equal(creationCount, 3)
  const postCloseAll = {
    close: async () => {
      events.push("close:post-close-all")
    }
  }
  postCloseAllCreation.resolve(postCloseAll)
  assert.equal(await postCloseAllGet, postCloseAll)
  await manager.close("thread-created-after-close-all")
  assert.equal(events.at(-1), "close:post-close-all")
})

function createEmptyStream(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true, value: undefined })
      }
    }
  }
}

function createChunkStream(): AsyncIterable<[string, unknown]> {
  return {
    async *[Symbol.asyncIterator]() {
      yield ["values", {}]
    }
  }
}

function createLifecycleControl(
  input: {
    abortRun?: RuntimeThreadRunLifecycleControl<never>["abortRun"]
    cancelRun?: RuntimeThreadRunLifecycleControl<never>["cancelRun"]
    completeRun?: RuntimeThreadRunLifecycleControl<never>["completeRun"]
    failRun?: RuntimeThreadRunLifecycleControl<never>["failRun"]
    settleRun?: RuntimeThreadRunLifecycleControl<never>["settleRun"]
  } = {}
): RuntimeThreadRunLifecycleControl<never> {
  return {
    abortRun: input.abortRun ?? (async () => undefined),
    cancelRun: input.cancelRun ?? (async () => undefined),
    beginInvokeRun: async () => ({
      modelId: "model-unused",
      recordingRefs: [],
      runId: "run-unused"
    }),
    beginResumeRun: async () => ({
      executionDisposition: "resume",
      modelId: "model-unused",
      recordingRefs: [],
      runId: "run-unused"
    }),
    completeRun:
      input.completeRun ??
      (async () => ({
        facts: { contextInclusions: [], recordingRefs: [] },
        status: "success"
      })),
    failRun: input.failRun ?? (async () => undefined),
    settleRun: input.settleRun ?? (async () => undefined)
  }
}

function createOperationControl(
  input: {
    onResume?: (decision: RuntimeToolApprovalDecision) => void
    stream?: AsyncIterable<[string, unknown]>
  } = {}
): RuntimeThreadOperationControl<never> {
  return {
    compact: async () => {
      throw new Error("Compact was not expected.")
    },
    invoke: async () => input.stream ?? createEmptyStream(),
    resume: async (resumeInput) => {
      input.onResume?.(resumeInput.decision)
      return input.stream ?? createEmptyStream()
    }
  }
}

function createInvokeExecutionInput(
  input: {
    onChunk?: () => Promise<void> | void
    signal?: AbortSignal
  } = {}
) {
  return {
    contextInclusions: [],
    message: { content: "hello", id: "message-1" },
    onChunk: input.onChunk ?? (() => undefined),
    removeMessageIds: [],
    signal: input.signal ?? new AbortController().signal
  }
}

test("RuntimeThreadRun abort waits for stream work before persisting the terminal state", async () => {
  const chunkStarted = createDeferred<void>()
  const releaseChunk = createDeferred<void>()
  const events: string[] = []
  const lifecycle = createLifecycleControl({
    abortRun: async () => {
      events.push("abort")
    },
    settleRun: async () => {
      events.push("settle")
    }
  })
  const stream: RuntimeThreadStreamControl = {
    drainRunStream: async (input) => {
      for await (const chunk of input.stream) {
        await input.onChunk(chunk)
      }
      return { interrupted: false }
    }
  }
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle,
      operations: createOperationControl({ stream: createChunkStream() }),
      stream
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-abort" }
  })
  const execution = run.execute(
    createInvokeExecutionInput({
      onChunk: async () => {
        chunkStarted.resolve()
        await releaseChunk.promise
        events.push("chunk-finished")
      }
    })
  )

  await chunkStarted.promise
  const abort = run.abort()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, [])

  releaseChunk.resolve()
  assert.equal(await abort, true)
  assert.deepEqual(await execution, { status: "aborted" })
  assert.deepEqual(events, ["chunk-finished", "abort", "settle"])
})

test("RuntimeThread stream does not call the host after cancellation during pending HITL persistence", async () => {
  const persistenceStarted = createDeferred<void>()
  const releasePersistence = createDeferred<void>()
  const controller = new AbortController()
  let hostChunkCount = 0
  const stream = createRuntimeThreadStreamDrainControlFromController({
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => {
        persistenceStarted.resolve()
        await releasePersistence.promise
      }
    },
    thread: { threadId: "thread-cancelled-hitl", workspacePath: "/workspace" }
  })
  const drain = stream.drainRunStream({
    onChunk: () => {
      hostChunkCount += 1
    },
    runId: "run-cancelled-hitl",
    signal: controller.signal,
    stream: {
      async *[Symbol.asyncIterator]() {
        yield [
          "values",
          {
            __interrupt__: [
              {
                value: {
                  actionRequests: [
                    {
                      args: {},
                      name: "write_file",
                      toolCallId: "tool-call-cancelled-hitl"
                    }
                  ],
                  reviewConfigs: []
                }
              }
            ]
          }
        ] as [string, unknown]
      }
    }
  })

  await persistenceStarted.promise
  controller.abort()
  releasePersistence.resolve()

  await assert.rejects(drain, { name: "AbortError" })
  assert.equal(hostChunkCount, 0)
})

test("RuntimeThreadRun keeps completion when completion claims the terminal state first", async () => {
  const completionStarted = createDeferred<void>()
  const releaseCompletion = createDeferred<void>()
  let abortCount = 0
  let settleCount = 0
  const lifecycle = createLifecycleControl({
    abortRun: async () => {
      abortCount += 1
    },
    completeRun: async () => {
      completionStarted.resolve()
      await releaseCompletion.promise
      return {
        facts: { contextInclusions: [], recordingRefs: [] },
        status: "success"
      }
    },
    settleRun: async () => {
      settleCount += 1
    }
  })
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle,
      operations: createOperationControl(),
      stream: {
        drainRunStream: async () => ({ interrupted: false })
      }
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-complete" }
  })
  const execution = run.execute(createInvokeExecutionInput())

  await completionStarted.promise
  const abort = run.abort()
  releaseCompletion.resolve()

  assert.equal((await execution).status, "completed")
  assert.equal(await abort, false)
  assert.equal(abortCount, 0)
  assert.equal(settleCount, 1)
})

test("RuntimeThreadRun keeps an explicit failure when abort follows during stream work", async () => {
  const chunkStarted = createDeferred<void>()
  const releaseChunk = createDeferred<void>()
  const failure = new Error("stream owner failed")
  const failedErrors: unknown[] = []
  let abortCount = 0
  let settleCount = 0
  const lifecycle = createLifecycleControl({
    abortRun: async () => {
      abortCount += 1
    },
    failRun: async ({ error }) => {
      failedErrors.push(error)
    },
    settleRun: async () => {
      settleCount += 1
    }
  })
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle,
      operations: createOperationControl({ stream: createChunkStream() }),
      stream: {
        drainRunStream: async (input) => {
          chunkStarted.resolve()
          await releaseChunk.promise
          for await (const chunk of input.stream) {
            await input.onChunk(chunk)
          }
          return { interrupted: false }
        }
      }
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-fail" }
  })
  const execution = run.execute(createInvokeExecutionInput())

  await chunkStarted.promise
  const fail = run.fail(failure)
  const abort = run.abort()
  releaseChunk.resolve()

  await assert.rejects(execution, failure)
  assert.equal(await fail, true)
  assert.equal(await abort, false)
  assert.deepEqual(failedErrors, [failure])
  assert.equal(abortCount, 0)
  assert.equal(settleCount, 1)
})

test("RuntimeThreadRun keeps abort when it reaches the referee before a rejected Promise continuation", async () => {
  const drainStarted = createDeferred<void>()
  const drain = createDeferred<never>()
  const failure = new Error("stream rejected")
  const failedErrors: unknown[] = []
  let abortCount = 0
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle: createLifecycleControl({
        abortRun: async () => {
          abortCount += 1
        },
        failRun: async ({ error }) => {
          failedErrors.push(error)
        }
      }),
      operations: createOperationControl(),
      stream: {
        drainRunStream: async () => {
          drainStarted.resolve()
          return drain.promise
        }
      }
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-stream-rejection" }
  })
  const execution = run.execute(createInvokeExecutionInput())

  await drainStarted.promise
  drain.reject(failure)
  const abort = run.abort()

  assert.deepEqual(await execution, { status: "aborted" })
  assert.equal(await abort, true)
  assert.deepEqual(failedErrors, [])
  assert.equal(abortCount, 1)
})

test("RuntimeThreadRun settles runtime ownership once when terminal persistence fails", async () => {
  const persistenceError = new Error("abort persistence failed")
  let settleCount = 0
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle: createLifecycleControl({
        abortRun: async () => {
          throw persistenceError
        },
        settleRun: async () => {
          settleCount += 1
        }
      }),
      operations: createOperationControl(),
      stream: {
        drainRunStream: async () => ({ interrupted: false })
      }
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-persistence-failure" }
  })

  await assert.rejects(run.abort(), persistenceError)
  await assert.rejects(run.abort(), persistenceError)
  assert.equal(settleCount, 1)
})

test("RuntimeThreadRun preserves the runtime error when failure persistence also fails", async () => {
  const runtimeError = new Error("runtime failed")
  const persistenceError = new Error("failure persistence failed")
  const run = createRuntimeThreadInvokeRun({
    controls: {
      lifecycle: createLifecycleControl({
        failRun: async () => {
          throw persistenceError
        }
      }),
      operations: createOperationControl(),
      stream: {
        drainRunStream: async () => {
          throw runtimeError
        }
      }
    },
    start: { modelId: "model-1", recordingRefs: [], runId: "run-double-failure" }
  })

  await assert.rejects(run.execute(createInvokeExecutionInput()), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [runtimeError, persistenceError])
    return true
  })
})

test("RuntimeThreadRun observes committed admission before creating the resume stream", async () => {
  const decision: RuntimeToolApprovalDecision = {
    request_id: "request-1",
    tool_call_id: "tool-call-1",
    type: "approve"
  }
  let observedDecision: RuntimeToolApprovalDecision | null = null
  const events: string[] = []
  const run = createRuntimeThreadResumeRun({
    controls: {
      lifecycle: createLifecycleControl(),
      operations: createOperationControl({
        onResume: (value) => {
          events.push("operations-resume")
          observedDecision = value
        },
        stream: createChunkStream()
      }),
      stream: {
        drainRunStream: async (input) => {
          for await (const chunk of input.stream) {
            await input.onChunk(chunk)
          }
          return { interrupted: false }
        }
      }
    },
    decision,
    start: {
      executionDisposition: "resume",
      modelId: "model-1",
      recordingRefs: [],
      runId: "run-resume"
    }
  })

  await run.execute({
    onChunk: () => {
      events.push("chunk")
    },
    onDecisionCommitted: () => {
      events.push("decision-observed")
    },
    signal: new AbortController().signal
  })
  assert.equal(observedDecision, decision)
  assert.deepEqual(events, ["decision-observed", "operations-resume", "chunk"])
})

test("RuntimeThreadRun commits user_declined without creating a resume stream", async () => {
  const events: string[] = []
  const run = createRuntimeThreadResumeRun({
    controls: {
      lifecycle: createLifecycleControl({
        cancelRun: async () => {
          events.push("fallback-cancel")
        },
        settleRun: async () => {
          events.push("settle")
        }
      }),
      operations: createOperationControl({
        onResume: () => {
          events.push("operations-resume")
        },
        stream: createChunkStream()
      }),
      stream: {
        drainRunStream: async (input) => {
          for await (const chunk of input.stream) await input.onChunk(chunk)
          return { interrupted: false }
        }
      }
    },
    decision: {
      request_id: "request-declined",
      tool_call_id: "tool-declined",
      type: "user_declined"
    },
    start: {
      cancelAfterDecision: () => {
        events.push("cancelled")
      },
      executionDisposition: "terminal",
      modelId: "model-1",
      recordingRefs: [],
      runId: "run-declined"
    }
  })

  const result = await run.execute({
    onChunk: () => {
      events.push("checkpoint-streamed")
    },
    onDecisionCommitted: () => {
      events.push("decision-observed")
    },
    signal: new AbortController().signal
  })
  assert.deepEqual(result, { status: "cancelled" })
  assert.deepEqual(events, ["decision-observed", "cancelled", "settle"])
})

test("RuntimeThreadRun observes a committed resume decision before cancellation skips the chunk", async () => {
  const controller = new AbortController()
  const events: string[] = []
  const lifecycleEvents: string[] = []
  const run = createRuntimeThreadResumeRun({
    controls: {
      lifecycle: createLifecycleControl({
        abortRun: async () => {
          lifecycleEvents.push("abort")
        },
        settleRun: async () => {
          lifecycleEvents.push("settle")
        }
      }),
      operations: createOperationControl({ stream: createChunkStream() }),
      stream: createRuntimeThreadStreamDrainControlFromController({
        pauseController: {
          parseReview: () => null,
          upsertPendingHitlRequest: async () => undefined
        },
        thread: { threadId: "thread-resume-observation", workspacePath: "/workspace" }
      })
    },
    decision: { request_id: "request-1", tool_call_id: "tool-1", type: "approve" },
    start: {
      executionDisposition: "resume",
      modelId: "model-1",
      recordingRefs: [],
      runId: "run-resume-observation"
    }
  })

  const result = await run.execute({
    onChunk: () => {
      events.push("chunk")
    },
    onDecisionCommitted: () => {
      events.push("decision-observed")
      controller.abort()
    },
    signal: controller.signal
  })

  assert.deepEqual(result, { status: "aborted" })
  assert.deepEqual(events, ["decision-observed"])
  assert.deepEqual(lifecycleEvents, ["abort", "settle"])
})

test("RuntimeThread compact rejects while a run owns the thread", async () => {
  const executionInputs: Array<{ modelId?: string; runId: string }> = []
  const thread = createRuntimeThreadFromControls({
    createRunExecution: async (executionInput) => {
      executionInputs.push(executionInput)
      return {
        streamInvoke: async () => createEmptyStream(),
        streamResume: async () => createEmptyStream()
      }
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: {
      beginInvokeRun: async () => ({
        modelId: "model-selected",
        recordingRefs: [],
        runId: "run-compact"
      }),
      beginResumeRun: async () => ({
        executionDisposition: "resume",
        modelId: "model-unused",
        recordingRefs: [],
        runId: "run-unused"
      }),
      finalizeRunWithoutCheckpoint: async () => ({
        contextInclusions: [],
        recordingRefs: []
      }),
      markRunAborted: async () => undefined,
      markRunCancelled: async () => undefined,
      markRunFailed: async () => undefined,
      recordMemoryRecordingRefs: async () => undefined,
      recordRunFinished: async () => undefined,
      recordRunInterrupted: async () => undefined,
      settleRun: async () => undefined,
      syncRunFromLatestCheckpoint: async () => ({
        contextInclusions: [],
        recordingRefs: []
      }),
      useCheckpointPersistence: () => false
    },
    thread: { threadId: "thread-1", workspacePath: "/workspace" }
  })

  await thread.startInvoke({})
  await assert.rejects(
    thread.compact({
      modelId: "model-selected",
      operationId: "compact-while-run-active",
      trigger: "manual"
    }),
    RuntimeThreadBusyError
  )

  assert.deepEqual(executionInputs, [])
})

test("RuntimeThread compact owns run admission until the compact operation settles", async () => {
  const compactStarted = createDeferred<void>()
  const releaseCompact = createDeferred<void>()
  const now = new Date().toISOString()
  const thread = createRuntimeThreadFactory({
    bindExecution: {
      invoke: () => async () => {
        throw new Error("Invoke execution was not expected.")
      },
      resume: () => async () => {
        throw new Error("Resume execution was not expected.")
      }
    },
    compaction: {
      compact: async (input) => {
        compactStarted.resolve()
        await releaseCompact.promise
        return {
          checkpointConfig: {
            configurable: {
              checkpoint_id: "checkpoint-after-compact",
              thread_id: input.threadId
            }
          },
          compaction: {
            compactionCount: 1,
            compactionId: input.operationId,
            createdAt: now,
            cutoffIndex: 0,
            historyRef: null,
            preservedUserMessageCount: 0,
            reason: null,
            status: "completed",
            summaryPreview: null,
            trigger: input.trigger,
            updatedAt: now,
            warning: null
          },
          messageCountAfterCompaction: 1,
          messageCountBeforeCompaction: 2
        }
      }
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: createLifecycleController()
  }).thread({ threadId: "thread-compact-admission", workspacePath: "/workspace" })

  const compact = thread.compact({
    modelId: "model-compact",
    operationId: "compact-admission",
    trigger: "manual"
  })
  await compactStarted.promise
  await assert.rejects(thread.startInvoke({}), RuntimeThreadBusyError)

  releaseCompact.resolve()
  assert.equal((await compact).compaction.compactionId, "compact-admission")
  const run = await thread.startInvoke({})
  assert.equal(await run.abort(), true)
})

test("BDD RuntimeThread supports idle compact with the caller operation identity", async () => {
  const previousBddRuntime = process.env.JINGLE_BDD_AGENT_RUNTIME
  process.env.JINGLE_BDD_AGENT_RUNTIME = "scripted"
  try {
    const handle = createAgentRunHandle({
      runtime: {
        thread() {
          throw new Error("Checkpoint runtime must not open in scripted BDD mode.")
        }
      },
      threadId: "thread-bdd-idle-compact",
      workspacePath: "/workspace"
    })

    const result = await handle.thread.compact({
      modelId: "provider/bdd-model",
      operationId: "bdd-compact-stable-operation",
      trigger: "manual"
    })

    assert.equal(result.compaction.compactionId, "bdd-compact-stable-operation")
    assert.equal(result.compaction.status, "failed")
    assert.equal(result.checkpointConfig.configurable?.operation_id, "bdd-compact-stable-operation")
    assert.equal(result.checkpointConfig.configurable?.model_id, "provider/bdd-model")
  } finally {
    if (previousBddRuntime === undefined) {
      delete process.env.JINGLE_BDD_AGENT_RUNTIME
    } else {
      process.env.JINGLE_BDD_AGENT_RUNTIME = previousBddRuntime
    }
  }
})

test("RuntimeThreadRun registers its settle barrier before a factory can re-enter abort", async () => {
  const events: string[] = []
  const runRef: { value: RuntimeThreadInvokeRun<never> | null } = { value: null }
  let reentrantAbort: Promise<boolean> | null = null
  let streamStarted = false
  const emptyStream = createEmptyStream()
  const thread = createRuntimeThreadFromControls({
    createRunExecution: async ({ signal }) => {
      assert.ok(runRef.value)
      reentrantAbort = runRef.value.abort()
      signal.throwIfAborted()
      return {
        streamInvoke: async () => {
          streamStarted = true
          return emptyStream
        },
        streamResume: async () => emptyStream
      }
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: createLifecycleController({ events }),
    thread: { threadId: "thread-reentrant-abort", workspacePath: "/workspace" }
  })

  const run = await thread.startInvoke({})
  runRef.value = run
  const execution = run.execute(createInvokeExecutionInput())

  assert.deepEqual(await execution, { status: "aborted" })
  assert.equal(await reentrantAbort, true)
  assert.equal(streamStarted, false)
  assert.deepEqual(events, ["abort", "settle"])

  const nextRun = await thread.startInvoke({})
  assert.equal(await nextRun.abort(), true)
})

test("RuntimeThreadRun abort waits for its signal-aware execution factory", async () => {
  const factoryStarted = createDeferred<void>()
  const events: string[] = []
  const thread = createRuntimeThreadFromControls({
    createRunExecution: async ({ signal }) => {
      factoryStarted.resolve()
      return new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: createLifecycleController({ events }),
    thread: { threadId: "thread-pending-resolution", workspacePath: "/workspace" }
  })
  const run = await thread.startInvoke({})
  const execution = run.execute(createInvokeExecutionInput())

  await factoryStarted.promise
  assert.equal(await run.abort(), true)
  assert.deepEqual(await execution, { status: "aborted" })
  assert.deepEqual(events, ["abort", "settle"])

  const nextRun = await thread.startInvoke({})
  assert.equal(await nextRun.abort(), true)
})

test("RuntimeThreadRun fail waits for its signal-aware execution factory", async () => {
  const factoryStarted = createDeferred<void>()
  const failure = new Error("explicit failure during resolution")
  const failedErrors: unknown[] = []
  let settleCount = 0
  const thread = createRuntimeThreadFromControls({
    createRunExecution: async ({ signal }) => {
      factoryStarted.resolve()
      return new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: createLifecycleController({
      onFailure: (error) => failedErrors.push(error),
      onSettle: () => {
        settleCount += 1
      }
    }),
    thread: { threadId: "thread-pending-failure", workspacePath: "/workspace" }
  })
  const run = await thread.startInvoke({})
  const execution = run.execute(createInvokeExecutionInput())

  await factoryStarted.promise
  assert.equal(await run.fail(failure), true)
  await assert.rejects(execution, failure)
  assert.deepEqual(failedErrors, [failure])
  assert.equal(settleCount, 1)

  const nextRun = await thread.startInvoke({})
  assert.equal(await nextRun.abort(), true)
})

test("RuntimeThread lifecycle returns a public start without retaining its private execution factory", async () => {
  const context = createRuntimeThreadContext({
    threadId: "thread-admission-copy",
    workspacePath: "/workspace"
  })
  const control = createRuntimeThreadRunLifecycleControlFromController({
    bindExecution: {
      invoke: () => async () => {
        throw new Error("Execution was not expected.")
      },
      resume: () => async () => {
        throw new Error("Execution was not expected.")
      }
    },
    context,
    runLifecycleController: createLifecycleController()
  })

  const start = await control.beginInvokeRun({ invoke: {} })
  assert.equal(Object.hasOwn(start, "createRunExecution"), false)
  await control.settleRun({ runId: start.runId })
})

test("RuntimeThread lifecycle does not bind execution when durable resume admission rejects", async () => {
  const admissionError = new Error("HITL CAS conflict")
  let resumeBindingCount = 0
  const context = createRuntimeThreadContext({
    threadId: "thread-resume-admission-rejected",
    workspacePath: "/workspace"
  })
  const lifecycle = createLifecycleController()
  lifecycle.beginResumeRun = async () => {
    throw admissionError
  }
  const control = createRuntimeThreadRunLifecycleControlFromController({
    bindExecution: {
      invoke: () => async () => {
        throw new Error("Execution was not expected.")
      },
      resume: () => {
        resumeBindingCount += 1
        return async () => {
          throw new Error("Execution was not expected.")
        }
      }
    },
    context,
    runLifecycleController: lifecycle
  })

  await assert.rejects(
    control.beginResumeRun({
      resume: {
        decision: { request_id: "request-loser", tool_call_id: "tool-loser", type: "approve" }
      }
    }),
    admissionError
  )
  assert.equal(resumeBindingCount, 0)
})

test("RuntimeThread lifecycle does not bind execution for a durable terminal resume", async () => {
  let resumeBindingCount = 0
  const context = createRuntimeThreadContext({
    threadId: "thread-resume-terminal",
    workspacePath: "/workspace"
  })
  const lifecycle = createLifecycleController()
  lifecycle.beginResumeRun = async () => ({
    executionDisposition: "terminal",
    modelId: "model-1",
    recordingRefs: [],
    runId: "run-resume-terminal"
  })
  const control = createRuntimeThreadRunLifecycleControlFromController({
    bindExecution: {
      invoke: () => async () => {
        throw new Error("Execution was not expected.")
      },
      resume: () => {
        resumeBindingCount += 1
        return async () => {
          throw new Error("Execution was not expected.")
        }
      }
    },
    context,
    runLifecycleController: lifecycle
  })

  const start = await control.beginResumeRun({
    resume: {
      decision: {
        request_id: "request-terminal",
        tool_call_id: "tool-terminal",
        type: "user_declined"
      }
    }
  })
  assert.equal(resumeBindingCount, 0)
  await control.settleRun({ runId: start.runId })
})

test("RuntimeThread lifecycle compensates durable starts when execution binding fails", async () => {
  const invokeFailure = new Error("invoke binding failed")
  const resumeFailure = new Error("resume binding failed")
  const failedErrors: unknown[] = []
  const events: string[] = []
  const lifecycle = createLifecycleController({
    events,
    onFailure: (error) => {
      failedErrors.push(error)
      events.push("failed")
    }
  })
  lifecycle.recordRunFinished = async ({ status }) => {
    events.push(`finished:${status}`)
  }
  const runtime = createRuntimeThreadFactory({
    bindExecution: {
      invoke: () => {
        if (failedErrors.length === 0) {
          throw invokeFailure
        }
        return async () => {
          throw new Error("Execution was not expected.")
        }
      },
      resume: () => {
        throw resumeFailure
      }
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: lifecycle
  })
  const thread = runtime.thread({
    threadId: "thread-admission-compensation",
    workspacePath: "/workspace"
  })

  await assert.rejects(thread.startInvoke({}), invokeFailure)
  await assert.rejects(
    thread.startResume({
      decision: { request_id: "request-1", tool_call_id: "tool-1", type: "approve" }
    }),
    resumeFailure
  )

  assert.deepEqual(failedErrors, [invokeFailure, resumeFailure])
  assert.deepEqual(events, [
    "failed",
    "finished:error",
    "settle",
    "failed",
    "finished:error",
    "settle"
  ])

  const nextRun = await thread.startInvoke({})
  assert.equal(await nextRun.abort(), true)
})

test("Runtime thread facades share one active-state referee and release it after settle", async () => {
  const runtime = createRuntimeThreadFactory({
    bindExecution: {
      invoke: () => async () => {
        throw new Error("Execution was not expected.")
      },
      resume: () => async () => {
        throw new Error("Execution was not expected.")
      }
    },
    pauseController: {
      parseReview: () => null,
      upsertPendingHitlRequest: async () => undefined
    },
    runLifecycleController: createLifecycleController()
  })
  const scope = { threadId: "thread-shared-referee", workspacePath: "/workspace" }
  const first = runtime.thread(scope)
  const second = runtime.thread(scope)
  assert.notEqual(first, second)

  const activeRun = await first.startInvoke({})
  await assert.rejects(second.startInvoke({}), { name: "RuntimeThreadBusyError" })
  assert.throws(() => runtime.thread({ ...scope, workspacePath: "/other" }), {
    name: "RuntimeThreadScopeMismatchError"
  })
  assert.equal(await activeRun.abort(), true)

  const nextRun = await second.startInvoke({})
  assert.equal(await nextRun.abort(), true)
})

test("RuntimeThreadTerminalReferee records ignored terminal diagnostics without changing the winner", async () => {
  const diagnostics: unknown[] = []
  const referee = createRuntimeThreadTerminalReferee({
    lifecycle: createLifecycleControl(),
    observeIgnoredTerminal: (diagnostic) => diagnostics.push(diagnostic),
    start: { modelId: "model-1", recordingRefs: [], runId: "run-diagnostic" }
  })

  referee.submit({ status: "aborted" })
  const ignoredError = new Error("ignored")
  referee.submit({ error: ignoredError, status: "failed" })

  assert.deepEqual(await referee.commit(), { status: "aborted" })
  assert.deepEqual(diagnostics, [
    {
      ignoredError,
      ignoredStatus: "failed",
      runId: "run-diagnostic",
      winnerStatus: "aborted"
    }
  ])
})

test("RuntimeThreadTerminalReferee lets a committed decline supersede an uncommitted abort", async () => {
  const events: string[] = []
  const referee = createRuntimeThreadTerminalReferee({
    lifecycle: createLifecycleControl({
      abortRun: async () => {
        events.push("abort")
      },
      cancelRun: async () => {
        events.push("cancelled")
      },
      settleRun: async () => {
        events.push("settle")
      }
    }),
    observeIgnoredTerminal: () => undefined,
    start: { modelId: "model-1", recordingRefs: [], runId: "run-decline-race" }
  })

  const abort = referee.submit({ status: "aborted" })
  const decline = referee.submit({ status: "cancelled" })
  assert.equal(referee.owns(abort), false)
  assert.equal(referee.owns(decline), true)
  assert.deepEqual(await referee.commit(), { status: "cancelled" })
  assert.deepEqual(events, ["cancelled", "settle"])
})

test("RuntimeThreadTerminalReferee isolates an ignored-terminal diagnostic failure", async () => {
  const events: string[] = []
  const diagnosticError = new Error("diagnostic sink failed")
  const originalConsoleError = console.error
  const loggedErrors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args)
  }
  try {
    const referee = createRuntimeThreadTerminalReferee({
      lifecycle: createLifecycleControl({
        abortRun: async () => {
          events.push("abort")
        },
        settleRun: async () => {
          events.push("settle")
        }
      }),
      observeIgnoredTerminal: () => {
        throw diagnosticError
      },
      start: { modelId: "model-1", recordingRefs: [], runId: "run-diagnostic-failure" }
    })

    referee.submit({ status: "aborted" })
    const ignored = referee.submit({ error: new Error("ignored"), status: "failed" })

    assert.deepEqual(ignored, {
      accepted: false,
      status: "failed",
      winnerStatus: "aborted"
    })
    assert.deepEqual(await referee.commit(), { status: "aborted" })
    assert.deepEqual(events, ["abort", "settle"])
    assert.equal(loggedErrors.length, 1)
    assert.equal(loggedErrors[0]?.[1], diagnosticError)
  } finally {
    console.error = originalConsoleError
  }
})

test("createRuntime makes the manager-owned checkpoint wait abortable", async () => {
  const checkpointStarted = createDeferred<void>()
  const bindingSignals: AbortSignal[] = []
  const checkpointSignals: AbortSignal[] = []
  const lifecycleEvents: string[] = []
  const runtime = createRuntime({
    bindExecution: {
      invoke: ({ signal }) => {
        bindingSignals.push(signal)
        return createExecutionCapabilities({
          checkpoint: ({ signal: checkpointSignal }) => {
            checkpointSignals.push(checkpointSignal)
            checkpointStarted.resolve()
            return new Promise<never>((_, reject) => {
              checkpointSignal.addEventListener("abort", () => reject(checkpointSignal.reason), {
                once: true
              })
            })
          }
        })
      },
      resume: () => {
        throw new Error("Resume binding was not expected.")
      }
    },
    control: {
      pauseController: {
        parseReview: () => null,
        upsertPendingHitlRequest: async () => undefined
      },
      runLifecycleController: createLifecycleController({ events: lifecycleEvents })
    }
  })
  const run = await runtime
    .thread({ threadId: "thread-abortable-checkpoint", workspacePath: "/workspace" })
    .startInvoke({})
  const execution = run.execute(createInvokeExecutionInput())

  await checkpointStarted.promise
  assert.equal(await run.abort(), true)
  assert.deepEqual(await execution, { status: "aborted" })
  assert.equal(checkpointSignals[0], bindingSignals[0])
  assert.equal(checkpointSignals[0]?.aborted, true)
  assert.deepEqual(lifecycleEvents, ["abort", "settle"])
})

test("createRuntime gives every synchronous capability the active run signal", async () => {
  const failure = new Error("stop after synchronous capability resolution")
  const bindingSignals: AbortSignal[] = []
  const capabilitySignals: Array<{ name: string; signal: AbortSignal }> = []
  const failedErrors: unknown[] = []
  const runtime = createRuntime({
    bindExecution: {
      invoke: ({ signal }) => {
        bindingSignals.push(signal)
        return createExecutionCapabilities({
          modelError: failure,
          onCapabilitySignal: (name, capabilitySignal) => {
            capabilitySignals.push({ name, signal: capabilitySignal })
          }
        })
      },
      resume: () => {
        throw new Error("Resume binding was not expected.")
      }
    },
    control: {
      pauseController: {
        parseReview: () => null,
        upsertPendingHitlRequest: async () => undefined
      },
      runLifecycleController: createLifecycleController({
        onFailure: (error) => failedErrors.push(error)
      })
    }
  })
  const run = await runtime
    .thread({ threadId: "thread-sync-capabilities", workspacePath: "/workspace" })
    .startInvoke({})

  await assert.rejects(run.execute(createInvokeExecutionInput()), failure)
  assert.deepEqual(
    capabilitySignals.map(({ name }) => name),
    ["approval", "backend", "model"]
  )
  assert.equal(
    capabilitySignals.every(({ signal }) => signal === bindingSignals[0]),
    true
  )
  assert.deepEqual(failedErrors, [failure])
})

type SynchronousCapabilityName = "approval" | "backend" | "model"

function createExecutionCapabilities(input: {
  checkpoint?: (context: { signal: AbortSignal }) => never | Promise<never>
  modelError?: Error
  onCapabilitySignal?: (name: SynchronousCapabilityName, signal: AbortSignal) => void
}): RuntimeExecutionCapabilities<never> {
  const placeholder = {} as never
  const resolveCapability = (name: SynchronousCapabilityName, signal: AbortSignal): never => {
    input.onCapabilitySignal?.(name, signal)
    if (name === "model" && input.modelError) throw input.modelError
    return placeholder
  }

  return {
    checkpoint: {
      checkpointer: (_scope, context) => input.checkpoint?.(context) ?? placeholder
    },
    context: {
      contextRetrieval: () => placeholder,
      guardrail: () => placeholder,
      systemPrompt: () => ""
    },
    control: {
      approvalController: (_scope, { signal }) => resolveCapability("approval", signal)
    },
    model: {
      model: (_scope, { signal }) => resolveCapability("model", signal)
    },
    prompt: {
      executeToolDescription: () => "",
      filesystemSystemPrompt: () => "",
      titleGenerator: placeholder
    },
    tools: {
      artifactPresentation: () => placeholder,
      backend: (_scope, { signal }) => resolveCapability("backend", signal),
      desktopAutomationTools: placeholder,
      extensionAiTools: placeholder,
      skillSources: () => [],
      webTools: placeholder
    }
  }
}

function createLifecycleController(
  input: {
    events?: string[]
    onFailure?: (error: unknown) => void
    onSettle?: () => void
  } = {}
): RuntimeRunLifecycleControllerContract<never> {
  let runSequence = 0
  const events = input.events
  return {
    beginInvokeRun: async () => ({
      modelId: "model-1",
      recordingRefs: [],
      runId: `run-${++runSequence}`
    }),
    beginResumeRun: async () => ({
      executionDisposition: "resume",
      modelId: "model-1",
      recordingRefs: [],
      runId: `run-${++runSequence}`
    }),
    finalizeRunWithoutCheckpoint: async ({
      submittedContextInclusions,
      submittedRecordingRefs
    }) => ({
      contextInclusions: [...submittedContextInclusions],
      recordingRefs: [...submittedRecordingRefs]
    }),
    markRunAborted: async () => {
      events?.push("abort")
    },
    markRunCancelled: async () => {
      events?.push("cancelled")
    },
    markRunFailed: async ({ error }) => {
      input.onFailure?.(error)
    },
    recordMemoryRecordingRefs: async () => undefined,
    recordRunFinished: async () => undefined,
    recordRunInterrupted: async () => undefined,
    settleRun: async () => {
      events?.push("settle")
      input.onSettle?.()
    },
    syncRunFromLatestCheckpoint: async ({
      submittedContextInclusions,
      submittedRecordingRefs
    }) => ({
      contextInclusions: [...submittedContextInclusions],
      recordingRefs: [...submittedRecordingRefs]
    }),
    useCheckpointPersistence: () => false
  }
}

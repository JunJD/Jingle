import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createProjectionQueue } from "../../src/main/projection/projection-queue"

test("projection queue coalesces scheduled jobs by key", async () => {
  const runs: string[] = []
  const queue = createProjectionQueue<{ key: string; value: string }>({
    debounceMs: 1_000,
    getKey: (job) => job.key,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job.value)
    }
  })

  queue.enqueue({ key: "thread-1", value: "first" })
  queue.enqueue({ key: "thread-1", value: "second" })

  await queue.flush()

  assert.deepEqual(runs, ["second"])
})

test("projection queue flushes dirty jobs that were not scheduled", async () => {
  const runs: string[] = []
  const queue = createProjectionQueue<string>({
    debounceMs: 1_000,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job)
    }
  })

  queue.markDirty("run-1")

  await delay(20)
  assert.deepEqual(runs, [])

  await queue.flush()

  assert.deepEqual(runs, ["run-1"])
})

test("projection queue coalesces repeated dirty marks and flushes the latest job", async () => {
  const runs: string[] = []
  const queue = createProjectionQueue<{ key: string; value: string }>({
    debounceMs: 1_000,
    getKey: (job) => job.key,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job.value)
    }
  })

  queue.markDirty({ key: "run-1", value: "first" })
  queue.markDirty({ key: "run-1", value: "second" })

  await queue.flush()

  assert.deepEqual(runs, ["second"])
})

test("projection queue reports job failures and continues draining", async () => {
  const runs: string[] = []
  const errors: string[] = []
  const queue = createProjectionQueue<string>({
    debounceMs: 1_000,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    onError: (job, error) => {
      errors.push(`${job}:${error instanceof Error ? error.message : String(error)}`)
    },
    run: async (job) => {
      runs.push(job)
      if (job === "bad") {
        throw new Error("boom")
      }
    }
  })

  queue.enqueue("bad")
  queue.enqueue("good")

  await queue.flush()

  assert.deepEqual(runs, ["bad", "good"])
  assert.deepEqual(errors, ["bad:boom"])
})

test("projection queue reports error handler failures and keeps draining", async () => {
  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "))
  }
  const queue = createProjectionQueue<string>({
    debounceMs: 1_000,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    onError: () => {
      throw new Error("diagnostic write failed")
    },
    run: async () => {
      throw new Error("boom")
    }
  })

  try {
    queue.enqueue("bad")
    await queue.flush()
  } finally {
    console.warn = originalWarn
  }

  assert.ok(warnings.some((warning) => warning.includes("Projection error handler failed.")))
  assert.ok(warnings.some((warning) => warning.includes("diagnostic write failed")))
})

test("projection queue schedules jobs enqueued while a drain is running", async () => {
  const runs: string[] = []
  const queue = createProjectionQueue<string>({
    debounceMs: 1,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job)
      if (job === "first") {
        queue.enqueue("second")
      }
    }
  })

  queue.enqueue("first")

  await queue.flush()

  assert.deepEqual(runs, ["first", "second"])
})

test("projection queue can share state across queue instances", async () => {
  const runs: string[] = []
  const stateKey = `projection-queue-test-${crypto.randomUUID()}`
  const writer = createProjectionQueue<string>({
    debounceMs: 50,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job)
    },
    stateKey
  })
  const flusher = createProjectionQueue<string>({
    debounceMs: 50,
    getKey: (job) => job,
    name: "ProjectionQueueTest",
    run: async (job) => {
      runs.push(job)
    },
    stateKey
  })

  writer.markDirty("shared")
  await flusher.flush()

  assert.deepEqual(runs, ["shared"])
})

test("projection queue rejects invalid concurrency limits", () => {
  for (const maxConcurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        createProjectionQueue<string>({
          debounceMs: 0,
          getKey: (job) => job,
          maxConcurrency,
          name: "ProjectionQueueConcurrencyValidationTest",
          run: async () => undefined
        }),
      /positive finite integer/
    )
  }
})

test("projection queue bounds max in-flight work above one recovery batch", async () => {
  let inFlight = 0
  let maxInFlight = 0
  let completed = 0
  const queue = createProjectionQueue<number>({
    debounceMs: 1_000,
    getKey: String,
    maxConcurrency: 2,
    name: "ProjectionQueueBoundedConcurrencyTest",
    run: async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(1)
      completed += 1
      inFlight -= 1
    }
  })
  for (let job = 0; job < 101; job += 1) queue.enqueue(job)

  await queue.flush()

  assert.equal(completed, 101)
  assert.equal(maxInFlight, 2)
})

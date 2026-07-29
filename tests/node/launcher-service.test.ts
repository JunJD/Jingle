import assert from "node:assert/strict"
import test from "node:test"
import { LauncherService } from "../../src/main/launcher/service"

test("launcher action success survives a history projection failure", async () => {
  const previousBdd = process.env.JINGLE_BDD
  const historyAttempts: unknown[] = []
  const localStartUsage: string[] = []
  const projectionError = new Error("history unavailable")
  const projectionErrors: Array<{ error: unknown; summary: string }> = []
  process.env.JINGLE_BDD = "1"

  try {
    const service = new LauncherService(
      {
        recordItem: (input: unknown) => {
          historyAttempts.push(input)
          throw projectionError
        }
      } as never,
      {
        getItem: () => ({ kind: "directory", path: "/workspace", title: "Workspace" }),
        recordItemUse: (itemId: string) => localStartUsage.push(itemId)
      } as never,
      {
        openMainWindow: () => {
          throw new Error("Unexpected Main window action.")
        }
      },
      {
        error: (summary, fields) => projectionErrors.push({ error: fields.error, summary })
      }
    )

    await service.executeAction({
      executor: "shell",
      localStartItemId: "workspace-a",
      target: { kind: "directory", path: "/workspace" },
      type: "open-path"
    })

    assert.deepEqual(localStartUsage, ["workspace-a"])
    assert.deepEqual(historyAttempts, [
      {
        action: {
          executor: "shell",
          localStartItemId: "workspace-a",
          target: { kind: "directory", path: "/workspace" },
          type: "open-path"
        },
        historyKey: "local-start:workspace-a",
        iconDataUrl: undefined,
        kind: "directory",
        subtitle: "/workspace",
        title: "Workspace"
      }
    ])
    assert.deepEqual(projectionErrors, [
      { error: projectionError, summary: "Launcher action projection failed" }
    ])
  } finally {
    if (previousBdd === undefined) delete process.env.JINGLE_BDD
    else process.env.JINGLE_BDD = previousBdd
  }
})

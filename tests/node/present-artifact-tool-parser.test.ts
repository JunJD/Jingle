import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ToolSchemaValidationError } from "../../src/main/agent/tool-input-schema"
import { parsePresentArtifactToolInput } from "../../src/main/artifacts/present-artifact-tool-parser"

test("parsePresentArtifactToolInput parses summary artifacts through the shared zod layer", async () => {
  const artifacts = await parsePresentArtifactToolInput(
    {
      artifacts: [
        {
          kind: "summary",
          text: "  hello world  ",
          title: "  Latest summary  "
        }
      ]
    },
    tmpdir()
  )

  assert.deepEqual(artifacts, [
    {
      artifactKey: "",
      dedupeKey: undefined,
      format: undefined,
      kind: "summary",
      subtitle: null,
      text: "hello world",
      title: "Latest summary"
    }
  ])
})

test("parsePresentArtifactToolInput resolves workspace file artifacts", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-artifact-parser-"))
  const filePath = join(workspacePath, "notes.md")
  await writeFile(filePath, "# notes\n")

  const artifacts = await parsePresentArtifactToolInput(
    {
      artifacts: [
        {
          kind: "file",
          path: "notes.md",
          title: "Notes"
        }
      ]
    },
    workspacePath
  )

  assert.equal(artifacts[0]?.kind, "file")
  assert.equal(artifacts[0]?.sourceType, "managed-file-path")
  assert.equal(artifacts[0]?.path, filePath)
  assert.equal(artifacts[0]?.title, "Notes")
})

test("parsePresentArtifactToolInput rejects malformed tool input with tool-scoped errors", async () => {
  await assert.rejects(
    parsePresentArtifactToolInput(
      {
        artifacts: [
          {
            kind: "link",
            title: "Example",
            url: "   "
          }
        ]
      },
      tmpdir()
    ),
    (error: unknown) => {
      assert.ok(error instanceof ToolSchemaValidationError)
      assert.equal(error.toolName, "present_artifacts")
      assert.deepEqual(error.issues, [
        "artifacts.0.url: Too small: expected string to have >=1 characters"
      ])
      return true
    }
  )
})

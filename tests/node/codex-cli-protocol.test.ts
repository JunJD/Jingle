import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { HumanMessage } from "@langchain/core/messages"
import {
  createCodexExecArgs,
  prepareCodexExecInput,
  writeCodexImagesForExec
} from "../../src/main/model-provider/protocols/codex-cli"

test("codex protocol extracts base64 image_url blocks into image attachments", async () => {
  const input = prepareCodexExecInput([
    new HumanMessage({
      content: [
        {
          text: "describe this image",
          type: "text"
        },
        {
          image_url: {
            url: "data:image/png;base64,aW1hZ2U="
          },
          type: "image_url"
        }
      ]
    })
  ])

  assert.equal(input.prompt.includes("describe this image"), true)
  assert.equal(input.prompt.includes("data:image/png"), false)
  assert.deepEqual(input.images, [
    {
      data: "aW1hZ2U=",
      mimeType: "image/png"
    }
  ])

  const tempDir = await mkdtemp(join(tmpdir(), "jingle-codex-protocol-"))
  try {
    const [imagePath] = writeCodexImagesForExec(input.images, tempDir)
    assert.equal(imagePath.endsWith(".png"), true)
    assert.equal(await readFile(imagePath, "utf8"), "image")
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
})

test("codex protocol rejects image MIME types unsupported by the Codex CLI", async () => {
  const input = prepareCodexExecInput([
    new HumanMessage({
      content: [
        {
          image_url: {
            url: "data:image/webp;base64,aW1hZ2U="
          },
          type: "image_url"
        }
      ]
    })
  ])
  const tempDir = await mkdtemp(join(tmpdir(), "jingle-codex-protocol-"))
  try {
    assert.throws(
      () => writeCodexImagesForExec(input.images, tempDir),
      /Unsupported image MIME type for Codex CLI: image\/webp/
    )
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
})

test("codex protocol uses current exec approval configuration flags", () => {
  const args = createCodexExecArgs({
    imagePaths: ["/tmp/image.png"],
    modelName: "gpt-5-codex",
    outputPath: "/tmp/last-message.txt"
  })

  assert.equal(args.includes("--ask-for-approval"), false)
  assert.deepEqual(args.slice(args.indexOf("-c"), args.indexOf("-c") + 2), [
    "-c",
    'approval_policy="never"'
  ])
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), [
    "--sandbox",
    "read-only"
  ])
})

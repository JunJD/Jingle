import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { AIMessage, type BaseMessage } from "@langchain/core/messages"
import type { ChatResult } from "@langchain/core/outputs"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

interface CodexCliChatModelFields {
  modelName: string | null
}

export interface CodexImageAttachment {
  data: string
  mimeType: string
}

interface CodexPreparedInput {
  images: CodexImageAttachment[]
  prompt: string
}

export class CodexCliChatModel extends BaseChatModel {
  private readonly modelName: string | null

  constructor(fields: CodexCliChatModelFields) {
    super({})
    this.modelName = fields.modelName
  }

  _llmType(): string {
    return "codex-cli"
  }

  bindTools(): this {
    return this
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const output = await runCodexExec(this.modelName, prepareCodexExecInput(messages))

    return {
      generations: [
        {
          message: new AIMessage(output),
          text: output
        }
      ],
      llmOutput: {}
    }
  }
}

export function createCodexCliChatModel(modelName: string | null): CodexCliChatModel {
  return new CodexCliChatModel({ modelName: modelName === "current" ? null : modelName })
}

export function prepareCodexExecInput(messages: BaseMessage[]): CodexPreparedInput {
  const images: CodexImageAttachment[] = []
  const renderedMessages = messages.map((message) => {
    return `${formatCodexRole(message.type)}: ${formatMessageContent(message, images)}`
  })

  return {
    images,
    prompt: [
      "You are connected through Jingle. Answer the latest user request using the conversation below.",
      "",
      ...renderedMessages,
      "",
      "Assistant:"
    ].join("\n")
  }
}

export function writeCodexImagesForExec(
  images: readonly CodexImageAttachment[],
  tempDir: string
): string[] {
  return images.map((image, index) => {
    const extension = getCodexImageExtension(image.mimeType)
    const imagePath = join(tempDir, `image-${index + 1}.${extension}`)
    writeFileSync(imagePath, Buffer.from(image.data, "base64"))
    return imagePath
  })
}

export function createCodexExecArgs(input: {
  imagePaths: readonly string[]
  modelName: string | null
  outputPath: string
}): string[] {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "--output-last-message",
    input.outputPath,
    ...(input.modelName ? ["--model", input.modelName] : []),
    ...input.imagePaths.flatMap((path) => ["-i", path]),
    "-"
  ]
}

async function runCodexExec(modelName: string | null, input: CodexPreparedInput): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "jingle-codex-"))
  const outputPath = join(tempDir, "last-message.txt")

  try {
    const imagePaths = writeCodexImagesForExec(input.images, tempDir)
    const args = createCodexExecArgs({ imagePaths, modelName, outputPath })

    await runProcessWithInput("codex", args, input.prompt)
    return readFileSync(outputPath, "utf8").trim()
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
}

function runProcessWithInput(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"]
    })
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`${command} timed out.`))
    }, 180_000)
    let stderr = ""

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeoutId)
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(`${command} exited with code ${code ?? "unknown"}${stderr ? `: ${stderr}` : ""}`)
      )
    })

    child.stdin.end(input)
  })
}

function formatCodexRole(messageType: string): string {
  switch (messageType) {
    case "human":
      return "Human"
    case "ai":
      return "Assistant"
    case "system":
      return "System"
    case "tool":
      return "Tool"
    default:
      return messageType
  }
}

function formatMessageContent(message: BaseMessage, images: CodexImageAttachment[]): string {
  if (typeof message.content === "string") {
    return message.content
  }

  return message.content
    .flatMap((block) => formatMessageBlock(block, images))
    .filter((text) => text.length > 0)
    .join("\n")
}

function formatMessageBlock(block: unknown, images: CodexImageAttachment[]): string[] {
  if (!isRecord(block)) {
    return []
  }

  const image = extractImageAttachment(block)
  if (image) {
    images.push(image)
    return []
  }

  if (block.type === "image" || block.type === "image_url") {
    const imageUrl = getImageBlockUrl(block)
    return imageUrl ? [`[image_url: ${imageUrl}]`] : []
  }

  const text = getTextBlockContent(block)
  return text ? [text] : []
}

function getTextBlockContent(block: Record<string, unknown>): string | null {
  if (block.type === "tool_use") {
    const name = typeof block.name === "string" ? block.name : "tool"
    const id = typeof block.id === "string" ? block.id : "unknown"
    return `[tool_use: ${name} id=${id}]`
  }

  if (block.type === "tool_result") {
    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "unknown"
    const content =
      typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "")
    return `[tool_result id=${toolUseId}] ${content}`
  }

  if (typeof block.text === "string") {
    return block.text
  }

  if (typeof block.content === "string") {
    return block.content
  }

  return null
}

function extractImageAttachment(block: Record<string, unknown>): CodexImageAttachment | null {
  if (block.type === "image_url") {
    const imageUrl = getImageBlockUrl(block)
    return imageUrl ? parseImageDataUrl(imageUrl) : null
  }

  if (block.type !== "image") {
    return null
  }

  const source = block.source
  if (isRecord(source) && source.type === "base64" && typeof source.data === "string") {
    const mimeType =
      getString(source.media_type) ?? getString(source.mime_type) ?? getString(block.mimeType)
    return mimeType ? { data: source.data, mimeType } : null
  }

  const imageUrl = getImageBlockUrl(block)
  return imageUrl ? parseImageDataUrl(imageUrl) : null
}

function parseImageDataUrl(url: string): CodexImageAttachment | null {
  const match = /^data:([^;,]+);base64,(.+)$/is.exec(url.trim())
  if (!match) {
    return null
  }

  return {
    data: match[2].replace(/\s/g, ""),
    mimeType: match[1].toLowerCase()
  }
}

function getImageBlockUrl(block: Record<string, unknown>): string | null {
  const imageUrl = block.image_url
  if (typeof imageUrl === "string" && imageUrl.length > 0) {
    return imageUrl
  }

  if (isRecord(imageUrl) && typeof imageUrl.url === "string" && imageUrl.url.length > 0) {
    return imageUrl.url
  }

  return typeof block.content === "string" && block.content.length > 0 ? block.content : null
}

function getCodexImageExtension(mimeType: string): "jpg" | "png" {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg"
    case "image/png":
      return "png"
    default:
      throw new Error(`Unsupported image MIME type for Codex CLI: ${mimeType}`)
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

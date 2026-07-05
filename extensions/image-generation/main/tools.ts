import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import { z } from "zod/v4"
import type {
  ExtensionToolContext,
  ExtensionToolDefinition,
  ExtensionToolOutput
} from "@jingle/extension-api"

const DEFAULT_BASE_URL = "https://www.xiongxiongai.online"
const DEFAULT_MODEL = "gpt-image-2"
const DEFAULT_QUALITY = "medium"
const DEFAULT_SIZE = "2048x2048"
const DEFAULT_N = 1

const qualitySchema = z.enum(["auto", "low", "medium", "high"]).optional().default(DEFAULT_QUALITY)

const generateImageInputSchema = z.object({
  model: z.string().trim().min(1).optional().default(DEFAULT_MODEL),
  n: z.number().int().min(1).max(4).optional().default(DEFAULT_N),
  prompt: z.string().trim().min(1),
  quality: qualitySchema,
  size: z.string().trim().min(1).optional().default(DEFAULT_SIZE)
})

const editImageInputSchema = generateImageInputSchema.extend({
  imagePaths: z.array(z.string().trim().min(1)).min(1).max(4)
})

type GenerateImageInput = z.infer<typeof generateImageInputSchema>
type EditImageInput = z.infer<typeof editImageInputSchema>

interface GeneratedImageOutput {
  files: Array<{
    path: string
    relativePath: string
    mimeType: "image/png"
    title: string
  }>
  prompt: string
  revisedPrompts?: string[]
}

interface ImageApiConfig {
  apiKey: string
  baseUrl: string
}

function getPreferenceString(
  preferences: Record<string, unknown>,
  name: string
): string | undefined {
  const value = preferences[name]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getImageApiConfig(ctx: ExtensionToolContext): ImageApiConfig {
  const apiKey = getPreferenceString(ctx.extensionPreferences, "apiKey")
  if (!apiKey) {
    throw new Error(
      "Image Generation API key is missing. Configure Image Generation API Key in Settings."
    )
  }

  return {
    apiKey,
    baseUrl: getPreferenceString(ctx.extensionPreferences, "baseUrl") ?? DEFAULT_BASE_URL
  }
}

function endpoint(config: ImageApiConfig, path: string): string {
  return new URL(path, `${config.baseUrl.replace(/\/+$/, "")}/`).toString()
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function formatFetchTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const error = record["error"]
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>)["message"]
        if (typeof message === "string" && message.trim()) {
          return message
        }
      }

      const message = record["message"]
      if (typeof message === "string" && message.trim()) {
        return message
      }
    }
  } catch {
    // Keep the HTTP body below; malformed provider errors are still useful.
  }

  return `Image API request failed with HTTP ${response.status}: ${text.slice(0, 500)}`
}

async function postJson(
  config: ImageApiConfig,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = endpoint(config, path)
  let response: Response
  try {
    response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    })
  } catch (error) {
    throw new Error(
      `Image API request failed while POST ${formatFetchTarget(url)}: ${formatErrorMessage(error)}`,
      { cause: error }
    )
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const parsed = (await response.json()) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Image API response was not a JSON object.")
  }

  return parsed as Record<string, unknown>
}

async function postMultipart(
  config: ImageApiConfig,
  path: string,
  fields: Record<string, string>,
  imagePaths: string[]
): Promise<Record<string, unknown>> {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value)
  }

  for (const imagePath of imagePaths) {
    const bytes = await readFile(imagePath)
    const blob = new Blob([bytes], { type: getImageMimeType(imagePath) })
    form.append("image", blob, basename(imagePath))
  }

  const url = endpoint(config, path)
  let response: Response
  try {
    response = await fetch(url, {
      body: form,
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      method: "POST"
    })
  } catch (error) {
    throw new Error(
      `Image API request failed while POST ${formatFetchTarget(url)}: ${formatErrorMessage(error)}`,
      { cause: error }
    )
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const parsed = (await response.json()) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Image API response was not a JSON object.")
  }

  return parsed as Record<string, unknown>
}

function getImageMimeType(path: string): string {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
    return "image/jpeg"
  }

  if (lowerPath.endsWith(".webp")) {
    return "image/webp"
  }

  return "image/png"
}

function getResponseItems(response: Record<string, unknown>): Record<string, unknown>[] {
  const data = response["data"]
  if (!Array.isArray(data)) {
    throw new Error("Image API response did not include data[].")
  }

  return data.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  )
}

async function readImageBytes(item: Record<string, unknown>): Promise<Buffer> {
  const b64Json = item["b64_json"]
  if (typeof b64Json === "string" && b64Json.trim()) {
    return Buffer.from(b64Json, "base64")
  }

  const url = item["url"]
  if (typeof url === "string" && url.trim()) {
    let response: Response
    try {
      response = await fetch(url)
    } catch (error) {
      throw new Error(
        `Failed to download generated image from ${formatFetchTarget(url)}: ${formatErrorMessage(error)}`,
        { cause: error }
      )
    }

    if (!response.ok) {
      throw new Error(
        `Failed to download generated image from ${formatFetchTarget(url)}: HTTP ${response.status}`
      )
    }

    return Buffer.from(await response.arrayBuffer())
  }

  throw new Error("Image API response item had neither b64_json nor url.")
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

function resolveGeneratedImagesDir(workspacePath: string): string {
  return join(workspacePath, ".jingle", "generated-images")
}

function getOutputPath(input: { index: number; prompt: string; workspacePath: string }): string {
  const promptHash = createHash("sha256").update(input.prompt).digest("hex").slice(0, 10)
  const stem = sanitizeFileStem(input.prompt) || "image"
  return join(
    resolveGeneratedImagesDir(input.workspacePath),
    `${stem}-${promptHash}-${randomUUID().slice(0, 8)}-${input.index}.png`
  )
}

async function saveGeneratedImages(input: {
  prompt: string
  response: Record<string, unknown>
  workspacePath: string
}): Promise<GeneratedImageOutput> {
  const items = getResponseItems(input.response)
  if (items.length === 0) {
    throw new Error("Image API response did not contain any image items.")
  }

  const outputDir = resolveGeneratedImagesDir(input.workspacePath)
  await mkdir(outputDir, { recursive: true })

  const files: GeneratedImageOutput["files"] = []
  const revisedPrompts: string[] = []

  for (const [index, item] of items.entries()) {
    const outputPath = getOutputPath({
      index: index + 1,
      prompt: input.prompt,
      workspacePath: input.workspacePath
    })
    await writeFile(outputPath, await readImageBytes(item))

    const relativePath = relative(input.workspacePath, outputPath)
    files.push({
      mimeType: "image/png",
      path: outputPath,
      relativePath,
      title: items.length === 1 ? "Generated image" : `Generated image ${index + 1}`
    })

    const revisedPrompt = item["revised_prompt"]
    if (typeof revisedPrompt === "string" && revisedPrompt.trim()) {
      revisedPrompts.push(revisedPrompt)
    }
  }

  return {
    files,
    prompt: input.prompt,
    ...(revisedPrompts.length > 0 ? { revisedPrompts } : {})
  }
}

async function resolveWorkspaceImagePaths(
  workspacePath: string,
  imagePaths: readonly string[]
): Promise<string[]> {
  const resolvedPaths: string[] = []

  for (const imagePath of imagePaths) {
    const resolvedPath = resolve(workspacePath, imagePath)
    const relativePath = relative(workspacePath, resolvedPath)
    if (relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\")) {
      throw new Error(`Reference image must be inside the current workspace: ${imagePath}`)
    }

    const imageStat = await stat(resolvedPath)
    if (!imageStat.isFile()) {
      throw new Error(`Reference image path must point to a file: ${imagePath}`)
    }

    resolvedPaths.push(resolvedPath)
  }

  return resolvedPaths
}

async function generateImage(
  ctx: ExtensionToolContext,
  input: GenerateImageInput
): Promise<GeneratedImageOutput> {
  const response = await postJson(
    getImageApiConfig(ctx),
    "/v1/images/generations",
    {
      model: input.model,
      n: input.n,
      prompt: input.prompt,
      quality: input.quality,
      size: input.size
    }
  )

  return saveGeneratedImages({
    prompt: input.prompt,
    response,
    workspacePath: ctx.workspacePath
  })
}

async function editImage(
  ctx: ExtensionToolContext,
  input: EditImageInput
): Promise<GeneratedImageOutput> {
  const imagePaths = await resolveWorkspaceImagePaths(ctx.workspacePath, input.imagePaths)
  const response = await postMultipart(
    getImageApiConfig(ctx),
    "/v1/images/edits",
    {
      model: input.model,
      n: String(input.n),
      prompt: input.prompt,
      quality: input.quality,
      size: input.size
    },
    imagePaths
  )

  return saveGeneratedImages({
    prompt: input.prompt,
    response,
    workspacePath: ctx.workspacePath
  })
}

function generatedImageOutputs(output: GeneratedImageOutput): ExtensionToolOutput[] {
  return output.files.map((file) => ({
    kind: "file",
    mimeType: file.mimeType,
    path: file.path,
    title: file.title
  }))
}

export function createImageGenerationTools(): ExtensionToolDefinition[] {
  const generateImageTool: ExtensionToolDefinition<GenerateImageInput, GeneratedImageOutput> = {
    access: "external",
    outputs: generatedImageOutputs,
    description: "Generate one or more PNG images from a natural language prompt.",
    inputSchema: generateImageInputSchema,
    name: "generateImage",
    title: "Generate Image",
    handler: generateImage
  }
  const editImageTool: ExtensionToolDefinition<EditImageInput, GeneratedImageOutput> = {
    access: "external",
    outputs: generatedImageOutputs,
    description: "Edit one or more workspace image files with a natural language instruction.",
    inputSchema: editImageInputSchema,
    name: "editImage",
    title: "Edit Image",
    handler: editImage
  }

  return [generateImageTool, editImageTool]
}

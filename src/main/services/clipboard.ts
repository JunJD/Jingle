import { existsSync, lstatSync } from "node:fs"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { clipboard } from "electron"
import type { ClipboardContext, ClipboardFile, ClipboardImage } from "@shared/clipboard"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

const MAC_FILE_FORMATS = ["NSFilenamesPboardType", "public.file-url"] as const
const LINUX_FILE_FORMAT = "text/uri-list"

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function readClipboardFormatText(format: string): string {
  const buffer = clipboard.readBuffer(format)
  if (buffer.length > 0) {
    return buffer.toString("utf8")
  }

  return clipboard.read(format)
}

function normalizeClipboardPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith("file://")) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      return null
    }
  }

  return trimmed
}

function parseClipboardFilePayload(payload: string): string[] {
  if (!payload.trim()) {
    return []
  }

  const plistMatches = Array.from(payload.matchAll(/<string>([\s\S]*?)<\/string>/g)).flatMap(
    (match) => {
      const value = decodeXmlEntities(match[1]?.trim() ?? "")
      return value ? [value] : []
    }
  )

  if (plistMatches.length > 0) {
    return plistMatches
  }

  return payload
    .split(/\r?\n/g)
    .map((entry) => normalizeClipboardPath(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function toClipboardFile(path: string): ClipboardFile | null {
  if (!existsSync(path)) {
    return null
  }

  const stat = lstatSync(path)
  return {
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    name: basename(path) || path,
    path
  }
}

function readClipboardFiles(): ClipboardFile[] {
  const availableFormats = new Set(clipboard.availableFormats())
  const rawEntries: string[] = []

  if (process.platform === "darwin") {
    for (const format of MAC_FILE_FORMATS) {
      if (!availableFormats.has(format)) {
        continue
      }

      rawEntries.push(...parseClipboardFilePayload(readClipboardFormatText(format)))
    }
  } else if (process.platform === "linux") {
    if (availableFormats.has(LINUX_FILE_FORMAT)) {
      rawEntries.push(...parseClipboardFilePayload(readClipboardFormatText(LINUX_FILE_FORMAT)))
    }
  }

  const uniquePaths = new Set<string>()
  const files: ClipboardFile[] = []

  for (const entry of rawEntries) {
    const normalizedPath = normalizeClipboardPath(entry)
    if (!normalizedPath || uniquePaths.has(normalizedPath)) {
      continue
    }

    const file = toClipboardFile(normalizedPath)
    if (!file) {
      continue
    }

    uniquePaths.add(normalizedPath)
    files.push(file)
  }

  return files
}

function hasClipboardFiles(files: ClipboardFile[]): files is [ClipboardFile, ...ClipboardFile[]] {
  return files.length > 0
}

function buildClipboardImage(image: Electron.NativeImage): ClipboardImage {
  const size = image.getSize()
  const maxPreviewEdge = 112
  const longestEdge = Math.max(size.width, size.height)
  const preview =
    size.width > maxPreviewEdge || size.height > maxPreviewEdge
      ? image.resize({
          height: Math.max(1, Math.round((size.height / longestEdge) * maxPreviewEdge)),
          quality: "good",
          width: Math.max(1, Math.round((size.width / longestEdge) * maxPreviewEdge))
        })
      : image

  return {
    dataUrl: image.toDataURL(),
    height: size.height,
    previewDataUrl: preview.toDataURL(),
    width: size.width
  }
}

export function readClipboardContext(): ClipboardContext {
  const files = readClipboardFiles()
  if (hasClipboardFiles(files)) {
    return {
      files,
      kind: "files"
    }
  }

  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    return {
      image: buildClipboardImage(image),
      kind: "image"
    }
  }

  const text = clipboard.readText().trim()
  if (text) {
    return {
      kind: "text",
      text
    }
  }

  return EMPTY_CLIPBOARD_CONTEXT
}

export function readClipboardText(): string {
  return clipboard.readText()
}

export interface WriteClipboardTextInput {
  html?: string
  text: string
}

export function writeClipboardText(text: string): void {
  clipboard.writeText(text)
}

export function writeClipboardTextContent(content: WriteClipboardTextInput): void {
  if (content.html !== undefined) {
    clipboard.write({
      html: content.html,
      text: content.text
    })
    return
  }

  clipboard.writeText(content.text)
}

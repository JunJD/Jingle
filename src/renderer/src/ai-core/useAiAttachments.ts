import { useCallback, useMemo, useState } from "react"
import type { ClipboardContext } from "@shared/clipboard"
import {
  isAiAttachmentFilePath,
  isAiAttachmentImagePath
} from "@shared/launcher-attachments"
import type { Message } from "@/types"
import { useAiCoreClipboard } from "./AiCoreHost"

export type LauncherAiAttachmentDraft =
  | {
      height: number
      id: string
      kind: "image"
      name: string
      path?: string
      previewDataUrl: string
      source: "clipboard" | "picker"
      width: number
    }
  | {
      id: string
      isDirectory: boolean
      kind: "file"
      name: string
      path: string
      source: "clipboard" | "picker"
    }

function deriveLauncherAiAttachmentDrafts(context: ClipboardContext): LauncherAiAttachmentDraft[] {
  switch (context.kind) {
    case "image":
      return [
        {
          height: context.image.height,
          id: `clipboard:image:${context.image.width}x${context.image.height}:${context.image.previewDataUrl.slice(0, 48)}`,
          kind: "image",
          name: "Clipboard image",
          previewDataUrl: context.image.previewDataUrl,
          source: "clipboard",
          width: context.image.width
        }
      ]
    case "files":
      return context.files
        .filter((file) => file.isFile && isAiAttachmentFilePath(file.path))
        .map((file) => ({
          id: `clipboard:file:${file.path}`,
          isDirectory: file.isDirectory,
          kind: "file" as const,
          name: file.name,
          path: file.path,
          source: "clipboard" as const
        }))
    case "none":
    case "text":
    default:
      return []
  }
}

type PickerFile = File & { path?: string }

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(reader.error ?? new Error(`Failed to read file "${file.name}"`))
    }
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read file "${file.name}"`))
        return
      }

      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function readImageSize(dataUrl: string): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error("Failed to decode image preview"))
    image.onload = () => {
      resolve({
        height: image.naturalHeight,
        width: image.naturalWidth
      })
    }
    image.src = dataUrl
  })
}

async function toPickedAttachment(file: PickerFile): Promise<LauncherAiAttachmentDraft | null> {
  const path = file.path ?? file.name
  if (!isAiAttachmentFilePath(path)) {
    return null
  }

  if (isAiAttachmentImagePath(path)) {
    const previewDataUrl = await readFileAsDataUrl(file)
    const size = await readImageSize(previewDataUrl)

    return {
      height: size.height,
      id: `picker:image:${path}:${file.lastModified}`,
      kind: "image",
      name: file.name,
      path,
      previewDataUrl,
      source: "picker",
      width: size.width
    }
  }

  return {
    id: `picker:file:${path}:${file.lastModified}`,
    isDirectory: false,
    kind: "file",
    name: file.name,
    path,
    source: "picker"
  }
}

export function useAiAttachments(): {
  attachments: LauncherAiAttachmentDraft[]
  addSelectedFiles: (files: FileList | File[]) => Promise<void>
  buildMessageContent: (message: string) => Message["content"]
  clearAllAttachments: () => void
  hasAttachments: boolean
  removeAttachment: (attachmentId: string) => void
} {
  const clipboard = useAiCoreClipboard()
  const [pickedImages, setPickedImages] = useState<LauncherAiAttachmentDraft[]>([])
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<Set<string>>(() => new Set())

  const clipboardAttachments = useMemo(
    () => deriveLauncherAiAttachmentDrafts(clipboard.context),
    [clipboard.context]
  )

  const attachments = useMemo(() => {
    const mergedAttachments = [...pickedImages, ...clipboardAttachments]
    if (dismissedAttachmentIds.size === 0) {
      return mergedAttachments
    }

    return mergedAttachments.filter((attachment) => !dismissedAttachmentIds.has(attachment.id))
  }, [clipboardAttachments, dismissedAttachmentIds, pickedImages])

  const hasAttachments = attachments.length > 0

  const addSelectedFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    const selectedFiles = Array.from(files)
    if (selectedFiles.length === 0) {
      return
    }

    const nextAttachments = (
      await Promise.all(selectedFiles.map((file) => toPickedAttachment(file as PickerFile)))
    ).filter((attachment): attachment is LauncherAiAttachmentDraft => attachment !== null)

    if (nextAttachments.length === 0) {
      return
    }

    setPickedImages((currentImages) => {
      const nextImages = [...currentImages]
      const existingIds = new Set(currentImages.map((image) => image.id))

      for (const nextImage of nextAttachments) {
        if (!existingIds.has(nextImage.id)) {
          nextImages.push(nextImage)
          existingIds.add(nextImage.id)
        }
      }

      return nextImages
    })
  }, [])

  const removeAttachment = useCallback((attachmentId: string): void => {
    setPickedImages((currentImages) =>
      currentImages.filter((attachment) => attachment.id !== attachmentId)
    )
    setDismissedAttachmentIds((currentIds) => {
      const nextIds = new Set(currentIds)
      nextIds.add(attachmentId)
      return nextIds
    })
  }, [])

  const buildMessageContent = useCallback(
    (message: string): Message["content"] => {
      if (attachments.length === 0) {
        return message
      }

      const blocks: Exclude<Message["content"], string> = []
      const trimmedMessage = message.trim()

      if (trimmedMessage) {
        blocks.push({
          text: trimmedMessage,
          type: "text"
        })
      }

      for (const attachment of attachments) {
        if (attachment.kind === "image") {
          blocks.push({
            content: attachment.previewDataUrl,
            mimeType: "image/png",
            name: attachment.name,
            type: "image"
          })
          continue
        }

        blocks.push({
          content: attachment.path,
          name: attachment.name,
          type: "file"
        })
      }

      return blocks
    },
    [attachments]
  )

  const clearAllAttachments = useCallback((): void => {
    if (attachments.length === 0) {
      return
    }

    setPickedImages([])
    setDismissedAttachmentIds((currentIds) => {
      const nextIds = new Set(currentIds)
      for (const attachment of attachments) {
        nextIds.add(attachment.id)
      }
      return nextIds
    })
  }, [attachments])

  return {
    attachments,
    addSelectedFiles,
    buildMessageContent,
    clearAllAttachments,
    hasAttachments,
    removeAttachment
  }
}

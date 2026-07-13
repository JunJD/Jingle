import { useCallback, useEffect, useMemo, useState } from "react"
import type { ClipboardContext } from "@shared/clipboard"
import { isAiAttachmentFilePath, isAiAttachmentImagePath } from "@shared/launcher-attachments"
import type { ComposerMessageRef } from "@shared/message-content"
import { useAiCoreClipboard } from "./AiCoreHost"

export type LauncherAiAttachmentDraft =
  | {
      dataUrl: string
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

function reportInvalidAttachment(reason: string): void {
  console.error(`[LauncherAiAttachments] ${reason}`)
}

function deriveLauncherAiAttachmentDrafts(context: ClipboardContext): LauncherAiAttachmentDraft[] {
  switch (context.kind) {
    case "image":
      return [
        {
          dataUrl: context.image.dataUrl,
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
      return context.files.reduce<LauncherAiAttachmentDraft[]>((drafts, file) => {
        if (!file.isFile || !isAiAttachmentFilePath(file.path)) {
          return drafts
        }

        drafts.push({
          id: `clipboard:file:${file.path}`,
          isDirectory: file.isDirectory,
          kind: "file",
          name: file.name,
          path: file.path,
          source: "clipboard"
        })
        return drafts
      }, [])
    case "none":
    case "text":
    default:
      return []
  }
}

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

async function toPickedAttachment(file: File): Promise<LauncherAiAttachmentDraft | null> {
  const name = file.name.trim()
  if (!name) {
    return null
  }

  const path = window.electron.getPathForFile(file).trim()
  if (!path) {
    reportInvalidAttachment(`Cannot attach "${name}" because its file path is unavailable.`)
    return null
  }

  if (!isAiAttachmentFilePath(path)) {
    return null
  }

  if (isAiAttachmentImagePath(path)) {
    const previewDataUrl = await readFileAsDataUrl(file)
    const size = await readImageSize(previewDataUrl)

    return {
      dataUrl: previewDataUrl,
      height: size.height,
      id: `picker:image:${path}:${file.lastModified}`,
      kind: "image",
      name,
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
    name,
    path,
    source: "picker"
  }
}

export function useAiAttachments(): {
  acceptClipboardAttachments: () => void
  attachments: LauncherAiAttachmentDraft[]
  addSelectedFiles: (files: FileList | File[]) => Promise<void>
  clipboardCandidateAttachments: LauncherAiAttachmentDraft[]
  clearAllAttachments: () => void
  messageRefs: ComposerMessageRef[]
  removeAttachment: (attachmentId: string) => void
} {
  const clipboard = useAiCoreClipboard()
  const clearClipboardContext = clipboard.clearContext
  const [pickedImages, setPickedImages] = useState<LauncherAiAttachmentDraft[]>([])
  const clipboardCandidateAttachments = useMemo(
    () => deriveLauncherAiAttachmentDrafts(clipboard.candidateContext),
    [clipboard.candidateContext]
  )
  const acceptedClipboardAttachments = useMemo(
    () => deriveLauncherAiAttachmentDrafts(clipboard.acceptedContext),
    [clipboard.acceptedContext]
  )

  const attachments = useMemo(() => {
    const mergedAttachments: LauncherAiAttachmentDraft[] = []
    const seenIds = new Set<string>()

    for (const attachment of [...pickedImages, ...acceptedClipboardAttachments]) {
      if (seenIds.has(attachment.id)) {
        continue
      }

      mergedAttachments.push(attachment)
      seenIds.add(attachment.id)
    }

    return mergedAttachments
  }, [acceptedClipboardAttachments, pickedImages])

  const messageRefs = useMemo<ComposerMessageRef[]>(() => {
    return attachments.map((attachment) => {
      if (attachment.kind === "image") {
        return {
          name: attachment.name,
          type: "image",
          url: attachment.dataUrl
        }
      }

      return {
        name: attachment.name,
        path: attachment.path,
        type: "file"
      }
    })
  }, [attachments])

  const addAttachmentDrafts = useCallback((nextAttachments: LauncherAiAttachmentDraft[]): void => {
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

  useEffect(() => {
    if (clipboard.acceptedContext.kind === "none") {
      return
    }

    let isCurrent = true
    queueMicrotask(() => {
      if (!isCurrent) {
        return
      }

      addAttachmentDrafts(acceptedClipboardAttachments)
      clearClipboardContext()
    })

    return () => {
      isCurrent = false
    }
  }, [
    acceptedClipboardAttachments,
    addAttachmentDrafts,
    clearClipboardContext,
    clipboard.acceptedContext
  ])

  const addSelectedFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    const selectedFiles = Array.from(files)
    if (selectedFiles.length === 0) {
      return
    }

    const nextAttachments = (
      await Promise.all(selectedFiles.map(toPickedAttachment))
    ).filter((attachment): attachment is LauncherAiAttachmentDraft => attachment !== null)

    if (nextAttachments.length === 0) {
      return
    }

    addAttachmentDrafts(nextAttachments)
  }, [addAttachmentDrafts])

  const acceptClipboardAttachments = useCallback((): void => {
    addAttachmentDrafts(clipboardCandidateAttachments)
    clearClipboardContext()
  }, [addAttachmentDrafts, clearClipboardContext, clipboardCandidateAttachments])

  const removeAttachment = useCallback((attachmentId: string): void => {
    setPickedImages((currentImages) =>
      currentImages.filter((attachment) => attachment.id !== attachmentId)
    )
  }, [])

  const clearAllAttachments = useCallback((): void => {
    if (attachments.length === 0) {
      return
    }

    setPickedImages([])
    if (acceptedClipboardAttachments.length > 0) {
      clearClipboardContext()
    }
  }, [acceptedClipboardAttachments.length, attachments.length, clearClipboardContext])

  return {
    acceptClipboardAttachments,
    attachments,
    clipboardCandidateAttachments,
    addSelectedFiles,
    clearAllAttachments,
    messageRefs,
    removeAttachment
  }
}

const AI_ATTACHMENT_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif"
] as const

const AI_ATTACHMENT_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "md"
] as const

export const AI_ATTACHMENT_FILE_EXTENSIONS = [
  ...AI_ATTACHMENT_IMAGE_EXTENSIONS,
  ...AI_ATTACHMENT_DOCUMENT_EXTENSIONS
] as const

function getPathExtension(path: string): string {
  const lastDotIndex = path.lastIndexOf(".")
  if (lastDotIndex < 0 || lastDotIndex === path.length - 1) {
    return ""
  }

  return path.slice(lastDotIndex + 1).toLowerCase()
}

export function isAiAttachmentImagePath(path: string): boolean {
  return AI_ATTACHMENT_IMAGE_EXTENSIONS.includes(
    getPathExtension(path) as (typeof AI_ATTACHMENT_IMAGE_EXTENSIONS)[number]
  )
}

export function isAiAttachmentFilePath(path: string): boolean {
  return AI_ATTACHMENT_FILE_EXTENSIONS.includes(
    getPathExtension(path) as (typeof AI_ATTACHMENT_FILE_EXTENSIONS)[number]
  )
}

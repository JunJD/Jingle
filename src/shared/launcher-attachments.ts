export const AI_ATTACHMENT_IMAGE_EXTENSIONS = [
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

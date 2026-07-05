export interface ClipboardFile {
  isDirectory: boolean
  isFile: boolean
  name: string
  path: string
}

export interface ClipboardImage {
  dataUrl: string
  height: number
  previewDataUrl: string
  width: number
}

export type ClipboardSnapshot =
  | {
      kind: "none"
    }
  | {
      kind: "text"
      text: string
    }
  | {
      files: ClipboardFile[]
      kind: "files"
    }
  | {
      image: ClipboardImage
      kind: "image"
    }

export type ClipboardContext = ClipboardSnapshot

export type ClipboardPayloadKind = Exclude<ClipboardSnapshot["kind"], "none">

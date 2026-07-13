export interface ClipboardFile {
  isDirectory: boolean
  isFile: boolean
  name: string
  path: string
}

export type ClipboardFileList = [ClipboardFile, ...ClipboardFile[]]

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
      files: ClipboardFileList
      kind: "files"
    }
  | {
      image: ClipboardImage
      kind: "image"
    }

export type ClipboardContext = ClipboardSnapshot

export type ClipboardPayloadKind = Exclude<ClipboardSnapshot["kind"], "none">

export interface ClipboardFile {
  isDirectory: boolean
  isFile: boolean
  name: string
  path: string
}

export type ClipboardContext =
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
      kind: "image"
    }

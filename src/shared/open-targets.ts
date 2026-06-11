export type OpenTargetKind = "file-manager" | "terminal" | "application"

export interface OpenTarget {
  id: string
  kind: OpenTargetKind
  label: string
  appPath?: string
  iconDataUrl?: string
}

export interface ListOpenTargetsRequest {
  folderPath: string
}

export interface ListOpenTargetsResponse {
  targets: OpenTarget[]
}

export interface OpenTargetRequest {
  folderPath: string
  targetId: string
}

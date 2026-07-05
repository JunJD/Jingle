import type { RuntimeOpenApplication } from "@jingle/extension-api"

export interface FigmaFilesPreferences {
  TEAM_ID: string
  accessToken?: string
  open_in?: RuntimeOpenApplication
}

export interface FigmaBranch {
  key: string
  last_modified: string
  name: string
  thumbnail_url: string
}

export interface FigmaFile {
  key: string
  last_modified: string
  name: string
  thumbnail_url: string
  branches: FigmaBranch[]
}

export interface FigmaProject {
  id: string
  name: string
}

export interface FigmaProjectFiles {
  files: FigmaFile[]
  name: string
  projectId: string
}

export interface FigmaTeamFiles {
  files: FigmaProjectFiles[]
  name: string
}

export interface FigmaTeamProjects {
  name: string
  projects: FigmaProject[]
}

export interface FigmaNode {
  children?: FigmaNode[]
  id: string
  name: string
}

export interface FigmaFileDetail {
  document: FigmaNode
}

import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Hash,
  NotebookText,
  Presentation,
  type LucideIcon
} from "lucide-react"
import { cn } from "@/lib/utils"

export type WorkspaceFileIconKind =
  | "archive"
  | "build"
  | "code"
  | "config"
  | "document"
  | "file"
  | "hash"
  | "html"
  | "image"
  | "javascript"
  | "json"
  | "notebook"
  | "pdf"
  | "presentation"
  | "react"
  | "shell"
  | "spreadsheet"
  | "typescript"

type WorkspaceFileIconDefinition = {
  className: string
  Icon: LucideIcon
}

const SPECIAL_FILE_ICON_KINDS = new Map<string, WorkspaceFileIconKind>([
  ["dockerfile", "shell"],
  ["makefile", "build"],
  ["skill.md", "config"]
])

const EXTENSION_ICON_KINDS = new Map<string, WorkspaceFileIconKind>([
  ...mapExtensions("typescript", ["ts"]),
  ...mapExtensions("react", ["tsx", "jsx"]),
  ...mapExtensions("javascript", ["js", "mjs", "cjs"]),
  ...mapExtensions("code", [
    "c",
    "cc",
    "cpp",
    "cs",
    "cxx",
    "go",
    "h",
    "hh",
    "hpp",
    "java",
    "kt",
    "m",
    "mm",
    "php",
    "py",
    "rb",
    "rs",
    "sql",
    "swift"
  ]),
  ...mapExtensions("html", ["htm", "html", "xml"]),
  ...mapExtensions("code", ["css", "less", "sass", "scss"]),
  ...mapExtensions("json", ["json", "jsonc"]),
  ...mapExtensions("config", ["env", "gitignore", "lock", "toml", "yaml", "yml"]),
  ...mapExtensions("document", ["md", "markdown", "mdown", "mdx", "mkd", "txt"]),
  ...mapExtensions("spreadsheet", ["csv", "tsv", "xls", "xlsm", "xlsx"]),
  ...mapExtensions("document", ["doc", "docx"]),
  ...mapExtensions("notebook", ["ipynb"]),
  ...mapExtensions("presentation", ["ppt", "pptx"]),
  ...mapExtensions("shell", ["bash", "fish", "ps1", "sh", "zsh"]),
  ...mapExtensions("image", ["bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]),
  ...mapExtensions("build", ["bazel", "build", "bzl", "gradle", "mk", "ninja"]),
  ...mapExtensions("hash", ["checksum", "md5", "sha", "sha1", "sha256", "sum"]),
  ...mapExtensions("pdf", ["pdf"]),
  ...mapExtensions("archive", ["gz", "tar", "tgz", "zip"])
])

const ICON_DEFINITIONS: Record<WorkspaceFileIconKind, WorkspaceFileIconDefinition> = {
  archive: { Icon: FileArchive, className: "text-amber-600" },
  build: { Icon: FileCog, className: "text-muted-foreground" },
  code: { Icon: FileCode, className: "text-blue-400" },
  config: { Icon: FileCog, className: "text-muted-foreground" },
  document: { Icon: FileText, className: "text-muted-foreground" },
  file: { Icon: File, className: "text-muted-foreground" },
  hash: { Icon: Hash, className: "text-muted-foreground" },
  html: { Icon: FileType, className: "text-orange-500" },
  image: { Icon: FileImage, className: "text-violet-500" },
  javascript: { Icon: FileCode, className: "text-amber-500" },
  json: { Icon: FileJson, className: "text-yellow-500" },
  notebook: { Icon: NotebookText, className: "text-orange-500" },
  pdf: { Icon: FileText, className: "text-red-500" },
  presentation: { Icon: Presentation, className: "text-rose-500" },
  react: { Icon: FileCode, className: "text-cyan-500" },
  shell: { Icon: FileTerminal, className: "text-emerald-600" },
  spreadsheet: { Icon: FileSpreadsheet, className: "text-green-600" },
  typescript: { Icon: FileCode, className: "text-sky-500" }
}

function mapExtensions(
  kind: WorkspaceFileIconKind,
  extensions: string[]
): [string, WorkspaceFileIconKind][] {
  return extensions.map((extension) => [extension, kind])
}

function getBaseName(name: string): string {
  const normalizedName = name.replace(/[\\/]+$/, "")
  const slashIndex = Math.max(normalizedName.lastIndexOf("/"), normalizedName.lastIndexOf("\\"))
  return slashIndex >= 0 ? normalizedName.slice(slashIndex + 1) : normalizedName
}

function getExtension(baseName: string): string {
  const dotIndex = baseName.lastIndexOf(".")
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    return baseName.slice(dotIndex + 1).toLowerCase()
  }
  if (dotIndex === 0 && baseName.length > 1) {
    return baseName.slice(1).toLowerCase()
  }
  return ""
}

export function getWorkspaceFileIconKind(name: string): WorkspaceFileIconKind {
  const baseName = getBaseName(name).toLowerCase()
  if (!baseName) {
    return "file"
  }
  if (baseName === ".env" || baseName.startsWith(".env.")) {
    return "config"
  }

  const specialKind = SPECIAL_FILE_ICON_KINDS.get(baseName)
  if (specialKind) {
    return specialKind
  }

  const extension = getExtension(baseName)
  return (extension && EXTENSION_ICON_KINDS.get(extension)) || "file"
}

export function WorkspaceFileIcon(props: { className?: string; name: string }): React.JSX.Element {
  const { className, name } = props
  const kind = getWorkspaceFileIconKind(name)
  const definition = ICON_DEFINITIONS[kind]
  const Icon = definition.Icon
  const iconClassName = cn("shrink-0", className)

  return <Icon className={cn(iconClassName, definition.className)} />
}

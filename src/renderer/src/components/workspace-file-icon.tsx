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
  | "cplusplus"
  | "css"
  | "document"
  | "file"
  | "hash"
  | "html"
  | "image"
  | "java"
  | "javascript"
  | "json"
  | "notebook"
  | "pdf"
  | "presentation"
  | "php"
  | "python"
  | "react"
  | "rust"
  | "shell"
  | "spreadsheet"
  | "terminal"
  | "toml"
  | "typescript"
  | "yaml"

export type WorkspaceFileIconBadge = {
  className: string
  kind: WorkspaceFileIconKind
  label: string
}

type WorkspaceFileIconDefinition = {
  badgeClassName: string
  badgeLabel: string
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
  ...mapExtensions("python", ["py"]),
  ...mapExtensions("java", ["java"]),
  ...mapExtensions("rust", ["rs"]),
  ...mapExtensions("php", ["php"]),
  ...mapExtensions("css", ["css", "less", "sass", "scss"]),
  ...mapExtensions("cplusplus", ["c", "cc", "cpp", "cxx", "h", "hh", "hpp"]),
  ...mapExtensions("code", [
    "cs",
    "go",
    "hs",
    "kt",
    "m",
    "mm",
    "rb",
    "sql",
    "swift"
  ]),
  ...mapExtensions("html", ["htm", "html", "xml"]),
  ...mapExtensions("json", ["json", "jsonc"]),
  ...mapExtensions("yaml", ["yaml", "yml"]),
  ...mapExtensions("toml", ["toml"]),
  ...mapExtensions("config", ["dotenv", "env", "gitignore", "lock"]),
  ...mapExtensions("document", ["md", "markdown", "mdown", "mdx", "mkd", "txt"]),
  ...mapExtensions("spreadsheet", ["csv", "tsv", "xls", "xlsm", "xlsx"]),
  ...mapExtensions("document", ["doc", "docx"]),
  ...mapExtensions("notebook", ["ipynb"]),
  ...mapExtensions("presentation", ["ppt", "pptx"]),
  ...mapExtensions("shell", ["bash", "fish", "ps1", "sh", "zsh"]),
  ...mapExtensions("terminal", ["dockerfile"]),
  ...mapExtensions("image", ["bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]),
  ...mapExtensions("build", ["bazel", "build", "bzl", "gradle", "mk", "ninja"]),
  ...mapExtensions("hash", ["checksum", "md5", "sha", "sha1", "sha256", "sum"]),
  ...mapExtensions("pdf", ["pdf"]),
  ...mapExtensions("archive", ["gz", "tar", "tgz", "zip"])
])

const ICON_DEFINITIONS: Record<WorkspaceFileIconKind, WorkspaceFileIconDefinition> = {
  archive: {
    Icon: FileArchive,
    badgeClassName: "bg-amber-100 text-amber-700",
    badgeLabel: "ZIP",
    className: "text-amber-600"
  },
  build: {
    Icon: FileCog,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "BLD",
    className: "text-muted-foreground"
  },
  code: {
    Icon: FileCode,
    badgeClassName: "bg-blue-100 text-blue-700",
    badgeLabel: "<>",
    className: "text-blue-400"
  },
  config: {
    Icon: FileCog,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "CFG",
    className: "text-muted-foreground"
  },
  cplusplus: {
    Icon: FileCode,
    badgeClassName: "bg-indigo-100 text-indigo-700",
    badgeLabel: "C++",
    className: "text-indigo-500"
  },
  css: {
    Icon: FileCode,
    badgeClassName: "bg-blue-100 text-blue-700",
    badgeLabel: "CSS",
    className: "text-blue-500"
  },
  document: {
    Icon: FileText,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "TXT",
    className: "text-muted-foreground"
  },
  file: {
    Icon: File,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "FILE",
    className: "text-muted-foreground"
  },
  hash: {
    Icon: Hash,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "#",
    className: "text-muted-foreground"
  },
  html: {
    Icon: FileType,
    badgeClassName: "bg-orange-100 text-orange-700",
    badgeLabel: "HTML",
    className: "text-orange-500"
  },
  image: {
    Icon: FileImage,
    badgeClassName: "bg-violet-100 text-violet-700",
    badgeLabel: "IMG",
    className: "text-violet-500"
  },
  java: {
    Icon: FileCode,
    badgeClassName: "bg-red-100 text-red-700",
    badgeLabel: "JAVA",
    className: "text-red-500"
  },
  javascript: {
    Icon: FileCode,
    badgeClassName: "bg-amber-100 text-amber-700",
    badgeLabel: "JS",
    className: "text-amber-500"
  },
  json: {
    Icon: FileJson,
    badgeClassName: "bg-yellow-100 text-yellow-700",
    badgeLabel: "{}",
    className: "text-yellow-500"
  },
  notebook: {
    Icon: NotebookText,
    badgeClassName: "bg-orange-100 text-orange-700",
    badgeLabel: "IPY",
    className: "text-orange-500"
  },
  pdf: {
    Icon: FileText,
    badgeClassName: "bg-red-100 text-red-700",
    badgeLabel: "PDF",
    className: "text-red-500"
  },
  php: {
    Icon: FileCode,
    badgeClassName: "bg-violet-100 text-violet-700",
    badgeLabel: "PHP",
    className: "text-violet-500"
  },
  presentation: {
    Icon: Presentation,
    badgeClassName: "bg-rose-100 text-rose-700",
    badgeLabel: "PPT",
    className: "text-rose-500"
  },
  python: {
    Icon: FileCode,
    badgeClassName: "bg-blue-100 text-blue-700",
    badgeLabel: "PY",
    className: "text-blue-500"
  },
  react: {
    Icon: FileCode,
    badgeClassName: "bg-cyan-100 text-cyan-700",
    badgeLabel: "RX",
    className: "text-cyan-500"
  },
  rust: {
    Icon: FileCode,
    badgeClassName: "bg-orange-100 text-orange-700",
    badgeLabel: "RS",
    className: "text-orange-500"
  },
  shell: {
    Icon: FileTerminal,
    badgeClassName: "bg-emerald-100 text-emerald-700",
    badgeLabel: "SH",
    className: "text-emerald-600"
  },
  spreadsheet: {
    Icon: FileSpreadsheet,
    badgeClassName: "bg-green-100 text-green-700",
    badgeLabel: "CSV",
    className: "text-green-600"
  },
  terminal: {
    Icon: FileTerminal,
    badgeClassName: "bg-emerald-100 text-emerald-700",
    badgeLabel: "$",
    className: "text-emerald-600"
  },
  toml: {
    Icon: FileCog,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "TOML",
    className: "text-muted-foreground"
  },
  typescript: {
    Icon: FileCode,
    badgeClassName: "bg-[#4d4b69] text-white/82",
    badgeLabel: "TS",
    className: "text-sky-500"
  },
  yaml: {
    Icon: FileCog,
    badgeClassName: "bg-slate-200 text-slate-600",
    badgeLabel: "YML",
    className: "text-muted-foreground"
  }
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

export function getWorkspaceFileIconBadge(name: string): WorkspaceFileIconBadge {
  const kind = getWorkspaceFileIconKind(name)
  const definition = ICON_DEFINITIONS[kind]

  return {
    className: definition.badgeClassName,
    kind,
    label: definition.badgeLabel
  }
}

export function WorkspaceFileIcon(props: {
  className?: string
  name: string
  variant?: "badge" | "glyph"
}): React.JSX.Element {
  const { className, name, variant = "glyph" } = props
  const badge = getWorkspaceFileIconBadge(name)
  const definition = ICON_DEFINITIONS[badge.kind]

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "flex size-[14px] shrink-0 items-center justify-center rounded-[3px] text-[6.5px] font-semibold leading-none tracking-normal",
          badge.className,
          className
        )}
      >
        {badge.label}
      </span>
    )
  }

  const Icon = definition.Icon
  const iconClassName = cn("shrink-0", className)

  return <Icon className={cn(iconClassName, definition.className)} />
}

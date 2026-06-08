import { File, FileCode, FileJson, FileText } from "lucide-react"
import { cn } from "@/lib/utils"

export function WorkspaceFileIcon(props: {
  className?: string
  name: string
}): React.JSX.Element {
  const { className, name } = props
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : ""
  const iconClassName = cn("shrink-0", className)

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "css":
    case "scss":
    case "html":
      return <FileCode className={cn(iconClassName, "text-blue-400")} />
    case "json":
      return <FileJson className={cn(iconClassName, "text-yellow-500")} />
    case "md":
    case "mdx":
    case "txt":
      return <FileText className={cn(iconClassName, "text-muted-foreground")} />
    default:
      return <File className={cn(iconClassName, "text-muted-foreground")} />
  }
}

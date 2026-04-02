import { AlertCircle, ArrowLeft, Settings2 } from "lucide-react"

export function LauncherCommandErrorPage(props: {
  description: string
  onBack: () => void
  onOpenSettings: () => void
  title: string
}): React.JSX.Element {
  const { description, onBack, onOpenSettings, title } = props

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-8">
      <div className="w-full max-w-md rounded-3xl border border-border bg-background-elevated/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.12)]">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-sm leading-6 text-muted-foreground">{description}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            onClick={onOpenSettings}
          >
            <Settings2 className="h-4 w-4" />
            <span>Open Settings</span>
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-background-elevated"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
        </div>
      </div>
    </div>
  )
}

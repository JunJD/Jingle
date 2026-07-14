import { AlertCircle, ArrowLeft, Settings2 } from "lucide-react"

export function LauncherCommandErrorPage(props: {
  description: string
  onBack: () => void
  onOpenSettings: () => void
  title: string
}): React.JSX.Element {
  const { description, onBack, onOpenSettings, title } = props

  return (
    <div className="flex h-full w-full items-center justify-center px-[var(--jingle-space-5)] py-[var(--jingle-space-6)]">
      <div className="w-full max-w-[var(--jingle-error-panel-max-w)] rounded-[var(--jingle-radius-dialog)] border border-border bg-background-elevated/95 p-[var(--jingle-space-5)] shadow-[0_16px_56px_rgba(0,0,0,0.1)]">
        <div className="flex items-start gap-[var(--jingle-gap-md)]">
          <div className="rounded-[var(--jingle-radius-lg)] bg-destructive/10 p-[var(--jingle-space-2-5)] text-destructive">
            <AlertCircle className="h-[var(--jingle-icon-md)] w-[var(--jingle-icon-md)]" />
          </div>
          <div className="space-y-[var(--jingle-space-2)]">
            <div className="[font-size:var(--jingle-font-control)] font-semibold text-foreground">
              {title}
            </div>
            <div className="[font-size:var(--jingle-font-control)] leading-[var(--jingle-line-chat)] text-muted-foreground">
              {description}
            </div>
          </div>
        </div>

        <div className="mt-[var(--jingle-space-6)] flex items-center gap-[var(--jingle-gap-md)]">
          <button
            type="button"
            className="inline-flex items-center gap-[var(--jingle-space-1-5)] rounded-full bg-foreground px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-control)] font-medium text-background transition hover:opacity-90"
            onClick={onOpenSettings}
          >
            <Settings2 className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
            <span>Open Settings</span>
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-[var(--jingle-space-1-5)] rounded-full border border-border bg-background px-[var(--jingle-space-3)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-control)] font-medium text-foreground transition hover:bg-background-elevated"
            onClick={onBack}
          >
            <ArrowLeft className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)]" />
            <span>Back</span>
          </button>
        </div>
      </div>
    </div>
  )
}

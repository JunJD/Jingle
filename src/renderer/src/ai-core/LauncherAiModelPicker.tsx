import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ModelSelectionContent } from "@/features/model-selection/ModelSelectionContent"
import { useI18n } from "@/lib/i18n"

export function LauncherAiModelPicker(props: {
  currentModelId: string | null
  onClose: () => void
  onSelectModel: (modelId: string) => Promise<boolean>
}): React.JSX.Element {
  const { currentModelId, onClose, onSelectModel } = props
  const { copy } = useI18n()

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-[var(--launcher-model-dialog-w)] gap-0 overflow-hidden border-border bg-background p-0">
        <DialogHeader className="border-b border-border px-[var(--jingle-space-4)] py-[var(--jingle-space-3)]">
          <DialogTitle className="[font-size:var(--jingle-font-control)] font-medium">
            {copy.launcher.changeModel}
          </DialogTitle>
        </DialogHeader>
        <ModelSelectionContent
          currentModelId={currentModelId}
          onDone={onClose}
          onSelectModel={onSelectModel}
        />
      </DialogContent>
    </Dialog>
  )
}

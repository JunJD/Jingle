import { useI18n } from "@/lib/i18n"
import {
  getSubagentStatusLabel,
  type SubagentReferenceView
} from "@/lib/subagent-view"
import { InlineActivityReferences } from "./InlineActivityReferences"

interface SubagentReferencesPanelProps {
  references: readonly SubagentReferenceView[]
}

type I18nCopy = ReturnType<typeof useI18n>["copy"]

function getReferenceStatusLabels(copy: I18nCopy) {
  return {
    completed: copy.common.completed,
    failed: copy.common.error,
    pending: copy.launcher.planned,
    running: copy.common.running
  }
}

export function SubagentReferencesPanel(
  props: SubagentReferencesPanelProps
): React.JSX.Element | null {
  const { references } = props
  const { copy } = useI18n()
  const statusLabels = getReferenceStatusLabels(copy)

  if (references.length === 0) {
    return null
  }

  return (
    <InlineActivityReferences
      items={references.map((reference) => ({
        detail: reference.detail,
        key: reference.key,
        meta: [reference.subagentType, getSubagentStatusLabel(reference.status, statusLabels)]
          .filter(Boolean)
          .join(" · "),
        title: reference.title
      }))}
      title={copy.chat.subagentReferencesTitle(references.length)}
    />
  )
}

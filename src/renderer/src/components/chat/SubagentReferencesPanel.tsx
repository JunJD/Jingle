import type { Subagent } from "@/types"
import { useI18n } from "@/lib/i18n"
import { InlineActivityReferences } from "./InlineActivityReferences"

interface SubagentReferencesPanelProps {
  subagents: readonly Subagent[]
}

type I18nCopy = ReturnType<typeof useI18n>["copy"]

function getStatusLabel(status: Subagent["status"], copy: I18nCopy): string {
  switch (status) {
    case "completed":
      return copy.common.completed
    case "failed":
      return copy.common.error
    case "running":
      return copy.common.running
    case "pending":
      return copy.launcher.planned
  }
}

export function SubagentReferencesPanel(
  props: SubagentReferencesPanelProps
): React.JSX.Element | null {
  const { subagents } = props
  const { copy } = useI18n()

  if (subagents.length === 0) {
    return null
  }

  return (
    <InlineActivityReferences
      items={subagents.map((subagent) => ({
        detail: subagent.description,
        key: subagent.id,
        meta: [subagent.subagentType, getStatusLabel(subagent.status, copy)]
          .filter(Boolean)
          .join(" · "),
        title: subagent.name
      }))}
      title={copy.chat.subagentReferencesTitle(subagents.length)}
    />
  )
}

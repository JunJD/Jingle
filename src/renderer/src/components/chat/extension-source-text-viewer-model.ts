import {
  parseComposerReferenceText,
  type ParsedExtensionSourceReference,
  type ParsedComposerReferenceText
} from "@shared/composer-reference-uri"
import type { ExtensionSourceMention } from "@shared/extension-sources"

export type ExtensionSourceToken = NonNullable<ParsedComposerReferenceText>["tokens"][number]

export function parseExtensionSourceTextForViewer(text: string): ExtensionSourceToken[] | null {
  return parseComposerReferenceText(text)?.tokens ?? null
}

export type ExtensionSourceChipProjection = {
  extensionName: string
  icon?: string
  iconName?: string
  label: string
  status: "ready" | "unavailable"
  title: string
}

export function projectExtensionSourceChip(input: {
  sourceMentions: readonly ExtensionSourceMention[]
  token: ParsedExtensionSourceReference
}): ExtensionSourceChipProjection {
  const sourceMention = input.sourceMentions.find(
    (mention) =>
      mention.extensionName === input.token.extensionName &&
      mention.sourceId === input.token.sourceId
  )

  if (!sourceMention) {
    return {
      extensionName: input.token.extensionName,
      label: input.token.label,
      status: "unavailable",
      title: input.token.label
    }
  }

  return {
    extensionName: sourceMention.extensionName,
    icon: sourceMention.icon,
    iconName: sourceMention.iconName,
    label: `@${sourceMention.value}`,
    status: "ready",
    title: sourceMention.label
  }
}

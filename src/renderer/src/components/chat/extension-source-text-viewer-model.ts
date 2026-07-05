import {
  parseComposerReferenceText,
  type ParsedComposerReferenceText
} from "@shared/composer-reference-uri"

export type ExtensionSourceToken = NonNullable<ParsedComposerReferenceText>["tokens"][number]

export function parseExtensionSourceTextForViewer(text: string): ExtensionSourceToken[] | null {
  return parseComposerReferenceText(text)?.tokens ?? null
}

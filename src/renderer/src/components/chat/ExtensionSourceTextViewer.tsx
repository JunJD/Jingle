import { FileText } from "lucide-react"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { useI18n } from "@/lib/i18n"
import { listNativeExtensionSourceMentions } from "@extensions/source-mentions"
import {
  parseComposerReferenceText,
  type ParsedComposerReferenceText,
  type ParsedExtensionSourceReference,
  type ParsedWorkspaceFileReference
} from "@shared/composer-reference-uri"
import type { ExtensionSourceMention } from "@shared/extension-sources"

type ViewerToken = NonNullable<ParsedComposerReferenceText>["tokens"][number]

export function parseComposerReferenceTextForViewer(text: string): ViewerToken[] | null {
  return parseComposerReferenceText(text)?.tokens ?? null
}

function ExtensionSourceChip(props: {
  sourceMentions: ExtensionSourceMention[]
  token: ParsedExtensionSourceReference
}): React.JSX.Element {
  const { sourceMentions, token } = props
  const sourceMention = sourceMentions.find(
    (mention) =>
      mention.extensionName === token.extensionName && mention.sourceId === token.sourceId
  )
  const label = sourceMention ? `@${sourceMention.value}` : token.label
  const title = sourceMention?.label ?? `${token.extensionName}/${token.sourceId}`

  return (
    <span
      className="inline-flex h-[20px] max-w-full items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[4px] align-top text-foreground"
      title={title}
    >
      <ExtensionIcon
        className="size-[14px] shrink-0 text-muted-foreground"
        extensionName={token.extensionName}
        icon={sourceMention?.icon}
        iconName={sourceMention?.iconName}
      />
      <span className="box-border block h-[20px] min-w-0 max-w-full truncate border-b border-border-emphasis [border-bottom-width:0.5px] [font-size:14px] font-semibold leading-[20px] tracking-normal">
        {label}
      </span>
    </span>
  )
}

function WorkspaceFileChip(props: { token: ParsedWorkspaceFileReference }): React.JSX.Element {
  const { token } = props

  return (
    <span
      className="inline-flex h-[20px] max-w-full items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[4px] align-top text-foreground"
      title={token.path}
    >
      <FileText className="size-[14px] shrink-0 text-muted-foreground" />
      <span className="box-border block h-[20px] min-w-0 max-w-full truncate border-b border-border-emphasis [border-bottom-width:0.5px] [font-size:14px] font-semibold leading-[20px] tracking-normal">
        {token.label}
      </span>
    </span>
  )
}

export function ComposerReferenceTextViewer(props: { text: string }): React.JSX.Element {
  const { text } = props
  const { locale } = useI18n()
  const sourceMentions = listNativeExtensionSourceMentions(
    window.electron.process.platform,
    locale
  )
  const tokens = parseComposerReferenceTextForViewer(text)

  if (!tokens) {
    return <>{text}</>
  }

  return (
    <>
      {tokens.map((token, index) =>
        token.type === "extension-source" ? (
          <ExtensionSourceChip
            key={`${token.extensionName}:${token.sourceId}:${index}`}
            sourceMentions={sourceMentions}
            token={token}
          />
        ) : token.type === "workspace-file" ? (
          <WorkspaceFileChip key={`${token.path}:${index}`} token={token} />
        ) : (
          <span key={`text:${index}`}>{token.text}</span>
        )
      )}
    </>
  )
}

export const ExtensionSourceTextViewer = ComposerReferenceTextViewer
export const parseExtensionSourceTextForViewer = parseComposerReferenceTextForViewer

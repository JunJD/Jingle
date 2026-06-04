import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { useI18n } from "@/lib/i18n"
import { listNativeExtensionSourceMentions } from "@extensions/source-mentions"
import type { ExtensionSourceMention } from "@shared/extension-sources"

const EXTENSION_SOURCE_MARKDOWN_PATTERN =
  /\[(@[^\]\n]+)\]\(openwork-extension-source:\/\/([^/\s)]+)\/([^)\s]+)\)/g

interface ExtensionSourceToken {
  extensionName: string
  label: string
  sourceId: string
  type: "extension-source"
}

interface TextToken {
  text: string
  type: "text"
}

type ViewerToken = ExtensionSourceToken | TextToken

function decodeUriSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function parseExtensionSourceTextForViewer(text: string): ViewerToken[] | null {
  const tokens: ViewerToken[] = []
  let lastIndex = 0
  let matched = false

  for (const match of text.matchAll(EXTENSION_SOURCE_MARKDOWN_PATTERN)) {
    const matchText = match[0]
    const matchIndex = match.index ?? 0
    const label = match[1] ?? ""
    const extensionName = decodeUriSegment(match[2] ?? "")
    const sourceId = decodeUriSegment(match[3] ?? "")

    if (!extensionName || !sourceId) {
      continue
    }

    if (matchIndex > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, matchIndex),
        type: "text"
      })
    }

    matched = true
    tokens.push({
      extensionName,
      label,
      sourceId,
      type: "extension-source"
    })
    lastIndex = matchIndex + matchText.length
  }

  if (!matched) {
    return null
  }

  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      type: "text"
    })
  }

  return tokens
}

function ExtensionSourceChip(props: {
  sourceMentions: ExtensionSourceMention[]
  token: ExtensionSourceToken
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

export function ExtensionSourceTextViewer(props: { text: string }): React.JSX.Element {
  const { text } = props
  const { locale } = useI18n()
  const sourceMentions = listNativeExtensionSourceMentions(
    window.electron.process.platform,
    locale
  )
  const tokens = parseExtensionSourceTextForViewer(text)

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
        ) : (
          <span key={`text:${index}`}>{token.text}</span>
        )
      )}
    </>
  )
}

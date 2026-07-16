import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { WorkspaceFileIcon } from "@/components/workspace-file-icon"
import { useI18n } from "@/lib/i18n"
import { useNativeSourceMentionsProjection } from "@extension-host/use-native-source-mentions-projection"
import {
  type ParsedExtensionSourceReference,
  type ParsedWorkspaceFileReference
} from "@shared/composer-reference-uri"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import {
  parseExtensionSourceTextForViewer as parseExtensionSourceTextForViewerModel,
  projectExtensionSourceChip,
  type ExtensionSourceToken
} from "./extension-source-text-viewer-model"

type WorkspaceFileOpenHandler = (path: string) => void

function getComposerReferenceTokenBaseKey(token: ExtensionSourceToken): string {
  if (token.type === "extension-source") {
    return `extension-source:${token.extensionName}:${token.sourceId}:${token.label}`
  }

  if (token.type === "workspace-file") {
    return `workspace-file:${token.path}:${token.label}`
  }

  return `text:${token.text}`
}

function getComposerReferenceTokenKey(
  token: ExtensionSourceToken,
  occurrenceByBaseKey: Map<string, number>
): string {
  const baseKey = getComposerReferenceTokenBaseKey(token)
  const occurrence = occurrenceByBaseKey.get(baseKey) ?? 0
  occurrenceByBaseKey.set(baseKey, occurrence + 1)
  return occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`
}

function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path
}

function ExtensionSourceChip(props: {
  sourceMentions: readonly ExtensionSourceMention[]
  token: ParsedExtensionSourceReference
}): React.JSX.Element {
  const { sourceMentions, token } = props
  const projection = projectExtensionSourceChip({ sourceMentions, token })

  return (
    <span
      className="inline-flex h-[20px] max-w-full items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[4px] align-top text-foreground"
      data-extension-source-status={projection.status}
      title={projection.title}
    >
      <ExtensionIcon
        className="size-[14px] shrink-0 text-muted-foreground"
        extensionName={projection.extensionName}
        icon={projection.icon}
        iconName={projection.iconName}
      />
      <span className="box-border block h-[20px] min-w-0 max-w-full truncate border-b border-border-emphasis [border-bottom-width:0.5px] [font-size:14px] font-semibold leading-[20px] tracking-normal">
        {projection.label}
      </span>
    </span>
  )
}

function WorkspaceFileChip(props: {
  onOpenWorkspaceFile?: WorkspaceFileOpenHandler
  token: ParsedWorkspaceFileReference
}): React.JSX.Element {
  const { onOpenWorkspaceFile, token } = props
  const className =
    "inline-flex h-[20px] max-w-full items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[4px] align-top text-foreground"
  const content = (
    <>
      <WorkspaceFileIcon
        className="size-[14px] shrink-0 text-muted-foreground"
        name={getWorkspaceFileName(token.path)}
      />
      <span className="box-border block h-[20px] min-w-0 max-w-full truncate border-b border-border-emphasis [border-bottom-width:0.5px] [font-size:14px] font-semibold leading-[20px] tracking-normal">
        {token.label}
      </span>
    </>
  )

  if (onOpenWorkspaceFile) {
    return (
      <button
        aria-label={token.path}
        className={`${className} cursor-pointer border-0 bg-transparent p-0 text-inherit hover:bg-background-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        onClick={() => onOpenWorkspaceFile(token.path)}
        title={token.path}
        type="button"
      >
        {content}
      </button>
    )
  }

  return (
    <span className={className} title={token.path}>
      {content}
    </span>
  )
}

export function ExtensionSourceTextViewer(props: {
  onOpenWorkspaceFile?: WorkspaceFileOpenHandler
  text: string
}): React.JSX.Element {
  const { onOpenWorkspaceFile, text } = props
  const { locale } = useI18n()
  const sourceMentions = useNativeSourceMentionsProjection(locale)
  const tokens = parseExtensionSourceTextForViewerModel(text)
  const tokenKeyOccurrences = new Map<string, number>()

  if (!tokens) {
    return <>{text}</>
  }

  return (
    <>
      {tokens.map((token) => {
        const key = getComposerReferenceTokenKey(token, tokenKeyOccurrences)
        return token.type === "extension-source" ? (
          <ExtensionSourceChip key={key} sourceMentions={sourceMentions} token={token} />
        ) : token.type === "workspace-file" ? (
          <WorkspaceFileChip key={key} onOpenWorkspaceFile={onOpenWorkspaceFile} token={token} />
        ) : (
          <span key={key}>{token.text}</span>
        )
      })}
    </>
  )
}

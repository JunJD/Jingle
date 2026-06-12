import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { WorkspaceFileIcon } from "@/components/workspace-file-icon"
import { useI18n } from "@/lib/i18n"
import { listNativeLauncherSourceMentions } from "@extension-host/index"
import {
  type ParsedExtensionSourceReference,
  type ParsedWorkspaceFileReference
} from "@shared/composer-reference-uri"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import {
  parseExtensionSourceTextForViewer as parseExtensionSourceTextForViewerModel
} from "./extension-source-text-viewer-model"

type WorkspaceFileOpenHandler = (path: string) => void

export const parseComposerReferenceTextForViewer = parseExtensionSourceTextForViewerModel

function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path
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

export function ComposerReferenceTextViewer(props: {
  onOpenWorkspaceFile?: WorkspaceFileOpenHandler
  text: string
}): React.JSX.Element {
  const { onOpenWorkspaceFile, text } = props
  const { locale } = useI18n()
  const sourceMentions = listNativeLauncherSourceMentions(
    window.electron.process.platform,
    locale
  )
  const tokens = parseExtensionSourceTextForViewerModel(text)

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
          <WorkspaceFileChip
            key={`${token.path}:${index}`}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
            token={token}
          />
        ) : (
          <span key={`text:${index}`}>{token.text}</span>
        )
      )}
    </>
  )
}

export const ExtensionSourceTextViewer = ComposerReferenceTextViewer
export const parseExtensionSourceTextForViewer = parseComposerReferenceTextForViewer

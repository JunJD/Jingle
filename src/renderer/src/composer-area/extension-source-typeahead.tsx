import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { $createTextNode, type TextNode } from "lexical"
import type { JSX } from "react"
import { useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { cn } from "@/lib/utils"
import { WorkspaceFileIcon } from "@/components/workspace-file-icon"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { $createExtensionSourceReferenceNode } from "./extension-source-node"
import { $createFileReferenceNode } from "./file-reference-node"
import type { ComposerWorkspaceFileMention } from "./types"

const COMPOSER_MENTION_TRIGGER_PATTERN = /(^|[\s([{"'])@([^\s@]{0,120})$/

class ExtensionSourceOption extends MenuOption {
  kind = "extension-source" as const
  mention: ExtensionSourceMention

  constructor(mention: ExtensionSourceMention) {
    super(`${mention.extensionName}:${mention.sourceId}`)
    this.mention = mention
  }
}

class WorkspaceFileOption extends MenuOption {
  kind = "workspace-file" as const
  file: ComposerWorkspaceFileMention

  constructor(file: ComposerWorkspaceFileMention) {
    super(`file:${file.path}`)
    this.file = file
  }
}

type ComposerMentionOption = ExtensionSourceOption | WorkspaceFileOption
type IndexedComposerMentionOption = {
  index: number
  option: ComposerMentionOption
}

const SECTION_LABEL_CLASS =
  "px-[var(--ow-space-1-5)] pb-[var(--ow-space-0-5)] pt-[var(--ow-space-1)] [font-size:var(--ow-font-caption)] font-semibold text-muted-foreground"

export function getExtensionSourceTriggerMatch(text: string): MenuTextMatch | null {
  const match = COMPOSER_MENTION_TRIGGER_PATTERN.exec(text)
  if (!match) {
    return null
  }

  const boundary = match[1] ?? ""
  const matchingString = match[2] ?? ""
  const replaceableString = `@${matchingString}`
  return {
    leadOffset: match.index + boundary.length,
    matchingString,
    replaceableString
  }
}

export const getComposerMentionTriggerMatch = getExtensionSourceTriggerMatch

function filterSourceMentionOptions(
  mentions: ExtensionSourceMention[],
  query: string | null
): ExtensionSourceOption[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? ""
  return mentions
    .filter((mention) => {
      if (!normalizedQuery) {
        return true
      }

      return (
        mention.value.toLowerCase().includes(normalizedQuery) ||
        mention.label.toLowerCase().includes(normalizedQuery)
      )
    })
    .slice(0, 8)
    .map((mention) => new ExtensionSourceOption(mention))
}

function filterWorkspaceFileOptions(
  files: ComposerWorkspaceFileMention[],
  query: string | null
): WorkspaceFileOption[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? ""
  if (!normalizedQuery) {
    return []
  }

  return files.slice(0, 8).map((file) => new WorkspaceFileOption(file))
}

function useMenuRenderFn(query: string | null): MenuRenderFn<ComposerMentionOption> {
  return useCallback((anchorElementRef, itemProps) => {
    const anchor = anchorElementRef.current
    if (!anchor || itemProps.options.length === 0) {
      return null
    }

    const normalizedQuery = query?.trim() ?? ""
    const indexedOptions: IndexedComposerMentionOption[] = itemProps.options.map(
      (option, index) => ({ index, option })
    )
    const pluginOptions = indexedOptions.filter(({ option }) => option.kind === "extension-source")
    const workspaceFileOptions = indexedOptions.filter(
      ({ option }) => option.kind === "workspace-file"
    )
    const showWorkspaceFileSearchHint =
      normalizedQuery.length === 0 && workspaceFileOptions.length === 0
    const showWorkspaceFileSection = workspaceFileOptions.length > 0 || showWorkspaceFileSearchHint

    const renderOption = ({ index, option }: IndexedComposerMentionOption): JSX.Element => {
      const selected = itemProps.selectedIndex === index
      return (
        <li
          key={option.key}
          ref={option.setRefElement}
          className={cn(
            "flex h-[36px] cursor-default select-none items-center gap-[var(--ow-space-1-5)] rounded-[var(--ow-radius-xs)] px-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] text-foreground outline-none transition-colors duration-100",
            selected ? "bg-background-secondary" : "hover:bg-background-secondary/72"
          )}
          onClick={() => {
            itemProps.setHighlightedIndex(index)
            itemProps.selectOptionAndCleanUp(option)
          }}
          onMouseEnter={() => itemProps.setHighlightedIndex(index)}
          role="option"
          aria-selected={selected}
        >
          {option.kind === "extension-source" ? (
            <>
              <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[var(--ow-radius-xs)] bg-background-tertiary text-muted-foreground">
                <ExtensionIcon
                  className="size-[16px]"
                  extensionName={option.mention.extensionName}
                  icon={option.mention.icon}
                  iconName={option.mention.iconName}
                />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">@{option.mention.value}</span>
            </>
          ) : (
            <>
              <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[var(--ow-radius-xs)] bg-background-tertiary text-muted-foreground">
                <WorkspaceFileIcon className="size-[16px]" name={option.file.name} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{option.file.name}</span>
                <span className="truncate [font-size:var(--ow-font-caption)] text-muted-foreground">
                  {option.file.path}
                </span>
              </span>
            </>
          )}
        </li>
      )
    }

    return createPortal(
      <div style={{ transform: "translateY(calc(-100% - 18px))" }}>
        <ul className="relative z-[9999] m-0 max-h-[320px] min-w-[320px] max-w-[520px] list-none overflow-y-auto rounded-[var(--ow-radius-sm)] border border-border bg-popover p-[var(--ow-space-0-5)] text-popover-foreground shadow-[0_10px_28px_rgba(15,23,42,0.14)] outline-none">
          {pluginOptions.length > 0 ? <li className={SECTION_LABEL_CLASS}>插件</li> : null}
          {pluginOptions.map(renderOption)}
          {showWorkspaceFileSection ? <li className={SECTION_LABEL_CLASS}>文件</li> : null}
          {workspaceFileOptions.map(renderOption)}
          {showWorkspaceFileSearchHint ? (
            <li
              className="flex h-[32px] cursor-default select-none items-center px-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] text-muted-foreground"
              role="presentation"
            >
              输入内容搜索文件
            </li>
          ) : null}
        </ul>
      </div>,
      anchor
    )
  }, [query])
}

export function ExtensionSourceTypeaheadPlugin(props: {
  onMenuClose?: () => void
  onMenuOpen?: () => void
  onQueryChange?: (query: string | null) => void
  sourceMentions: ExtensionSourceMention[]
  workspaceFileMentions?: ComposerWorkspaceFileMention[]
}): JSX.Element | null {
  const { onMenuClose, onMenuOpen, onQueryChange, sourceMentions, workspaceFileMentions = [] } =
    props
  const [query, setQuery] = useState<string | null>(null)
  const options = useMemo<ComposerMentionOption[]>(() => {
    return [
      ...filterSourceMentionOptions(sourceMentions, query),
      ...filterWorkspaceFileOptions(workspaceFileMentions, query)
    ]
  }, [query, sourceMentions, workspaceFileMentions])
  const menuRenderFn = useMenuRenderFn(query)
  const handleQueryChange = useCallback(
    (nextQuery: string | null): void => {
      setQuery(nextQuery)
      onQueryChange?.(nextQuery)
    },
    [onQueryChange]
  )
  const handleSelectOption = useCallback(
    (
      option: ComposerMentionOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void
    ): void => {
      if (!textNodeContainingQuery) {
        closeMenu()
        return
      }

      const referenceNode =
        option.kind === "extension-source"
          ? $createExtensionSourceReferenceNode({
              displayName: option.mention.label,
              extensionName: option.mention.extensionName,
              icon: option.mention.icon,
              label: `@${option.mention.value}`,
              sourceId: option.mention.sourceId
            })
          : $createFileReferenceNode({
              label: `@${option.file.path}`,
              name: option.file.name,
              path: option.file.path
            })
      const trailingSpace = $createTextNode(" ")

      textNodeContainingQuery.replace(referenceNode)
      referenceNode.insertAfter(trailingSpace)
      trailingSpace.selectEnd()
      closeMenu()
      onQueryChange?.(null)
    },
    [onQueryChange]
  )

  return (
    <LexicalTypeaheadMenuPlugin<ComposerMentionOption>
      anchorClassName="z-[9999]"
      ignoreEntityBoundary={false}
      menuRenderFn={menuRenderFn}
      onClose={onMenuClose}
      onOpen={onMenuOpen}
      onQueryChange={handleQueryChange}
      onSelectOption={handleSelectOption}
      options={options}
      preselectFirstItem={true}
      triggerFn={getExtensionSourceTriggerMatch}
    />
  )
}

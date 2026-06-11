import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { $createTextNode, type TextNode } from "lexical"
import type { JSX } from "react"
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react"
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
export type WorkspaceFileSearchMenuStatus =
  | "empty-query"
  | "no-results"
  | "search-disabled"
  | "search-incomplete"
  | "searching"

const SECTION_LABEL_CLASS =
  "px-[var(--ow-space-2)] pb-[var(--ow-space-0-5)] pt-[var(--ow-space-1-5)] [font-size:var(--ow-font-meta)] font-medium text-muted-foreground"
const MENTION_MENU_INPUT_GAP = 8
const MENTION_MENU_MAX_WIDTH = 560
const MENTION_MENU_VIEWPORT_MARGIN = 20

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

function getWorkspaceFileDirectory(file: ComposerWorkspaceFileMention): string {
  const slashIndex = file.path.lastIndexOf("/")
  return slashIndex > 0 ? file.path.slice(0, slashIndex) : ""
}

function getWorkspaceFileReferenceLabel(file: ComposerWorkspaceFileMention): string {
  return `@${file.name}`
}

export function getWorkspaceFileSearchMenuStatus(props: {
  query: string | null
  resultCount: number
  searchEnabled: boolean
  searchIncomplete: boolean
  searchInProgress: boolean
}): WorkspaceFileSearchMenuStatus | null {
  const normalizedQuery = props.query?.trim() ?? ""
  if (normalizedQuery.length === 0) {
    return "empty-query"
  }

  if (!props.searchEnabled) {
    return "search-disabled"
  }

  if (!props.searchInProgress && props.searchIncomplete) {
    return "search-incomplete"
  }

  if (props.resultCount > 0) {
    return null
  }

  return props.searchInProgress ? "searching" : "no-results"
}

function getWorkspaceFileSearchStatusLabel(status: WorkspaceFileSearchMenuStatus): string {
  switch (status) {
    case "empty-query":
      return "输入文件名或路径搜索"
    case "no-results":
      return "没有匹配的文件"
    case "search-disabled":
      return "当前没有工作区，无法搜索文件"
    case "search-incomplete":
      return "搜索范围较大，继续输入缩小结果"
    case "searching":
      return "正在搜索文件..."
  }
}

export function getComposerMentionMenuLayout(props: {
  anchorLeft: number
  anchorTop: number
  boundaryLeft: number | null
  boundaryTop: number | null
  boundaryWidth: number | null
  viewportHeight: number
  viewportWidth: number
}): { bottom: number; left: number; width: number } {
  const availableViewportWidth = Math.max(0, props.viewportWidth - MENTION_MENU_VIEWPORT_MARGIN * 2)
  const boundedWidth =
    props.boundaryWidth && props.boundaryWidth > 0
      ? Math.min(MENTION_MENU_MAX_WIDTH, props.boundaryWidth, availableViewportWidth)
      : Math.min(MENTION_MENU_MAX_WIDTH, availableViewportWidth)
  const preferredLeft = props.boundaryLeft ?? props.anchorLeft
  const preferredTop = props.boundaryTop ?? props.anchorTop
  const maxLeft = Math.max(
    MENTION_MENU_VIEWPORT_MARGIN,
    props.viewportWidth - MENTION_MENU_VIEWPORT_MARGIN - boundedWidth
  )
  const maxBottom = Math.max(MENTION_MENU_VIEWPORT_MARGIN, props.viewportHeight - MENTION_MENU_VIEWPORT_MARGIN)
  const left = Math.min(Math.max(preferredLeft, MENTION_MENU_VIEWPORT_MARGIN), maxLeft)
  const bottom = Math.min(
    Math.max(props.viewportHeight - preferredTop + MENTION_MENU_INPUT_GAP, MENTION_MENU_VIEWPORT_MARGIN),
    maxBottom
  )

  return {
    bottom: Math.round(bottom),
    left: Math.round(left),
    width: Math.round(boundedWidth)
  }
}

function useMenuRenderFn(
  menuBoundaryRef: RefObject<HTMLElement | null> | undefined,
  query: string | null,
  workspaceFileSearchEnabled: boolean,
  workspaceFileSearchIncomplete: boolean,
  workspaceFileSearchInProgress: boolean
): MenuRenderFn<ComposerMentionOption> {
  return useCallback(
    (anchorElementRef, itemProps) => {
      const anchor = anchorElementRef.current
      if (!anchor) {
        return null
      }

      const anchorRect = anchor.getBoundingClientRect()
      const boundaryRect = menuBoundaryRef?.current?.getBoundingClientRect() ?? null
      const menuLayout = getComposerMentionMenuLayout({
        anchorLeft: anchorRect.left,
        anchorTop: anchorRect.top,
        boundaryLeft: boundaryRect?.left ?? null,
        boundaryTop: boundaryRect?.top ?? null,
        boundaryWidth: boundaryRect?.width ?? null,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      })
      const indexedOptions: IndexedComposerMentionOption[] = itemProps.options.map(
        (option, index) => ({ index, option })
      )
      const pluginOptions = indexedOptions.filter(
        ({ option }) => option.kind === "extension-source"
      )
      const workspaceFileOptions = indexedOptions.filter(
        ({ option }) => option.kind === "workspace-file"
      )
      const workspaceFileSearchStatus = getWorkspaceFileSearchMenuStatus({
        query,
        resultCount: workspaceFileOptions.length,
        searchEnabled: workspaceFileSearchEnabled,
        searchIncomplete: workspaceFileSearchIncomplete,
        searchInProgress: workspaceFileSearchInProgress
      })
      const showWorkspaceFileSection =
        workspaceFileOptions.length > 0 || workspaceFileSearchStatus !== null
      const showSectionLabels = pluginOptions.length > 0 && showWorkspaceFileSection

      const renderOption = ({ index, option }: IndexedComposerMentionOption): JSX.Element => {
        const selected = itemProps.selectedIndex === index
        const isWorkspaceFile = option.kind === "workspace-file"
        return (
          <li
            key={option.key}
            ref={option.setRefElement}
            className={cn(
              "flex cursor-default select-none items-center gap-[var(--ow-space-1-5)] rounded-[var(--ow-radius-xs)] px-[var(--ow-space-2)] text-foreground outline-none transition-colors duration-100",
              isWorkspaceFile
                ? "h-[26px] [font-size:var(--ow-font-meta)]"
                : "h-[34px] [font-size:var(--ow-font-label)]",
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
              <WorkspaceFileOptionContent file={option.file} />
            )}
          </li>
        )
      }

      return createPortal(
        <div
          style={{
            bottom: `${menuLayout.bottom}px`,
            left: `${menuLayout.left}px`,
            position: "fixed",
            width: `${menuLayout.width}px`
          }}
        >
          <ul className="relative z-[9999] m-0 max-h-[320px] w-full list-none overflow-y-auto rounded-[var(--ow-radius-sm)] border border-border bg-popover p-[var(--ow-space-0-5)] text-popover-foreground shadow-[0_10px_28px_rgba(15,23,42,0.14)] outline-none">
            {pluginOptions.length > 0 && showSectionLabels ? (
              <li className={SECTION_LABEL_CLASS}>插件</li>
            ) : null}
            {pluginOptions.map(renderOption)}
            {showWorkspaceFileSection && showSectionLabels ? (
              <li className={SECTION_LABEL_CLASS}>文件</li>
            ) : null}
            {workspaceFileOptions.map(renderOption)}
            {workspaceFileSearchStatus ? (
              <li
                className="flex h-[32px] cursor-default select-none items-center px-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-muted-foreground"
                role="presentation"
              >
                {getWorkspaceFileSearchStatusLabel(workspaceFileSearchStatus)}
              </li>
            ) : null}
          </ul>
        </div>,
        document.body
      )
    },
    [
      menuBoundaryRef,
      query,
      workspaceFileSearchEnabled,
      workspaceFileSearchIncomplete,
      workspaceFileSearchInProgress
    ]
  )
}

export function ExtensionSourceTypeaheadPlugin(props: {
  menuBoundaryRef?: RefObject<HTMLElement | null>
  onMenuClose?: () => void
  onMenuOpen?: () => void
  onQueryChange?: (query: string | null) => void
  onSelectableOptionsChange?: (hasSelectableOptions: boolean) => void
  sourceMentions: ExtensionSourceMention[]
  workspaceFileMentions?: ComposerWorkspaceFileMention[]
  workspaceFileSearchEnabled?: boolean
  workspaceFileSearchIncomplete?: boolean
  workspaceFileSearchInProgress?: boolean
}): JSX.Element | null {
  const {
    menuBoundaryRef,
    onMenuClose,
    onMenuOpen,
    onQueryChange,
    onSelectableOptionsChange,
    sourceMentions,
    workspaceFileMentions = [],
    workspaceFileSearchEnabled = false,
    workspaceFileSearchIncomplete = false,
    workspaceFileSearchInProgress = false
  } = props
  const [query, setQuery] = useState<string | null>(null)
  const options = useMemo<ComposerMentionOption[]>(() => {
    return [
      ...filterSourceMentionOptions(sourceMentions, query),
      ...filterWorkspaceFileOptions(workspaceFileMentions, query)
    ]
  }, [query, sourceMentions, workspaceFileMentions])
  useEffect(() => {
    onSelectableOptionsChange?.(options.length > 0)
  }, [onSelectableOptionsChange, options.length])
  const menuRenderFn = useMenuRenderFn(
    menuBoundaryRef,
    query,
    workspaceFileSearchEnabled,
    workspaceFileSearchIncomplete,
    workspaceFileSearchInProgress
  )
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
              label: getWorkspaceFileReferenceLabel(option.file),
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

function WorkspaceFileOptionContent(props: { file: ComposerWorkspaceFileMention }): JSX.Element {
  const { file } = props
  const directory = getWorkspaceFileDirectory(file)

  return (
    <>
      <WorkspaceFileIcon className="mt-px" name={file.name} variant="badge" />
      <span className="flex w-full min-w-0 items-center gap-[var(--ow-space-1)]">
        <span
          className={cn(
            "truncate font-medium leading-[18px] text-foreground/82",
            directory ? "max-w-[62%] shrink truncate" : "min-w-0 flex-1"
          )}
        >
          {file.name}
        </span>
        {directory ? (
          <span className="min-w-0 flex-1 truncate leading-[18px] text-muted-foreground/72">
            {directory}
          </span>
        ) : null}
      </span>
    </>
  )
}

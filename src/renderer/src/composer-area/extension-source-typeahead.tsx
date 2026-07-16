import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { $createTextNode, type TextNode } from "lexical"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react"
import { createPortal } from "react-dom"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { WorkspaceFileIcon } from "@/components/workspace-file-icon"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { $createExtensionSourceReferenceNode } from "./extension-source-node"
import { $createFileReferenceNode } from "./file-reference-node"
import {
  getComposerMentionMenuLayout,
  getExtensionSourceTriggerMatch,
  getWorkspaceFileSearchMenuStatus,
  hasComposerMentionSelectableOptions,
  type WorkspaceFileSearchMenuStatus
} from "./extension-source-typeahead-model"
import type { ComposerWorkspaceFileMention } from "./types"

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
  "px-[var(--jingle-space-2)] pb-[var(--jingle-space-0-5)] pt-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-meta)] font-medium text-muted-foreground"

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

function getComposerMentionOptionCount(props: {
  query: string | null
  sourceMentions: ExtensionSourceMention[]
  workspaceFileMentions: ComposerWorkspaceFileMention[]
}): number {
  return (
    filterSourceMentionOptions(props.sourceMentions, props.query).length +
    filterWorkspaceFileOptions(props.workspaceFileMentions, props.query).length
  )
}

function getWorkspaceFileDirectory(file: ComposerWorkspaceFileMention): string {
  const slashIndex = file.path.lastIndexOf("/")
  return slashIndex > 0 ? file.path.slice(0, slashIndex) : ""
}

function getWorkspaceFileReferenceLabel(file: ComposerWorkspaceFileMention): string {
  return `@${file.name}`
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

      const renderOption = ({ index, option }: IndexedComposerMentionOption): ReactNode => {
        const selected = itemProps.selectedIndex === index
        const isWorkspaceFile = option.kind === "workspace-file"
        return (
          <li key={option.key}>
            <Button
              ref={option.setRefElement}
              className={cn(
                "flex w-full cursor-default select-none items-center gap-[var(--jingle-space-1-5)] rounded-[var(--jingle-radius-xs)] border-0 bg-transparent px-[var(--jingle-space-2)] text-left text-foreground outline-none",
                isWorkspaceFile
                  ? "h-[26px] [font-size:var(--jingle-font-meta)]"
                  : "h-[34px] [font-size:var(--jingle-font-label)]",
                selected ? "bg-background-secondary" : "hover:bg-background-secondary/72"
              )}
              onClick={() => {
                itemProps.setHighlightedIndex(index)
                itemProps.selectOptionAndCleanUp(option)
              }}
              onMouseEnter={() => itemProps.setHighlightedIndex(index)}
              tabIndex={-1}
              type="button"
              variant="ghost"
            >
              {option.kind === "extension-source" ? (
                <>
                  <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[var(--jingle-radius-xs)] bg-background-tertiary text-muted-foreground">
                    <ExtensionIcon
                      className="size-[16px]"
                      extensionName={option.mention.extensionName}
                      icon={option.mention.icon}
                      iconName={option.mention.iconName}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    @{option.mention.value}
                  </span>
                </>
              ) : (
                <WorkspaceFileOptionContent file={option.file} />
              )}
            </Button>
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
          <ul
            className="relative z-[9999] m-0 max-h-[320px] w-full list-none overflow-y-auto rounded-[var(--jingle-radius-sm)] border border-border bg-popover p-[var(--jingle-space-0-5)] text-popover-foreground shadow-[0_10px_28px_rgba(15,23,42,0.14)] outline-none"
            data-press-surface="instant"
          >
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
                className="flex h-[32px] cursor-default select-none items-center px-[var(--jingle-space-2)] [font-size:var(--jingle-font-meta)] text-muted-foreground"
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
}): ReactNode {
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
  const isMenuOpenRef = useRef(false)
  const options = useMemo<ComposerMentionOption[]>(() => {
    return [
      ...filterSourceMentionOptions(sourceMentions, query),
      ...filterWorkspaceFileOptions(workspaceFileMentions, query)
    ]
  }, [query, sourceMentions, workspaceFileMentions])
  const reportSelectableOptions = useCallback(
    (optionCount: number): void => {
      onSelectableOptionsChange?.(
        hasComposerMentionSelectableOptions({
          isMenuOpen: isMenuOpenRef.current,
          optionCount
        })
      )
    },
    [onSelectableOptionsChange]
  )
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
      reportSelectableOptions(
        getComposerMentionOptionCount({
          query: nextQuery,
          sourceMentions,
          workspaceFileMentions
        })
      )
      onQueryChange?.(nextQuery)
    },
    [onQueryChange, reportSelectableOptions, sourceMentions, workspaceFileMentions]
  )
  const handleMenuOpen = useCallback((): void => {
    isMenuOpenRef.current = true
    reportSelectableOptions(options.length)
    onMenuOpen?.()
  }, [onMenuOpen, options.length, reportSelectableOptions])
  const handleMenuClose = useCallback((): void => {
    isMenuOpenRef.current = false
    reportSelectableOptions(options.length)
    onMenuClose?.()
  }, [onMenuClose, options.length, reportSelectableOptions])
  useEffect(() => {
    reportSelectableOptions(options.length)
  }, [options.length, reportSelectableOptions])
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
      onClose={handleMenuClose}
      onOpen={handleMenuOpen}
      onQueryChange={handleQueryChange}
      onSelectOption={handleSelectOption}
      options={options}
      preselectFirstItem={true}
      triggerFn={getExtensionSourceTriggerMatch}
    />
  )
}

function WorkspaceFileOptionContent(props: { file: ComposerWorkspaceFileMention }): ReactNode {
  const { file } = props
  const directory = getWorkspaceFileDirectory(file)

  return (
    <>
      <WorkspaceFileIcon className="mt-px" name={file.name} variant="badge" />
      <span className="flex w-full min-w-0 items-center gap-[var(--jingle-space-1)]">
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

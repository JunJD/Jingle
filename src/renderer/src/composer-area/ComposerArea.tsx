import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { mergeRegister } from "@lexical/utils"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  ParagraphNode,
  type EditorState,
  type LexicalEditor
} from "lexical"
import {
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  useBeautifulMentions,
  type BeautifulMentionComponentProps,
  type BeautifulMentionsItem,
  type BeautifulMentionsMenuItemProps,
  type BeautifulMentionsMenuProps
} from "lexical-beautiful-mentions"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef
} from "react"
import { AtSign, FileText, Puzzle, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ComposerMessageRef } from "@shared/message-content"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import {
  areComposerRefsEqual,
  getComposerRefFromMention,
  type ComposerMentionData
} from "./mention-refs"
import type { ComposerAreaHandle, ComposerAreaProps } from "./types"

const COMPOSER_AREA_SYNC_TAG = "composer-area-sync"

function getComposerMentionIcon(kind?: string): typeof AtSign {
  if (kind === "extension") {
    return Puzzle
  }

  if (kind === "skill") {
    return Sparkles
  }

  if (kind === "file") {
    return FileText
  }

  return AtSign
}

function resolveCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}

function splitPlainTextLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/)
}

function writePlainTextToEditor(editor: LexicalEditor, value: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()

      for (const line of splitPlainTextLines(value)) {
        const paragraph = $createParagraphNode()
        if (line.length > 0) {
          paragraph.append($createTextNode(line))
        }
        root.append(paragraph)
      }

      root.selectEnd()
    },
    { tag: COMPOSER_AREA_SYNC_TAG }
  )
}

function getPlainTextFromEditorState(editorState: EditorState): string {
  return editorState.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getTextContent())
      .join("\n")
  )
}

function getComposerMentionItems(
  sourceMentions: ExtensionSourceMention[]
): Record<string, BeautifulMentionsItem[]> {
  return {
    "@": sourceMentions.map((mention) => ({
      extensionName: mention.extensionName,
      iconName: mention.iconName,
      id: mention.label,
      kind: "extension",
      sourceId: mention.sourceId,
      value: mention.value
    }))
  }
}

function ComposerMentionChip(props: BeautifulMentionComponentProps): React.JSX.Element {
  const { children, data, trigger, value, ...rest } = props
  const mentionData = data as Partial<ComposerMentionData> | undefined
  const Icon = getComposerMentionIcon(mentionData?.kind)

  return (
    <span
      {...rest}
      className={cn(
        "inline-flex h-[20px] max-w-full items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[4px] align-top leading-[20px] text-foreground",
        rest.className
      )}
      title={`${trigger}${value}`}
    >
      <Icon className="size-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="box-border block h-[20px] min-w-0 max-w-full truncate border-b border-border-emphasis [border-bottom-width:0.5px] [font-size:14px] font-semibold leading-[20px] tracking-normal">
        {value}
      </span>
    </span>
  )
}

function positionComposerMentionMenu(menu: HTMLUListElement): void {
  const anchor = menu.parentElement
  if (!anchor) {
    return
  }

  const viewportMargin = 8
  const menuGap = 8
  menu.style.maxHeight = ""
  menu.style.transform = ""
  menu.style.transformOrigin = "top left"

  const menuRect = menu.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const belowTop = anchorRect.bottom + menuGap
  const availableBelow = window.innerHeight - viewportMargin - belowTop
  const availableAbove = anchorRect.top - viewportMargin - menuGap

  if (availableBelow >= menuRect.height || availableBelow >= availableAbove) {
    if (menuRect.height > availableBelow) {
      menu.style.maxHeight = `${Math.max(34, availableBelow)}px`
    }

    const nextRect = menu.getBoundingClientRect()
    menu.style.transform = `translateY(${Math.floor(belowTop - nextRect.top)}px)`
    return
  }

  if (menuRect.height > availableAbove) {
    menu.style.maxHeight = `${Math.max(34, availableAbove)}px`
  }

  const nextRect = menu.getBoundingClientRect()
  const desiredTop = Math.max(viewportMargin, anchorRect.top - nextRect.height - menuGap)
  menu.style.transform = `translateY(${Math.floor(desiredTop - nextRect.top)}px)`
  menu.style.transformOrigin = "bottom left"
}

const ComposerMentionMenu = forwardRef<HTMLUListElement, BeautifulMentionsMenuProps>(
  function ComposerMentionMenu({ children, className, loading: _loading, ...props }, ref) {
    const menuRef = useRef<HTMLUListElement | null>(null)
    const updateMenuRef = useCallback(
      (node: HTMLUListElement | null) => {
        menuRef.current = node

        if (typeof ref === "function") {
          ref(node)
          return
        }

        if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    useLayoutEffect(() => {
      const menu = menuRef.current
      if (!menu) {
        return
      }

      positionComposerMentionMenu(menu)

      const frame = window.requestAnimationFrame(() => {
        positionComposerMentionMenu(menu)
      })
      const handleResize = () => {
        positionComposerMentionMenu(menu)
      }

      window.addEventListener("resize", handleResize)

      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener("resize", handleResize)
      }
    }, [children])

    return (
      <ul
        ref={updateMenuRef}
        className={cn(
          "relative z-[9999] m-0 min-w-[236px] max-w-[320px] list-none overflow-y-auto rounded-[var(--ow-radius-md)] border border-border bg-popover p-[var(--ow-space-1)] text-popover-foreground shadow-[0_14px_38px_rgba(15,23,42,0.16)] outline-none",
          className
        )}
        {...props}
      >
        {children}
      </ul>
    )
  }
)

const ComposerMentionMenuItem = forwardRef<HTMLLIElement, BeautifulMentionsMenuItemProps>(
  function ComposerMentionMenuItem(
    {
      children: _children,
      className,
      iconName: _iconName,
      id: _id,
      item,
      itemValue: _itemValue,
      kind: _kind,
      label: _label,
      selected,
      sourceId: _sourceId,
      ...props
    },
    ref
  ) {
    const mentionData = item.data as Partial<ComposerMentionData> | undefined
    const Icon = getComposerMentionIcon(mentionData?.kind)

    return (
      <li
        ref={ref}
        className={cn(
          "flex h-[34px] cursor-default select-none items-center gap-[var(--ow-space-2)] rounded-[var(--ow-radius-sm)] px-[var(--ow-space-2)] [font-size:var(--ow-font-control)] text-foreground outline-none transition-colors duration-100",
          selected ? "bg-background-secondary" : "hover:bg-background-secondary/72",
          className
        )}
        {...props}
      >
        <span className="flex size-[var(--ow-icon-md)] shrink-0 items-center justify-center rounded-[var(--ow-radius-xs)] bg-background-tertiary text-muted-foreground">
          <Icon className="size-[var(--ow-icon-xs)]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.trigger}
          {item.value}
        </span>
      </li>
    )
  }
)

const composerMentionNodes = createBeautifulMentionNode(ComposerMentionChip)

function ComposerAreaHandlePlugin(props: {
  disabled: boolean
  handleRef: React.Ref<ComposerAreaHandle>
  onRefsChange?: (refs: ComposerMessageRef[]) => void
  value: string
}): null {
  const { disabled, handleRef, onRefsChange, value } = props
  const [editor] = useLexicalComposerContext()
  const { getMentions } = useBeautifulMentions()
  const lastEditorValueRef = useRef(value)
  const lastRefsRef = useRef<ComposerMessageRef[]>([])
  const getRefs = useCallback(
    () =>
      getMentions()
        .map(getComposerRefFromMention)
        .filter((ref): ref is ComposerMessageRef => Boolean(ref)),
    [getMentions]
  )

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (!tags.has(COMPOSER_AREA_SYNC_TAG)) {
          lastEditorValueRef.current = getPlainTextFromEditorState(editorState)
        }

        const refs = getRefs()
        if (!areComposerRefsEqual(refs, lastRefsRef.current)) {
          lastRefsRef.current = refs
          onRefsChange?.(refs)
        }
      }),
    [editor, getRefs, onRefsChange]
  )

  useLayoutEffect(() => {
    if (value === lastEditorValueRef.current) {
      return
    }

    lastEditorValueRef.current = value
    writePlainTextToEditor(editor, value)
  }, [editor, value])

  useImperativeHandle(
    handleRef,
    () => ({
      blur: () => {
        editor.blur()
      },
      focus: () => {
        editor.focus()
      },
      getElement: () => editor.getRootElement(),
      getRefs,
      insertText: (text: string) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            selection.insertRawText(text)
            return
          }

          $getRoot().selectEnd()
          const endSelection = $getSelection()
          if ($isRangeSelection(endSelection)) {
            endSelection.insertRawText(text)
          }
        })
      }
    }),
    [editor, getRefs, handleRef]
  )

  return null
}

function ComposerAreaEnterPlugin(props: {
  mentionMenuOpenRef: React.RefObject<boolean>
  onSubmit?: () => void
  onUserKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
  submitOnEnter: boolean
}): null {
  const { mentionMenuOpenRef, onSubmit, onUserKeyDown, submitOnEnter } = props
  const [editor] = useLexicalComposerContext()
  const composingRef = useRef(false)

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) {
      return
    }

    const handleCompositionStart = (): void => {
      composingRef.current = true
    }
    const handleCompositionEnd = (): void => {
      composingRef.current = false
    }

    root.addEventListener("compositionstart", handleCompositionStart)
    root.addEventListener("compositionend", handleCompositionEnd)

    return () => {
      root.removeEventListener("compositionstart", handleCompositionStart)
      root.removeEventListener("compositionend", handleCompositionEnd)
    }
  }, [editor])

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand<KeyboardEvent>(
          KEY_ENTER_COMMAND,
          (event) => {
            if (!event) {
              return false
            }

            if (
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              composingRef.current ||
              event.isComposing === true ||
              event.keyCode === 229
            ) {
              onUserKeyDown?.(event as unknown as React.KeyboardEvent<HTMLElement>)
              return false
            }

            if (mentionMenuOpenRef.current) {
              event.preventDefault()
              return true
            }

            if (!submitOnEnter) {
              onUserKeyDown?.(event as unknown as React.KeyboardEvent<HTMLElement>)
              return false
            }

            event.preventDefault()
            onSubmit?.()
            return true
          },
          COMMAND_PRIORITY_LOW
        )
      ),
    [editor, mentionMenuOpenRef, onSubmit, onUserKeyDown, submitOnEnter]
  )

  return null
}

export const ComposerArea = forwardRef<ComposerAreaHandle, ComposerAreaProps>(function ComposerArea(
  {
    className,
    disabled = false,
    maxHeight,
    minHeight,
    onKeyDown,
    onRefsChange,
    onSubmit,
    onValueChange,
    placeholder,
    sourceMentions = [],
    submitOnEnter = true,
    value
  },
  ref
) {
  const mentionItems = useMemo(() => getComposerMentionItems(sourceMentions), [sourceMentions])
  const mentionMenuOpenRef = useRef(false)
  const handleMentionMenuOpen = useCallback(() => {
    mentionMenuOpenRef.current = true
  }, [])
  const handleMentionMenuClose = useCallback(() => {
    mentionMenuOpenRef.current = false
  }, [])
  const initialConfig = useMemo(
    () => ({
      editorState: (editor: LexicalEditor) => {
        writePlainTextToEditor(editor, value)
      },
      namespace: "OpenworkComposerArea",
      nodes: [ParagraphNode, ...composerMentionNodes],
      onError: (error: Error) => {
        throw error
      },
      theme: {
        paragraph: "m-0 min-h-[20px] leading-[20px]",
        text: {
          bold: "font-semibold"
        }
      }
    }),
    []
  )
  const rootStyle = useMemo(
    () => ({
      maxHeight: resolveCssSize(maxHeight),
      minHeight: resolveCssSize(minHeight)
    }),
    [maxHeight, minHeight]
  )
  const contentEditableClassName = cn(
    "w-full min-w-0 overflow-y-auto border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/58 focus:outline-none focus-visible:ring-0",
    "scrollbar-hide whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
    disabled && "cursor-not-allowed opacity-50",
    className,
    "leading-[20px]"
  )
  const handleValueChange = useCallback(
    (nextValue: string): void => {
      onValueChange?.(nextValue)
    },
    [onValueChange]
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative min-w-0 flex-1">
        <PlainTextPlugin
          contentEditable={
            placeholder ? (
              <ContentEditable
                aria-placeholder={placeholder}
                placeholder={
                  <div
                    className={cn(
                      "pointer-events-none absolute left-0 top-0 select-none text-muted-foreground/58",
                      className,
                      "leading-[20px]"
                    )}
                  >
                    {placeholder}
                  </div>
                }
                className={contentEditableClassName}
                spellCheck={true}
                style={rootStyle}
              />
            ) : (
              <ContentEditable
                className={contentEditableClassName}
                placeholder={null}
                spellCheck={true}
                style={rootStyle}
              />
            )
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin
          ignoreHistoryMergeTagChange={true}
          ignoreSelectionChange={true}
          onChange={(_, editor, tags) => {
            if (tags.has(COMPOSER_AREA_SYNC_TAG)) {
              return
            }
            handleValueChange(getPlainTextFromEditorState(editor.getEditorState()))
          }}
        />
        <BeautifulMentionsPlugin
          items={mentionItems}
          creatable={false}
          menuAnchorClassName="z-[9999]"
          menuComponent={ComposerMentionMenu}
          menuItemComponent={ComposerMentionMenuItem}
          menuItemLimit={8}
          onMenuClose={handleMentionMenuClose}
          onMenuItemSelect={handleMentionMenuClose}
          onMenuOpen={handleMentionMenuOpen}
          triggers={["@"]}
        />
        <ComposerAreaEnterPlugin
          mentionMenuOpenRef={mentionMenuOpenRef}
          onSubmit={onSubmit}
          onUserKeyDown={onKeyDown}
          submitOnEnter={submitOnEnter}
        />
        <ComposerAreaHandlePlugin
          disabled={disabled}
          handleRef={ref}
          onRefsChange={onRefsChange}
          value={value}
        />
      </div>
    </LexicalComposer>
  )
})

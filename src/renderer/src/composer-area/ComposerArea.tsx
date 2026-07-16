import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { mergeRegister } from "@lexical/utils"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_EDITOR,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
  ParagraphNode,
  type LexicalEditor
} from "lexical"
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef
} from "react"
import { cn } from "@/lib/utils"
import {
  getComposerRefsFromEditorState,
  getPlainTextFromEditorState,
  serializeComposerEditorStateForModel
} from "./extension-source-serialization"
import { parseComposerReferenceText } from "@shared/composer-reference-uri"
import {
  $createExtensionSourceReferenceNode,
  $isExtensionSourceReferenceNode,
  ExtensionSourceReferenceNode
} from "./extension-source-node"
import { ExtensionSourceTypeaheadPlugin } from "./extension-source-typeahead"
import {
  $createFileReferenceNode,
  $isFileReferenceNode,
  FileReferenceNode
} from "./file-reference-node"
import { ComposerReferenceTooltipPlugin } from "./reference-tooltip"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import type { ComposerAreaHandle, ComposerAreaProps } from "./types"

const COMPOSER_AREA_SYNC_TAG = "composer-area-sync"
const REFERENCE_NODE_SELECTED_CLASS = "jingle-composer-reference--selected"
const EMPTY_SOURCE_MENTIONS: ExtensionSourceMention[] = []
const EMPTY_WORKSPACE_FILE_MENTIONS: NonNullable<ComposerAreaProps["workspaceFileMentions"]> = []

function $isComposerReferenceNode(node: LexicalNode | null | undefined): boolean {
  return $isExtensionSourceReferenceNode(node) || $isFileReferenceNode(node)
}

function $isReferenceParentRTL(node: LexicalNode): boolean {
  const parent = node.getParent()
  return $isElementNode(parent) && parent.getDirection() === "rtl"
}

function getSourceMentionsKey(sourceMentions: readonly ExtensionSourceMention[]): string {
  return sourceMentions
    .map(
      (mention) =>
        `${mention.extensionName}:${mention.sourceId}:${mention.label}:${mention.icon ?? ""}`
    )
    .join("|")
}

function getSourceMentionMapKey(extensionName: string, sourceId: string): string {
  return `${extensionName}\0${sourceId}`
}

function createSourceMentionMap(
  sourceMentions: readonly ExtensionSourceMention[]
): Map<string, ExtensionSourceMention> {
  return new Map(
    sourceMentions.map((mention) => [
      getSourceMentionMapKey(mention.extensionName, mention.sourceId),
      mention
    ])
  )
}

function getExtensionSourceDisplayName(input: {
  sourceMention: ExtensionSourceMention | undefined
  tokenLabel: string
}): string {
  if (input.sourceMention) {
    return input.sourceMention.label
  }

  return input.tokenLabel
}

function hasExtensionSourceReferenceText(value: string): boolean {
  return (
    parseComposerReferenceText(value)?.references.some(
      (reference) => reference.type === "extension-source"
    ) ?? false
  )
}

function resolveCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}

function splitPlainTextLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/)
}

function appendComposerTextToParagraph(
  paragraph: ReturnType<typeof $createParagraphNode>,
  text: string,
  sourceMentionsByKey: ReadonlyMap<string, ExtensionSourceMention>
): void {
  const parsed = parseComposerReferenceText(text)
  if (!parsed) {
    if (text.length > 0) {
      paragraph.append($createTextNode(text))
    }
    return
  }

  for (const token of parsed.tokens) {
    if (token.type === "text") {
      if (token.text.length > 0) {
        paragraph.append($createTextNode(token.text))
      }
      continue
    }

    if (token.type === "extension-source") {
      const sourceMention = sourceMentionsByKey.get(
        getSourceMentionMapKey(token.extensionName, token.sourceId)
      )
      paragraph.append(
        $createExtensionSourceReferenceNode({
          displayName: getExtensionSourceDisplayName({
            sourceMention,
            tokenLabel: token.label
          }),
          extensionName: token.extensionName,
          icon: sourceMention?.icon,
          label: token.label,
          sourceId: token.sourceId
        })
      )
      continue
    }

    paragraph.append(
      $createFileReferenceNode({
        label: token.label,
        name: token.label.startsWith("@") ? token.label.slice(1) : token.label,
        path: token.path
      })
    )
  }
}

function writePlainTextToEditor(
  editor: LexicalEditor,
  value: string,
  sourceMentions: readonly ExtensionSourceMention[]
): void {
  const sourceMentionsByKey = createSourceMentionMap(sourceMentions)
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const lines = splitPlainTextLines(value)

      lines.forEach((line) => {
        const paragraph = $createParagraphNode()
        appendComposerTextToParagraph(paragraph, line, sourceMentionsByKey)
        root.append(paragraph)
      })

      root.selectEnd()
    },
    { tag: COMPOSER_AREA_SYNC_TAG }
  )
}

function ComposerAreaHandlePlugin(props: {
  disabled: boolean
  handleRef?: React.Ref<ComposerAreaHandle>
  sourceMentions: readonly ExtensionSourceMention[]
  value: string
}): null {
  const { disabled, handleRef, sourceMentions, value } = props
  const [editor] = useLexicalComposerContext()
  const lastEditorValueRef = useRef(value)
  const lastSourceMentionsKeyRef = useRef<string | null>(null)
  if (lastSourceMentionsKeyRef.current === null) {
    lastSourceMentionsKeyRef.current = getSourceMentionsKey(sourceMentions)
  }
  const getRefs = useCallback(
    () => getComposerRefsFromEditorState(editor.getEditorState()),
    [editor]
  )
  const getModelText = useCallback(
    () => serializeComposerEditorStateForModel(editor.getEditorState()),
    [editor]
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
      }),
    [editor]
  )

  useLayoutEffect(() => {
    const sourceMentionsKey = getSourceMentionsKey(sourceMentions)
    const valueChanged = value !== lastEditorValueRef.current
    const sourceMentionsChanged = sourceMentionsKey !== lastSourceMentionsKeyRef.current
    if (!valueChanged && (!sourceMentionsChanged || !hasExtensionSourceReferenceText(value))) {
      return
    }

    lastEditorValueRef.current = value
    lastSourceMentionsKeyRef.current = sourceMentionsKey
    writePlainTextToEditor(editor, value, sourceMentions)
  }, [editor, sourceMentions, value])

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
      getModelText,
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
    [editor, getModelText, getRefs]
  )

  return null
}

function ComposerAreaKeyboardPlugin(props: {
  mentionMenuHasSelectableOptionsRef: React.RefObject<boolean>
  onSubmit?: () => void
  onUserKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
}): null {
  const { mentionMenuHasSelectableOptionsRef, onSubmit, onUserKeyDown } = props
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

  const handleDeleteKey = useCallback(
    (event: KeyboardEvent): boolean => {
      const selection = $getSelection()
      if ($isNodeSelection(selection)) {
        const selectedNodes = selection.getNodes()
        if (
          selectedNodes.length > 0 &&
          selectedNodes.every((node) => $isComposerReferenceNode(node))
        ) {
          event.preventDefault()
          selection.deleteNodes()
          return true
        }
      }

      onUserKeyDown?.(event as unknown as React.KeyboardEvent<HTMLElement>)
      return event.defaultPrevented
    },
    [onUserKeyDown]
  )
  const handleArrowLeftKey = useCallback((event: KeyboardEvent): boolean => {
    const selection = $getSelection()
    if (!$isNodeSelection(selection)) {
      return false
    }

    const [node] = selection.getNodes()
    if (!$isComposerReferenceNode(node)) {
      return false
    }

    event.preventDefault()
    if ($isReferenceParentRTL(node)) {
      node.selectNext(0, 0)
    } else {
      node.selectPrevious()
    }
    return true
  }, [])
  const handleArrowRightKey = useCallback((event: KeyboardEvent): boolean => {
    const selection = $getSelection()
    if (!$isNodeSelection(selection)) {
      return false
    }

    const [node] = selection.getNodes()
    if (!$isComposerReferenceNode(node)) {
      return false
    }

    event.preventDefault()
    if ($isReferenceParentRTL(node)) {
      node.selectPrevious()
    } else {
      node.selectNext(0, 0)
    }
    return true
  }, [])

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand<KeyboardEvent>(
          KEY_ARROW_LEFT_COMMAND,
          handleArrowLeftKey,
          COMMAND_PRIORITY_EDITOR
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_ARROW_RIGHT_COMMAND,
          handleArrowRightKey,
          COMMAND_PRIORITY_EDITOR
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_BACKSPACE_COMMAND,
          handleDeleteKey,
          COMMAND_PRIORITY_BEFORE_EDITOR
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_DELETE_COMMAND,
          handleDeleteKey,
          COMMAND_PRIORITY_BEFORE_EDITOR
        ),
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
              return event.defaultPrevented
            }

            if (mentionMenuHasSelectableOptionsRef.current) {
              return false
            }

            event.preventDefault()
            onSubmit?.()
            return true
          },
          COMMAND_PRIORITY_BEFORE_EDITOR
        )
      ),
    [
      editor,
      handleArrowLeftKey,
      handleArrowRightKey,
      handleDeleteKey,
      mentionMenuHasSelectableOptionsRef,
      onSubmit,
      onUserKeyDown
    ]
  )

  return null
}

function ComposerAreaReferenceSelectionPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const selectedReferenceKeysRef = useRef<Set<string> | null>(null)
  if (selectedReferenceKeysRef.current === null) {
    selectedReferenceKeysRef.current = new Set()
  }

  const syncReferenceSelectionClass = useCallback((): void => {
    const previousKeys = selectedReferenceKeysRef.current ?? new Set<string>()
    const nextKeys = new Set<string>()

    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isNodeSelection(selection)) {
        return
      }

      for (const node of selection.getNodes()) {
        if ($isComposerReferenceNode(node)) {
          nextKeys.add(node.getKey())
        }
      }
    })

    for (const key of previousKeys) {
      if (!nextKeys.has(key)) {
        editor.getElementByKey(key)?.classList.remove(REFERENCE_NODE_SELECTED_CLASS)
      }
    }

    for (const key of nextKeys) {
      editor.getElementByKey(key)?.classList.add(REFERENCE_NODE_SELECTED_CLASS)
    }

    selectedReferenceKeysRef.current = nextKeys
  }, [editor])

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(syncReferenceSelectionClass),
        editor.registerMutationListener(ExtensionSourceReferenceNode, syncReferenceSelectionClass, {
          skipInitialization: false
        }),
        editor.registerMutationListener(FileReferenceNode, syncReferenceSelectionClass, {
          skipInitialization: false
        })
      ),
    [editor, syncReferenceSelectionClass]
  )

  return null
}

export function ComposerArea(props: ComposerAreaProps): React.JSX.Element {
  const {
    className,
    disabled = false,
    maxHeight,
    minHeight,
    onKeyDown,
    onMentionQueryChange,
    onSubmit,
    onValueChange,
    placeholder,
    ref,
    sourceMentions = EMPTY_SOURCE_MENTIONS,
    workspaceFileMentions = EMPTY_WORKSPACE_FILE_MENTIONS,
    workspaceFileSearchEnabled = false,
    workspaceFileSearchIncomplete = false,
    workspaceFileSearchInProgress = false,
    value
  } = props
  const mentionMenuHasSelectableOptionsRef = useRef(false)
  const menuBoundaryRef = useRef<HTMLDivElement | null>(null)
  const handleMentionMenuClose = useCallback(() => {
    mentionMenuHasSelectableOptionsRef.current = false
    onMentionQueryChange?.(null)
  }, [onMentionQueryChange])
  const handleMentionSelectableOptionsChange = useCallback((hasSelectableOptions: boolean) => {
    mentionMenuHasSelectableOptionsRef.current = hasSelectableOptions
  }, [])
  const handleMentionQueryChange = useCallback(
    (nextQuery: string | null): void => {
      onMentionQueryChange?.(nextQuery)
    },
    [onMentionQueryChange]
  )
  const initialConfig = useMemo(
    () => ({
      editorState: (editor: LexicalEditor) => {
        writePlainTextToEditor(editor, value, sourceMentions)
      },
      namespace: "JingleComposerArea",
      nodes: [ParagraphNode, ExtensionSourceReferenceNode, FileReferenceNode],
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
    [sourceMentions, value]
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
      <div ref={menuBoundaryRef} className="relative min-w-0 flex-1">
        <PlainTextPlugin
          contentEditable={
            placeholder ? (
              <ContentEditable
                aria-placeholder={placeholder}
                placeholder={
                  <div
                    className={cn(
                      "jingle-composer-placeholder pointer-events-none absolute left-0 top-0 select-none",
                      className,
                      "font-normal leading-[20px]"
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
        <ComposerAreaReferenceSelectionPlugin />
        <ComposerReferenceTooltipPlugin sourceMentions={sourceMentions} />
        <HistoryPlugin />
        <OnChangePlugin
          ignoreHistoryMergeTagChange={true}
          ignoreSelectionChange={true}
          onChange={(editorState, _editor, tags) => {
            if (tags.has(COMPOSER_AREA_SYNC_TAG)) {
              return
            }
            handleValueChange(getPlainTextFromEditorState(editorState))
          }}
        />
        <ExtensionSourceTypeaheadPlugin
          menuBoundaryRef={menuBoundaryRef}
          onMenuClose={handleMentionMenuClose}
          onSelectableOptionsChange={handleMentionSelectableOptionsChange}
          onQueryChange={handleMentionQueryChange}
          sourceMentions={sourceMentions}
          workspaceFileMentions={workspaceFileMentions}
          workspaceFileSearchEnabled={workspaceFileSearchEnabled}
          workspaceFileSearchIncomplete={workspaceFileSearchIncomplete}
          workspaceFileSearchInProgress={workspaceFileSearchInProgress}
        />
        <ComposerAreaKeyboardPlugin
          mentionMenuHasSelectableOptionsRef={mentionMenuHasSelectableOptionsRef}
          onSubmit={onSubmit}
          onUserKeyDown={onKeyDown}
        />
        <ComposerAreaHandlePlugin
          disabled={disabled}
          handleRef={ref}
          sourceMentions={sourceMentions}
          value={value}
        />
      </div>
    </LexicalComposer>
  )
}

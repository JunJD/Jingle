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
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  ParagraphNode,
  type LexicalEditor
} from "lexical"
import {
  forwardRef,
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
  ExtensionSourceReferenceNode
} from "./extension-source-node"
import { ExtensionSourceTypeaheadPlugin } from "./extension-source-typeahead"
import { $createFileReferenceNode, FileReferenceNode } from "./file-reference-node"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import type { ComposerAreaHandle, ComposerAreaProps } from "./types"

const COMPOSER_AREA_SYNC_TAG = "composer-area-sync"

function getSourceMentionsKey(sourceMentions: readonly ExtensionSourceMention[]): string {
  return sourceMentions
    .map(
      (mention) =>
        `${mention.extensionName}:${mention.sourceId}:${mention.label}:${mention.icon ?? ""}`
    )
    .join("|")
}

function hasExtensionSourceReferenceText(value: string): boolean {
  return parseComposerReferenceText(value)?.references.some(
    (reference) => reference.type === "extension-source"
  ) ?? false
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
  sourceMentions: readonly ExtensionSourceMention[]
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
      const sourceMention = sourceMentions.find(
        (mention) =>
          mention.extensionName === token.extensionName && mention.sourceId === token.sourceId
      )
      paragraph.append(
        $createExtensionSourceReferenceNode({
          displayName: sourceMention?.label ?? token.label,
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
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const lines = splitPlainTextLines(value)

      lines.forEach((line) => {
        const paragraph = $createParagraphNode()
        appendComposerTextToParagraph(paragraph, line, sourceMentions)
        root.append(paragraph)
      })

      root.selectEnd()
    },
    { tag: COMPOSER_AREA_SYNC_TAG }
  )
}

function ComposerAreaHandlePlugin(props: {
  disabled: boolean
  handleRef: React.Ref<ComposerAreaHandle>
  sourceMentions: readonly ExtensionSourceMention[]
  value: string
}): null {
  const { disabled, handleRef, sourceMentions, value } = props
  const [editor] = useLexicalComposerContext()
  const lastEditorValueRef = useRef(value)
  const lastSourceMentionsKeyRef = useRef(getSourceMentionsKey(sourceMentions))
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
    if (
      !valueChanged &&
      (!sourceMentionsChanged || !hasExtensionSourceReferenceText(value))
    ) {
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
    [editor, getModelText, getRefs, handleRef]
  )

  return null
}

function ComposerAreaKeyboardPlugin(props: {
  mentionMenuOpenRef: React.RefObject<boolean>
  onSubmit?: () => void
  onUserKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
}): null {
  const { mentionMenuOpenRef, onSubmit, onUserKeyDown } = props
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
      onUserKeyDown?.(event as unknown as React.KeyboardEvent<HTMLElement>)
      return event.defaultPrevented
    },
    [onUserKeyDown]
  )

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand<KeyboardEvent>(
          KEY_BACKSPACE_COMMAND,
          handleDeleteKey,
          COMMAND_PRIORITY_LOW
        ),
        editor.registerCommand<KeyboardEvent>(
          KEY_DELETE_COMMAND,
          handleDeleteKey,
          COMMAND_PRIORITY_LOW
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

            if (mentionMenuOpenRef.current) {
              return false
            }

            event.preventDefault()
            onSubmit?.()
            return true
          },
          COMMAND_PRIORITY_LOW
        )
      ),
    [editor, handleDeleteKey, mentionMenuOpenRef, onSubmit, onUserKeyDown]
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
    onMentionQueryChange,
    onSubmit,
    onValueChange,
    placeholder,
    sourceMentions = [],
    workspaceFileMentions = [],
    value
  },
  ref
) {
  const mentionMenuOpenRef = useRef(false)
  const handleMentionMenuOpen = useCallback(() => {
    mentionMenuOpenRef.current = true
  }, [])
  const handleMentionMenuClose = useCallback(() => {
    mentionMenuOpenRef.current = false
    onMentionQueryChange?.(null)
  }, [onMentionQueryChange])
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
      namespace: "OpenworkComposerArea",
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
                      "ow-composer-placeholder pointer-events-none absolute left-0 top-0 select-none",
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
          onMenuClose={handleMentionMenuClose}
          onMenuOpen={handleMentionMenuOpen}
          onQueryChange={handleMentionQueryChange}
          sourceMentions={sourceMentions}
          workspaceFileMentions={workspaceFileMentions}
        />
        <ComposerAreaKeyboardPlugin
          mentionMenuOpenRef={mentionMenuOpenRef}
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
})

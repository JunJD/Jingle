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
import { ExtensionSourceReferenceNode } from "./extension-source-node"
import { ExtensionSourceTypeaheadPlugin } from "./extension-source-typeahead"
import { FileReferenceNode } from "./file-reference-node"
import type { ComposerAreaHandle, ComposerAreaProps } from "./types"

const COMPOSER_AREA_SYNC_TAG = "composer-area-sync"

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

function ComposerAreaHandlePlugin(props: {
  disabled: boolean
  handleRef: React.Ref<ComposerAreaHandle>
  value: string
}): null {
  const { disabled, handleRef, value } = props
  const [editor] = useLexicalComposerContext()
  const lastEditorValueRef = useRef(value)
  const getRefs = useCallback(() => getComposerRefsFromEditorState(editor.getEditorState()), [editor])
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
        writePlainTextToEditor(editor, value)
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
          value={value}
        />
      </div>
    </LexicalComposer>
  )
})

import { Edit } from "lucide-react"
import { useCallback, useState } from "react"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  hasComposerMessageInputContent,
  type ComposerMessageInput
} from "@shared/message-content"
import type { Message as ThreadMessage } from "@/types"
import type { EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import { useI18n } from "@/lib/i18n"
import { formatTime } from "@/lib/utils"
import { Message, MessageAction, MessageActions, MessageContent, MessageToolbar } from "./message"
import { Button, CopyButton } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { AssistantSelectionReferencesFromMetadata } from "./AssistantSelectionReferences"
import { getAssistantSelectionRefs } from "./useAssistantSelectionRefs"
import { useThreadControl } from "@/lib/thread-context"
import { renderStructuredContent } from "./message-turn-content"

function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path
}

export function UserMessage(props: {
  editInput?: ComposerMessageInput | null
  message: ThreadMessage
  onSubmitEdit?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  threadId: string
}): React.JSX.Element | null {
  const { editInput, message, onSubmitEdit, threadId } = props
  const { copy, locale } = useI18n()
  const [editingInput, setEditingInput] = useState<ComposerMessageInput | null>(null)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const threadControl = useThreadControl(threadId)
  const handleOpenWorkspaceFile = useCallback(
    (path: string): void => {
      threadControl?.local.openFile(path, getWorkspaceFileName(path))
    },
    [threadControl]
  )
  const content = renderStructuredContent(message.content, {
    isUser: true,
    onOpenWorkspaceFile: handleOpenWorkspaceFile
  })
  const hasReferences =
    getAssistantSelectionRefs(extractComposerMessageRefsMetadata(message.metadata)).length > 0
  const canEdit = Boolean(editInput && onSubmitEdit)
  const isEditing = canEdit && editingInput !== null
  const editIsSubmittable = editingInput ? hasComposerMessageInputContent(editingInput) : false
  const copyText = extractMessageText(message.content)
  const canCopy = copyText.trim().length > 0
  const hasActions = canCopy || canEdit
  const createdAtLabel = formatTime(message.created_at, locale)

  const startEditing = useCallback((): void => {
    if (!editInput || !onSubmitEdit) {
      return
    }

    setEditingInput({
      refs: editInput.refs,
      text: editInput.text
    })
  }, [editInput, onSubmitEdit])
  const cancelEditing = useCallback((): void => {
    setEditingInput(null)
  }, [])
  const submitEdit = useCallback(async (): Promise<void> => {
    if (!canEdit || !editIsSubmittable || !editingInput || !onSubmitEdit || isSubmittingEdit) {
      return
    }

    setIsSubmittingEdit(true)
    try {
      const didSubmit = await onSubmitEdit({
        messageId: message.id,
        messageInput: editingInput
      })
      if (didSubmit) {
        setEditingInput(null)
      }
    } finally {
      setIsSubmittingEdit(false)
    }
  }, [canEdit, editIsSubmittable, editingInput, isSubmittingEdit, message.id, onSubmitEdit])

  if (
    !content.attachments &&
    !content.textContent &&
    !content.unrenderableContent &&
    !hasReferences
  ) {
    return null
  }

  if (isEditing) {
    return (
      <Message from="user">
        {hasReferences ? (
          <AssistantSelectionReferencesFromMetadata
            className="ml-auto justify-end"
            metadata={message.metadata}
          />
        ) : null}
        {content.attachments}
        <form
          className="ml-auto flex w-full max-w-full flex-col gap-[var(--jingle-space-3)] rounded-[var(--jingle-radius-md)] bg-secondary px-[var(--jingle-message-bubble-x)] py-[var(--jingle-message-bubble-y)] text-foreground"
          onSubmit={(event) => {
            event.preventDefault()
            void submitEdit()
          }}
        >
          <Textarea
            aria-label={copy.chat.editUserMessage}
            autoFocus
            className="min-h-[7rem] w-full resize-y bg-transparent [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground outline-none placeholder:text-muted-foreground"
            disabled={isSubmittingEdit}
            onChange={(event) => {
              const text = event.currentTarget.value
              setEditingInput((current) => (current ? { ...current, text } : current))
            }}
            value={editingInput.text}
          />
          <div className="flex items-center justify-end gap-[var(--jingle-gap-sm)]">
            <Button
              className="inline-flex h-[var(--jingle-control-h-md)] items-center justify-center rounded-[var(--jingle-radius-sm)] bg-background-elevated px-[var(--jingle-space-3)] [font-size:var(--jingle-font-meta)] text-muted-foreground transition hover:bg-background-interactive hover:text-foreground disabled:opacity-50"
              disabled={isSubmittingEdit}
              onClick={cancelEditing}
              type="button"
              variant="ghost"
            >
              {copy.chat.cancelEditMessage}
            </Button>
            <Button
              className="inline-flex h-[var(--jingle-control-h-md)] items-center justify-center rounded-[var(--jingle-radius-sm)] bg-primary px-[var(--jingle-space-3)] [font-size:var(--jingle-font-meta)] text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              disabled={!editIsSubmittable}
              loading={isSubmittingEdit}
              loadingLabel={copy.chat.sendEditedMessage}
              type="submit"
            >
              {copy.chat.sendEditedMessage}
            </Button>
          </div>
        </form>
      </Message>
    )
  }

  return (
    <Message from="user">
      {hasReferences ? (
        <AssistantSelectionReferencesFromMetadata
          className="ml-auto justify-end"
          metadata={message.metadata}
        />
      ) : null}
      {content.attachments}
      {content.unrenderableContent}
      {content.textContent ? (
        <MessageContent className="gap-[var(--jingle-space-2-5)]">
          {content.textContent}
        </MessageContent>
      ) : null}
      {hasActions ? (
        <MessageToolbar className="-mt-[var(--jingle-space-1)] ml-auto justify-end">
          <MessageActions className="h-[var(--jingle-control-h-compact)] rounded-[var(--jingle-radius-sm)] border border-transparent px-[var(--jingle-space-1)] text-muted-foreground">
            <span className="px-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] tabular-nums">
              {createdAtLabel}
            </span>
            {canCopy ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--jingle-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--jingle-icon-sm)]"
                  copiedLabel={copy.common.copied}
                  copyErrorLabel={copy.common.copyFailed}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--jingle-icon-sm)]"
                  text={copyText}
                />
              </MessageAction>
            ) : null}
            {canEdit ? (
              <MessageAction
                label={copy.chat.editUserMessage}
                onClick={startEditing}
                tooltip={copy.chat.editUserMessage}
              >
                <Edit className="size-[var(--jingle-icon-sm)]" />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </Message>
  )
}

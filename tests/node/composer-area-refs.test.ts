import assert from "node:assert/strict"
import test from "node:test"
import { checkForMentions } from "lexical-beautiful-mentions"
import { createEditor, type SerializedEditorState, type SerializedLexicalNode } from "lexical"
import { BeautifulMentionNode, type BeautifulMentionsItemData } from "lexical-beautiful-mentions"
import { getComposerRefFromMention } from "../../src/renderer/src/composer-area/mention-refs"
import type { ComposerMessageRef } from "../../src/shared/message-content"

const COMPOSER_AREA_SYNC_TAG = "composer-area-sync"
const composerMentionPunctuation = '\\.,\\*\\?\\$\\|#{}\\(\\)\\^\\[\\]\\\\/!%\'"~=<>_:;'

type MentionRecord = {
  data?: Record<string, BeautifulMentionsItemData>
  trigger: string
  value: string
}

type SerializedComposerNode = SerializedLexicalNode & {
  [key: string]: unknown
  children?: SerializedComposerNode[]
  data?: Record<string, BeautifulMentionsItemData>
  trigger?: string
  value?: string
}

const mentionEditorState = {
  root: {
    children: [
      {
        children: [
          {
            data: {
              extensionName: "apple-reminders",
              id: "Apple Reminders",
              kind: "extension",
              sourceId: "appleReminders"
            },
            trigger: "@",
            type: "beautifulMention",
            value: "apple-reminders",
            version: 1
          }
        ],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1
      }
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1
  }
} satisfies SerializedEditorState<SerializedComposerNode>

const plainEditorState = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "plain follow-up",
            type: "text",
            version: 1
          }
        ],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1
      }
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1
  }
} satisfies SerializedEditorState<SerializedComposerNode>

function createMentionEditor(): ReturnType<typeof createEditor> {
  return createEditor({
    namespace: "composer-area-refs-test",
    nodes: [BeautifulMentionNode],
    onError: (error) => {
      throw error
    }
  })
}

function refsFromSerializedMentions(mentions: MentionRecord[]): ComposerMessageRef[] {
  return mentions
    .map((mention) => getComposerRefFromMention(mention))
    .filter((ref): ref is ComposerMessageRef => Boolean(ref))
}

test("composer refs use source identity from mention metadata instead of display value", () => {
  assert.deepEqual(
    getComposerRefFromMention({
      data: {
        extensionName: "apple-reminders",
        id: "Apple Reminders",
        kind: "extension",
        sourceId: "appleReminders"
      },
      trigger: "@",
      value: "Apple Reminders"
    }),
    {
      extensionName: "apple-reminders",
      name: "Apple Reminders",
      sourceId: "appleReminders",
      type: "extension-source"
    }
  )
})

test("composer mention matcher accepts @ without a leading space", () => {
  const match = checkForMentions("foo@apple-reminders", ["@"], "\\S", composerMentionPunctuation, false)

  assert.deepEqual(match, {
    leadOffset: 3,
    matchingString: "apple-reminders",
    replaceableString: "@apple-reminders"
  })
})

test("composer refs are recalculated when a tagged controlled sync clears mention nodes", () => {
  const editor = createMentionEditor()
  const refsByUpdate: ComposerMessageRef[][] = []
  let lastRefs: ComposerMessageRef[] = []

  editor.registerUpdateListener(({ editorState }) => {
    const serialized = editorState.toJSON()
    const paragraph = serialized.root.children[0]
    const mentions =
      "children" in paragraph && Array.isArray(paragraph.children)
        ? paragraph.children
            .filter((node): node is MentionRecord & SerializedComposerNode => {
              return node.type === "beautifulMention"
            })
            .map((node) => ({
              data: node.data,
              trigger: node.trigger,
              value: node.value
            }))
        : []
    const refs = refsFromSerializedMentions(mentions)
    if (JSON.stringify(refs) !== JSON.stringify(lastRefs)) {
      lastRefs = refs
      refsByUpdate.push(refs)
    }
  })

  editor.setEditorState(editor.parseEditorState(mentionEditorState), {
    tag: "user-select-mention"
  })
  editor.setEditorState(editor.parseEditorState(plainEditorState), {
    tag: COMPOSER_AREA_SYNC_TAG
  })

  assert.deepEqual(refsByUpdate, [
    [
      {
        extensionName: "apple-reminders",
        name: "Apple Reminders",
        sourceId: "appleReminders",
        type: "extension-source"
      }
    ],
    []
  ])
})

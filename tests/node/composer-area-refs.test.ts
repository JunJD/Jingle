import assert from "node:assert/strict"
import test from "node:test"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  ParagraphNode,
  type SerializedEditorState,
  type SerializedParagraphNode,
  type SerializedTextNode
} from "lexical"
import { getExtensionSourceTriggerMatch } from "../../src/renderer/src/composer-area/extension-source-typeahead"
import {
  $createExtensionSourceReferenceNode,
  ExtensionSourceReferenceNode,
  type SerializedExtensionSourceReferenceNode
} from "../../src/renderer/src/composer-area/extension-source-node"
import {
  getComposerRefsFromEditorState,
  serializeComposerEditorStateForModel
} from "../../src/renderer/src/composer-area/extension-source-serialization"

type SerializedComposerNode = SerializedExtensionSourceReferenceNode | SerializedTextNode
type SerializedComposerParagraphNode = SerializedParagraphNode & {
  children: SerializedComposerNode[]
}
type SerializedComposerEditorState = SerializedEditorState<SerializedComposerParagraphNode>

const referenceEditorState = {
  root: {
    children: [
      {
        children: [
          {
            detail: 2,
            displayName: "Apple Reminders",
            extensionName: "apple-reminders",
            format: 0,
            label: "@apple-reminders",
            mode: "token",
            sourceId: "appleReminders",
            style: "",
            text: "@apple-reminders",
            type: "extension-source-reference",
            version: 1
          } satisfies SerializedExtensionSourceReferenceNode
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
} satisfies SerializedComposerEditorState

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
          } satisfies SerializedTextNode
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
} satisfies SerializedComposerEditorState

function createComposerEditor(): ReturnType<typeof createEditor> {
  return createEditor({
    namespace: "composer-area-refs-test",
    nodes: [ParagraphNode, ExtensionSourceReferenceNode],
    onError: (error) => {
      throw error
    }
  })
}

test("extension source reference node serializes refs and model markdown from editor state", () => {
  const editor = createComposerEditor()

  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      paragraph.append(
        $createTextNode("Use "),
        $createExtensionSourceReferenceNode({
          displayName: "Apple Reminders",
          extensionName: "apple-reminders",
          label: "@apple-reminders",
          sourceId: "appleReminders"
        }),
        $createTextNode(" today")
      )
      root.append(paragraph)
    },
    { discrete: true }
  )

  assert.deepEqual(getComposerRefsFromEditorState(editor.getEditorState()), [
    {
      extensionName: "apple-reminders",
      name: "Apple Reminders",
      sourceId: "appleReminders",
      type: "extension-source"
    }
  ])
  assert.equal(
    serializeComposerEditorStateForModel(editor.getEditorState()),
    "Use [@apple-reminders](openwork-extension-source://apple-reminders/appleReminders) today"
  )
})

test("extension source reference node removal clears refs and model markdown", () => {
  const editor = createComposerEditor()

  editor.setEditorState(editor.parseEditorState(referenceEditorState), {
    tag: "user-select-reference"
  })
  editor.update(
    () => {
      const root = $getRoot()
      const paragraph = root.getFirstChild()
      if (!$isElementNode(paragraph)) {
        return
      }

      paragraph.getFirstChild()?.remove()
    },
    { discrete: true }
  )

  assert.deepEqual(getComposerRefsFromEditorState(editor.getEditorState()), [])
  assert.equal(serializeComposerEditorStateForModel(editor.getEditorState()), "")
})

test("composer refs are recalculated when controlled sync clears reference nodes", () => {
  const editor = createComposerEditor()
  const refsByUpdate: ReturnType<typeof getComposerRefsFromEditorState>[] = []
  let lastRefs: ReturnType<typeof getComposerRefsFromEditorState> = []

  editor.registerUpdateListener(({ editorState }) => {
    const refs = getComposerRefsFromEditorState(editorState)
    if (JSON.stringify(refs) !== JSON.stringify(lastRefs)) {
      lastRefs = refs
      refsByUpdate.push(refs)
    }
  })

  editor.setEditorState(editor.parseEditorState(referenceEditorState), {
    tag: "user-select-reference"
  })
  editor.setEditorState(editor.parseEditorState(plainEditorState), {
    tag: "composer-area-sync"
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

test("extension source typeahead opens only for standalone @ queries", () => {
  assert.deepEqual(getExtensionSourceTriggerMatch("@apple"), {
    leadOffset: 0,
    matchingString: "apple",
    replaceableString: "@apple"
  })
  assert.deepEqual(getExtensionSourceTriggerMatch("use @apple"), {
    leadOffset: 4,
    matchingString: "apple",
    replaceableString: "@apple"
  })
  assert.equal(getExtensionSourceTriggerMatch("hello@example.com"), null)
})

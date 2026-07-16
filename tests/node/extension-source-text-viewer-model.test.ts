import assert from "node:assert/strict"
import test from "node:test"
import type { ParsedExtensionSourceReference } from "../../src/shared/composer-reference-uri"
import type { ExtensionSourceMention } from "../../src/shared/extension-sources"
import {
  parseExtensionSourceTextForViewer,
  projectExtensionSourceChip
} from "../../src/renderer/src/components/chat/extension-source-text-viewer-model"

const token: ParsedExtensionSourceReference = {
  extensionName: "github",
  label: "@issues",
  sourceId: "issues",
  type: "extension-source"
}

const mention: ExtensionSourceMention = {
  extensionName: "github",
  icon: "github",
  label: "GitHub issues",
  sourceId: "issues",
  tools: [],
  value: "issues"
}

test("extension source chip projects registered source presentation", () => {
  assert.deepEqual(projectExtensionSourceChip({ sourceMentions: [mention], token }), {
    extensionName: "github",
    icon: "github",
    iconName: undefined,
    label: "@issues",
    status: "ready",
    title: "GitHub issues"
  })
})

test("extension source chip preserves captured label when source is unavailable", () => {
  assert.deepEqual(projectExtensionSourceChip({ sourceMentions: [], token }), {
    extensionName: "github",
    label: "@issues",
    status: "unavailable",
    title: "@issues"
  })
})

test("extension source viewer parser keeps typed extension reference facts", () => {
  const encoded = "[@issues](jingle-extension-source://github/issues)"
  assert.deepEqual(parseExtensionSourceTextForViewer(encoded), [token])
})

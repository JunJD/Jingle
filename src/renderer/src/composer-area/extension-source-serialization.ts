import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type LexicalNode
} from "lexical"
import type { ComposerMessageRef } from "@shared/message-content"
import { $isExtensionSourceReferenceNode } from "./extension-source-node"
import { $isFileReferenceNode } from "./file-reference-node"

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")
}

function escapeMarkdownUri(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\)/g, "\\)")
}

function serializeNodeForModel(node: LexicalNode): string {
  if ($isExtensionSourceReferenceNode(node)) {
    return `[${escapeMarkdownLabel(node.getLabel())}](${escapeMarkdownUri(node.getUri())})`
  }

  if ($isFileReferenceNode(node)) {
    return `[${escapeMarkdownLabel(node.getLabel())}](${escapeMarkdownUri(node.getUri())})`
  }

  if ($isElementNode(node)) {
    return node.getChildren().map(serializeNodeForModel).join("")
  }

  return node.getTextContent()
}

function collectComposerRefs(node: LexicalNode, refs: ComposerMessageRef[]): void {
  if ($isExtensionSourceReferenceNode(node)) {
    refs.push({
      extensionName: node.getExtensionName(),
      name: node.getDisplayName(),
      sourceId: node.getSourceId(),
      type: "extension-source"
    })
    return
  }

  if ($isFileReferenceNode(node)) {
    refs.push({
      name: node.getName(),
      path: node.getPath(),
      type: "file"
    })
    return
  }

  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      collectComposerRefs(child, refs)
    }
  }
}

export function getPlainTextFromEditorState(editorState: EditorState): string {
  return editorState.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getTextContent())
      .join("\n")
  )
}

export function serializeComposerEditorStateForModel(editorState: EditorState): string {
  return editorState.read(() =>
    $getRoot()
      .getChildren()
      .map(serializeNodeForModel)
      .join("\n")
  )
}

export function getComposerRefsFromEditorState(editorState: EditorState): ComposerMessageRef[] {
  return editorState.read(() => {
    const refs: ComposerMessageRef[] = []
    for (const child of $getRoot().getChildren()) {
      collectComposerRefs(child, refs)
    }
    return refs
  })
}

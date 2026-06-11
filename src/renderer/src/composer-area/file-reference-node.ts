import { addClassNamesToElement } from "@lexical/utils"
import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
  type Spread
} from "lexical"
import {
  createWorkspaceFileReferenceUri,
  WORKSPACE_FILE_REFERENCE_SCHEME
} from "@shared/composer-reference-uri"
import { getWorkspaceFileIconBadge } from "@/components/workspace-file-icon"

export const FILE_REFERENCE_NODE_TYPE = "file-reference"
export const FILE_REFERENCE_SCHEME = WORKSPACE_FILE_REFERENCE_SCHEME

export type FileReferencePayload = {
  label: string
  name: string
  path: string
}

export type SerializedFileReferenceNode = Spread<
  FileReferencePayload & {
    type: typeof FILE_REFERENCE_NODE_TYPE
    version: 1
  },
  SerializedTextNode
>

function normalizeReferenceLabel(label: string): string {
  const trimmed = label.trim()
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`
}

export function createFileReferenceUri(path: string): string {
  return createWorkspaceFileReferenceUri(path)
}

export class FileReferenceNode extends TextNode {
  __label: string
  __name: string
  __path: string

  static getType(): string {
    return FILE_REFERENCE_NODE_TYPE
  }

  static clone(node: FileReferenceNode): FileReferenceNode {
    return new FileReferenceNode(
      {
        label: node.__label,
        name: node.__name,
        path: node.__path
      },
      node.__key
    )
  }

  static importJSON(serializedNode: SerializedFileReferenceNode): FileReferenceNode {
    return $createFileReferenceNode({
      label: serializedNode.label,
      name: serializedNode.name,
      path: serializedNode.path
    }).updateFromJSON(serializedNode)
  }

  constructor(payload: FileReferencePayload, key?: NodeKey) {
    const label = normalizeReferenceLabel(payload.label)
    super(label, key)
    this.__label = label
    this.__name = payload.name
    this.__path = payload.path
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    addClassNamesToElement(
      element,
      "inline-flex",
      "h-[20px]",
      "max-w-full",
      "items-center",
      "ow-file-reference",
      "whitespace-nowrap",
      "rounded-[4px]",
      "px-[2px]",
      "align-top",
      "font-semibold",
      "leading-[20px]",
      "text-foreground"
    )
    element.dataset.filePath = this.__path
    syncFileIconDom(element, this.__name)
    element.title = this.__path
    return element
  }

  updateDOM(prevNode: FileReferenceNode, dom: HTMLElement, config: EditorConfig): boolean {
    super.updateDOM(prevNode as this, dom, config)

    if (prevNode.__path !== this.__path) {
      dom.dataset.filePath = this.__path
      dom.title = this.__path
    }

    if (prevNode.__name !== this.__name) {
      syncFileIconDom(dom, this.__name)
    }

    return false
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedFileReferenceNode>): this {
    const next = super.updateFromJSON(serializedNode)
    next.__label = normalizeReferenceLabel(serializedNode.label)
    next.__name = serializedNode.name
    next.__path = serializedNode.path
    next.__text = next.__label
    return next
  }

  exportJSON(): SerializedFileReferenceNode {
    return {
      ...super.exportJSON(),
      label: this.getLabel(),
      name: this.getName(),
      path: this.getPath(),
      type: FILE_REFERENCE_NODE_TYPE,
      version: 1
    }
  }

  canHaveFormat(): boolean {
    return false
  }

  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }

  isTextEntity(): boolean {
    return true
  }

  getLabel(): string {
    return this.getLatest().__label
  }

  getName(): string {
    return this.getLatest().__name
  }

  getPath(): string {
    return this.getLatest().__path
  }

  getUri(): string {
    return createFileReferenceUri(this.getPath())
  }
}

function syncFileIconDom(element: HTMLElement, name: string): void {
  const badge = getWorkspaceFileIconBadge(name)
  element.classList.add("ow-file-reference--with-icon")
  element.dataset.fileIconKind = badge.kind
  element.dataset.fileIconLabel = badge.label
}

export function $createFileReferenceNode(payload: FileReferencePayload): FileReferenceNode {
  return $applyNodeReplacement(new FileReferenceNode(payload)).setMode("token").toggleUnmergeable()
}

export function $isFileReferenceNode(
  node: LexicalNode | null | undefined
): node is FileReferenceNode {
  return node instanceof FileReferenceNode
}

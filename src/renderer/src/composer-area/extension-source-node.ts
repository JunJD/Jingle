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
import { getExtensionIconAssetSrc } from "@/extensions/extension-icon-assets"

export const EXTENSION_SOURCE_REFERENCE_NODE_TYPE = "extension-source-reference"
export const EXTENSION_SOURCE_REFERENCE_SCHEME = "openwork-extension-source"

export type ExtensionSourceReferencePayload = {
  displayName: string
  extensionName: string
  icon?: string
  label: string
  sourceId: string
}

export type SerializedExtensionSourceReferenceNode = Spread<
  ExtensionSourceReferencePayload & {
    type: typeof EXTENSION_SOURCE_REFERENCE_NODE_TYPE
    version: 1
  },
  SerializedTextNode
>

function normalizeReferenceLabel(label: string): string {
  const trimmed = label.trim()
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`
}

function encodeUriSegment(value: string): string {
  return encodeURIComponent(value)
}

export function createExtensionSourceReferenceUri(
  extensionName: string,
  sourceId: string
): string {
  return `${EXTENSION_SOURCE_REFERENCE_SCHEME}://${encodeUriSegment(extensionName)}/${encodeUriSegment(sourceId)}`
}

export class ExtensionSourceReferenceNode extends TextNode {
  __displayName: string
  __extensionName: string
  __icon?: string
  __label: string
  __sourceId: string

  static getType(): string {
    return EXTENSION_SOURCE_REFERENCE_NODE_TYPE
  }

  static clone(node: ExtensionSourceReferenceNode): ExtensionSourceReferenceNode {
    return new ExtensionSourceReferenceNode(
      {
        displayName: node.__displayName,
        extensionName: node.__extensionName,
        icon: node.__icon,
        label: node.__label,
        sourceId: node.__sourceId
      },
      node.__key
    )
  }

  static importJSON(
    serializedNode: SerializedExtensionSourceReferenceNode
  ): ExtensionSourceReferenceNode {
    return $createExtensionSourceReferenceNode({
      displayName: serializedNode.displayName,
      extensionName: serializedNode.extensionName,
      icon: serializedNode.icon,
      label: serializedNode.label,
      sourceId: serializedNode.sourceId
    }).updateFromJSON(serializedNode)
  }

  constructor(payload: ExtensionSourceReferencePayload, key?: NodeKey) {
    const label = normalizeReferenceLabel(payload.label)
    super(label, key)
    this.__displayName = payload.displayName
    this.__extensionName = payload.extensionName
    this.__icon = payload.icon
    this.__label = label
    this.__sourceId = payload.sourceId
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    addClassNamesToElement(
      element,
      "inline-flex",
      "h-[20px]",
      "max-w-full",
      "items-center",
      "ow-extension-source-reference",
      "whitespace-nowrap",
      "rounded-[4px]",
      "px-[4px]",
      "align-top",
      "font-semibold",
      "leading-[20px]",
      "text-foreground",
      "border-b",
      "border-border-emphasis",
      "[border-bottom-width:0.5px]"
    )
    element.dataset.extensionName = this.__extensionName
    element.dataset.sourceId = this.__sourceId
    syncIconDom(element, this.__extensionName, this.__icon)
    element.title = this.__displayName
    return element
  }

  updateDOM(
    prevNode: ExtensionSourceReferenceNode,
    dom: HTMLElement,
    config: EditorConfig
  ): boolean {
    super.updateDOM(prevNode as this, dom, config)

    if (prevNode.__extensionName !== this.__extensionName) {
      dom.dataset.extensionName = this.__extensionName
    }

    if (prevNode.__extensionName !== this.__extensionName || prevNode.__icon !== this.__icon) {
      syncIconDom(dom, this.__extensionName, this.__icon)
    }

    if (prevNode.__sourceId !== this.__sourceId) {
      dom.dataset.sourceId = this.__sourceId
    }

    if (prevNode.__displayName !== this.__displayName) {
      dom.title = this.__displayName
    }

    return false
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedExtensionSourceReferenceNode>): this {
    const next = super.updateFromJSON(serializedNode)
    next.__displayName = serializedNode.displayName
    next.__extensionName = serializedNode.extensionName
    next.__icon = serializedNode.icon
    next.__label = normalizeReferenceLabel(serializedNode.label)
    next.__sourceId = serializedNode.sourceId
    next.__text = next.__label
    return next
  }

  exportJSON(): SerializedExtensionSourceReferenceNode {
    return {
      ...super.exportJSON(),
      displayName: this.getDisplayName(),
      extensionName: this.getExtensionName(),
      icon: this.getIcon(),
      label: this.getLabel(),
      sourceId: this.getSourceId(),
      type: EXTENSION_SOURCE_REFERENCE_NODE_TYPE,
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

  getDisplayName(): string {
    return this.getLatest().__displayName
  }

  getExtensionName(): string {
    return this.getLatest().__extensionName
  }

  getLabel(): string {
    return this.getLatest().__label
  }

  getIcon(): string | undefined {
    return this.getLatest().__icon
  }

  getSourceId(): string {
    return this.getLatest().__sourceId
  }

  getUri(): string {
    return createExtensionSourceReferenceUri(this.getExtensionName(), this.getSourceId())
  }
}

function syncIconDom(element: HTMLElement, extensionName: string, icon: string | undefined): void {
  const iconSrc = getExtensionIconAssetSrc({ extensionName, icon })
  if (!iconSrc) {
    element.classList.remove("ow-extension-source-reference--with-icon")
    element.style.removeProperty("--ow-extension-source-icon-url")
    return
  }

  element.classList.add("ow-extension-source-reference--with-icon")
  element.style.setProperty("--ow-extension-source-icon-url", `url("${iconSrc}")`)
}

export function $createExtensionSourceReferenceNode(
  payload: ExtensionSourceReferencePayload
): ExtensionSourceReferenceNode {
  return $applyNodeReplacement(new ExtensionSourceReferenceNode(payload))
    .setMode("token")
    .toggleUnmergeable()
}

export function $isExtensionSourceReferenceNode(
  node: LexicalNode | null | undefined
): node is ExtensionSourceReferenceNode {
  return node instanceof ExtensionSourceReferenceNode
}

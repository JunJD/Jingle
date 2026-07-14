import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import type { ExtensionSourceMention } from "@shared/extension-sources"

const FILE_REFERENCE_SELECTOR = ".jingle-file-reference[data-file-path]"
const EXTENSION_SOURCE_SELECTOR =
  ".jingle-extension-source-reference[data-extension-name][data-source-id]"
const REFERENCE_TOOLTIP_MARGIN = 12
const FILE_TOOLTIP_MAX_WIDTH = 420
const EXTENSION_TOOLTIP_MAX_WIDTH = 360
const EXTENSION_TOOLTIP_MAX_VISIBLE_TOOLS = 6

type ReferenceTooltipState =
  | {
      kind: "file"
      left: number
      path: string
      placement: "above" | "below"
      top: number
    }
  | {
      kind: "extension-source"
      left: number
      mention: ExtensionSourceMention
      placement: "above" | "below"
      top: number
    }

function getExtensionSourceMentionKey(extensionName: string, sourceId: string): string {
  return `${extensionName}:${sourceId}`
}

function getReferenceElement(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null
  }

  const element = target.closest<HTMLElement>(
    `${FILE_REFERENCE_SELECTOR}, ${EXTENSION_SOURCE_SELECTOR}`
  )
  if (!element || !root.contains(element)) {
    return null
  }

  return element
}

function getBoundedLeft(rect: DOMRect, maxWidth: number): number {
  const maxLeft = Math.max(
    REFERENCE_TOOLTIP_MARGIN,
    window.innerWidth - maxWidth - REFERENCE_TOOLTIP_MARGIN
  )
  return Math.min(Math.max(rect.left, REFERENCE_TOOLTIP_MARGIN), maxLeft)
}

function getFileReferenceTooltipState(element: HTMLElement): ReferenceTooltipState | null {
  const path = element.dataset.filePath
  if (!path) {
    return null
  }

  const rect = element.getBoundingClientRect()
  const placement = rect.top >= 48 ? "above" : "below"
  return {
    kind: "file",
    left: getBoundedLeft(rect, FILE_TOOLTIP_MAX_WIDTH),
    path,
    placement,
    top: placement === "above" ? rect.top - 6 : rect.bottom + 6
  }
}

function getExtensionSourceTooltipState(
  element: HTMLElement,
  sourceMentionsByKey: ReadonlyMap<string, ExtensionSourceMention>
): ReferenceTooltipState | null {
  const { extensionName, sourceId } = element.dataset
  if (!extensionName || !sourceId) {
    return null
  }

  const mention = sourceMentionsByKey.get(getExtensionSourceMentionKey(extensionName, sourceId))
  if (!mention || mention.tools.length === 0) {
    return null
  }

  const rect = element.getBoundingClientRect()
  const placement = rect.top >= 92 ? "above" : "below"
  return {
    kind: "extension-source",
    left: getBoundedLeft(rect, EXTENSION_TOOLTIP_MAX_WIDTH),
    mention,
    placement,
    top: placement === "above" ? rect.top - 6 : rect.bottom + 6
  }
}

function getReferenceTooltipState(
  element: HTMLElement,
  sourceMentionsByKey: ReadonlyMap<string, ExtensionSourceMention>
): ReferenceTooltipState | null {
  if (element.matches(FILE_REFERENCE_SELECTOR)) {
    return getFileReferenceTooltipState(element)
  }

  if (element.matches(EXTENSION_SOURCE_SELECTOR)) {
    return getExtensionSourceTooltipState(element, sourceMentionsByKey)
  }

  return null
}

function FileReferenceTooltip(props: {
  tooltip: Extract<ReferenceTooltipState, { kind: "file" }>
}): React.JSX.Element {
  const { tooltip } = props
  return (
    <div
      className="jingle-file-reference-tooltip"
      data-placement={tooltip.placement}
      style={{
        left: tooltip.left,
        top: tooltip.top
      }}
    >
      {tooltip.path}
    </div>
  )
}

function ExtensionSourceTooltip(props: {
  tooltip: Extract<ReferenceTooltipState, { kind: "extension-source" }>
}): React.JSX.Element {
  const { tooltip } = props
  const visibleTools = tooltip.mention.tools.slice(0, EXTENSION_TOOLTIP_MAX_VISIBLE_TOOLS)
  const hiddenToolCount = tooltip.mention.tools.length - visibleTools.length

  return (
    <div
      className="jingle-extension-source-tooltip"
      data-placement={tooltip.placement}
      style={{
        left: tooltip.left,
        top: tooltip.top
      }}
    >
      <div className="jingle-extension-source-tooltip__title">{tooltip.mention.label}</div>
      <div className="jingle-extension-source-tooltip__tools">
        {visibleTools.map((tool) => (
          <div className="jingle-extension-source-tooltip__tool" key={tool.toolName}>
            <span className="jingle-extension-source-tooltip__tool-title">{tool.title}</span>
            <span className="jingle-extension-source-tooltip__tool-description">
              {tool.description}
            </span>
          </div>
        ))}
      </div>
      {hiddenToolCount > 0 ? (
        <div className="jingle-extension-source-tooltip__more">+{hiddenToolCount}</div>
      ) : null}
    </div>
  )
}

export function ComposerReferenceTooltipPlugin(props: {
  sourceMentions: readonly ExtensionSourceMention[]
}): React.JSX.Element | null {
  const { sourceMentions } = props
  const [editor] = useLexicalComposerContext()
  const [tooltip, setTooltip] = useState<ReferenceTooltipState | null>(null)
  const sourceMentionsByKey = useMemo(
    () =>
      new Map(
        sourceMentions.map((mention) => [
          getExtensionSourceMentionKey(mention.extensionName, mention.sourceId),
          mention
        ])
      ),
    [sourceMentions]
  )

  const showTooltip = useCallback(
    (element: HTMLElement): void => {
      setTooltip(getReferenceTooltipState(element, sourceMentionsByKey))
    },
    [sourceMentionsByKey]
  )
  const hideTooltip = useCallback((): void => {
    setTooltip(null)
  }, [])
  const hideTooltipEvent = useEffectEvent(() => {
    hideTooltip()
  })
  const handleReferencePointerOver = useEffectEvent(
    (root: HTMLElement, target: EventTarget | null) => {
      const element = getReferenceElement(root, target)
      if (element) {
        showTooltip(element)
      }
    }
  )
  const handleReferencePointerOut = useEffectEvent((root: HTMLElement, event: PointerEvent) => {
    const element = getReferenceElement(root, event.target)
    if (
      !element ||
      (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))
    ) {
      return
    }
    hideTooltip()
  })

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) {
      return
    }

    const handlePointerOver = (event: PointerEvent): void => {
      handleReferencePointerOver(root, event.target)
    }
    const handlePointerOut = (event: PointerEvent): void => {
      handleReferencePointerOut(root, event)
    }

    root.addEventListener("pointerover", handlePointerOver)
    root.addEventListener("pointerout", handlePointerOut)
    return () => {
      root.removeEventListener("pointerover", handlePointerOver)
      root.removeEventListener("pointerout", handlePointerOut)
    }
  }, [editor])

  useEffect(() => {
    if (!tooltip) {
      return
    }

    window.addEventListener("resize", hideTooltipEvent)
    window.addEventListener("scroll", hideTooltipEvent, true)
    return () => {
      window.removeEventListener("resize", hideTooltipEvent)
      window.removeEventListener("scroll", hideTooltipEvent, true)
    }
  }, [tooltip])

  if (!tooltip || typeof document === "undefined") {
    return null
  }

  return createPortal(
    tooltip.kind === "file" ? (
      <FileReferenceTooltip tooltip={tooltip} />
    ) : (
      <ExtensionSourceTooltip tooltip={tooltip} />
    ),
    document.body
  )
}

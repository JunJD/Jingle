import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { $createTextNode, type TextNode } from "lexical"
import type { JSX } from "react"
import { useCallback, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ExtensionIcon } from "@/extensions/ExtensionIcon"
import { cn } from "@/lib/utils"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { $createExtensionSourceReferenceNode } from "./extension-source-node"

const EXTENSION_SOURCE_TRIGGER_PATTERN = /(^|[\s([{"'])@([A-Za-z0-9_-]{0,75})$/

class ExtensionSourceOption extends MenuOption {
  mention: ExtensionSourceMention

  constructor(mention: ExtensionSourceMention) {
    super(`${mention.extensionName}:${mention.sourceId}`)
    this.mention = mention
  }
}

export function getExtensionSourceTriggerMatch(text: string): MenuTextMatch | null {
  const match = EXTENSION_SOURCE_TRIGGER_PATTERN.exec(text)
  if (!match) {
    return null
  }

  const boundary = match[1] ?? ""
  const matchingString = match[2] ?? ""
  const replaceableString = `@${matchingString}`
  return {
    leadOffset: match.index + boundary.length,
    matchingString,
    replaceableString
  }
}

function filterSourceMentionOptions(
  mentions: ExtensionSourceMention[],
  query: string | null
): ExtensionSourceOption[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? ""
  return mentions
    .filter((mention) => {
      if (!normalizedQuery) {
        return true
      }

      return (
        mention.value.toLowerCase().includes(normalizedQuery) ||
        mention.label.toLowerCase().includes(normalizedQuery)
      )
    })
    .slice(0, 8)
    .map((mention) => new ExtensionSourceOption(mention))
}

function useMenuRenderFn(): MenuRenderFn<ExtensionSourceOption> {
  return useCallback((anchorElementRef, itemProps) => {
    const anchor = anchorElementRef.current
    if (!anchor || itemProps.options.length === 0) {
      return null
    }

    return createPortal(
      <div style={{ transform: "translateY(calc(-100% - 18px))" }}>
        <ul className="relative z-[9999] m-0 min-w-[204px] max-w-[280px] list-none overflow-y-auto rounded-[var(--ow-radius-sm)] border border-border bg-popover p-[var(--ow-space-0-5)] text-popover-foreground shadow-[0_10px_28px_rgba(15,23,42,0.14)] outline-none">
          {itemProps.options.map((option, index) => {
            const selected = itemProps.selectedIndex === index
            return (
              <li
                key={option.key}
                ref={option.setRefElement}
                className={cn(
                  "flex h-[28px] cursor-default select-none items-center gap-[var(--ow-space-1-5)] rounded-[var(--ow-radius-xs)] px-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] text-foreground outline-none transition-colors duration-100",
                  selected ? "bg-background-secondary" : "hover:bg-background-secondary/72"
                )}
                onClick={() => {
                  itemProps.setHighlightedIndex(index)
                  itemProps.selectOptionAndCleanUp(option)
                }}
                onMouseEnter={() => itemProps.setHighlightedIndex(index)}
                role="option"
                aria-selected={selected}
              >
                <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[var(--ow-radius-xs)] bg-background-tertiary text-muted-foreground">
                  <ExtensionIcon
                    className="size-[16px]"
                    extensionName={option.mention.extensionName}
                    icon={option.mention.icon}
                    iconName={option.mention.iconName}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  @{option.mention.value}
                </span>
              </li>
            )
          })}
        </ul>
      </div>,
      anchor
    )
  }, [])
}

export function ExtensionSourceTypeaheadPlugin(props: {
  onMenuClose?: () => void
  onMenuOpen?: () => void
  sourceMentions: ExtensionSourceMention[]
}): JSX.Element | null {
  const { onMenuClose, onMenuOpen, sourceMentions } = props
  const [query, setQuery] = useState<string | null>(null)
  const options = useMemo(
    () => filterSourceMentionOptions(sourceMentions, query),
    [query, sourceMentions]
  )
  const menuRenderFn = useMenuRenderFn()
  const handleSelectOption = useCallback(
    (
      option: ExtensionSourceOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void
    ): void => {
      if (!textNodeContainingQuery) {
        closeMenu()
        return
      }

      const mention = option.mention
      const referenceNode = $createExtensionSourceReferenceNode({
        displayName: mention.label,
        extensionName: mention.extensionName,
        icon: mention.icon,
        label: `@${mention.value}`,
        sourceId: mention.sourceId
      })
      const trailingSpace = $createTextNode(" ")

      textNodeContainingQuery.replace(referenceNode)
      referenceNode.insertAfter(trailingSpace)
      trailingSpace.selectEnd()
      closeMenu()
    },
    []
  )

  return (
    <LexicalTypeaheadMenuPlugin<ExtensionSourceOption>
      anchorClassName="z-[9999]"
      ignoreEntityBoundary={false}
      menuRenderFn={menuRenderFn}
      onClose={onMenuClose}
      onOpen={onMenuOpen}
      onQueryChange={setQuery}
      onSelectOption={handleSelectOption}
      options={options}
      preselectFirstItem={true}
      triggerFn={getExtensionSourceTriggerMatch}
    />
  )
}

import { Check, ChevronDown, Loader2 } from "lucide-react"
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref
} from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface NativeExtensionSelectItem {
  title: string
  value: string
}

export function NativeExtensionSelect(props: {
  autoFocus?: boolean
  children: ReactNode
  className: string
  onChange: (value: string) => void
  ref?: Ref<HTMLSelectElement>
  value: string
}): ReactNode {
  const { autoFocus, children, className, onChange, ref, value } = props

  return (
    <div className="relative">
      <select
        autoFocus={autoFocus}
        className={className}
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {children}
      </select>

      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground">
        <ChevronDown className="h-3 w-3" />
      </div>
    </div>
  )
}

export function NativeExtensionSearchableSelect(props: {
  autoFocus?: boolean
  className: string
  isLoading?: boolean
  items: readonly NativeExtensionSelectItem[]
  onChange: (value: string) => void
  onSearch: (query: string) => void
  placeholder?: string
  ref?: Ref<HTMLButtonElement>
  searchPlaceholder?: string
  value: string
}): ReactNode {
  const {
    autoFocus,
    className,
    isLoading = false,
    items,
    onChange,
    onSearch,
    placeholder = "Select",
    ref,
    searchPlaceholder = "Search",
    value
  } = props
  const listboxId = useId()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(() => getInitialOptionIndex(items, value))
  const [lastSelectedItem, setLastSelectedItem] = useState<NativeExtensionSelectItem | null>(null)
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const selectedItem = items.find((item) => item.value === value)
  const displayLabel =
    selectedItem?.title ?? (lastSelectedItem?.value === value ? lastSelectedItem.title : "")
  const resolvedActiveIndex = resolveOptionIndex(items, activeIndex)
  const activeOptionId =
    resolvedActiveIndex >= 0 ? `${listboxId}-option-${resolvedActiveIndex}` : undefined

  const clearSearch = (): void => {
    if (searchText === "") {
      return
    }

    setSearchText("")
    onSearch("")
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (nextOpen) {
      setActiveIndex(getInitialOptionIndex(items, value))
      return
    }

    clearSearch()
  }

  const handleSearchChange = (nextSearchText: string): void => {
    setSearchText(nextSearchText)
    setActiveIndex(0)
    onSearch(nextSearchText)
  }

  const selectOption = (index: number): void => {
    const item = items[index]
    if (!item) {
      return
    }

    setLastSelectedItem(item)
    onChange(item.value)
    setOpen(false)
    clearSearch()
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((current) => getNextOptionIndex(items, current, 1))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) => getNextOptionIndex(items, current, -1))
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      selectOption(resolvedActiveIndex)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      clearSearch()
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          autoFocus={autoFocus}
          className={className}
          ref={ref}
          role="combobox"
          type="button"
        >
          <span
            className={cn(
              "min-w-0 truncate text-left",
              displayLabel ? null : "text-muted-foreground/70"
            )}
          >
            {displayLabel || placeholder}
          </span>
          {isLoading ? (
            <Loader2 className="ml-[var(--ow-gap-sm)] size-[var(--ow-icon-sm)] shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className="ml-[var(--ow-gap-sm)] size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => {
            searchInputRef.current?.focus()
          })
        }}
      >
        <input
          aria-activedescendant={activeOptionId}
          aria-controls={listboxId}
          className="mb-1 flex h-[var(--ow-control-h-sm)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={searchPlaceholder}
          ref={searchInputRef}
          role="searchbox"
          value={searchText}
          onChange={(event) => handleSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <div id={listboxId} className="max-h-56 overflow-y-auto py-0.5" role="listbox">
          {items.length === 0 ? (
            <div className="px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] text-muted-foreground">
              No results
            </div>
          ) : (
            items.map((item, index) => {
              const active = index === resolvedActiveIndex
              const selected = item.value === value

              return (
                <button
                  aria-selected={selected}
                  className={cn(
                    "flex min-h-[var(--ow-control-h-sm)] w-full items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-sm)] px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] text-left [font-size:var(--ow-font-control)] outline-none transition hover:bg-accent focus-visible:bg-accent",
                    active ? "bg-accent" : null,
                    selected ? "text-foreground" : "text-muted-foreground"
                  )}
                  id={`${listboxId}-option-${index}`}
                  key={item.value}
                  role="option"
                  type="button"
                  onClick={() => selectOption(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {selected ? (
                    <Check className="size-[var(--ow-icon-sm)] shrink-0 text-primary" />
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function getInitialOptionIndex(
  items: readonly NativeExtensionSelectItem[],
  value: string
): number {
  const selectedIndex = items.findIndex((item) => item.value === value)
  return selectedIndex >= 0 ? selectedIndex : 0
}

function resolveOptionIndex(items: readonly NativeExtensionSelectItem[], index: number): number {
  if (items.length === 0) {
    return -1
  }

  return Math.min(Math.max(index, 0), items.length - 1)
}

function getNextOptionIndex(
  items: readonly NativeExtensionSelectItem[],
  currentIndex: number,
  direction: -1 | 1
): number {
  if (items.length === 0) {
    return -1
  }

  const index = resolveOptionIndex(items, currentIndex)
  return (index + direction + items.length) % items.length
}

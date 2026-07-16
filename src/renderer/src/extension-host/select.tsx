import { Check, ChevronDown } from "lucide-react"
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export interface NativeExtensionSelectItem {
  title: string
  value: string
}

type NativeExtensionSelectValuePresentation =
  | {
      kind: "ready"
      title: string
    }
  | {
      kind: "empty"
      title: string
    }
  | {
      kind: "invalid"
      title: string
    }

function projectNativeExtensionSelectValue(params: {
  items: readonly NativeExtensionSelectItem[]
  emptyTitle: string
  invalidTitle: string
  value: string
}): NativeExtensionSelectValuePresentation {
  const selectedItem = params.items.find((item) => item.value === params.value)
  if (selectedItem) {
    return { kind: "ready", title: selectedItem.title }
  }

  if (params.value.length === 0) {
    return { kind: "empty", title: params.emptyTitle }
  }

  return { kind: "invalid", title: params.invalidTitle }
}

export function NativeExtensionSelect(props: {
  autoFocus?: boolean
  children: ReactNode
  className: string
  onChange: (value: string) => void
  ref?: Ref<HTMLSelectElement>
  value: string
  wrapperClassName?: string
}): ReactNode {
  const { autoFocus, children, className, onChange, ref, value, wrapperClassName } = props

  return (
    <Select
      autoFocus={autoFocus}
      className={className}
      ref={ref}
      value={value}
      wrapperClassName={wrapperClassName}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    >
      {children}
    </Select>
  )
}

export function NativeExtensionSearchableSelect(props: {
  autoFocus?: boolean
  className: string
  emptyTitle: string
  invalidTitle: string
  isLoading?: boolean
  items: readonly NativeExtensionSelectItem[]
  onChange: (value: string) => void
  onSearch: (query: string) => void
  ref?: Ref<HTMLButtonElement>
  searchPlaceholder: string
  value: string
}): ReactNode {
  const {
    autoFocus,
    className,
    emptyTitle,
    invalidTitle,
    isLoading = false,
    items,
    onChange,
    onSearch,
    ref,
    searchPlaceholder,
    value
  } = props
  const listboxId = useId()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(() => getInitialOptionIndex(items, value))
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const valuePresentation = projectNativeExtensionSelectValue({
    emptyTitle,
    invalidTitle,
    items,
    value
  })
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
        <Button
          aria-busy={isLoading || undefined}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={valuePresentation.kind === "invalid" || undefined}
          autoFocus={autoFocus}
          className={className}
          ref={ref}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span
            className={cn(
              "min-w-0 truncate text-left",
              valuePresentation.kind === "empty" ? "text-muted-foreground/70" : null,
              valuePresentation.kind === "invalid" ? "text-destructive" : null
            )}
          >
            {valuePresentation.title}
          </span>
          {isLoading ? (
            <Spinner className="ml-[var(--jingle-gap-sm)] text-muted-foreground" size="sm" />
          ) : (
            <ChevronDown className="ml-[var(--jingle-gap-sm)] size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
          )}
        </Button>
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
        <Input
          aria-activedescendant={activeOptionId}
          aria-controls={listboxId}
          className="mb-1 h-[var(--jingle-control-h-sm)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2-5)]"
          placeholder={searchPlaceholder}
          ref={searchInputRef}
          role="searchbox"
          value={searchText}
          onChange={(event) => handleSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <div
          id={listboxId}
          className="max-h-56 overflow-y-auto py-0.5"
          data-press-surface="instant"
          role="listbox"
        >
          {items.length === 0 ? (
            <div className="px-[var(--jingle-space-2-5)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-body)] text-muted-foreground">
              No results
            </div>
          ) : (
            items.map((item, index) => {
              const active = index === resolvedActiveIndex
              const selected = item.value === value

              return (
                <Button
                  aria-selected={selected}
                  className={cn(
                    "min-h-[var(--jingle-control-h-sm)] w-full justify-start gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-sm)] px-[var(--jingle-space-2-5)] py-[var(--jingle-space-1)] text-left",
                    active ? "bg-accent" : null,
                    selected ? "text-foreground" : "text-muted-foreground"
                  )}
                  id={`${listboxId}-option-${index}`}
                  key={item.value}
                  role="option"
                  variant="ghost"
                  type="button"
                  onClick={() => selectOption(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {selected ? (
                    <Check className="size-[var(--jingle-icon-sm)] shrink-0 text-primary" />
                  ) : null}
                </Button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function getInitialOptionIndex(items: readonly NativeExtensionSelectItem[], value: string): number {
  const selectedIndex = items.findIndex((item) => item.value === value)
  return selectedIndex
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

  if (currentIndex < 0) {
    return direction === 1 ? 0 : items.length - 1
  }

  const index = resolveOptionIndex(items, currentIndex)
  return (index + direction + items.length) % items.length
}

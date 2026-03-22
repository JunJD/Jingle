import { Settings2 } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { LauncherResultList } from "./components/LauncherResultList"
import { useLauncherShell } from "./hooks/useLauncherShell"

export default function LauncherApp(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    executeItem,
    handleInputKeyDown,
    items,
    placeholder,
    query,
    resultsViewportHeight,
    selectedIndex,
    setQuery,
    syncViewportHeight
  } = useLauncherShell()
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null
  const footerAction = useMemo(() => {
    if (!selectedItem) {
      return {
        label: "Open Result",
        shortcut: "↵"
      }
    }

    return {
      label: selectedItem.kind === "application" ? "Open App" : "Open Result",
      shortcut: "↵"
    }
  }, [selectedItem])

  useEffect(() => {
    const focusInput = (): void => {
      const input = inputRef.current
      if (!input) {
        return
      }

      input.focus()
      const caretPosition = input.value.length
      input.setSelectionRange(caretPosition, caretPosition)
    }

    focusInput()
    const cleanupShown = window.api.launcher.onShown(() => {
      focusInput()
      syncViewportHeight()
    })
    window.addEventListener("focus", focusInput)

    return () => {
      cleanupShown()
      window.removeEventListener("focus", focusInput)
    }
  }, [syncViewportHeight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        void window.api.launcher.hide()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div
      className="h-full w-full p-px shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
      style={{
        borderRadius: "var(--launcher-panel-radius)",
        backgroundColor: "var(--launcher-border)"
      }}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden"
        style={{
          borderRadius: "var(--launcher-panel-radius-inner)",
          backgroundColor: "var(--launcher-surface)"
        }}
      >
        <div
          className="flex h-[60px] shrink-0 items-center pl-6 pr-8"
          style={{ borderBottom: "1px solid var(--launcher-border)" }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            className="h-full flex-1 border-0 bg-transparent px-0 text-[16px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <LauncherResultList
          height={resultsViewportHeight}
          items={items}
          onExecute={executeItem}
          selectedIndex={selectedIndex}
        />

        {items.length > 0 && (
          <div
            className="flex h-[48px] shrink-0 items-center justify-between pl-4 pr-8"
            style={{
              borderTop: "1px solid var(--launcher-border)",
              backgroundColor: "color-mix(in srgb, var(--launcher-surface-strong) 42%, transparent)"
            }}
          >
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              className="flex appearance-none items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1 text-[13px] text-muted-foreground transition hover:text-foreground"
            >
              <Settings2 className="size-4" />
              <span>Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedItem) {
                  return
                }

                executeItem(selectedIndex)
              }}
              onMouseDown={(event) => event.preventDefault()}
              className="flex appearance-none items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1 text-[13px] font-medium text-foreground"
            >
              <span>{footerAction.label}</span>
              <span
                className="rounded-[10px] px-2 py-1 text-[12px]"
                style={{
                  border: "1px solid var(--launcher-border-strong)",
                  backgroundColor: "var(--launcher-surface-strong)",
                  color: "var(--launcher-text)"
                }}
              >
                {footerAction.shortcut}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

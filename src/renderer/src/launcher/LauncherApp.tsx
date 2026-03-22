import { useEffect, useRef } from "react"
import { LauncherPageTransition } from "./components/LauncherPageTransition"
import { LauncherSearchPage } from "./components/LauncherSearchPage"
import { LauncherSecondaryPage } from "./components/LauncherSecondaryPage"
import { useLauncherShell } from "./hooks/useLauncherShell"

export default function LauncherApp(): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const detailInputRef = useRef<HTMLInputElement>(null)
  const {
    activeSecondaryPage,
    closeSecondaryPage,
    detailQuery,
    executeItem,
    handleDetailInputKeyDown,
    handleInputKeyDown,
    items,
    mode,
    navigationDirection,
    openSecondaryPage,
    pageEntries,
    placeholder,
    query,
    resultsVisible,
    resultsViewportHeight,
    selectedIndex,
    setDetailQuery,
    setQuery,
    syncViewportHeight
  } = useLauncherShell()
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null
  const activePageKey = activeSecondaryPage ? activeSecondaryPage.id : "search"

  useEffect(() => {
    const focusInput = (): void => {
      const input = mode === "detail" ? detailInputRef.current : searchInputRef.current
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
  }, [mode, syncViewportHeight])

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
        <LauncherPageTransition direction={navigationDirection} pageKey={activePageKey}>
          {activeSecondaryPage ? (
            <LauncherSecondaryPage
              inputRef={detailInputRef}
              onBack={closeSecondaryPage}
              onInputKeyDown={handleDetailInputKeyDown}
              page={activeSecondaryPage}
              query={detailQuery}
              setQuery={setDetailQuery}
            />
          ) : (
            <LauncherSearchPage
              executeItem={executeItem}
              inputRef={searchInputRef}
              items={items}
              onInputKeyDown={handleInputKeyDown}
              onOpenPage={openSecondaryPage}
              pageEntries={pageEntries}
              placeholder={placeholder}
              query={query}
              resultsViewportHeight={resultsViewportHeight}
              resultsVisible={resultsVisible}
              selectedIndex={selectedIndex}
              selectedItem={selectedItem}
              setQuery={setQuery}
            />
          )}
        </LauncherPageTransition>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef } from "react"
import { LauncherPageTransition } from "./components/LauncherPageTransition"
import { LauncherSearchPage } from "./components/LauncherSearchPage"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"

export default function LauncherApp(): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const featureInputRef = useRef<HTMLInputElement>(null)
  const viewportHeightRef = useRef(0)
  const {
    activeFeaturePage,
    closeActivePage,
    navigationDirection,
    openFeaturePage,
    route,
    routeKey
  } = useLauncherRouter()
  const searchPage = useLauncherSearchPage({ openFeaturePage })
  const selectedItem =
    searchPage.selectedIndex >= 0 ? searchPage.items[searchPage.selectedIndex] : null
  const ActiveFeaturePageComponent = activeFeaturePage?.Component ?? null
  const setViewportHeight = useCallback((height: number): void => {
    viewportHeightRef.current = height
    void window.api.launcher.setViewportHeight(height)
  }, [])

  useEffect(() => {
    if (route.id === "home") {
      setViewportHeight(searchPage.viewportHeight)
    }
  }, [route.id, searchPage.viewportHeight, setViewportHeight])

  useEffect(() => {
    const focusInput = (): void => {
      const input = route.id === "home" ? searchInputRef.current : featureInputRef.current
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
      if (viewportHeightRef.current > 0) {
        setViewportHeight(viewportHeightRef.current)
      }
    })
    window.addEventListener("focus", focusInput)

    return () => {
      cleanupShown()
      window.removeEventListener("focus", focusInput)
    }
  }, [route.id, setViewportHeight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        if (route.id !== "home") {
          closeActivePage()
          return
        }

        void window.api.launcher.hide()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeActivePage, route.id])

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
        <LauncherPageTransition direction={navigationDirection} pageKey={routeKey}>
          {activeFeaturePage && ActiveFeaturePageComponent && route.id !== "home" ? (
            <ActiveFeaturePageComponent
              inputRef={featureInputRef}
              onBack={closeActivePage}
              onViewportHeightChange={setViewportHeight}
              seedQuery={route.seedQuery}
            />
          ) : (
            <LauncherSearchPage
              entries={searchPage.entries}
              executeItem={searchPage.executeItem}
              inputRef={searchInputRef}
              items={searchPage.items}
              onInputKeyDown={searchPage.handleInputKeyDown}
              onOpenFeaturePage={searchPage.openFeaturePage}
              placeholder={searchPage.placeholder}
              query={searchPage.query}
              resultsViewportHeight={searchPage.resultsViewportHeight}
              resultsVisible={searchPage.resultsVisible}
              selectedIndex={searchPage.selectedIndex}
              selectedItem={selectedItem}
              setQuery={searchPage.setQuery}
            />
          )}
        </LauncherPageTransition>
      </div>
    </div>
  )
}

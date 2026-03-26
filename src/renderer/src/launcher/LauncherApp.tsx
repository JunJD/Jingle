import { useCallback, useEffect, useRef } from "react"
import { LauncherPageTransition } from "./components/LauncherPageTransition"
import { LauncherSearchPage } from "./components/LauncherSearchPage"
import { useLauncherRouter } from "./hooks/useLauncherRouter"
import { useLauncherSearchPage } from "./hooks/useLauncherSearchPage"

export default function LauncherApp(): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pluginInputRef = useRef<HTMLInputElement>(null)
  const viewportHeightRef = useRef(0)
  const { activePlugin, closeActivePlugin, navigationDirection, openPlugin, route, routeKey } =
    useLauncherRouter()
  const searchPage = useLauncherSearchPage({ openPlugin })
  const selectedItem =
    searchPage.selectedIndex >= 0 ? searchPage.items[searchPage.selectedIndex] : null
  const ActivePluginComponent = activePlugin?.Component ?? null
  const viewportHeight =
    route.id === "home"
      ? searchPage.viewportHeight
      : (activePlugin?.getViewportHeight(searchPage.shellConfig) ?? searchPage.viewportHeight)

  const setViewportHeight = useCallback((height: number): void => {
    const nextHeight = Math.round(height)
    if (nextHeight <= 0 || nextHeight === viewportHeightRef.current) {
      return
    }

    viewportHeightRef.current = nextHeight
    void window.api.launcher.setViewportHeight(nextHeight)
  }, [])

  useEffect(() => {
    setViewportHeight(viewportHeight)
  }, [setViewportHeight, viewportHeight])

  useEffect(() => {
    const focusInput = (): void => {
      const input = route.id === "home" ? searchInputRef.current : pluginInputRef.current
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
          closeActivePlugin()
          return
        }

        void window.api.launcher.hide()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeActivePlugin, route.id])

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{
        borderRadius: "var(--launcher-panel-radius)",
        backgroundColor: "var(--launcher-surface)"
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
          {activePlugin && ActivePluginComponent && route.id !== "home" ? (
            <ActivePluginComponent
              inputRef={pluginInputRef}
              onBack={closeActivePlugin}
              seedQuery={route.seedQuery}
              shellConfig={searchPage.shellConfig}
            />
          ) : (
            <LauncherSearchPage
              entries={searchPage.entries}
              executeItem={searchPage.executeItem}
              inputRef={searchInputRef}
              inputValue={searchPage.query}
              items={searchPage.items}
              onInputKeyDown={searchPage.handleInputKeyDown}
              onInputValueChange={searchPage.setQuery}
              onOpenPlugin={searchPage.openPlugin}
              placeholder={searchPage.placeholder}
              resultsViewportHeight={searchPage.resultsViewportHeight}
              resultsVisible={searchPage.resultsVisible}
              selectedIndex={searchPage.selectedIndex}
              selectedItem={selectedItem}
              shellConfig={searchPage.shellConfig}
            />
          )}
        </LauncherPageTransition>
      </div>
    </div>
  )
}

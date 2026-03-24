import { ArrowLeft } from "lucide-react"
import type { ReactNode, RefObject } from "react"
import { LauncherInput } from "../components/LauncherInput"

interface LauncherAiPageChromeConfig {
  footer: {
    leadingLabel: string
    primaryLabel: string
    primaryShortcutLabel: string
  }
  inputPlaceholder: string
}

export function LauncherAiPageChrome(props: {
  children: ReactNode
  chrome: LauncherAiPageChromeConfig
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onPrimaryAction: () => void
  primaryActionDisabled: boolean
  query: string
  setQuery: (value: string) => void
}): React.JSX.Element {
  const {
    children,
    chrome,
    inputRef,
    onBack,
    onInputKeyDown,
    onPrimaryAction,
    primaryActionDisabled,
    query,
    setQuery
  } = props

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex h-[60px] shrink-0 items-center pl-6 pr-8"
        style={{ borderBottom: "1px solid var(--launcher-border)" }}
      >
        <button
          type="button"
          onClick={onBack}
          onMouseDown={(event) => event.preventDefault()}
          className="mr-4 flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-[10px] border-0 text-muted-foreground transition hover:text-foreground"
          style={{ backgroundColor: "var(--launcher-surface-strong)" }}
        >
          <ArrowLeft className="size-5" />
        </button>
        <LauncherInput
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={chrome.inputPlaceholder}
          className="flex-1 text-foreground"
        />
      </div>

      {children}

      <div
        className="flex h-[48px] shrink-0 items-center justify-between pl-4 pr-8"
        style={{
          borderTop: "1px solid var(--launcher-border)",
          backgroundColor: "color-mix(in srgb, var(--launcher-surface-strong) 42%, transparent)"
        }}
      >
        <div className="px-2 py-1 text-[13px] text-muted-foreground">
          {chrome.footer.leadingLabel}
        </div>

        <button
          type="button"
          onClick={onPrimaryAction}
          onMouseDown={(event) => event.preventDefault()}
          disabled={primaryActionDisabled}
          className="flex appearance-none items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
        >
          <span>{chrome.footer.primaryLabel}</span>
          <span
            className="rounded-[10px] px-2 py-1 text-[12px]"
            style={{
              border: "1px solid var(--launcher-border-strong)",
              backgroundColor: "var(--launcher-surface-strong)",
              color: "var(--launcher-text)"
            }}
          >
            {chrome.footer.primaryShortcutLabel}
          </span>
        </button>
      </div>
    </div>
  )
}

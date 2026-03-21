import { useEffect, useRef, useState } from "react"

function getShortcutLabel(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "Cmd + Shift + Space" : "Ctrl + Shift + Space"
}

export default function LauncherApp(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState("")
  const shortcutLabel = getShortcutLabel(window.electron.process.platform)

  useEffect(() => {
    const focusInput = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    focusInput()
    window.addEventListener("focus", focusInput)
    return () => window.removeEventListener("focus", focusInput)
  }, [])

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
    <div className="h-screen bg-[#101014] p-3">
      <div className="app-drag-region flex h-full items-center rounded-[14px] border border-white/8 bg-[linear-gradient(135deg,#15151b_0%,#101014_100%)] px-4 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
        <div className="mr-4 flex shrink-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f97316]">
            Launcher
          </span>
          <span className="text-[11px] text-muted-foreground">{shortcutLabel}</span>
        </div>

        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Phase 1.1: launcher window only. Search lands in Phase 2."
          className="app-no-drag h-12 flex-1 border-0 bg-transparent text-[20px] text-foreground outline-none placeholder:text-[#5f6372]"
        />

        <div className="ml-4 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#8a8a96]">
            Esc
          </span>
          <span>Hide</span>
        </div>
      </div>
    </div>
  )
}

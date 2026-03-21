import { useEffect, useRef, useState } from "react"

function getShortcutLabel(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "Cmd + Shift + Space" : "Ctrl + Shift + Space"
}

export default function LauncherApp(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState("")
  const platform = window.electron.process.platform
  const shortcutLabel = getShortcutLabel(platform)

  useEffect(() => {
    const focusInput = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    focusInput()
    const cleanupShown = window.api.launcher.onShown(focusInput)
    window.addEventListener("focus", focusInput)

    return () => {
      cleanupShown()
      window.removeEventListener("focus", focusInput)
    }
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
    <div className="flex h-screen items-center overflow-hidden border border-[#33333d] bg-[#1c1c28] px-4 shadow-[0_14px_36px_rgba(0,0,0,0.32)]">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Launcher shell ready. Search connects next."
        className="h-full flex-1 border-0 bg-transparent px-1 text-[16px] text-[#e8e8f0] outline-none placeholder:text-[#73788c]"
      />

      <div className="ml-3 flex shrink-0 items-center gap-2 text-[11px] text-[#a9aabd]">
        <span className="hidden min-[760px]:inline text-[10px] uppercase tracking-[0.12em] text-[#7e8297]">
          {shortcutLabel}
        </span>
        <span className="rounded border border-[#3a3d4f] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#c7c9d6]">
          Esc
        </span>
      </div>
    </div>
  )
}

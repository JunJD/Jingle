import type { LauncherSecondaryPageDefinition } from "./types"

const AI_PAGE_VIEWPORT_HEIGHT = 520

function getAiPageViewportHeight(): number {
  return AI_PAGE_VIEWPORT_HEIGHT
}

export const aiLauncherPage: LauncherSecondaryPageDefinition = {
  id: "ai",
  title: "Ask Anything",
  inputPlaceholder: "Ask AI anything...",
  closeOnEmptyBackspace: true,
  entry: {
    label: "Ask AI",
    shortcutLabel: "Tab"
  },
  footer: {
    leadingLabel: "Quick AI",
    primaryLabel: "Ask AI",
    primaryShortcutLabel: "↵"
  },
  getViewportHeight: getAiPageViewportHeight,
  renderBody: () => (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 58%)"
        }}
      />
      <div className="relative flex flex-col items-center text-center">
        <h1 className="text-[48px] font-semibold tracking-[-0.04em] text-foreground">
          Ask Anything
        </h1>
      </div>
    </div>
  )
}

import { AlertTriangle, ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { ExternalExtensionBundleResult } from "../../../../shared/external-extensions"
import ExtensionView from "./ExtensionView"

interface ResolvedExternalBundleState {
  bundle: ExternalExtensionBundleResult | null
  commandId: string
  error: string | null
}

export function ExternalCommandRouteView(props: {
  commandName: string
  extensionName: string
  onClose: () => void
}): React.JSX.Element {
  const { commandName, extensionName, onClose } = props
  const commandId = `${extensionName}:${commandName}`
  const [resolvedState, setResolvedState] = useState<ResolvedExternalBundleState | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.api.extensions
      .getBundle({
        commandName,
        extensionName
      })
      .then((bundle) => {
        if (cancelled) {
          return
        }

        setResolvedState({
          bundle,
          commandId,
          error: null
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setResolvedState({
          bundle: null,
          commandId,
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
    }
  }, [commandId, commandName, extensionName])

  const activeState = useMemo(() => {
    if (resolvedState?.commandId === commandId) {
      return {
        bundle: resolvedState.bundle,
        error: resolvedState.error,
        loading: false
      }
    }

    return {
      bundle: null,
      error: null,
      loading: true
    }
  }, [commandId, resolvedState])

  if (activeState.bundle) {
    return (
      <ExtensionView
        assetsPath={activeState.bundle.assetsPath}
        code={activeState.bundle.code}
        commandName={activeState.bundle.commandName}
        extensionDisplayName={activeState.bundle.extensionDisplayName}
        extensionIconDataUrl={activeState.bundle.extensionIconDataUrl}
        extensionName={activeState.bundle.extensionName}
        extensionPath={activeState.bundle.extensionPath}
        mode={activeState.bundle.mode}
        onClose={onClose}
        owner={activeState.bundle.owner}
        preferenceDefinitions={activeState.bundle.preferenceDefinitions}
        preferences={activeState.bundle.preferences}
        supportPath={activeState.bundle.supportPath}
        title={activeState.bundle.title}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
        <button onClick={onClose} className="text-white/40 transition-colors hover:text-white/70">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm text-white/70">
          {activeState.loading ? `Loading ${extensionName}/${commandName}` : `${extensionName}/${commandName}`}
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        {activeState.loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            <p className="text-sm text-white/50">Bundling and loading extension command…</p>
          </div>
        ) : (
          <div className="max-w-lg text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400/60" />
            <p className="whitespace-pre-wrap break-words text-left text-sm text-red-400/80">
              {activeState.error ?? `Failed to load ${extensionName}/${commandName}.`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

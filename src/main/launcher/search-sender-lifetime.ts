interface LauncherSearchSender {
  id: number
  isDestroyed(): boolean
  once(event: "destroyed", listener: () => void): unknown
  removeListener(event: "destroyed", listener: () => void): unknown
}

export interface LauncherSearchSenderLifetime {
  activate(): void
  callerId: string
  dispose(): void
}

export function getScopedLauncherSearchCallerId(senderId: number, callerId: string): string {
  if (typeof callerId !== "string" || callerId.length === 0 || callerId.length > 128) {
    throw new Error("Launcher search caller id is invalid.")
  }

  return `${senderId}:${callerId}`
}

export function bindLauncherSearchSenderLifetime(params: {
  cancel: (callerId: string) => void
  callerId: string
  sender: LauncherSearchSender
}): LauncherSearchSenderLifetime {
  const { cancel, callerId, sender } = params
  const scopedCallerId = getScopedLauncherSearchCallerId(sender.id, callerId)
  let active = false
  let cancellationPending = false
  const handleSenderDestroyed = (): void => {
    if (!active) {
      cancellationPending = true
      return
    }
    cancel(scopedCallerId)
  }
  sender.once("destroyed", handleSenderDestroyed)
  if (sender.isDestroyed()) {
    handleSenderDestroyed()
  }

  return {
    activate: () => {
      active = true
      if (cancellationPending || sender.isDestroyed()) {
        cancellationPending = false
        cancel(scopedCallerId)
      }
    },
    callerId: scopedCallerId,
    dispose: () => {
      sender.removeListener("destroyed", handleSenderDestroyed)
    }
  }
}

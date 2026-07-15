export type JingleInputModality = "keyboard" | "pointer"

let currentInputModality: JingleInputModality = "keyboard"
let installed = false

function setInputModality(modality: JingleInputModality): void {
  if (currentInputModality === modality) {
    return
  }

  currentInputModality = modality
  document.documentElement.dataset.inputModality = modality
}

export function getCurrentInputModality(): JingleInputModality {
  return currentInputModality
}

export function installInputModalityTracking(): void {
  if (installed) {
    return
  }

  installed = true
  document.documentElement.dataset.inputModality = currentInputModality

  document.addEventListener(
    "keydown",
    () => {
      setInputModality("keyboard")
    },
    true
  )

  for (const eventName of ["pointerdown", "pointermove", "pointerover"] as const) {
    document.addEventListener(
      eventName,
      () => {
        setInputModality("pointer")
      },
      true
    )
  }
}

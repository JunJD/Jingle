import { showHUD, type NativeExtensionRuntimeNoViewRunContext } from "@jingle/extension-api"
import { parseCoffeeUntil } from "./duration"
import { startCoffee } from "./runtime-client"

export default async function CoffeeCaffeinateUntil(
  context: NativeExtensionRuntimeNoViewRunContext
): Promise<void> {
  const time = String(
    context.launchProps?.arguments?.time ?? context.launchProps?.fallbackText ?? context.seedQuery
  ).trim()
  const parsed = parseCoffeeUntil(time)

  await startCoffee({ durationSeconds: parsed.durationSeconds })
  await showHUD(`Caffeinating your Mac until ${parsed.label}`)
}

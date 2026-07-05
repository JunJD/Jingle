import { showHUD, type NativeExtensionRuntimeNoViewRunContext } from "@jingle/extension-api"
import { formatCoffeeDuration, parseCoffeeDuration } from "./duration"
import { startCoffee } from "./runtime-client"

export default async function CoffeeCaffeinateFor(
  context: NativeExtensionRuntimeNoViewRunContext
): Promise<void> {
  const durationSeconds = parseCoffeeDuration({
    fallbackText: context.launchProps?.fallbackText ?? context.seedQuery,
    hours: context.launchProps?.arguments?.hours,
    minutes: context.launchProps?.arguments?.minutes,
    seconds: context.launchProps?.arguments?.seconds
  })

  await startCoffee({ durationSeconds })
  await showHUD(`Caffeinating your Mac for ${formatCoffeeDuration(durationSeconds)}`)
}

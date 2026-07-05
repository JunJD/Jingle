import { showHUD } from "@jingle/extension-api"
import { getCoffeeStatus } from "./runtime-client"

export default async function CoffeeStatus(): Promise<void> {
  const status = await getCoffeeStatus()
  if (!status.isRunning) {
    await showHUD("Your Mac is decaffeinated")
    return
  }

  await showHUD(status.timeRemaining ? `Your Mac is caffeinated: ${status.timeRemaining}` : "Your Mac is caffeinated")
}

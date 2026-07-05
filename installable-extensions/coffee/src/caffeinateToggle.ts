import { showHUD } from "@jingle/extension-api"
import { toggleCoffee } from "./runtime-client"

export default async function CoffeeToggle(): Promise<void> {
  const status = await toggleCoffee()
  await showHUD(status.isRunning ? "Your Mac is now caffeinated" : "Your Mac is now decaffeinated")
}

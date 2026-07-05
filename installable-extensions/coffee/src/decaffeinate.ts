import { showHUD } from "@jingle/extension-api"
import { stopCoffee } from "./runtime-client"

export default async function CoffeeDecaffeinate(): Promise<void> {
  await stopCoffee()
  await showHUD("Your Mac is now decaffeinated")
}

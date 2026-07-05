import { showHUD } from "@jingle/extension-api"
import { startCoffee } from "./runtime-client"

export default async function CoffeeCaffeinate(): Promise<void> {
  await startCoffee()
  await showHUD("Your Mac is now caffeinated")
}

import { defineNativeExtensionRuntime } from "@jingle/extension-api"
import CoffeeCaffeinate from "./src/caffeinate"
import CoffeeCaffeinateFor from "./src/caffeinateFor"
import CoffeeToggle from "./src/caffeinateToggle"
import CoffeeCaffeinateUntil from "./src/caffeinateUntil"
import CoffeeDecaffeinate from "./src/decaffeinate"
import CoffeeMenuBar from "./src/index"
import CoffeeStatus from "./src/status"

export const coffeeRuntime = defineNativeExtensionRuntime({
  commands: {
    caffeinate: {
      mode: "no-view",
      run: CoffeeCaffeinate
    },
    decaffeinate: {
      mode: "no-view",
      run: CoffeeDecaffeinate
    },
    caffeinateToggle: {
      mode: "no-view",
      run: CoffeeToggle
    },
    caffeinateFor: {
      mode: "no-view",
      run: CoffeeCaffeinateFor
    },
    caffeinateUntil: {
      mode: "no-view",
      run: CoffeeCaffeinateUntil
    },
    index: {
      Component: CoffeeMenuBar,
      mode: "menu-bar"
    },
    status: {
      mode: "no-view",
      run: CoffeeStatus
    }
  },
  extensionName: "coffee"
})

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
    caffeinateFor: {
      mode: "no-view",
      run: CoffeeCaffeinateFor
    },
    caffeinateToggle: {
      mode: "no-view",
      run: CoffeeToggle
    },
    caffeinateUntil: {
      mode: "no-view",
      run: CoffeeCaffeinateUntil
    },
    decaffeinate: {
      mode: "no-view",
      run: CoffeeDecaffeinate
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

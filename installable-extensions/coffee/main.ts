import { defineNativeExtensionMain } from "@jingle/extension-api"
import coffeeNativeExtensionService from "./main/service"
import { createCoffeeTools } from "./main/tools"

export const coffeeMain = defineNativeExtensionMain({
  service: coffeeNativeExtensionService,
  tools: createCoffeeTools()
})

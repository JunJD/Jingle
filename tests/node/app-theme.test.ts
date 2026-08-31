import assert from "node:assert/strict"
import test from "node:test"
import {
  APP_THEME_PRESETS,
  resolveAppThemeWindowChrome,
  type JingleThemeV1
} from "@shared/app-theme"

test("dark theme uses dark native window chrome even when its source surface is light", () => {
  const darkConfig: JingleThemeV1 = {
    ...APP_THEME_PRESETS[0].config,
    variant: "dark"
  }

  assert.deepEqual(resolveAppThemeWindowChrome(darkConfig), {
    background: "#171c21",
    foreground: "#eff2f5"
  })
})

test("light theme keeps its configured window surface", () => {
  assert.deepEqual(resolveAppThemeWindowChrome(APP_THEME_PRESETS[0].config), {
    background: "#e9eae8",
    foreground: "#2f312d"
  })
})

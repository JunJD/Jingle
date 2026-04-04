import { resolve } from "path"
import { readFileSync, copyFileSync, existsSync, mkdirSync } from "fs"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

// Plugin to copy resources to output
function copyResources(): { name: string; closeBundle: () => void } {
  return {
    name: "copy-resources",
    closeBundle(): void {
      const srcIcon = resolve("resources/icon.png")
      const destDir = resolve("out/resources")
      const destIcon = resolve("out/resources/icon.png")

      if (existsSync(srcIcon)) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }
        copyFileSync(srcIcon, destIcon)
      }
    }
  }
}

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@extensions": resolve("src/extensions"),
        "@launcher": resolve("src/renderer/src/launcher"),
        "@plugins": resolve("src/plugins"),
        "@shared": resolve("src/shared")
      }
    },
    // Bundle all dependencies into the main process
    build: {
      lib: {
        entry: "src/main/index.ts",
        formats: ["cjs"]
      },
      rollupOptions: {
        external: ["electron", "@prisma/client", "prisma"],
        plugins: [copyResources()]
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        "@extensions": resolve("src/extensions"),
        "@launcher": resolve("src/renderer/src/launcher"),
        "@plugins": resolve("src/plugins"),
        "@shared": resolve("src/shared")
      }
    }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@extensions": resolve("src/extensions"),
        "@launcher": resolve("src/renderer/src/launcher"),
        "@plugins": resolve("src/plugins"),
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

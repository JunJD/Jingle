import { resolve } from "path"
import { readFileSync, copyFileSync, cpSync, existsSync, mkdirSync } from "fs"
import { defineConfig } from "electron-vite"
import { buildSync } from "esbuild"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

// Plugin to copy resources to output
function copyResources(): { name: string; closeBundle: () => void } {
  return {
    name: "copy-resources",
    closeBundle(): void {
      const srcIcon = resolve("resources/icon.png")
      const srcAssets = resolve("resources/assets")
      const destDir = resolve("out/resources")
      const destAssets = resolve("out/resources/assets")
      const destIcon = resolve("out/resources/icon.png")
      const nativeSource = resolve("src/native/openwork-minimal-island.swift")
      const nativeDestDir = resolve("out/native")
      const nativeDestFile = resolve("out/native/openwork-minimal-island.swift")
      const mutationPredictorWorkerSource = resolve("src/main/agent/mutation-predictor-worker.ts")
      const mutationPredictorWorkerDestDir = resolve("out/main")
      const mutationPredictorWorkerDest = resolve("out/main/mutation-predictor-worker.mjs")

      if (existsSync(srcIcon)) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }
        copyFileSync(srcIcon, destIcon)
      }

      if (existsSync(srcAssets)) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true })
        }
        cpSync(srcAssets, destAssets, { recursive: true })
      }

      if (existsSync(nativeSource)) {
        if (!existsSync(nativeDestDir)) {
          mkdirSync(nativeDestDir, { recursive: true })
        }
        copyFileSync(nativeSource, nativeDestFile)
      }

      if (existsSync(mutationPredictorWorkerSource)) {
        if (!existsSync(mutationPredictorWorkerDestDir)) {
          mkdirSync(mutationPredictorWorkerDestDir, { recursive: true })
        }
        buildSync({
          bundle: true,
          entryPoints: [mutationPredictorWorkerSource],
          external: ["just-bash"],
          format: "esm",
          outfile: mutationPredictorWorkerDest,
          platform: "node",
          target: "node18"
        })
      }
    }
  }
}

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@ai-core": resolve("src/renderer/src/ai-core"),
        "@extension-host": resolve("src/renderer/src/extension-host"),
        "@extensions": resolve("src/extensions"),
        "@launcher-components": resolve("src/renderer/src/launcher-components"),
        "@launcher-shell": resolve("src/renderer/src/launcher-shell"),
        "@plugins": resolve("src/plugins"),
        "@shared": resolve("src/shared")
      }
    },
    // Bundle all dependencies into the main process
    build: {
      lib: {
        entry: {
          "extension-runtime-entry": resolve("src/extension-runtime/entry.ts"),
          index: resolve("src/main/index.ts")
        },
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
        "@ai-core": resolve("src/renderer/src/ai-core"),
        "@extension-host": resolve("src/renderer/src/extension-host"),
        "@extensions": resolve("src/extensions"),
        "@launcher-components": resolve("src/renderer/src/launcher-components"),
        "@launcher-shell": resolve("src/renderer/src/launcher-shell"),
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
        "@ai-core": resolve("src/renderer/src/ai-core"),
        "@extension-host": resolve("src/renderer/src/extension-host"),
        "@extensions": resolve("src/extensions"),
        "@launcher-components": resolve("src/renderer/src/launcher-components"),
        "@launcher-shell": resolve("src/renderer/src/launcher-shell"),
        "@plugins": resolve("src/plugins"),
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

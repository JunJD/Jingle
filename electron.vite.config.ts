import { resolve } from "path"
import { readFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs"
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
      const srcExtensionAssets = resolve("src/extensions")
      const bundledExtensionAssets = resolve("extensions")
      const destDir = resolve("out/resources")
      const destAssets = resolve("out/resources/assets")
      const destExtensionAssets = resolve("out/resources/extensions")
      const destIcon = resolve("out/resources/icon.png")
      const nativeDestDir = resolve("out/native")
      const nativeSources = [
        "openwork-apple-reminders.swift",
        "openwork-apple-reminders-info.plist",
        "openwork-desktop-automation.swift",
        "openwork-minimal-island.swift"
      ]
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

      for (const extensionAssetsRoot of [srcExtensionAssets, bundledExtensionAssets]) {
        if (!existsSync(extensionAssetsRoot)) {
          continue
        }

        const extensionAssetDirs = readdirSync(extensionAssetsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)

        for (const extensionName of extensionAssetDirs) {
          const sourceAssetDir = resolve(extensionAssetsRoot, extensionName, "assets")
          if (existsSync(sourceAssetDir)) {
            const targetAssetDir = resolve(destExtensionAssets, extensionName, "assets")
            rmSync(targetAssetDir, { recursive: true, force: true })
            cpSync(sourceAssetDir, targetAssetDir, { recursive: true })
          }
        }
      }

      for (const nativeSourceName of nativeSources) {
        const nativeSource = resolve("src/native", nativeSourceName)
        if (existsSync(nativeSource)) {
          if (!existsSync(nativeDestDir)) {
            mkdirSync(nativeDestDir, { recursive: true })
          }
          copyFileSync(nativeSource, resolve("out/native", nativeSourceName))
        }
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
        "@openwork/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@openwork/extension-utils": resolve("packages/extension-utils/src/index.ts"),
        "@plugins": resolve("src/plugins"),
        "@shared": resolve("src/shared")
      }
    },
    // Bundle all dependencies into the main process
    build: {
      externalizeDeps: false,
      lib: {
        entry: {
          "extension-runtime-entry": resolve("src/extension-runtime/entry.ts"),
          index: resolve("src/main/index.ts")
        },
        formats: ["cjs"]
      },
      rollupOptions: {
        external: ["electron", "@prisma/client", "just-bash"],
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
        "@openwork/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@openwork/extension-utils": resolve("packages/extension-utils/src/index.ts"),
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
        "@openwork/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@openwork/extension-utils": resolve("packages/extension-utils/src/index.ts"),
        "@plugins": resolve("src/plugins"),
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

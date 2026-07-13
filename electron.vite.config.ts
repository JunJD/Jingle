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
      const installedExtensionPackages = resolve(".jingle-build/installed-extensions")
      const destDir = resolve("out/resources")
      const destAssets = resolve("out/resources/assets")
      const destExtensionAssets = resolve("out/resources/extensions")
      const destInstalledExtensions = resolve("out/resources/installed-extensions")
      const destIcon = resolve("out/resources/icon.png")
      const nativeDestDir = resolve("out/native")
      const nativeSources = [
        "jingle-apple-reminders.swift",
        "jingle-apple-reminders-info.plist",
        "jingle-desktop-automation.swift",
        "jingle-minimal-island.swift"
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
        rmSync(destAssets, { recursive: true, force: true })
        cpSync(srcAssets, destAssets, { recursive: true })
      }

      rmSync(destExtensionAssets, { recursive: true, force: true })
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

      rmSync(destInstalledExtensions, { recursive: true, force: true })
      if (existsSync(installedExtensionPackages)) {
        cpSync(installedExtensionPackages, destInstalledExtensions, { recursive: true })
      }

      rmSync(nativeDestDir, { recursive: true, force: true })
      for (const nativeSourceName of nativeSources) {
        const nativeSource = resolve("src/native", nativeSourceName)
        if (existsSync(nativeSource)) {
          mkdirSync(nativeDestDir, { recursive: true })
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
        "@jingle/extension-api/host-runtime": resolve(
          "packages/extension-api/src/host-runtime.ts"
        ),
        "@jingle/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@jingle/extension-utils": resolve("packages/extension-utils/src/index.ts"),
        "@jingle/agent-client": resolve("packages/agent-client/src/index.ts"),
        "@jingle/agent-react": resolve("packages/agent-react/src/index.ts"),
        "@jingle/devtools-network/main": resolve("packages/devtools-network/src/main.ts"),
        "@jingle/devtools-network/protocol": resolve("packages/devtools-network/src/protocol.ts"),
        "@jingle/devtools-network": resolve("packages/devtools-network/src/index.ts"),
        "@jingle/langchain-agent-harness/transitional": resolve(
          "packages/langchain-agent-harness/src/root-transitional-api.ts"
        ),
        "@jingle/langchain-agent-harness": resolve("packages/langchain-agent-harness/src/index.ts"),
        canvas: resolve("src/main/runtime-shims/canvas.ts"),
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
        "@jingle/extension-api/host-runtime": resolve(
          "packages/extension-api/src/host-runtime.ts"
        ),
        "@jingle/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@jingle/extension-utils": resolve("packages/extension-utils/src/index.ts"),
        "@jingle/agent-client": resolve("packages/agent-client/src/index.ts"),
        "@jingle/agent-react": resolve("packages/agent-react/src/index.ts"),
        "@jingle/devtools-network/protocol": resolve("packages/devtools-network/src/protocol.ts"),
        "@jingle/devtools-network": resolve("packages/devtools-network/src/index.ts"),
        "@plugins": resolve("src/plugins"),
        "@shared": resolve("src/shared")
      }
    },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"]
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
        "@jingle/extension-api/host-runtime": resolve(
          "packages/extension-api/src/host-runtime.ts"
        ),
        "@jingle/extension-api": resolve("packages/extension-api/src/index.ts"),
        "@jingle/extension-utils": resolve("packages/extension-utils/src/index.ts"),
        "@jingle/agent-client": resolve("packages/agent-client/src/index.ts"),
        "@jingle/agent-react": resolve("packages/agent-react/src/index.ts"),
        "@jingle/devtools-network/protocol": resolve("packages/devtools-network/src/protocol.ts"),
        "@jingle/devtools-network": resolve("packages/devtools-network/src/index.ts"),
        "@plugins": resolve("src/plugins"),
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

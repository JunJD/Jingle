import { defineConfig } from "eslint/config"
import eslint from "@eslint/js"
import tseslint from "@electron-toolkit/eslint-config-ts"
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier"
import eslintPluginReact from "eslint-plugin-react"
import eslintPluginReactHooks from "eslint-plugin-react-hooks"
import eslintPluginReactRefresh from "eslint-plugin-react-refresh"

export default defineConfig(
  {
    ignores: [
      ".agents/**",
      ".jingle-build/**",
      "drafts/**",
      "electron.vite.config.*.mjs",
      "**/node_modules",
      "**/dist",
      "**/out"
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ...eslintPluginReact.configs.flat.recommended,
    files: ["**/*.{jsx,tsx}"],
    settings: {
      react: {
        version: "detect"
      }
    }
  },
  {
    ...eslintPluginReact.configs.flat["jsx-runtime"],
    files: ["**/*.{jsx,tsx}"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    files: ["src/renderer/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": eslintPluginReactHooks,
      "react-refresh": eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      "react-refresh/only-export-components": "off"
    }
  },
  {
    ...eslintConfigPrettier,
    rules: {
      ...eslintConfigPrettier.rules,
      "prettier/prettier": "off"
    }
  }
)

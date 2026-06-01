import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  buildRaycastAiMigrationArtifacts,
  buildRaycastAiMigrationPreview
} from "../../packages/extension-migration/src/preview-raycast-ai-migration.mjs"
import { validateNativeExtensionPackageBoundaries } from "../../scripts/native-extension-package-boundaries.mjs"

const repoRoot = process.cwd()

test("Raycast migration preview reports dependency decisions and unsupported APIs", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-preview-"))

  try {
    await mkdir(join(extensionRoot, "src", "tools"), { recursive: true })
    await mkdir(join(extensionRoot, "src", "utils"), { recursive: true })
    await mkdir(join(extensionRoot, "assets"), { recursive: true })
    await writeFile(join(extensionRoot, "assets", "fixture.png"), "fixture image")
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          ai: {
            instructions: "- Search before retrieving pages."
          },
          commands: [
            {
              arguments: [
                {
                  name: "query",
                  required: false,
                  type: "text"
                }
              ],
              description: "Search pages.",
              mode: "view",
              name: "search-page",
              preferences: [
                {
                  data: [
                    {
                      title: "Open in Notion",
                      value: "notion"
                    },
                    {
                      title: "Preview in Raycast",
                      value: "raycast"
                    }
                  ],
                  default: "raycast",
                  name: "primaryAction",
                  title: "Primary Action",
                  type: "dropdown"
                }
              ],
              title: "Search Pages"
            }
          ],
          dependencies: {
            "@mozilla/readability": "^0.6.0",
            "@notionhq/client": "^5.9.0",
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            "date-fns": "^4.3.0",
            linkedom: "^0.18.12",
            "notion-to-md": "^3.1.9"
          },
          devDependencies: {
            "@types/react": "19.2.13",
            eslint: "^9.39.2",
            prettier: "^3.8.1",
            typescript: "^5.9.3"
          },
          description: "Fixture extension",
          icon: "fixture.png",
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            },
            {
              default: "Notion",
              name: "open_in",
              required: false,
              title: "Open In",
              type: "appPicker"
            }
          ],
          title: "Fixture",
          tools: [
            {
              description: "Search pages.",
              name: "search-pages",
              title: "Search Pages"
            }
          ]
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "index.tsx"),
      [
        'import { Action, ActionPanel, AI, Cache, Form, Icon, LaunchProps, LaunchType, PopToRootType, getSelectedText, launchCommand, open, showHUD, showToast } from "@raycast/api"',
        'import { getAccessToken, showFailureToast, useFetch, useForm, useLocalStorage, withAccessToken } from "@raycast/utils"',
        'import { Readability } from "@mozilla/readability"',
        'import { formatDistanceToNow } from "date-fns"',
        'import { parseHTML } from "linkedom"',
        'import { NotionToMarkdown } from "notion-to-md"',
        "",
        "export default function Command(_props: LaunchProps) {",
        "  void AI.ask({ prompt: 'Summarize this page' })",
        "  void PopToRootType.Suspended",
        "  void getSelectedText()",
        "  void open('notion://www.notion.so/page-1', { name: 'Notion' })",
        "  void launchCommand({ name: 'quick-capture', type: LaunchType.UserInitiated, fallbackText: 'https://example.com/article' })",
        "  void new Cache({ namespace: 'notion-preview' }).set('recent', 'page-1')",
        "  void showToast({ title: 'UI toast is supported' })",
        "  void showFailureToast(new Error('UI helper failure'))",
        "  void getAccessToken({ personalAccessToken: 'fallback-token' })",
        "  void useFetch('https://api.notion.test/search')",
        "  void useLocalStorage('recent-pages', [])",
        "  void Readability",
        "  void formatDistanceToNow",
        "  void parseHTML",
        "  const { itemProps } = useForm({ initialValues: { title: '' } })",
        "  return (",
        "    <Form>",
        '      <Form.Description text="Supported in Openwork" />',
        '      <Form.TextField title="Title" {...itemProps.title} />',
        "      <ActionPanel>",
        "        <Action.CreateQuicklink quicklink={{ name: 'Create Notion page', link: 'raycast://extensions/HenriChabrand/notion/create-database-page' }} />",
        "        <Action title=\"Open in Raycast\" onAction={() => void 'raycast'} />",
        "        <Action title=\"Run\" icon={Icon.Upload} onAction={() => showHUD('Done')} />",
        "      </ActionPanel>",
        "    </Form>",
        "  )",
        "}",
        "void NotionToMarkdown"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "tools", "search-pages.ts"),
      [
        'import { showToast } from "@raycast/api"',
        'import { withAccessToken } from "@raycast/utils"',
        'import { readPage } from "../utils/notion"',
        'import { getNotionClient, service } from "../oauth"',
        "",
        "interface Input {",
        "  query: string",
        "}",
        "",
        "export default withAccessToken(service)(async function tool(_input: Input) {",
        "  void getNotionClient()",
        "  void readPage()",
        "  await showToast({ title: 'Tool toast should be returned instead' })",
        "  return []",
        "})",
        "",
        "export const confirmation = withAccessToken(service)(async (input: Input) => {",
        "  return {",
        "    title: 'Search pages?',",
        "    message: 'Search Notion before continuing.',",
        "    facts: [",
        "      { label: 'query', value: input.query }",
        "    ]",
        "  }",
        "})"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "utils", "notion.ts"),
      [
        'import { showToast } from "@raycast/api"',
        'import { getNotionClient } from "../oauth"',
        'import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints"',
        "",
        "export function readPage() {",
        "  void showToast",
        "  void ({} as BlockObjectRequest)",
        "  return getNotionClient()",
        "}"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "oauth.ts"),
      [
        'import { OAuth } from "@raycast/api"',
        'import { OAuthService } from "@raycast/utils"',
        "",
        "export const service = new OAuthService({",
        "  client: new OAuth.PKCEClient({ providerName: 'Notion' }),",
        "  authorizeUrl: 'https://fixture.oauth.raycast.com/authorize',",
        "  tokenUrl: 'https://fixture.oauth.raycast.com/token',",
        "  personalAccessToken: 'secret_token',",
        "  onAuthorize({ token }) {",
        "    void token",
        "  }",
        "})",
        "",
        "export function getNotionClient() {",
        "  return {}",
        "}"
      ].join("\n")
    )

    const output = execFileSync(
      process.execPath,
      ["scripts/preview-raycast-ai-migration.mjs", extensionRoot],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
    const preview = JSON.parse(output)
    const packagePreview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    const serializedPackagePreview = JSON.parse(JSON.stringify(packagePreview))

    assert.deepEqual(preview.manifestPreview.aiCapability.toolNames, ["searchPages"])
    assert.deepEqual(preview.manifestPreview.aiCapability.requiredPreferenceNames, ["accessToken"])
    assert.deepEqual(preview.manifestPreview.connection.auth.secretNames, ["accessToken"])
    assert.deepEqual(preview.manifestPreview.capabilities, ["navigation", "surface"])
    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, [
      "ai",
      "clipboard",
      "navigation",
      "preferences",
      "quicklinks",
      "settings",
      "shell",
      "storage",
      "toast"
    ])
    assert.deepEqual(preview.manifestPreview.runtimeShell, { allowedUrlSchemes: ["notion"] })
    assert.deepEqual(
      preview.manifestPreview.preferences.map((preference: { name: string }) => preference.name),
      ["accessToken", "open_in"]
    )
    assert.deepEqual(
      preview.manifestPreview.preferences.find(
        (preference: { name: string }) => preference.name === "open_in"
      ),
      {
        default: {
          name: "Notion"
        },
        name: "open_in",
        required: false,
        title: "Open In",
        type: "appPicker"
      }
    )
    assert.deepEqual(serializedPackagePreview.manifestPreview, preview.manifestPreview)
    assert.deepEqual(
      serializedPackagePreview.unsupportedApis.counts,
      preview.unsupportedApis.counts
    )
    assert.deepEqual(
      serializedPackagePreview.runtimeCompatibility.counts,
      preview.runtimeCompatibility.counts
    )
    assert.deepEqual(preview.runtimeCompatibility, preview.unsupportedApis)
    assert.deepEqual(preview.utilsBoundaryReport, {
      counts: {
        pureHelpers: 0,
        runtimeBound: 1,
        toolReachableRuntimeBound: 1,
        utilsFiles: 1
      },
      entries: [
        {
          classification: "runtime-bound",
          file: "src/utils/notion.ts",
          recommendation:
            "AI tool migration reaches a runtime-bound utils module; split pure helpers before promoting this path to main/domain tools.",
          runtimeImports: ["@raycast/api"],
          runtimeMembers: [],
          toolReachable: true
        }
      ]
    })
    assert.deepEqual(preview.feasibility.score, {
      manifest: "high",
      migrationReport: "medium",
      toolHandlers: "high",
      toolInputSchemas: "high",
      toolMetadata: "high",
      uiCommands: "medium"
    })
    assert.deepEqual(Object.keys(buildRaycastAiMigrationArtifacts(packagePreview)).sort(), [
      "dependency-report.md",
      "main.preview.ts",
      "manifest.patch.json",
      "manifest.preview.ts",
      "migration-preview.json",
      "openwork-package/assets/fixture.png",
      "openwork-package/identity.ts",
      "openwork-package/main.ts",
      "openwork-package/main/migrated-src/oauth.ts",
      "openwork-package/main/migrated-src/tools/search-pages.ts",
      "openwork-package/main/migrated-src/utils/notion.ts",
      "openwork-package/main/tools.ts",
      "openwork-package/manifest.ts",
      "openwork-package/package.json",
      "openwork-package/runtime-metadata.ts",
      "openwork-package/runtime.ts",
      "openwork-package/src/index.tsx",
      "openwork-package/src/oauth.ts",
      "openwork-package/src/search-page.meta.ts",
      "openwork-package/src/search-page.tsx",
      "openwork-package/src/tools/search-pages.ts",
      "openwork-package/src/utils/notion.ts",
      "openwork-package/tsconfig.check.json",
      "openwork-package/types.d.ts",
      "package.preview.json",
      "runtime-compatibility.json",
      "tools.preview.json",
      "tools.preview.ts",
      "unsupported-apis.json",
      "utils-boundary-report.json"
    ])
    assert.deepEqual(pickDependency(preview, "@raycast/api"), {
      category: "runtime-facade",
      declaredAs: "dependency",
      decision: "rewrite-import",
      importedBy: ["src/index.tsx", "src/oauth.ts", "src/tools/search-pages.ts", "src/utils/notion.ts"],
      name: "@raycast/api",
      openworkTarget: "@openwork/extension-api",
      version: "^1.104.5"
    })
    assert.equal(pickDependency(preview, "@raycast/utils").decision, "rewrite-import-with-adapters")
    assert.equal(pickDependency(preview, "notion-to-md").decision, "keep-direct-dependency")
    assert.equal(pickDependency(preview, "@mozilla/readability").decision, "keep-direct-dependency")
    assert.equal(pickDependency(preview, "date-fns").decision, "keep-direct-dependency")
    assert.equal(pickDependency(preview, "linkedom").decision, "keep-direct-dependency")
    assert.equal(pickDependency(preview, "@notionhq/client").declaredAs, "dependency")
    assert.deepEqual(pickDependency(preview, "@notionhq/client").importedBy, [
      "src/utils/notion.ts"
    ])
    assert.equal(
      preview.dependencyReport.some((entry: { name: string }) => entry.name === "typescript"),
      false
    )
    assert.equal(
      preview.dependencyReport.some((entry: { name: string }) => entry.name === "eslint"),
      false
    )
    assert.equal(preview.unsupportedApis.counts.files, 1)
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
    assert.equal(preview.unsupportedApis.counts.blockingAdapters, 0)
    assert.equal(preview.unsupportedApis.counts.compatibilityNotes, 2)
    assert.equal(preview.unsupportedApis.counts.degradationNotes, 0)
    assert.equal(preview.unsupportedApis.counts.migrationNotes, 2)
    assert.equal(preview.unsupportedApis.counts.unsupportedImports, 0)
    assert.equal(preview.unsupportedApis.counts.unsupportedMembers, 0)

    const indexEntry = preview.unsupportedApis.entries.find(
      (entry: { file: string }) => entry.file === "src/index.tsx"
    )
    assert.equal(indexEntry, undefined)

    const toolEntry = preview.unsupportedApis.entries.find(
      (entry: { file: string }) => entry.file === "src/tools/search-pages.ts"
    )
    assert.equal(toolEntry, undefined)

    const oauthEntry = preview.unsupportedApis.entries.find(
      (entry: { file: string }) => entry.file === "src/oauth.ts"
    )
    assert.ok(oauthEntry)
    assert.deepEqual(
      oauthEntry.unsupportedImports.map((entry: { import: string; status: string }) => [
        entry.import,
        entry.status
      ]),
      []
    )
    assert.deepEqual(oauthEntry.adapterNotes, [])
    assert.deepEqual(
      oauthEntry.migrationNotes.map((entry: { import: string; status: string }) => [
        entry.import,
        entry.status
      ]),
      [
        ["OAuth", "supported-with-migration-note"],
        ["OAuthService", "supported-with-migration-note"]
      ]
    )
    assert.deepEqual(oauthEntry.blockingAdapters, [])

    const artifactDir = join(extensionRoot, "migration-artifacts")
    execFileSync(
      process.execPath,
      ["scripts/preview-raycast-ai-migration.mjs", extensionRoot, "--out-dir", artifactDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )

    assert.deepEqual((await listArtifactFiles(artifactDir)).sort(), [
      "dependency-report.md",
      "main.preview.ts",
      "manifest.patch.json",
      "manifest.preview.ts",
      "migration-preview.json",
      "openwork-package/assets/fixture.png",
      "openwork-package/identity.ts",
      "openwork-package/main.ts",
      "openwork-package/main/migrated-src/oauth.ts",
      "openwork-package/main/migrated-src/tools/search-pages.ts",
      "openwork-package/main/migrated-src/utils/notion.ts",
      "openwork-package/main/tools.ts",
      "openwork-package/manifest.ts",
      "openwork-package/package.json",
      "openwork-package/runtime-metadata.ts",
      "openwork-package/runtime.ts",
      "openwork-package/src/index.tsx",
      "openwork-package/src/oauth.ts",
      "openwork-package/src/search-page.meta.ts",
      "openwork-package/src/search-page.tsx",
      "openwork-package/src/tools/search-pages.ts",
      "openwork-package/src/utils/notion.ts",
      "openwork-package/tsconfig.check.json",
      "openwork-package/types.d.ts",
      "package.preview.json",
      "runtime-compatibility.json",
      "tools.preview.json",
      "tools.preview.ts",
      "unsupported-apis.json",
      "utils-boundary-report.json"
    ])

    const manifestPatch = JSON.parse(
      await readFile(join(artifactDir, "manifest.patch.json"), "utf8")
    )
    assert.deepEqual(manifestPatch.aiCapability.toolNames, ["searchPages"])
    assert.deepEqual(manifestPatch.connection.auth.secretNames, ["accessToken"])
    assert.deepEqual(manifestPatch.capabilities, ["navigation", "surface"])
    assert.deepEqual(manifestPatch.runtimeCapabilities, [
      "ai",
      "clipboard",
      "navigation",
      "preferences",
      "quicklinks",
      "settings",
      "shell",
      "storage",
      "toast"
    ])
    assert.deepEqual(manifestPatch.runtimeShell, { allowedUrlSchemes: ["notion"] })
    assert.deepEqual(manifestPatch.commands[0]?.arguments, [
      {
        name: "query",
        required: false,
        type: "text"
      }
    ])
    assert.deepEqual(manifestPatch.commands[0]?.runtime, { viewport: { bodyHeight: 520 } })
    assert.deepEqual(manifestPatch.commands[0]?.preferences[0]?.default, "openwork")
    assert.deepEqual(manifestPatch.commands[0]?.preferences[0]?.data, [
      {
        title: "Open in Notion",
        value: "notion"
      },
      {
        title: "Preview in Openwork",
        value: "openwork"
      }
    ])
    assert.deepEqual(manifestPatch.aiCapability.instructions, ["Search before retrieving pages."])
    assert.deepEqual(
      manifestPatch.preferences.map((preference: { name: string }) => preference.name),
      ["accessToken", "open_in"]
    )
    assert.deepEqual(
      manifestPatch.preferences.find(
        (preference: { name: string }) => preference.name === "open_in"
      ),
      {
        default: {
          name: "Notion"
        },
        name: "open_in",
        required: false,
        title: "Open In",
        type: "appPicker"
      }
    )

    const manifestPreviewSource = await readFile(join(artifactDir, "manifest.preview.ts"), "utf8")
    assert.match(manifestPreviewSource, /defineNativeExtensionManifest/)
    assert.match(manifestPreviewSource, /export const fixtureManifest/)
    assert.match(manifestPreviewSource, /aiCapability/)
    assert.doesNotMatch(manifestPreviewSource, /migratedManifest/)
    assert.doesNotMatch(manifestPreviewSource, /@raycast\/api|@raycast\/utils/)

    const mainPreviewSource = await readFile(join(artifactDir, "main.preview.ts"), "utf8")
    assert.match(mainPreviewSource, /defineNativeExtensionMain/)
    assert.match(mainPreviewSource, /export const fixtureMain/)
    assert.match(mainPreviewSource, /createFixtureTools/)
    assert.doesNotMatch(mainPreviewSource, /migratedMain|createMigratedTools/)
    assert.doesNotMatch(mainPreviewSource, /@raycast\/api|@raycast\/utils/)

    const packagePreviewJson = JSON.parse(
      await readFile(join(artifactDir, "package.preview.json"), "utf8")
    )
    assert.deepEqual(packagePreviewJson, {
      dependencies: {
        "@mozilla/readability": "^0.6.0",
        "@notionhq/client": "^5.22.0",
        "@openwork/extension-api": "workspace:*",
        "@openwork/extension-utils": "workspace:*",
        "date-fns": "^4.3.0",
        linkedom: "^0.18.12",
        "notion-to-md": "^3.1.9",
        zod: "^4.0.0"
      },
      main: "./main.ts",
      name: "@openwork/extension-fixture",
      private: true,
      type: "module",
      types: "./manifest.ts",
      version: "0.0.0"
    })

    const openworkPackageJson = JSON.parse(
      await readFile(join(artifactDir, "openwork-package", "package.json"), "utf8")
    )
    assert.deepEqual(openworkPackageJson, packagePreviewJson)
    const openworkMain = await readFile(join(artifactDir, "openwork-package", "main.ts"), "utf8")
    assert.match(openworkMain, /from "\.\/main\/tools"/)
    assert.match(openworkMain, /fixtureMain/)
    assert.match(openworkMain, /createFixtureTools/)
    assert.doesNotMatch(openworkMain, /@raycast\/api|@raycast\/utils/)
    const openworkManifest = await readFile(
      join(artifactDir, "openwork-package", "manifest.ts"),
      "utf8"
    )
    assert.match(openworkManifest, /defineNativeExtensionManifest/)
    assert.match(openworkManifest, /fixtureManifest/)
    assert.match(
      openworkManifest,
      /import \{ viewport as searchPageViewport \} from "\.\/src\/search-page\.meta"/
    )
    assert.match(openworkManifest, /"viewport": searchPageViewport/)
    assert.doesNotMatch(openworkManifest, /@raycast\/api|@raycast\/utils/)
    assert.doesNotMatch(openworkManifest, /Raycast|raycast/)
    const openworkTools = await readFile(
      join(artifactDir, "openwork-package", "main", "tools.ts"),
      "utf8"
    )
    assert.match(openworkTools, /createFixtureTools/)
    assert.match(openworkTools, /runMigratedTool/)
    assert.match(openworkTools, /requestMigratedToolHost/)
    assert.match(openworkTools, /request\.capability === "toast"/)
    assert.match(openworkTools, /request\.capability === "navigation"/)
    assert.match(openworkTools, /searchPagesConfirmation/)
    assert.match(openworkTools, /approval: \{/)
    assert.match(openworkTools, /import\("\.\.\/main\/migrated-src\/tools\/search-pages"\)\)\.default/)
    assert.match(openworkTools, /import\("\.\.\/main\/migrated-src\/tools\/search-pages"\)\)\.confirmation/)
    assert.doesNotMatch(openworkTools, /createMigratedTools/)
    assert.doesNotMatch(
      openworkTools,
      /Migrate src\/tools\/search-pages\.ts into an Openwork handler/
    )
    assert.doesNotMatch(openworkTools, /@raycast\/api|@raycast\/utils/)

    const openworkRuntime = await readFile(
      join(artifactDir, "openwork-package", "runtime.ts"),
      "utf8"
    )
    assert.match(openworkRuntime, /defineNativeExtensionRuntime/)
    assert.match(openworkRuntime, /FixtureSearchPageCommand/)
    assert.match(openworkRuntime, /import FixtureSearchPageCommandSource from "\.\/src\/search-page"/)
    assert.match(openworkRuntime, /FixtureSearchPageCommandSource as ComponentType/)
    assert.match(openworkRuntime, /extensionName: "fixture"/)
    assert.match(openworkRuntime, /"\bsearch-page\b"/)
    assert.doesNotMatch(openworkRuntime, /@raycast\/api|@raycast\/utils/)

    const generatedCommandMeta = await readFile(
      join(artifactDir, "openwork-package", "src", "search-page.meta.ts"),
      "utf8"
    )
    assert.match(generatedCommandMeta, /bodyHeight: 520/)

    const generatedCommandWrapper = await readFile(
      join(artifactDir, "openwork-package", "src", "search-page.tsx"),
      "utf8"
    )
    assert.equal(generatedCommandWrapper, 'export { default } from "./index"\n')

    const openworkRuntimeMetadata = await readFile(
      join(artifactDir, "openwork-package", "runtime-metadata.ts"),
      "utf8"
    )
    assert.match(openworkRuntimeMetadata, /defineNativeExtensionRuntimeMetadata/)
    assert.match(openworkRuntimeMetadata, /name: "search-page"/)
    assert.match(openworkRuntimeMetadata, /const commandSearchConfigs/)
    assert.match(openworkRuntimeMetadata, /aliases/)
    assert.match(openworkRuntimeMetadata, /commandName": "search-page"/)
    const openworkIdentity = await readFile(
      join(artifactDir, "openwork-package", "identity.ts"),
      "utf8"
    )
    assert.match(openworkIdentity, /subjectTerms: \[\s*"fixture"\s*\]/)
    assert.match(openworkIdentity, /export const EXTENSION_SUBJECT_TERMS = EXTENSION_IDENTITY\.subjectTerms/)
    assert.match(openworkRuntimeMetadata, /resolveCommand/)
    assert.doesNotMatch(openworkRuntimeMetadata, /config\.aliases\.includes\(query\)/)
    assert.doesNotMatch(openworkRuntimeMetadata, /@shared\/launcher/)

    const typecheckConfig = JSON.parse(
      await readFile(join(artifactDir, "openwork-package", "tsconfig.check.json"), "utf8")
    )
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@openwork/extension-api"], [
      join(repoRoot, "packages/extension-api/src/index.ts")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@openwork/extension-utils"], [
      join(repoRoot, "packages/extension-utils/src/index.ts")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@mozilla/readability"], [
      join(repoRoot, "node_modules/@mozilla/readability")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@mozilla/readability/*"], [
      join(repoRoot, "node_modules/@mozilla/readability/*")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@notionhq/client"], [
      join(repoRoot, "node_modules/@notionhq/client")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["@notionhq/client/*"], [
      join(repoRoot, "node_modules/@notionhq/client/*")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["date-fns"], [
      join(repoRoot, "node_modules/date-fns")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["date-fns/*"], [
      join(repoRoot, "node_modules/date-fns/*")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths.linkedom, [
      join(repoRoot, "node_modules/linkedom")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["linkedom/*"], [
      join(repoRoot, "node_modules/linkedom/*")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["notion-to-md"], [
      join(repoRoot, "node_modules/notion-to-md")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["notion-to-md/*"], [
      join(repoRoot, "node_modules/notion-to-md/*")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths.zod, [
      join(repoRoot, "node_modules/zod")
    ])
    assert.deepEqual(typecheckConfig.compilerOptions.paths["zod/*"], [
      join(repoRoot, "node_modules/zod/*")
    ])
    assert.equal(Object.hasOwn(typecheckConfig.compilerOptions.paths, "react"), false)
    assert.equal(Object.hasOwn(typecheckConfig.compilerOptions.paths, "react/jsx-runtime"), false)
    assert.equal(typecheckConfig.compilerOptions.moduleResolution, "Bundler")
    assert.equal(typecheckConfig.compilerOptions.noImplicitReturns, true)
    assert.equal(typecheckConfig.compilerOptions.noUnusedLocals, true)
    assert.equal(typecheckConfig.compilerOptions.noUnusedParameters, true)
    assert.deepEqual(typecheckConfig.include, [
      "main.ts",
      "main/**/*.ts",
      "identity.ts",
      "manifest.ts",
      "runtime-metadata.ts",
      "runtime.ts",
      "src/**/*.ts",
      "src/**/*.tsx",
      "types.d.ts"
    ])

    const openworkTypes = await readFile(
      join(artifactDir, "openwork-package", "types.d.ts"),
      "utf8"
    )
    assert.match(openworkTypes, /namespace Preferences/)
    assert.match(openworkTypes, /type Extension/)
    assert.match(openworkTypes, /open_in\?: RuntimeOpenApplication/)
    assert.match(openworkTypes, /namespace Arguments/)
    assert.match(openworkTypes, /type SearchPage/)
    assert.match(openworkTypes, /query\?: string/)

    const migratedCommandSource = await readFile(
      join(artifactDir, "openwork-package", "src", "index.tsx"),
      "utf8"
    )
    assert.match(migratedCommandSource, /from "@openwork\/extension-api"/)
    assert.match(migratedCommandSource, /from "@openwork\/extension-utils"/)
    assert.doesNotMatch(migratedCommandSource, /@raycast\/api|@raycast\/utils/)
    assert.doesNotMatch(migratedCommandSource, /Raycast|raycast/)
    assert.match(migratedCommandSource, /import React from "react"\nvoid React/)

    const migratedOauthSource = await readFile(
      join(artifactDir, "openwork-package", "src", "oauth.ts"),
      "utf8"
    )
    assert.doesNotMatch(migratedOauthSource, /raycast\.com/)

    const migratedToolSource = await readFile(
      join(artifactDir, "openwork-package", "src", "tools", "search-pages.ts"),
      "utf8"
    )
    assert.match(migratedToolSource, /from "@openwork\/extension-api"/)
    assert.match(migratedToolSource, /from "@openwork\/extension-utils"/)
    assert.doesNotMatch(migratedToolSource, /@raycast\/api|@raycast\/utils/)

    const migratedAsset = await readFile(
      join(artifactDir, "openwork-package", "assets", "fixture.png"),
      "utf8"
    )
    assert.equal(migratedAsset, "fixture image")

    const toolsPreview = JSON.parse(await readFile(join(artifactDir, "tools.preview.json"), "utf8"))
    assert.deepEqual(
      toolsPreview.map((tool: { openworkName: string }) => tool.openworkName),
      ["searchPages"]
    )
    assert.deepEqual(toolsPreview[0]?.confirmation, {
      exportName: "confirmation",
      sourceFile: "src/tools/search-pages.ts"
    })
    assert.match(toolsPreview[0]?.zodSchemaDraft ?? "", /query/)

    const toolsPreviewSource = await readFile(join(artifactDir, "tools.preview.ts"), "utf8")
    assert.match(
      toolsPreviewSource,
      /import \{ runWithExtensionRuntimeSdk \} from "@openwork\/extension-api"/
    )
    assert.match(
      toolsPreviewSource,
      /import type \{ ExtensionToolConfirmation, ExtensionToolContext, ExtensionToolDefinition \} from "@openwork\/extension-api"/
    )
    assert.match(toolsPreviewSource, /createFixtureTools/)
    assert.match(toolsPreviewSource, /const searchPagesInputSchema = z\.object/)
    assert.match(toolsPreviewSource, /runMigratedTool/)
    assert.match(toolsPreviewSource, /requestMigratedToolHost/)
    assert.match(toolsPreviewSource, /searchPagesConfirmation/)
    assert.match(
      toolsPreviewSource,
      /import\("\.\/openwork-package\/main\/migrated-src\/tools\/search-pages"\)\)\.default/
    )
    assert.match(
      toolsPreviewSource,
      /import\("\.\/openwork-package\/main\/migrated-src\/tools\/search-pages"\)\)\.confirmation/
    )
    assert.match(toolsPreviewSource, /name: "searchPages"/)
    assert.match(toolsPreviewSource, /access: "read"/)
    assert.doesNotMatch(
      toolsPreviewSource,
      /Migrate src\/tools\/search-pages\.ts into an Openwork handler/
    )
    assert.doesNotMatch(toolsPreviewSource, /@raycast\/api|@raycast\/utils/)

    const unsupportedApis = JSON.parse(
      await readFile(join(artifactDir, "unsupported-apis.json"), "utf8")
    )
    const runtimeCompatibility = JSON.parse(
      await readFile(join(artifactDir, "runtime-compatibility.json"), "utf8")
    )
    assert.deepEqual(runtimeCompatibility, unsupportedApis)
    assert.equal(unsupportedApis.counts.blockingIssues, 0)
    assert.equal(unsupportedApis.counts.blockingAdapters, 0)
    assert.equal(unsupportedApis.counts.compatibilityNotes, 2)
    assert.equal(unsupportedApis.counts.degradationNotes, 0)
    assert.equal(unsupportedApis.counts.migrationNotes, 2)

    const migrationPreview = JSON.parse(
      await readFile(join(artifactDir, "migration-preview.json"), "utf8")
    )
    assert.deepEqual(
      migrationPreview.sourceMigration.sourceFiles
        .map((file: { outputPath: string }) => file.outputPath)
        .sort(),
      [
        "openwork-package/main/migrated-src/oauth.ts",
        "openwork-package/main/migrated-src/tools/search-pages.ts",
        "openwork-package/main/migrated-src/utils/notion.ts",
        "openwork-package/src/index.tsx",
        "openwork-package/src/oauth.ts",
        "openwork-package/src/tools/search-pages.ts",
        "openwork-package/src/utils/notion.ts"
      ]
    )
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        migrationPreview.sourceMigration.sourceFiles[0],
        "sourceText"
      ),
      false
    )

    const dependencyReport = await readFile(join(artifactDir, "dependency-report.md"), "utf8")
    assert.match(dependencyReport, /@raycast\/api/)
    assert.match(dependencyReport, /rewrite-import/)
    assert.match(dependencyReport, /## Runtime Compatibility Summary/)
    assert.match(dependencyReport, /## Utils Boundary Summary/)
    assert.match(dependencyReport, /Blocking issues: 0/)
    assert.match(dependencyReport, /AI tool reachable runtime-bound utils: 1/)

    const utilsBoundaryReport = JSON.parse(
      await readFile(join(artifactDir, "utils-boundary-report.json"), "utf8")
    )
    assert.deepEqual(utilsBoundaryReport, preview.utilsBoundaryReport)
    assert.match(dependencyReport, /Compatibility notes: 2/)
    assert.match(dependencyReport, /Tool handlers: high/)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview wires git extension command sources into generated runtime", async () => {
  const repoRootDir = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-git-"))
  const extensionRoot = join(repoRootDir, "extensions", "notion")

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "search-page",
              title: "Search Page"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.0.0"
          },
          name: "notion",
          title: "Notion"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "search-page.tsx"),
      [
        'import { Action, ActionPanel, List } from "@raycast/api"',
        "",
        "export default function SearchPage() {",
        '  return <List><List.EmptyView title="No pages" actions={<ActionPanel><Action.CreateQuicklink quicklink={{ name: "Search generated pages", link: "raycast://extensions/acme/fixture/search-page?launchContext=%7B%22defaults%22%3A%7B%22query%22%3A%22spec%22%7D%7D" }} /></ActionPanel>} /></List>',
        "}"
      ].join("\n")
    )
    execFileSync("git", ["-C", repoRootDir, "init"], { encoding: "utf8" })
    execFileSync("git", ["-C", repoRootDir, "add", "."], { encoding: "utf8" })
    execFileSync(
      "git",
      [
        "-C",
        repoRootDir,
        "-c",
        "user.name=Openwork Test",
        "-c",
        "user.email=openwork@example.test",
        "commit",
        "-m",
        "fixture"
      ],
      { encoding: "utf8" }
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: "extensions/notion",
      gitRef: "HEAD",
      gitRepo: repoRootDir,
      out: null
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)

    assert.deepEqual(
      preview.sourceMigration.sourceFiles.map((file: { path: string }) => file.path),
      ["src/search-page.tsx"]
    )
    assert.match(
      String(artifacts["openwork-package/runtime.ts"]),
      /import \w+SearchPageCommandSource from "\.\/src\/search-page"/
    )
    assert.doesNotMatch(
      String(artifacts["openwork-package/runtime.ts"]),
      /Migrate command source for search-page/
    )
    assert.ok(artifacts["openwork-package/src/search-page.tsx"])
  } finally {
    await rm(repoRootDir, { force: true, recursive: true })
  }
})

test("Raycast migration preview infers host capabilities from action components", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-actions-"))

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "search-page",
              title: "Search Page"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.0.0"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "search-page.tsx"),
      [
        'import { Action, ActionPanel, List } from "@raycast/api"',
        "",
        "export default function SearchPage() {",
        "  return (",
        "    <List>",
        "      <List.Item",
        '        title="Page"',
        "        actions={",
        "          <ActionPanel>",
        '            <Action.CopyToClipboard content="https://example.com/page" />',
        '            <Action.Paste content="https://example.com/page" />',
        '            <Action.OpenInBrowser url="https://example.com/page" />',
        "          </ActionPanel>",
        "        }",
        "      />",
        "    </List>",
        "  )",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })

    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, ["clipboard", "shell"])
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview infers host capabilities from navigation and HUD helpers", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-helpers-"))

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "command",
              title: "Command"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.0.0"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "command.tsx"),
      [
        'import { Action, ActionPanel, LaunchType, List, launchCommand, showHUD } from "@raycast/api"',
        "",
        "export default function Command() {",
        "  return (",
        "    <List>",
        "      <List.Item",
        '        title="Command"',
        "        actions={",
        "          <ActionPanel>",
        "            <Action",
        '              title="Run"',
        "              onAction={() => {",
        "                void showHUD('Done')",
        "                void launchCommand({ name: 'target', type: LaunchType.UserInitiated })",
        "              }}",
        "            />",
        "          </ActionPanel>",
        "        }",
        "      />",
        "    </List>",
        "  )",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })

    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, ["navigation", "toast"])
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview supports Raycast preferences settings helpers", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-preferences-"))

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "command",
              title: "Command"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.0.0"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "command.tsx"),
      [
        'import { Action, ActionPanel, List, openCommandPreferences, openExtensionPreferences } from "@raycast/api"',
        "",
        "export default function Command() {",
        "  return (",
        "    <List>",
        "      <List.Item",
        '        title="Command"',
        "        actions={",
        "          <ActionPanel>",
        '            <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />',
        '            <Action title="Open Command Preferences" onAction={openCommandPreferences} />',
        "          </ActionPanel>",
        "        }",
        "      />",
        "    </List>",
        "  )",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)

    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, ["settings"])
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
    assert.match(
      String(artifacts["openwork-package/src/command.tsx"]),
      /from "@openwork\/extension-api"/
    )
    assert.match(String(artifacts["openwork-package/src/command.tsx"]), /openCommandPreferences/)
    assert.match(String(artifacts["openwork-package/src/command.tsx"]), /openExtensionPreferences/)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview infers storage capability from storeValue controls", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-store-value-"))

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "command",
              title: "Command"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.0.0"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "command.tsx"),
      [
        'import { Form as RaycastForm, List } from "@raycast/api"',
        "",
        "export default function Command() {",
        "  return (",
        "    <List",
        "      searchBarAccessory={",
        '        <List.Dropdown tooltip="Sort" storeValue>',
        '          <List.Dropdown.Item title="Created" value="created_time" />',
        "        </List.Dropdown>",
        "      }",
        "    >",
        '      <List.Item title="Command" />',
        "    </List>",
        "  )",
        "}",
        "",
        "function SettingsForm() {",
        "  return (",
        "    <RaycastForm>",
        '      <RaycastForm.Dropdown id="mode" title="Mode" storeValue={true}>',
        '        <RaycastForm.Dropdown.Item title="Default" value="default" />',
        "      </RaycastForm.Dropdown>",
        "    </RaycastForm>",
        "  )",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })

    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, ["storage"])
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview does not infer runtime capabilities from type-only Raycast imports", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-type-only-"))

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              mode: "view",
              name: "command",
              title: "Command"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            react: "^19.0.0"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "command.tsx"),
      [
        'import { List, type LocalStorage } from "@raycast/api"',
        'import type { Clipboard } from "@raycast/api"',
        'import { type useLocalStorage } from "@raycast/utils"',
        "",
        "type StoredValue = Awaited<ReturnType<typeof LocalStorage.getItem>>",
        "type ClipboardValue = typeof Clipboard",
        "type StorageHook = typeof useLocalStorage",
        "",
        "export default function Command() {",
        '  return <List><List.Item title="Command" /></List>',
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })

    assert.deepEqual(preview.manifestPreview.runtimeCapabilities, [])
    assert.equal(preview.unsupportedApis.counts.blockingIssues, 0)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated tool handlers run migrated Raycast auth utilities", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-tools-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "src", "tools"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            zod: "^4.0.0"
          },
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture",
          tools: [
            {
              description: "Search pages.",
              name: "search-pages",
              title: "Search Pages"
            }
          ]
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "oauth.ts"),
      [
        'import { OAuthService } from "@raycast/utils"',
        "",
        "export const service = new OAuthService({",
        '  personalAccessToken: "fallback-token"',
        "})"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "tools", "search-pages.ts"),
      [
        'import { getPreferenceValues } from "@raycast/api"',
        'import { withAccessToken } from "@raycast/utils"',
        'import { service } from "../oauth"',
        "",
        "type Input = {",
        "  query: string",
        "}",
        "",
        "export default withAccessToken(service)(async (input: Input) => {",
        "  const preferences = getPreferenceValues<{ accessToken?: string }>()",
        "  return {",
        "    query: input.query,",
        "    token: preferences.accessToken ?? null",
        "  }",
        "})",
        "",
        "export const confirmation = withAccessToken(service)(async (input: Input) => {",
        "  const preferences = getPreferenceValues<{ accessToken?: string }>()",
        "  return {",
        "    title: 'Search pages?',",
        "    message: input.query,",
        "    facts: [",
        "      { label: 'token', value: preferences.accessToken ?? 'missing', mono: true }",
        "    ]",
        "  }",
        "})"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)
    const migratedOauthSource = String(artifacts["openwork-package/src/oauth.ts"])
    assert.doesNotMatch(migratedOauthSource, /getConnectionSecret/)

    await writeArtifacts(artifactDir, artifacts)
    await writeFile(
      join(artifactDir, "openwork-package", "run-tool.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { createFixtureTools } from "./main/tools"',
        "",
        "const [tool] = createFixtureTools()",
        "assert.ok(tool)",
        "const result = await tool.handler(",
        "  {",
        '    extensionName: "fixture",',
        '    extensionPreferences: { accessToken: "secret-token" },',
        '    threadId: "thread-1",',
        '    toolName: "searchPages",',
        '    workspacePath: "/workspace"',
        "  },",
        '  { query: "roadmap" }',
        ")",
        'assert.deepEqual(result, { query: "roadmap", token: "secret-token" })',
        "const confirmation = await tool.approval?.confirmation?.(",
        '  { query: "roadmap" },',
        "  {",
        '    access: "read",',
        '    capabilityDisplayName: "Fixture",',
        '    extensionName: "fixture",',
        '    extensionPreferences: { accessToken: "secret-token" },',
        '    permissionMode: "ask-to-edit",',
        '    threadId: "thread-1",',
        '    toolName: "searchPages",',
        '    toolTitle: "Search Pages",',
        '    workspacePath: "/workspace"',
        "  }",
        ")",
        "assert.deepEqual(confirmation, {",
        "  facts: [{ label: 'token', value: 'secret-token', mono: true }],",
        "  message: 'roadmap',",
        "  title: 'Search pages?'",
        "})"
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "run-tool.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated Notion-style tools initialize module Notion client inside SDK context", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-notion-tool-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "src", "tools"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            zod: "^4.0.0"
          },
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture",
          tools: [
            {
              description: "Get a Notion page.",
              name: "get-page",
              title: "Get Page"
            }
          ]
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "oauth.ts"),
      [
        'import { OAuth, getPreferenceValues } from "@raycast/api"',
        'import { OAuthService } from "@raycast/utils"',
        "",
        "const { notion_token } = getPreferenceValues<Preferences>()",
        "let notion: { token: string } | null = null",
        "",
        "export const notionService = new OAuthService({",
        "  client: new OAuth.PKCEClient({ providerName: 'Notion' }),",
        "  personalAccessToken: notion_token,",
        "  onAuthorize({ token }) {",
        "    notion = { token }",
        "  }",
        "})",
        "",
        "export function getNotionClient() {",
        "  if (!notion) {",
        "    throw new Error('No Notion client initialized')",
        "  }",
        "",
        "  return notion",
        "}"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "tools", "get-page.ts"),
      [
        'import { withAccessToken } from "@raycast/utils"',
        'import { getNotionClient, notionService } from "../oauth"',
        "",
        "type Input = {",
        "  pageId: string",
        "}",
        "",
        "export default withAccessToken(notionService)(async ({ pageId }: Input) => {",
        "  const notion = getNotionClient()",
        "  return {",
        "    pageId,",
        "    token: notion.token",
        "  }",
        "})"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)
    const migratedOauthSource = String(artifacts["openwork-package/src/oauth.ts"])
    assert.match(migratedOauthSource, /getConnectionSecret/)
    assert.doesNotMatch(migratedOauthSource, /getPreferenceValues/)
    assert.doesNotMatch(migratedOauthSource, /personalAccessToken/)
    assert.doesNotMatch(migratedOauthSource, /let notion/)
    assert.doesNotMatch(migratedOauthSource, /onAuthorize/)
    assert.match(migratedOauthSource, /return \{ token: accessToken \}/)

    await writeArtifacts(artifactDir, artifacts)
    await writeFile(
      join(artifactDir, "openwork-package", "run-notion-tool.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { createFixtureTools } from "./main/tools"',
        "",
        'const tool = createFixtureTools().find((candidate) => candidate.name === "getPage")',
        "assert.ok(tool)",
        "const result = await tool.handler(",
        "  {",
        '    extensionName: "fixture",',
        '    extensionPreferences: { accessToken: "secret-token" },',
        '    threadId: "thread-1",',
        '    toolName: "getPage",',
        '    workspacePath: "/workspace"',
        "  },",
        '  { pageId: "page-1" }',
        ")",
        'assert.deepEqual(result, { pageId: "page-1", token: "secret-token" })'
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "run-notion-tool.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration treats no-input tools as fully schematized", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-empty-tool-"))

  try {
    await mkdir(join(extensionRoot, "src", "tools"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@raycast/utils": "^2.2.2",
            zod: "^4.0.0"
          },
          name: "fixture",
          title: "Fixture",
          tools: [
            {
              description: "List databases.",
              name: "get-databases",
              title: "Get Databases"
            }
          ]
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "tools", "get-databases.ts"),
      [
        'import { withAccessToken } from "@raycast/utils"',
        "",
        "const service = { personalAccessToken: 'secret-token' }",
        "",
        "export default withAccessToken(service)(async () => {",
        "  return []",
        "})"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })

    assert.equal(preview.feasibility.score.toolInputSchemas, "high")
    assert.equal(preview.tools[0]?.zodSchemaDraft, "const getDatabasesInputSchema = z.object({})")
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration rewrites Notion form property values to current API wrappers", async () => {
  const extensionRoot = await mkdtemp(
    join(tmpdir(), "openwork-raycast-migration-notion-properties-")
  )

  try {
    await mkdir(join(extensionRoot, "src", "utils", "notion", "page"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            "@tryfabric/martian": "^1.2.4",
            "date-fns": "^4.1.0",
            react: "^19.2.1"
          },
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "utils", "notion", "page", "property.ts"),
      [
        'import { Form } from "@raycast/api"',
        'import { markdownToRichText } from "@tryfabric/martian"',
        'import { subMinutes } from "date-fns"',
        "",
        "type ReadablePropertyType = 'title' | 'rich_text' | 'number' | 'date' | 'select' | 'status' | 'multi_select' | 'relation' | 'people' | 'url'",
        "",
        "export function formValueToPropertyValue(type: ReadablePropertyType, value: any) {",
        "  switch (type) {",
        '    case "title":',
        '    case "rich_text":',
        "      return markdownToRichText(value)",
        '    case "number":',
        "      return parseFloat(value)",
        '    case "date": {',
        "      if (!value) return",
        "      const time = subMinutes(new Date(value), new Date().getTimezoneOffset()).toISOString()",
        "      if (Form.DatePicker.isFullDay(value)) {",
        '        return { start: time.split("T")[0] }',
        "      } else {",
        "        return { start: time, time_zone: getLocalTimezone() }",
        "      }",
        "    }",
        '    case "select":',
        '    case "status":',
        "      return { id: value }",
        '    case "multi_select":',
        '    case "relation":',
        '    case "people":',
        "      return value.map((id: string) => ({ id }))",
        '    case "formula":',
        "      return",
        "    default:",
        "      return value",
        "  }",
        "}",
        "",
        "function getLocalTimezone() {",
        '  return "Asia/Shanghai"',
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    const migratedPropertySource = String(
      buildRaycastAiMigrationArtifacts(preview)[
        "openwork-package/src/utils/notion/page/property.ts"
      ]
    )

    assert.match(migratedPropertySource, /return \{ title: markdownToRichText\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ rich_text: markdownToRichText\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ number: parseFloat\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ date: \{ start: time\.split\("T"\)\[0\] \} \}/)
    assert.match(
      migratedPropertySource,
      /return \{ date: \{ start: time, time_zone: getLocalTimezone\(\) \} \}/
    )
    assert.match(migratedPropertySource, /return \{ select: \{ id: value \} \}/)
    assert.match(migratedPropertySource, /return \{ status: \{ id: value \} \}/)
    assert.match(
      migratedPropertySource,
      /return \{ multi_select: value\.map\(\(id: string\) => \(\{ id \}\)\) \}/
    )
    assert.match(
      migratedPropertySource,
      /return \{ relation: value\.map\(\(id: string\) => \(\{ id \}\)\) \}/
    )
    assert.match(
      migratedPropertySource,
      /return \{ people: value\.map\(\(id: string\) => \(\{ id \}\)\) \}/
    )
    assert.match(migratedPropertySource, /return \{ \[type\]: value \}/)
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated UI command uses Openwork runtime facade host requests", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-ui-command-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              description: "Capture a page.",
              mode: "view",
              name: "quick-capture",
              title: "Quick Capture"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            react: "^19.2.1"
          },
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "quick-capture.tsx"),
      [
        'import React from "react"',
        'import { Action, ActionPanel, Clipboard, Form, LocalStorage, Toast, closeMainWindow, getPreferenceValues, showToast } from "@raycast/api"',
        'import { useCachedPromise, useForm } from "@raycast/utils"',
        "",
        "export default function QuickCapture() {",
        "  const preferences = getPreferenceValues<{ accessToken?: string }>()",
        "  const cached = useCachedPromise(async () => {",
        "    const recent = await LocalStorage.getItem<string>('recent-page')",
        "    return recent ?? preferences.accessToken ?? 'missing'",
        "  })",
        "  const { handleSubmit, itemProps } = useForm<{ title: string }>({",
        "    initialValues: { title: '' },",
        "    async onSubmit(values) {",
        "      const clipboard = await Clipboard.readText()",
        "      await LocalStorage.setItem('recent-page', values.title)",
        "      await showToast({ style: Toast.Style.Success, title: clipboard })",
        "      await closeMainWindow()",
        "    }",
        "  })",
        "",
        "  return (",
        "    <Form",
        "      actions={",
        "        <ActionPanel>",
        '          <Action.SubmitForm title="Save" onSubmit={handleSubmit} />',
        "        </ActionPanel>",
        "      }",
        "    >",
        "      <Form.Description text={cached.data ?? 'loading'} />",
        '      <Form.TextField title="Title" {...itemProps.title} />',
        "    </Form>",
        "  )",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    await writeArtifacts(artifactDir, buildRaycastAiMigrationArtifacts(preview))
    await symlink(
      join(repoRoot, "node_modules"),
      join(artifactDir, "openwork-package", "node_modules"),
      "dir"
    )
    await writeFile(
      join(artifactDir, "openwork-package", "runtime-ui-command-check.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { createElement } from "react"',
        'import { fixtureRuntime } from "./runtime"',
        "",
        `const { createExtensionRuntimeRenderer } = await import(${JSON.stringify(join(repoRoot, "src/extension-runtime/reconciler/render"))})`,
        `const { createExtensionRuntimeNavigation, ExtensionRuntimeNavigationProvider } = await import(${JSON.stringify(join(repoRoot, "packages/extension-api/src/host-runtime.ts"))})`,
        "",
        "const hostRequests: unknown[] = []",
        "const storage = new Map<string, unknown>()",
        "const requestHost = async (request: any) => {",
        "  hostRequests.push(request)",
        "  if (request.capability === 'storage' && request.method === 'get') {",
        "    return { id: request.id ?? 'host-request', ok: true, result: storage.get(request.payload.key) }",
        "  }",
        "  if (request.capability === 'storage' && request.method === 'set') {",
        "    storage.set(request.payload.key, request.payload.value)",
        "    return { id: request.id ?? 'host-request', ok: true, result: null }",
        "  }",
        "  if (request.capability === 'clipboard' && request.method === 'read-text') {",
        "    return { id: request.id ?? 'host-request', ok: true, result: 'clipboard text' }",
        "  }",
        "  if (request.capability === 'toast' && request.method === 'show') {",
        "    return { id: request.id ?? 'host-request', ok: true, result: null }",
        "  }",
        "  if (request.capability === 'navigation' && request.method === 'hide-launcher') {",
        "    return { id: request.id ?? 'host-request', ok: true, result: null }",
        "  }",
        "  return { id: request.id ?? 'host-request', ok: true, result: null }",
        "}",
        "",
        'const command = fixtureRuntime.commands["quick-capture"]',
        "assert.ok(command)",
        'assert.equal(command.mode, "view")',
        "const renderer = createExtensionRuntimeRenderer(",
        "  { commandName: 'quick-capture', extensionName: 'fixture' },",
        "  { onHostRequest: requestHost }",
        ")",
        "renderer.render(",
        "  createElement(",
        "    ExtensionRuntimeNavigationProvider,",
        "    {",
        "      value: {",
        "        commandName: 'quick-capture',",
        "        commandPreferences: {},",
        "        extensionName: 'fixture',",
        "        extensionPreferences: { accessToken: 'runtime-token' },",
        "        initialAction: 'open',",
        "        locale: 'zh-CN',",
        "        mode: 'view',",
        "        navigation: createExtensionRuntimeNavigation({ requestHost }),",
        "        requestHost,",
        "        seedQuery: ''",
        "      }",
        "    },",
        "    createElement(command.Component)",
        "  )",
        ")",
        "await renderer.flushSnapshots()",
        "await renderer.flushSnapshots()",
        "const initialSnapshot = renderer.getSnapshot()",
        "assert.equal(initialSnapshot?.kind, 'form')",
        "assert.equal(initialSnapshot?.kind === 'form' ? initialSnapshot.fields[0]?.text : undefined, 'runtime-token')",
        "const titleField = initialSnapshot?.kind === 'form' ? initialSnapshot.fields.find((field: any) => field.title === 'Title') : null",
        "assert.ok(titleField)",
        "assert.equal(await renderer.dispatchEvent({ changeId: 'change-1', fieldId: titleField.id, type: 'form.field.change', value: 'Roadmap' }), true)",
        "const editedSnapshot = renderer.getSnapshot()",
        "assert.equal(editedSnapshot?.kind, 'form')",
        "const submitAction = editedSnapshot?.kind === 'form' ? editedSnapshot.actions.find((action: any) => action.title === 'Save') : null",
        "assert.ok(submitAction)",
        "assert.equal(await renderer.dispatchEvent({ actionId: submitAction.id, revision: editedSnapshot.revision, type: 'action.execute' }), true)",
        "assert.equal(storage.get('recent-page'), 'Roadmap')",
        "assert.equal(hostRequests.some((request: any) => request.capability === 'clipboard' && request.method === 'read-text'), true)",
        "assert.equal(hostRequests.some((request: any) => request.capability === 'toast' && request.method === 'show' && request.payload.title === 'clipboard text'), true)",
        "assert.equal(hostRequests.some((request: any) => request.capability === 'navigation' && request.method === 'hide-launcher'), true)"
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "runtime-ui-command-check.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated package passes native extension registry validation", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-registry-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "assets"), { recursive: true })
    await mkdir(join(extensionRoot, "src", "tools"), { recursive: true })
    await writeFile(join(extensionRoot, "assets", "fixture.png"), "fixture icon")
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          ai: {
            instructions: "- Search before retrieving pages."
          },
          commands: [
            {
              description: "Search pages.",
              mode: "view",
              name: "search-page",
              title: "Search Pages"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            react: "^19.2.1",
            zod: "^4.0.0"
          },
          description: "Fixture extension",
          icon: "fixture.png",
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture",
          tools: [
            {
              description: "Search pages.",
              name: "search-pages",
              title: "Search Pages"
            }
          ]
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "oauth.ts"),
      [
        'import { OAuthService } from "@raycast/utils"',
        "",
        "export const service = new OAuthService({",
        '  personalAccessToken: "fallback-token"',
        "})"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "search-page.tsx"),
      [
        'import { Action, ActionPanel, List } from "@raycast/api"',
        "",
        "export default function SearchPage() {",
        '  return <List><List.EmptyView title="No pages" actions={<ActionPanel><Action.CreateQuicklink quicklink={{ name: "Search generated pages", link: "raycast://extensions/acme/fixture/search-page?launchContext=%7B%22defaults%22%3A%7B%22query%22%3A%22spec%22%7D%7D" }} /></ActionPanel>} /></List>',
        "}"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "tools", "search-pages.ts"),
      [
        'import { withAccessToken } from "@raycast/utils"',
        'import { service } from "../oauth"',
        "",
        "type Input = {",
        "  query: string",
        "}",
        "",
        "export default withAccessToken(service)(async (input: Input) => {",
        "  return { query: input.query }",
        "})"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null,
      targetExtensionId: "fixture-generated",
      targetExtensionTitle: "Fixture Generated"
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)
    const packageJson = JSON.parse(String(artifacts["openwork-package/package.json"]))

    assert.equal(preview.source.packageName, "fixture")
    assert.equal(preview.source.targetExtensionId, "fixture-generated")
    assert.equal(preview.source.targetTitle, "Fixture Generated")
    assert.equal(preview.manifestPreview.name, "fixture-generated")
    assert.equal(preview.manifestPreview.title, "Fixture Generated")
    assert.equal(preview.manifestPreview.aiCapability.id, "fixture-generated")
    assert.equal(preview.manifestPreview.aiCapability.mention.value, "fixture-generated")
    assert.equal(preview.manifestPreview.connection.provider, "fixture")
    assert.equal(packageJson.name, "@openwork/extension-fixture-generated")
    assert.match(
      String(artifacts["openwork-package/identity.ts"]),
      /extensionId: "fixture-generated"/
    )
    assert.match(
      String(artifacts["openwork-package/identity.ts"]),
      /providerId: "fixture"/
    )
    assert.match(
      String(artifacts["openwork-package/identity.ts"]),
      /export const EXTENSION_ID = EXTENSION_IDENTITY\.extensionId/
    )
    assert.match(
      String(artifacts["openwork-package/manifest.ts"]),
      /"id": EXTENSION_ID/
    )
    assert.match(
      String(artifacts["openwork-package/runtime-metadata.ts"]),
      /extensionName: EXTENSION_ID/
    )
    assert.match(
      String(artifacts["openwork-package/src/search-page.tsx"]),
      /openwork:\/\/extensions\/fixture-generated\/search-page\?launchContext=/
    )
    assert.doesNotMatch(
      String(artifacts["openwork-package/src/search-page.tsx"]),
      /extensions\/acme\/fixture\/search-page|extensions\/fixture\/search-page|raycast:\/\//
    )

    await writeArtifacts(artifactDir, artifacts)
    await symlink(
      join(repoRoot, "node_modules"),
      join(artifactDir, "openwork-package", "node_modules"),
      "dir"
    )
    await symlink(
      join(artifactDir, "openwork-package"),
      join(artifactDir, "fixture-generated"),
      "dir"
    )
    await mkdir(join(artifactDir, "extensions"), { recursive: true })
    await symlink(
      join(artifactDir, "openwork-package"),
      join(artifactDir, "extensions", "fixture-generated"),
      "dir"
    )
    assert.deepEqual(
      validateNativeExtensionPackageBoundaries({ repoRoot: artifactDir }).errors,
      []
    )
    await writeFile(
      join(artifactDir, "openwork-package", "registry-check.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { fixtureGeneratedMain } from "./main"',
        'import { fixtureGeneratedManifest } from "./manifest"',
        'import { fixtureGeneratedRuntime } from "./runtime"',
        'import { fixtureGeneratedRuntimeMetadata } from "./runtime-metadata"',
        "",
        `const { validateNativeExtensionRegistry } = await import(${JSON.stringify(join(repoRoot, "src/main/native-extensions/validation"))})`,
        "",
        'assert.equal(fixtureGeneratedManifest.name, "fixture-generated")',
        'assert.equal(fixtureGeneratedManifest.connection?.provider, "fixture")',
        'assert.equal(fixtureGeneratedRuntime.extensionName, "fixture-generated")',
        'assert.equal(fixtureGeneratedRuntimeMetadata.extensionName, "fixture-generated")',
        "",
        "const result = validateNativeExtensionRegistry({",
        `  assetRoots: [${JSON.stringify(artifactDir)}],`,
        "  mainDefinitions: new Map([[fixtureGeneratedManifest.name, fixtureGeneratedMain]]),",
        "  manifests: [fixtureGeneratedManifest],",
        "  runtimeMetadataPackages: [fixtureGeneratedRuntimeMetadata],",
        "  runtimePackages: [fixtureGeneratedRuntime]",
        "})",
        "",
        "assert.deepEqual(result.errors, [])"
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "registry-check.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview normalizes scoped package names into valid Openwork extension ids", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-preview-scoped-"))

  try {
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [],
          description: "Scoped fixture extension",
          name: "@raycast/notion",
          title: "Notion"
        },
        null,
        2
      )
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null,
      targetExtensionId: null,
      targetExtensionTitle: null
    })

    assert.equal(preview.source.targetExtensionId, "notion")
    assert.equal(preview.manifestPreview.name, "notion")
    assert.equal(preview.manifestPreview.aiCapability.id, "notion")
    assert.equal(preview.manifestPreview.aiCapability.mention.value, "notion")
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration preview rejects explicit invalid target extension ids", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-preview-invalid-id-"))

  try {
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [],
          description: "Invalid target fixture extension",
          name: "fixture",
          title: "Fixture"
        },
        null,
        2
      )
    )

    assert.throws(
      () =>
        buildRaycastAiMigrationPreview({
          extensionPath: extensionRoot,
          gitRef: "HEAD",
          gitRepo: null,
          out: null,
          targetExtensionId: "@raycast/notion",
          targetExtensionTitle: null
        }),
      /Target extension id "@raycast\/notion" must start with a letter/
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated Notion-style package keeps runtime contracts reproducible", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-notion-contract-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "src", "utils", "notion", "page"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              description: "Search pages.",
              mode: "view",
              name: "search-page",
              title: "Search Pages"
            }
          ],
          dependencies: {
            "@notionhq/client": "^5.9.0",
            "@raycast/api": "^1.104.5",
            "@raycast/utils": "^2.2.2",
            "@tryfabric/martian": "^1.2.4",
            "date-fns": "^4.1.0",
            react: "^19.2.1"
          },
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "oauth.ts"),
      [
        'import { Client } from "@notionhq/client"',
        'import { OAuth, getPreferenceValues } from "@raycast/api"',
        'import { OAuthService } from "@raycast/utils"',
        "",
        "const { notion_token } = getPreferenceValues<Preferences>()",
        "let notion: Client | null = null",
        "",
        "const client = new OAuth.PKCEClient({",
        "  providerName: 'Notion'",
        "})",
        "",
        "export const notionService = new OAuthService({",
        "  client,",
        "  personalAccessToken: notion_token,",
        "  onAuthorize({ token }) {",
        "    notion = new Client({ auth: token })",
        "  }",
        "})",
        "",
        "export function getNotionClient() {",
        "  if (!notion) {",
        "    throw new Error('No Notion client initialized')",
        "  }",
        "  return notion",
        "}"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "search-page.tsx"),
      [
        'import { Action, ActionPanel, List } from "@raycast/api"',
        "",
        "export default function SearchPage() {",
        '  return <List><List.EmptyView title="No pages" actions={<ActionPanel><Action.CreateQuicklink quicklink={{ name: "Search generated pages", link: "raycast://extensions/acme/fixture/search-page?launchContext=%7B%22defaults%22%3A%7B%22query%22%3A%22spec%22%7D%7D" }} /></ActionPanel>} /></List>',
        "}"
      ].join("\n")
    )
    await writeFile(
      join(extensionRoot, "src", "utils", "notion", "page", "property.ts"),
      [
        'import { Form } from "@raycast/api"',
        'import { markdownToRichText } from "@tryfabric/martian"',
        'import { subMinutes } from "date-fns"',
        "",
        "type ReadablePropertyType = 'title' | 'rich_text' | 'number' | 'date' | 'select' | 'status' | 'multi_select' | 'relation' | 'people' | 'url'",
        "",
        "export function formValueToPropertyValue(type: ReadablePropertyType, value: any) {",
        "  switch (type) {",
        '    case "title":',
        '    case "rich_text":',
        "      return markdownToRichText(value)",
        '    case "number":',
        "      return parseFloat(value)",
        '    case "date": {',
        "      if (!value) return",
        "      const time = subMinutes(new Date(value), new Date().getTimezoneOffset()).toISOString()",
        "      if (Form.DatePicker.isFullDay(value)) {",
        '        return { start: time.split("T")[0] }',
        "      }",
        "      return { start: time, time_zone: getLocalTimezone() }",
        "    }",
        '    case "select":',
        '    case "status":',
        "      return { id: value }",
        '    case "multi_select":',
        '    case "relation":',
        '    case "people":',
        "      return value.map((id: string) => ({ id }))",
        "    default:",
        "      return value",
        "  }",
        "}",
        "",
        "function getLocalTimezone() {",
        '  return "Asia/Shanghai"',
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null,
      targetExtensionId: "fixture-generated",
      targetExtensionTitle: "Fixture Generated"
    })
    const artifacts = buildRaycastAiMigrationArtifacts(preview)

    const runtimeSource = String(artifacts["openwork-package/runtime.ts"])
    assert.match(runtimeSource, /import FixtureGeneratedSearchPageCommandSource from "\.\/src\/search-page"/)
    assert.doesNotMatch(runtimeSource, /React\.lazy|import\(\s*["']\.\/src\/search-page["']\s*\)/)

    const migratedOauthSource = String(artifacts["openwork-package/src/oauth.ts"])
    assert.match(migratedOauthSource, /getConnectionSecret\("accessToken"\)/)
    assert.match(migratedOauthSource, /return new Client\(\{ auth: accessToken \}\)/)
    assert.doesNotMatch(migratedOauthSource, /getPreferenceValues|personalAccessToken|let notion|onAuthorize/)

    assert.match(
      String(artifacts["openwork-package/src/search-page.tsx"]),
      /openwork:\/\/extensions\/fixture-generated\/search-page\?launchContext=/
    )
    assert.doesNotMatch(
      String(artifacts["openwork-package/src/search-page.tsx"]),
      /raycast:\/\/|extensions\/acme\/fixture\/search-page/
    )

    const migratedPropertySource = String(
      artifacts["openwork-package/src/utils/notion/page/property.ts"]
    )
    assert.match(migratedPropertySource, /return \{ title: markdownToRichText\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ rich_text: markdownToRichText\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ number: parseFloat\(value\) \}/)
    assert.match(migratedPropertySource, /return \{ date: \{ start: time\.split\("T"\)\[0\] \} \}/)
    assert.match(migratedPropertySource, /return \{ select: \{ id: value \} \}/)
    assert.match(migratedPropertySource, /return \{ status: \{ id: value \} \}/)
    assert.match(
      migratedPropertySource,
      /return \{ relation: value\.map\(\(id: string\) => \(\{ id \}\)\) \}/
    )
    assert.match(
      migratedPropertySource,
      /return \{ people: value\.map\(\(id: string\) => \(\{ id \}\)\) \}/
    )

    const runtimeMetadataSource = String(artifacts["openwork-package/runtime-metadata.ts"])
    assert.match(runtimeMetadataSource, /aliases/)
    assert.match(runtimeMetadataSource, /resolveCommand/)
    assert.match(runtimeMetadataSource, /EXTENSION_SUBJECT_TERMS/)
    assert.doesNotMatch(runtimeMetadataSource, /const EXTENSION_NAME/)
    assert.equal(artifacts["openwork-package/assets/.gitkeep"], "")

    await writeArtifacts(artifactDir, artifacts)
    await symlink(
      join(repoRoot, "node_modules"),
      join(artifactDir, "openwork-package", "node_modules"),
      "dir"
    )
    await mkdir(join(artifactDir, "extensions"), { recursive: true })
    await symlink(
      join(artifactDir, "openwork-package"),
      join(artifactDir, "extensions", "fixture-generated"),
      "dir"
    )
    assert.deepEqual(
      validateNativeExtensionPackageBoundaries({ repoRoot: artifactDir }).errors,
      []
    )
    await writeFile(
      join(artifactDir, "openwork-package", "runtime-contract-check.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { fixtureGeneratedRuntime } from "./runtime"',
        'import { fixtureGeneratedRuntimeMetadata } from "./runtime-metadata"',
        "",
        'const command = fixtureGeneratedRuntime.commands["search-page"]',
        "assert.ok(command)",
        'assert.equal(command.mode, "view")',
        'const search = fixtureGeneratedRuntimeMetadata.commands.find((candidate) => candidate.name === "search-page")?.search',
        "assert.ok(search)",
        "assert.deepEqual(",
        "  search.resolveCommand?.({",
        "    altKey: false,",
        "    ctrlKey: false,",
        '    key: " ",',
        "    metaKey: false,",
        '    query: "search pages",',
        "    shiftKey: false",
        "  }),",
        "  null",
        ")",
        "assert.deepEqual(",
        "  search.resolveCommand?.({",
        "    altKey: false,",
        "    ctrlKey: false,",
        '    key: " ",',
        "    metaKey: false,",
        '    query: "fixture search pages",',
        "    shiftKey: false",
        "  }),",
        "  { commandName: 'search-page', openOptions: { seedQuery: '' } }",
        ")",
        "assert.deepEqual(",
        "  search.resolveCommand?.({",
        "    altKey: false,",
        "    ctrlKey: false,",
        '    key: "Enter",',
        "    metaKey: false,",
        '    query: "fixture search pages",',
        "    shiftKey: false",
        "  }),",
        "  null",
        ")"
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        "--noEmit",
        "--pretty",
        "false"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "runtime-contract-check.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

test("Raycast migration generated runtime supports top-level preference reads in command sources", async () => {
  const extensionRoot = await mkdtemp(join(tmpdir(), "openwork-raycast-migration-runtime-static-"))
  const artifactDir = join(extensionRoot, "migration-artifacts")

  try {
    await mkdir(join(extensionRoot, "src"), { recursive: true })
    await writeFile(
      join(extensionRoot, "package.json"),
      JSON.stringify(
        {
          commands: [
            {
              description: "Search pages.",
              mode: "view",
              name: "search-page",
              title: "Search Pages"
            }
          ],
          dependencies: {
            "@raycast/api": "^1.104.5",
            react: "^19.2.1"
          },
          name: "fixture",
          preferences: [
            {
              name: "notion_token",
              type: "password"
            }
          ],
          title: "Fixture"
        },
        null,
        2
      )
    )
    await writeFile(
      join(extensionRoot, "src", "search-page.tsx"),
      [
        'import { Form, getPreferenceValues } from "@raycast/api"',
        "",
        "const preferences = getPreferenceValues<{ accessToken?: string }>()",
        "",
        "export default function SearchPage() {",
        "  return <Form><Form.Description text={preferences.accessToken ?? 'missing'} /></Form>",
        "}"
      ].join("\n")
    )

    const preview = buildRaycastAiMigrationPreview({
      extensionPath: extensionRoot,
      gitRef: "HEAD",
      gitRepo: null,
      out: null
    })
    await writeArtifacts(artifactDir, buildRaycastAiMigrationArtifacts(preview))
    await symlink(
      join(repoRoot, "node_modules"),
      join(artifactDir, "openwork-package", "node_modules"),
      "dir"
    )
    await writeFile(
      join(artifactDir, "openwork-package", "runtime-static-check.ts"),
      [
        'import assert from "node:assert/strict"',
        'import { createElement } from "react"',
        'import { fixtureRuntime } from "./runtime"',
        "",
        `const { createExtensionRuntimeRenderer } = await import(${JSON.stringify(join(repoRoot, "src/extension-runtime/reconciler/render"))})`,
        `const { createExtensionRuntimeNavigation, ExtensionRuntimeNavigationProvider } = await import(${JSON.stringify(join(repoRoot, "packages/extension-api/src/host-runtime.ts"))})`,
        "",
        'const command = fixtureRuntime.commands["search-page"]',
        "assert.ok(command)",
        'assert.equal(command.mode, "view")',
        "const requestHost = async () => ({ id: 'test-host-request', ok: true, result: null })",
        "const renderer = createExtensionRuntimeRenderer({ commandName: 'search-page', extensionName: 'fixture' })",
        "renderer.render(",
        "  createElement(",
        "    ExtensionRuntimeNavigationProvider,",
        "    {",
        "      value: {",
        "        commandName: 'search-page',",
        "        commandPreferences: {},",
        "        extensionName: 'fixture',",
        "        extensionPreferences: { accessToken: 'runtime-token' },",
        "        initialAction: 'open',",
        "        locale: 'zh-CN',",
        "        mode: 'view',",
        "        navigation: createExtensionRuntimeNavigation({ requestHost }),",
        "        requestHost,",
        "        seedQuery: ''",
        "      }",
        "    },",
        "    createElement(command.Component)",
        "  )",
        ")",
        "await renderer.flushSnapshots()",
        "await renderer.flushSnapshots()",
        "const snapshot = renderer.getSnapshot()",
        "assert.equal(snapshot?.kind, 'form')",
        "assert.equal(snapshot?.kind === 'form' ? snapshot.fields[0]?.text : undefined, 'runtime-token')"
      ].join("\n")
    )

    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules/.bin/tsx"),
        "--tsconfig",
        join(artifactDir, "openwork-package", "tsconfig.check.json"),
        join(artifactDir, "openwork-package", "runtime-static-check.ts")
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      }
    )
  } finally {
    await rm(extensionRoot, { force: true, recursive: true })
  }
})

async function writeArtifacts(root: string, artifacts: Record<string, Buffer | string>) {
  await Promise.all(
    Object.entries(artifacts).map(async ([relativePath, content]) => {
      const target = join(root, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    })
  )
}

async function listArtifactFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        return listArtifactFiles(root, relativePath)
      }
      return Promise.resolve([relativePath])
    })
  )
  return files.flat()
}

function pickDependency(
  preview: {
    dependencyReport: Array<{
      category: string
      declaredAs?: string
      decision: string
      importedBy: string[]
      name: string
      openworkTarget?: string
      version?: string
    }>
  },
  name: string
) {
  const dependency = preview.dependencyReport.find((entry) => entry.name === name)
  assert.ok(dependency, `missing dependency report entry for ${name}`)
  return {
    category: dependency.category,
    declaredAs: dependency.declaredAs,
    decision: dependency.decision,
    importedBy: dependency.importedBy,
    name: dependency.name,
    openworkTarget: dependency.openworkTarget,
    version: dependency.version
  }
}

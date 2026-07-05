export const knownNotionTransform = {
  name: "known-extensions/notion",
  appliesTo(context) {
    return isNotionMigrationContext(context)
  },
  detectBlockingAdapters(context) {
    return hasModuleLevelNotionClient(context.sourceText) ? [MODULE_LEVEL_CLIENT_BLOCKER] : []
  },
  extendGuide(context) {
    return [
      context.guide,
      "Search before retrieving or modifying a page unless the user provided an exact id."
    ].join(" ")
  },
  extendPreferenceTypeLiteral(context) {
    if (
      !shouldPreserveNotionTokenAlias(context.preview) ||
      !hasAccessTokenPreference(context.items)
    ) {
      return context.literal
    }

    return context.literal.replace(/\n {4}}$/, "\n      notion_token?: string\n    }")
  },
  run(context) {
    const sourceText = rewriteKnownNotionSourceForJingle(context.sourceText, context.filePath)
    return {
      diagnostics:
        sourceText === context.sourceText
          ? []
          : [
              {
                message: "Applied Notion-specific compatibility rewrites.",
                severity: "info",
                transform: knownNotionTransform.name
              }
            ],
      sourceText
    }
  },
  suppressBlockingAdapters(context) {
    if (!context.sourceFiles.some((file) => isNotionMigrationContext({ ...context, ...file }))) {
      return context.sourceFiles
    }

    const hasMigratableClientInitializer = context.sourceFiles.some(
      (file) =>
        file.sourceText.includes("new OAuthService") &&
        file.sourceText.includes("getPreferenceValues") &&
        file.sourceText.includes("onAuthorize") &&
        file.sourceText.includes("getNotionClient")
    )
    const hasWrappedEntrypoints = context.sourceFiles.some(
      (file) =>
        file.sourceText.includes("withAccessToken(notionService)") ||
        file.sourceText.includes("withAccessToken(service)")
    )

    if (!hasMigratableClientInitializer || !hasWrappedEntrypoints) {
      return context.sourceFiles
    }

    return context.sourceFiles.map((file) => ({
      ...file,
      blockingAdapters: file.blockingAdapters.filter(
        (blocker) => blocker !== MODULE_LEVEL_CLIENT_BLOCKER
      )
    }))
  }
}

const MODULE_LEVEL_CLIENT_BLOCKER =
  "Uses module-level Notion client; replace with request-scoped Jingle client."

function isNotionMigrationContext(context) {
  const sourceId = String(context.target?.sourceExtensionId ?? "").toLowerCase()
  const extensionId = String(context.target?.extensionId ?? "").toLowerCase()
  const filePath = String(context.filePath ?? context.path ?? "").toLowerCase()
  const packageName = String(
    context.pkg?.name ?? context.preview?.source?.packageName ?? ""
  ).toLowerCase()
  const packageDependencies =
    context.pkg?.dependencies ??
    Object.fromEntries((context.preview?.dependencyReport ?? []).map((dependency) => [dependency.name, true]))
  const sourceText = String(context.sourceText ?? "")

  return (
    sourceId === "notion" ||
    extensionId === "notion" ||
    packageName === "notion" ||
    Object.hasOwn(packageDependencies, "@notionhq/client") ||
    (Array.isArray(context.sourceFiles) &&
      context.sourceFiles.some((file) =>
        isNotionMigrationContext({ ...context, ...file, sourceFiles: undefined })
      )) ||
    filePath.includes("/notion/") ||
    filePath.includes("utils/notion") ||
    sourceText.includes("@notionhq/client") ||
    sourceText.includes("notion_token")
  )
}

function hasAccessTokenPreference(items) {
  return Array.isArray(items) && items.some((item) => item.name === "accessToken")
}

function shouldPreserveNotionTokenAlias(preview) {
  if (!preview) {
    return false
  }

  return (
    String(preview.source?.packageName ?? "").toLowerCase() === "notion" ||
    preview.dependencyReport?.some((dependency) => dependency.name === "@notionhq/client") ||
    preview.sourceMigration?.sourceFiles?.some((file) => file.path.includes("utils/notion"))
  )
}

function rewriteKnownNotionSourceForJingle(sourceText, filePath) {
  const rewrittenSource = rewriteKnownNotionOauthSourceForJingle(
    rewriteKnownNotionTypeFixups(sourceText),
    filePath
  )

  if (!filePath.endsWith("src/utils/notion/page/property.ts")) {
    return rewrittenSource
  }

  return rewrittenSource
    .replaceAll(
      /case "title":\n\s*case "rich_text":\n\s*return markdownToRichText\(value\);?/g,
      [
        'case "title":',
        "      return { title: markdownToRichText(value) };",
        '    case "rich_text":',
        "      return { rich_text: markdownToRichText(value) };"
      ].join("\n")
    )
    .replaceAll(/return parseFloat\(value\);?/g, "return { number: parseFloat(value) };")
    .replaceAll(
      /return \{ start: time\.split\("T"\)\[0\] \};?/g,
      'return { date: { start: time.split("T")[0] } };'
    )
    .replaceAll(
      /return \{ start: time, time_zone: getLocalTimezone\(\) \};?/g,
      "return { date: { start: time, time_zone: getLocalTimezone() } };"
    )
    .replaceAll(
      /case "select":\n\s*case "status":\n\s*return \{ id: value \};?/g,
      [
        'case "select":',
        "      return { select: { id: value } };",
        '    case "status":',
        "      return { status: { id: value } };"
      ].join("\n")
    )
    .replaceAll(
      /case "multi_select":\n\s*case "relation":\n\s*case "people":\n\s*return value\.map\(\(id(?::\s*string)?\) => \(\{ id \}\)\);?/g,
      [
        'case "multi_select":',
        "      return { multi_select: value.map((id: string) => ({ id })) };",
        '    case "relation":',
        "      return { relation: value.map((id: string) => ({ id })) };",
        '    case "people":',
        "      return { people: value.map((id: string) => ({ id })) };"
      ].join("\n")
    )
    .replaceAll(/return value;?/g, "return { [type]: value };")
}

function rewriteKnownNotionTypeFixups(sourceText) {
  return sourceText
    .replaceAll(
      /import\s+\{\s*useCachedPromise,\s*withAccessToken\s*\}\s+from\s+["']@jingle\/extension-utils["']/g,
      'import { useCachedPromise, withAccessToken, type PaginationRequest } from "@jingle/extension-utils"'
    )
    .replaceAll(
      /import\s+\{\s*iteratePaginatedAPI\s*\}\s+from\s+["']@notionhq\/client["']/g,
      'import { iteratePaginatedAPI, type UserObjectResponse } from "@notionhq/client"'
    )
    .replaceAll(/\bconst blocks = \[\]/g, "const blocks: string[] = []")
    .replaceAll(/\bconst users = \[\]/g, "const users: UserObjectResponse[] = []")
    .replaceAll(
      /\biteratePaginatedAPI\(notion\.users\.list,\s*\{\}\)/g,
      "iteratePaginatedAPI(notion.users.list, {}) as AsyncIterable<UserObjectResponse>"
    )
    .replaceAll(/\(\{ cursor \}\) =>/g, "({ cursor }: PaginationRequest) =>")
    .replaceAll(
      /if \(newIndex < 0 \|\| newIndex >= propertiesOrder\.length\) return propertiesOrder;/g,
      "if (newIndex < 0 || newIndex >= propertiesOrder.length) return;"
    )
    .replaceAll(
      /if \(!value \|\| !opt\.id\) \{\n(\s*)return null;\n(\s*)\}/g,
      "if (!value || !opt.id) {\n$1return;\n$2}"
    )
    .replaceAll(
      /(catch \(error\) \{\n(\s*)console\.error\(error\);\n)(\s*)\}/g,
      "$1$2return undefined;\n$3}"
    )
    .replaceAll(
      /(\s*)if \(!silent\) return handleError\(([^;\n]+)\);\n(\s*)\}/g,
      "$1if (!silent) return handleError($2);\n$1return undefined;\n$3}"
    )
    .replaceAll(
      /(if \(!validateUrl\(input\)\) return "The URL is not valid";\n)(\s*)\}/g,
      "$1$2return undefined;\n$2}"
    )
    .replaceAll(
      /(\n\s*case "status":\n\s*return \{\n\s*tag: \{ value: property\.value\.name, color: notionColorToTintColor\(property\.value\.color\) \},\n\s*tooltip: `\$\{title\}: \$\{property\.value\.name\}`,\n\s*\};\n)(\s*)\}/g,
      "$1$2default:\n$2  return undefined;\n$2}"
    )
    .replaceAll(/\bnotion_token\b/g, "accessToken")
}

function rewriteKnownNotionOauthSourceForJingle(sourceText, filePath) {
  if (!filePath.endsWith("oauth.ts") || !sourceText.includes("getNotionClient")) {
    return sourceText
  }

  const assignedClient = extractNotionClientAssignment(sourceText)
  if (!assignedClient) {
    return sourceText
  }

  const clientExpression = rewriteNotionClientExpression(assignedClient)
  return sourceText
    .replace(
      /import\s+\{\s*OAuth,\s*getPreferenceValues\s*\}\s+from\s+["']@jingle\/extension-api["']/,
      'import { OAuth, getConnectionSecret } from "@jingle/extension-api"'
    )
    .replace(
      /import\s+\{\s*getPreferenceValues,\s*OAuth\s*\}\s+from\s+["']@jingle\/extension-api["']/,
      'import { OAuth, getConnectionSecret } from "@jingle/extension-api"'
    )
    .replace(/^\s*const\s+\{\s*accessToken\s*\}\s*=\s*getPreferenceValues<Preferences>\(\)\s*\n/m, "")
    .replace(/^\s*let\s+notion:[^\n]+=\s*null;?\s*\n/m, "")
    .replace(/^\s*personalAccessToken:\s*accessToken,?\s*\n/m, "")
    .replace(
      /^\s*onAuthorize\(\{\s*token\s*\}\)\s*\{\s*\n\s*notion\s*=\s*[^;\n]+;?\s*\n\s*\},?\s*\n/m,
      ""
    )
    .replace(
      /export function getNotionClient\(\)\s*\{\s*\n\s*if \(!notion\) \{\s*\n\s*throw new Error\([^\n]+\)\s*\n\s*\}\s*\n\s*return notion;?\s*\n\}/m,
      [
        "export function getNotionClient() {",
        '  const accessToken = getConnectionSecret("accessToken")',
        "  if (!accessToken) {",
        '    throw new Error("Missing accessToken preference for this extension.")',
        "  }",
        "",
        `  return ${clientExpression}`,
        "}"
      ].join("\n")
    )
}

function hasModuleLevelNotionClient(sourceText) {
  return (
    /\blet\s+notion\b[^\n]*=\s*null;?/m.test(sourceText) &&
    /export function getNotionClient\(\)/.test(sourceText)
  )
}

function extractNotionClientAssignment(sourceText) {
  const match = sourceText.match(
    /onAuthorize\(\{\s*token\s*\}\)\s*\{\s*\n\s*notion\s*=\s*([^;\n]+);?\s*\n\s*\}/m
  )
  return match?.[1]?.trim() ?? null
}

function rewriteNotionClientExpression(expression) {
  const trimmedExpression = expression.trim()
  if (trimmedExpression === "{ token }") {
    return "{ token: accessToken }"
  }

  return trimmedExpression.replace(/\btoken\b/g, "accessToken")
}

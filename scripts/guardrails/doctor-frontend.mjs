import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { doctorSchemaVersion, stableDiagnosticId } from "./doctor-contracts.mjs"
import { resolveImportPath as resolveArchitectureImportPath } from "./lib/architecture-guardrails.mjs"

const rendererRootPath = "src/renderer/src"
const primitiveRootPath = `${rendererRootPath}/components/ui`
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])
const nativeControlTags = new Set(["button", "input", "select", "textarea"])
const rendererBridgeNames = new Set(["api", "electron"])
const visualTitleTags = new Set([
  "a",
  "button",
  "dd",
  "div",
  "h1",
  "h2",
  "h3",
  "li",
  "p",
  "span",
  "td"
])
const upperLayerNames = ["ai-core", "devtools", "extension-runtime", "launcher-shell", "settings"]
const lowerLayerNames = [
  "components",
  "composer-area",
  "extension-host",
  "extensions",
  "features",
  "launcher-components",
  "lib",
  "shortcuts"
]
const upperLayerRoots = upperLayerNames.map((name) => `${rendererRootPath}/${name}/`)
const lowerLayerRoots = lowerLayerNames.map((name) => `${rendererRootPath}/${name}/`)
const classifiedLayerNames = new Set([...upperLayerNames, ...lowerLayerNames])
const upperRootFiles = new Set([
  `${rendererRootPath}/RendererRoot.tsx`,
  `${rendererRootPath}/main.tsx`
])
const sharedRootFiles = new Set([
  `${rendererRootPath}/env.d.ts`,
  `${rendererRootPath}/index.css`,
  `${rendererRootPath}/types.ts`
])
const classifiedRootFiles = new Set([...upperRootFiles, ...sharedRootFiles])
const controllerOwnerRoots = [
  `${rendererRootPath}/ai-core/`,
  `${rendererRootPath}/components/chat/`,
  `${rendererRootPath}/composer-area/`,
  `${rendererRootPath}/extension-host/`,
  `${rendererRootPath}/extension-runtime/`,
  `${rendererRootPath}/features/`,
  `${rendererRootPath}/launcher-shell/`,
  `${rendererRootPath}/settings/`,
  `${rendererRootPath}/shortcuts/`
]

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/")
}

function discoverFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverFiles(absolutePath))
    } else if (entry.isFile()) {
      files.push(absolutePath)
    }
  }
  return files.sort()
}

function scriptKindFor(filePath) {
  switch (path.extname(filePath)) {
    case ".js":
      return ts.ScriptKind.JS
    case ".jsx":
      return ts.ScriptKind.JSX
    case ".tsx":
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

function lineAndColumn(sourceFile, position) {
  const point = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: point.line + 1, column: point.character + 1 }
}

function locationFromOffset(sourceText, offset) {
  const prefix = sourceText.slice(0, offset)
  const lines = prefix.split("\n")
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function stripCssComments(sourceText) {
  const characters = [...sourceText]
  let quote = null
  let escaped = false

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character !== "/" || characters[index + 1] !== "*") {
      continue
    }

    characters[index] = " "
    characters[index + 1] = " "
    index += 2
    while (
      index < characters.length &&
      !(characters[index] === "*" && characters[index + 1] === "/")
    ) {
      if (characters[index] !== "\n") {
        characters[index] = " "
      }
      index += 1
    }
    if (index >= characters.length) {
      throw new Error("Unclosed CSS comment")
    }
    characters[index] = " "
    characters[index + 1] = " "
    index += 1
  }

  return characters.join("")
}

function findCssDelimiter(sourceText, start, end, delimiters) {
  let quote = null
  let escaped = false
  let parentheses = 0
  let brackets = 0

  for (let index = start; index < end; index += 1) {
    const character = sourceText[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "(") {
      parentheses += 1
      continue
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1)
      continue
    }
    if (character === "[") {
      brackets += 1
      continue
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1)
      continue
    }
    if (parentheses === 0 && brackets === 0 && delimiters.has(character)) {
      return { character, index }
    }
  }

  return null
}

function findClosingCssBrace(sourceText, openIndex, end) {
  let depth = 1
  let quote = null
  let escaped = false

  for (let index = openIndex + 1; index < end; index += 1) {
    const character = sourceText[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function parseCssDeclarations(body, bodyOffset) {
  const declarations = []
  let segmentStart = 0

  while (segmentStart < body.length) {
    const delimiter = findCssDelimiter(body, segmentStart, body.length, new Set([";", "{"]))
    const segmentEnd = delimiter?.index ?? body.length
    const segment = body.slice(segmentStart, segmentEnd)
    const colon = findCssDelimiter(segment, 0, segment.length, new Set([":"]))
    if (colon) {
      const property = segment.slice(0, colon.index).trim().toLowerCase()
      const value = segment.slice(colon.index + 1).trim()
      if (/^(?:--)?[a-z]/i.test(property) && value) {
        const leadingWhitespace = segment.search(/\S|$/)
        declarations.push({
          property,
          value,
          offset: bodyOffset + segmentStart + leadingWhitespace
        })
      }
    }

    if (!delimiter) {
      break
    }
    if (delimiter.character === "{") {
      const close = findClosingCssBrace(body, delimiter.index, body.length)
      segmentStart = close === -1 ? body.length : close + 1
    } else {
      segmentStart = delimiter.index + 1
    }
  }

  return declarations
}

export function parseCssRules(sourceText) {
  const source = stripCssComments(sourceText)
  const rules = []
  const errors = []
  const recursiveAtRules = /^@(container|layer|media|scope|starting-style|supports)\b/i

  const parseRange = (start, end, atRules) => {
    let cursor = start
    while (cursor < end) {
      while (cursor < end && /[\s;]/.test(source[cursor])) {
        cursor += 1
      }
      if (cursor >= end) {
        break
      }

      const delimiter = findCssDelimiter(source, cursor, end, new Set(["{", ";"]))
      if (!delimiter) {
        if (source.slice(cursor, end).trim()) {
          errors.push({ offset: cursor, message: "Unparsed CSS content" })
        }
        break
      }
      if (delimiter.character === ";") {
        cursor = delimiter.index + 1
        continue
      }

      const header = source.slice(cursor, delimiter.index).trim()
      const close = findClosingCssBrace(source, delimiter.index, end)
      if (close === -1) {
        errors.push({ offset: delimiter.index, message: `Unclosed CSS block: ${header}` })
        break
      }
      const bodyStart = delimiter.index + 1
      const body = source.slice(bodyStart, close)
      if (header.startsWith("@")) {
        if (recursiveAtRules.test(header)) {
          parseRange(bodyStart, close, [...atRules, header])
        }
      } else if (header) {
        rules.push({
          selector: header,
          atRules,
          declarations: parseCssDeclarations(body, bodyStart),
          offset: cursor
        })
      }
      cursor = close + 1
    }
  }

  parseRange(0, source.length, [])
  return { errors, rules }
}

function hasCssDeclaration(rule, property, predicate) {
  return rule.declarations.some(
    (declaration) => declaration.property === property && predicate(declaration.value)
  )
}

function selectorContains(rule, selector) {
  return rule.selector.split(",").some((part) => part.trim().includes(selector))
}

function jsxClassValues(sourceFile) {
  const values = []
  visit(sourceFile, (node) => {
    if (!ts.isJsxAttribute(node) || node.name.text !== "className" || !node.initializer) {
      return
    }
    visit(node.initializer, (child) => {
      if (
        ts.isStringLiteral(child) ||
        ts.isNoSubstitutionTemplateLiteral(child) ||
        child.kind === ts.SyntaxKind.TemplateHead ||
        child.kind === ts.SyntaxKind.TemplateMiddle ||
        child.kind === ts.SyntaxKind.TemplateTail
      ) {
        values.push(child.text)
      }
    })
  })
  return values
}

function sourceStringValues(sourceFile) {
  const values = []
  visit(sourceFile, (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      values.push(node.text)
    }
  })
  return values
}

function createFinding({ caseEntry, evidence, file, locations, message }) {
  const first = locations[0] ?? { line: 1, column: 1 }
  return {
    diagnosticId: stableDiagnosticId([caseEntry.id, file]),
    source: "jingle-doctor",
    caseId: caseEntry.id,
    caseTitle: caseEntry.title,
    casePath: caseEntry.path,
    owner: caseEntry.owner,
    ruleId: caseEntry.ruleId,
    severity: caseEntry.severity,
    file,
    line: first.line,
    column: first.column,
    occurrenceCount: locations.length,
    locations,
    evidence,
    message
  }
}

function visit(sourceFile, callback) {
  const walk = (node) => {
    callback(node)
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
}

function jsxTagName(node) {
  const tag = node.tagName
  return ts.isIdentifier(tag) ? tag.text : null
}

function jsxAttribute(node, name) {
  return node.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name
  )
}

function collectImports(sourceFile) {
  const imports = []
  visit(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({ node: node.moduleSpecifier, specifier: node.moduleSpecifier.text })
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push({ node: node.arguments[0], specifier: node.arguments[0].text })
    }
  })
  return imports
}

function resolveRendererImport(repoRoot, fromFile, specifier) {
  const resolvedPath = resolveArchitectureImportPath(fromFile, specifier)
  return resolvedPath ? toRepoPath(repoRoot, resolvedPath) : null
}

function packageNameFromSpecifier(specifier) {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

function loadDeclaredPackageNames(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  return new Set(
    [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {})
    ].sort()
  )
}

function isResolvableExternalImport(specifier, declaredPackageNames) {
  if (specifier.startsWith("node:")) {
    return true
  }
  return declaredPackageNames.has(packageNameFromSpecifier(specifier))
}

function isControllerOwner(repoFile) {
  const basename = path.basename(repoFile)
  const hasControllerName = /controller\.(?:[cm]?[jt]s)$/i.test(basename)
  const hasCommandsName = /(?:^|[-_.])commands\.(?:[cm]?[jt]s)$/i.test(basename)
  return (
    controllerOwnerRoots.some((root) => repoFile.startsWith(root)) &&
    (hasControllerName || hasCommandsName)
  )
}

function unwrapExpression(node) {
  let expression = node
  while (
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

function isUnshadowedGlobalIdentifier(node, name, sourceFile, typeChecker) {
  if (!ts.isIdentifier(node) || node.text !== name) {
    return false
  }
  const symbol = typeChecker.getSymbolAtLocation(node)
  return !symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile)
}

function staticElementAccessName(node) {
  if (!node.argumentExpression) {
    return null
  }
  const argument = unwrapExpression(node.argumentExpression)
  return ts.isStringLiteralLike(argument) ? argument.text : null
}

function staticBindingPropertyName(element) {
  const property = element.propertyName ?? element.name
  if (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) {
    return property.text
  }
  if (ts.isComputedPropertyName(property)) {
    const expression = unwrapExpression(property.expression)
    return ts.isStringLiteralLike(expression) ? expression.text : null
  }
  return null
}

function isRendererBridgeHostReference(node, bridgeHostAliasSymbols, sourceFile, typeChecker) {
  const expression = unwrapExpression(node)
  if (ts.isIdentifier(expression)) {
    if (
      isUnshadowedGlobalIdentifier(expression, "window", sourceFile, typeChecker) ||
      isUnshadowedGlobalIdentifier(expression, "globalThis", sourceFile, typeChecker)
    ) {
      return true
    }
    const symbol = typeChecker.getSymbolAtLocation(expression)
    return !!symbol && bridgeHostAliasSymbols.has(symbol)
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "window" &&
    isRendererBridgeHostReference(
      expression.expression,
      bridgeHostAliasSymbols,
      sourceFile,
      typeChecker
    )
  ) {
    return true
  }
  return (
    ts.isElementAccessExpression(expression) &&
    staticElementAccessName(expression) === "window" &&
    isRendererBridgeHostReference(
      expression.expression,
      bridgeHostAliasSymbols,
      sourceFile,
      typeChecker
    )
  )
}

function collectRendererBridgeHostAliasSymbols(sourceFile, typeChecker) {
  const aliases = new Set()
  let changed = true
  while (changed) {
    changed = false
    visit(sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
        isRendererBridgeHostReference(node.initializer, aliases, sourceFile, typeChecker)
      ) {
        const symbol = typeChecker.getSymbolAtLocation(node.name)
        if (symbol && !aliases.has(symbol)) {
          aliases.add(symbol)
          changed = true
        }
      }
    })
  }
  return aliases
}

function isRendererBridgeAccess(node, bridgeHostAliasSymbols, sourceFile, typeChecker) {
  if (
    ts.isPropertyAccessExpression(node) &&
    rendererBridgeNames.has(node.name.text) &&
    isRendererBridgeHostReference(node.expression, bridgeHostAliasSymbols, sourceFile, typeChecker)
  ) {
    return true
  }

  if (
    ts.isElementAccessExpression(node) &&
    isRendererBridgeHostReference(
      node.expression,
      bridgeHostAliasSymbols,
      sourceFile,
      typeChecker
    ) &&
    rendererBridgeNames.has(staticElementAccessName(node))
  ) {
    return true
  }

  return (
    ts.isVariableDeclaration(node) &&
    !!node.initializer &&
    isRendererBridgeHostReference(
      node.initializer,
      bridgeHostAliasSymbols,
      sourceFile,
      typeChecker
    ) &&
    ts.isObjectBindingPattern(node.name) &&
    node.name.elements.some((element) =>
      rendererBridgeNames.has(staticBindingPropertyName(element))
    )
  )
}

function scanRendererBridge({ caseEntry, parsedFiles, typeChecker }) {
  const findings = []
  for (const file of parsedFiles) {
    if (isControllerOwner(file.repoFile)) {
      continue
    }
    const bridgeHostAliasSymbols = collectRendererBridgeHostAliasSymbols(
      file.sourceFile,
      typeChecker
    )
    const locations = []
    visit(file.sourceFile, (node) => {
      if (isRendererBridgeAccess(node, bridgeHostAliasSymbols, file.sourceFile, typeChecker)) {
        locations.push(lineAndColumn(file.sourceFile, node.getStart(file.sourceFile)))
      }
    })
    if (locations.length > 0) {
      findings.push(
        createFinding({
          caseEntry,
          file: file.repoFile,
          locations,
          evidence: `${locations.length} renderer bridge reference${locations.length === 1 ? "" : "s"}`,
          message:
            "Move renderer IPC into a feature controller or commands module and pass typed data and commands to the view."
        })
      )
    }
  }
  return { findings, matchedFiles: parsedFiles.length, scannedFiles: parsedFiles.length }
}

function scanLowerLayerImports({ caseEntry, parsedFiles, repoRoot, styleFiles }) {
  const findings = []
  const declaredPackageNames = loadDeclaredPackageNames(repoRoot)
  const topLevelNames = new Set()
  for (const file of [...parsedFiles, ...styleFiles]) {
    const relativePath = file.repoFile.slice(`${rendererRootPath}/`.length)
    const [topLevelName, nestedPath] = relativePath.split("/", 2)
    if (nestedPath) {
      topLevelNames.add(topLevelName)
    }
  }
  for (const name of [...topLevelNames]
    .filter((entry) => !classifiedLayerNames.has(entry))
    .sort()) {
    findings.push(
      createFinding({
        caseEntry,
        file: `${rendererRootPath}/${name}`,
        locations: [{ line: 1, column: 1 }],
        evidence: `unclassified renderer root: ${name}`,
        message:
          "Classify the new renderer root as a shell or lower layer before Doctor can prove dependency direction."
      })
    )
  }
  const rootFiles = [...parsedFiles, ...styleFiles]
    .map((file) => file.repoFile)
    .filter((file) => !file.slice(`${rendererRootPath}/`.length).includes("/"))
  for (const file of rootFiles.filter((entry) => !classifiedRootFiles.has(entry)).sort()) {
    findings.push(
      createFinding({
        caseEntry,
        file,
        locations: [{ line: 1, column: 1 }],
        evidence: `unclassified renderer root file: ${path.basename(file)}`,
        message:
          "Classify the new renderer root file as shell composition or shared infrastructure before Doctor can prove dependency direction."
      })
    )
  }
  const candidates = parsedFiles.filter(
    (file) =>
      lowerLayerRoots.some((root) => file.repoFile.startsWith(root)) ||
      sharedRootFiles.has(file.repoFile)
  )
  for (const file of candidates) {
    const matches = collectImports(file.sourceFile)
      .map((entry) => ({
        ...entry,
        target: resolveRendererImport(repoRoot, file.absolutePath, entry.specifier)
      }))
      .filter(
        (entry) =>
          (entry.target && upperLayerRoots.some((root) => entry.target.startsWith(root))) ||
          (entry.target && upperRootFiles.has(entry.target)) ||
          (!entry.target &&
            entry.specifier.startsWith("@") &&
            !isResolvableExternalImport(entry.specifier, declaredPackageNames))
      )
    if (matches.length === 0) {
      continue
    }
    const locations = matches.map((entry) =>
      lineAndColumn(file.sourceFile, entry.node.getStart(file.sourceFile))
    )
    findings.push(
      createFinding({
        caseEntry,
        file: file.repoFile,
        locations,
        evidence: matches
          .map((entry) =>
            entry.target ? entry.specifier : `${entry.specifier} (unclassified import)`
          )
          .join(", "),
        message:
          "Move shared copy or UI contracts to their feature owner; lower renderer layers cannot import a page or shell."
      })
    )
  }
  return {
    findings,
    matchedFiles: candidates.length + topLevelNames.size + rootFiles.length,
    scannedFiles: candidates.length + topLevelNames.size + rootFiles.length
  }
}

function scanPrimitiveIsolation({ caseEntry, parsedFiles, repoRoot, typeChecker }) {
  const findings = []
  const candidates = parsedFiles.filter((file) => file.repoFile.startsWith(`${primitiveRootPath}/`))
  for (const file of candidates) {
    const matches = []
    for (const entry of collectImports(file.sourceFile)) {
      const target = resolveRendererImport(repoRoot, file.absolutePath, entry.specifier)
      const targetWithoutExtension = target?.replace(/\.(?:[cm]?[jt]sx?)$/i, "")
      if (
        target &&
        !target.startsWith(`${primitiveRootPath}/`) &&
        targetWithoutExtension !== `${rendererRootPath}/lib/utils`
      ) {
        matches.push({ node: entry.node, evidence: `import ${entry.specifier}` })
      }
    }
    const bridgeHostAliasSymbols = collectRendererBridgeHostAliasSymbols(
      file.sourceFile,
      typeChecker
    )
    visit(file.sourceFile, (node) => {
      if (isRendererBridgeAccess(node, bridgeHostAliasSymbols, file.sourceFile, typeChecker)) {
        matches.push({ node, evidence: node.getText(file.sourceFile) })
      }
      if (ts.isJsxText(node) && /[A-Za-z0-9\u3400-\u9fff]/.test(node.text)) {
        matches.push({ node, evidence: `JSX text: ${node.text.trim().slice(0, 40)}` })
      }
      if (
        ts.isJsxAttribute(node) &&
        ["alt", "aria-label", "placeholder", "title"].includes(node.name.text)
      ) {
        if (
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text.trim()
        ) {
          matches.push({
            node,
            evidence: `${node.name.text}: ${node.initializer.text.slice(0, 40)}`
          })
        }
      }
    })
    if (matches.length === 0) {
      continue
    }
    findings.push(
      createFinding({
        caseEntry,
        file: file.repoFile,
        locations: matches.map((entry) =>
          lineAndColumn(file.sourceFile, entry.node.getStart(file.sourceFile))
        ),
        evidence: matches.map((entry) => entry.evidence).join("; "),
        message: "Keep primitives free of renderer features, IPC, and hard-coded product copy."
      })
    )
  }
  return { findings, matchedFiles: candidates.length, scannedFiles: candidates.length }
}

function scanRadixOwner({ caseEntry, parsedFiles }) {
  const findings = []
  for (const file of parsedFiles.filter(
    (entry) => !entry.repoFile.startsWith(`${primitiveRootPath}/`)
  )) {
    const matches = collectImports(file.sourceFile).filter((entry) =>
      entry.specifier.startsWith("@radix-ui/react-")
    )
    if (matches.length === 0) {
      continue
    }
    findings.push(
      createFinding({
        caseEntry,
        file: file.repoFile,
        locations: matches.map((entry) =>
          lineAndColumn(file.sourceFile, entry.node.getStart(file.sourceFile))
        ),
        evidence: matches.map((entry) => entry.specifier).join(", "),
        message:
          "Wrap Radix behavior in components/ui and consume the shared primitive from product surfaces."
      })
    )
  }
  return { findings, matchedFiles: parsedFiles.length, scannedFiles: parsedFiles.length }
}

function scanNativeControls({ caseEntry, parsedFiles }) {
  const findings = []
  const candidates = parsedFiles.filter(
    (file) =>
      /\.jsx?$|\.tsx$/i.test(file.repoFile) && !file.repoFile.startsWith(`${primitiveRootPath}/`)
  )
  for (const file of candidates) {
    const matches = []
    visit(file.sourceFile, (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        if (tag && nativeControlTags.has(tag)) {
          matches.push({ node, tag })
        }
      }
    })
    if (matches.length === 0) {
      continue
    }
    const counts = new Map()
    for (const match of matches) {
      counts.set(match.tag, (counts.get(match.tag) ?? 0) + 1)
    }
    findings.push(
      createFinding({
        caseEntry,
        file: file.repoFile,
        locations: matches.map((entry) =>
          lineAndColumn(file.sourceFile, entry.node.getStart(file.sourceFile))
        ),
        evidence: [...counts].map(([tag, count]) => `${tag} x${count}`).join(", "),
        message:
          "Replace native controls with the shared Button, Input, Textarea, Select, Switch, or IconButton primitive."
      })
    )
  }
  return { findings, matchedFiles: candidates.length, scannedFiles: candidates.length }
}

function scanNativeTitle({ caseEntry, parsedFiles }) {
  const findings = []
  const candidates = parsedFiles.filter(
    (file) =>
      /\.jsx?$|\.tsx$/i.test(file.repoFile) && !file.repoFile.startsWith(`${primitiveRootPath}/`)
  )
  for (const file of candidates) {
    const matches = []
    visit(file.sourceFile, (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        const title = tag && visualTitleTags.has(tag) ? jsxAttribute(node, "title") : null
        if (title) {
          matches.push(title)
        }
      }
    })
    if (matches.length === 0) {
      continue
    }
    findings.push(
      createFinding({
        caseEntry,
        file: file.repoFile,
        locations: matches.map((entry) =>
          lineAndColumn(file.sourceFile, entry.getStart(file.sourceFile))
        ),
        evidence: `${matches.length} native title attribute${matches.length === 1 ? "" : "s"}`,
        message: "Use the shared Tooltip or IconButton contract for visible hover and focus help."
      })
    )
  }
  return { findings, matchedFiles: candidates.length, scannedFiles: candidates.length }
}

function scanStringToken({ caseEntry, evidenceLabel, parsedFiles, styleFiles, patterns, message }) {
  const findings = []
  for (const file of parsedFiles) {
    const matches = []
    visit(file.sourceFile, (node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        node.kind === ts.SyntaxKind.TemplateHead ||
        node.kind === ts.SyntaxKind.TemplateMiddle ||
        node.kind === ts.SyntaxKind.TemplateTail
      ) {
        for (const pattern of patterns) {
          pattern.lastIndex = 0
          if (pattern.test(node.text)) {
            matches.push({ node, token: pattern.source })
            break
          }
        }
      }
    })
    if (matches.length > 0) {
      findings.push(
        createFinding({
          caseEntry,
          file: file.repoFile,
          locations: matches.map((entry) =>
            lineAndColumn(file.sourceFile, entry.node.getStart(file.sourceFile))
          ),
          evidence: `${matches.length} ${evidenceLabel}${matches.length === 1 ? "" : "s"}`,
          message
        })
      )
    }
  }
  for (const file of styleFiles) {
    const matches = []
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      for (const match of file.sourceText.matchAll(pattern)) {
        matches.push(locationFromOffset(file.sourceText, match.index))
      }
    }
    if (matches.length > 0) {
      findings.push(
        createFinding({
          caseEntry,
          file: file.repoFile,
          locations: matches,
          evidence: `${matches.length} ${evidenceLabel}${matches.length === 1 ? "" : "s"}`,
          message
        })
      )
    }
  }
  return {
    findings,
    matchedFiles: parsedFiles.length + styleFiles.length,
    scannedFiles: parsedFiles.length + styleFiles.length
  }
}

function scanLoadingMotion({ caseEntry, parsedFiles }) {
  const candidates = parsedFiles.filter(
    (file) => file.repoFile !== `${primitiveRootPath}/spinner.tsx`
  )
  return scanStringToken({
    caseEntry,
    evidenceLabel: "local loading animation token",
    parsedFiles: candidates,
    styleFiles: [],
    patterns: [/\banimate-(?:ping|pulse|spin)\b/g],
    message:
      "Use the shared Spinner or a dedicated stable loading primitive instead of local animation utilities."
  })
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

function isInfiniteValue(node) {
  return (
    (ts.isIdentifier(node) && node.text === "Infinity") ||
    (ts.isStringLiteral(node) && node.text.toLowerCase() === "infinite") ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Number" &&
      node.name.text === "POSITIVE_INFINITY")
  )
}

function scanPerpetualMotion({ caseEntry, parsedFiles, styleFiles }) {
  const findings = []
  for (const file of styleFiles) {
    const matches = []
    for (const rule of file.rules) {
      const isSpinnerOwner = rule.selector
        .split(",")
        .every((selector) => selector.trim() === ".jingle-spinner")
      for (const declaration of rule.declarations) {
        const isInfiniteAnimation =
          declaration.property === "animation" && /\binfinite\b/i.test(declaration.value)
        const isInfiniteIteration =
          declaration.property === "animation-iteration-count" &&
          /(^|,)\s*infinite\s*(,|$)/i.test(declaration.value)
        if ((isInfiniteAnimation || isInfiniteIteration) && !isSpinnerOwner) {
          matches.push({
            location: locationFromOffset(file.sourceText, declaration.offset),
            declaration: `${declaration.property}: ${declaration.value}`
          })
        }
      }
    }
    if (matches.length > 0) {
      findings.push(
        createFinding({
          caseEntry,
          file: file.repoFile,
          locations: matches.map((entry) => entry.location),
          evidence: matches.map((entry) => entry.declaration).join("; "),
          message:
            "Delete decorative loops or bind real running state to a shared motion primitive with reduced-motion behavior."
        })
      )
    }
  }

  for (const file of parsedFiles) {
    const matches = []
    visit(file.sourceFile, (node) => {
      if (ts.isPropertyAssignment(node)) {
        const property = propertyNameText(node.name)
        if (
          property &&
          ["animationIterationCount", "iterations", "repeat"].includes(property) &&
          isInfiniteValue(node.initializer)
        ) {
          matches.push({
            location: lineAndColumn(file.sourceFile, node.getStart(file.sourceFile)),
            declaration: node.getText(file.sourceFile)
          })
        }
      }
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        /\banimate-\[[^\]]*\binfinite\b/i.test(node.text)
      ) {
        matches.push({
          location: lineAndColumn(file.sourceFile, node.getStart(file.sourceFile)),
          declaration: node.text
        })
      }
    })
    if (matches.length > 0) {
      findings.push(
        createFinding({
          caseEntry,
          file: file.repoFile,
          locations: matches.map((entry) => entry.location),
          evidence: matches.map((entry) => entry.declaration).join("; "),
          message:
            "Delete decorative loops or bind real running state to a shared motion primitive with reduced-motion behavior."
        })
      )
    }
  }
  return {
    findings,
    matchedFiles: parsedFiles.length + styleFiles.length,
    scannedFiles: parsedFiles.length + styleFiles.length
  }
}

function scanMotionContract({ caseEntry, parsedFiles, styleFiles }) {
  const indexCss = styleFiles.find((file) => file.repoFile === `${rendererRootPath}/index.css`)
  const requiredPrimitiveFragments = new Map([
    [`${primitiveRootPath}/button-variants.ts`, ["jingle-pressable"]],
    [`${primitiveRootPath}/dialog.tsx`, ["jingle-dialog-overlay", "jingle-dialog-content"]],
    [`${primitiveRootPath}/spinner.tsx`, ["jingle-spinner"]],
    [`${primitiveRootPath}/context-menu.tsx`, ["jingle-floating-surface", "origin-[var("]],
    [`${primitiveRootPath}/dropdown-menu.tsx`, ["jingle-floating-surface", "origin-[var("]],
    [`${primitiveRootPath}/hover-card.tsx`, ["jingle-floating-surface", "origin-[var("]],
    [`${primitiveRootPath}/popover.tsx`, ["jingle-floating-surface", "origin-[var("]],
    [`${primitiveRootPath}/tooltip.tsx`, ["jingle-floating-surface", "origin-[var("]]
  ])
  const missing = []
  if (!indexCss) {
    missing.push({ file: `${rendererRootPath}/index.css`, fragment: "file" })
  } else {
    const rules = indexCss.rules
    const requireCss = (name, predicate) => {
      if (!predicate()) {
        missing.push({ file: indexCss.repoFile, fragment: name })
      }
    }
    for (const token of [
      "--jingle-motion-duration-press",
      "--jingle-motion-duration-fast",
      "--jingle-motion-duration-exit",
      "--jingle-motion-ease-out"
    ]) {
      requireCss(token, () =>
        rules.some(
          (rule) =>
            selectorContains(rule, ":root") &&
            hasCssDeclaration(rule, token, (value) => value.length > 0)
        )
      )
    }
    requireCss(".jingle-pressable transition", () =>
      rules.some(
        (rule) =>
          rule.selector.trim() === ".jingle-pressable" &&
          hasCssDeclaration(rule, "transition-property", (value) => value.includes("transform")) &&
          hasCssDeclaration(rule, "transition-duration", (value) =>
            value.includes("--jingle-motion-duration-fast")
          ) &&
          hasCssDeclaration(rule, "transition-timing-function", (value) =>
            value.includes("--jingle-motion-ease-out")
          )
      )
    )
    for (const [selector, properties] of [
      [".jingle-dialog-overlay", ["opacity"]],
      [".jingle-dialog-content", ["opacity", "transform"]],
      [".jingle-floating-surface", ["opacity", "transform"]]
    ]) {
      requireCss(`${selector} transition`, () =>
        rules.some(
          (rule) =>
            rule.selector.trim() === selector &&
            hasCssDeclaration(
              rule,
              "transition",
              (value) =>
                properties.every((property) => value.includes(property)) &&
                value.includes("--jingle-motion-duration-exit") &&
                value.includes("--jingle-motion-ease-out")
            )
        )
      )
    }
    requireCss(".jingle-spinner animation", () =>
      rules.some(
        (rule) =>
          rule.selector.trim() === ".jingle-spinner" &&
          hasCssDeclaration(
            rule,
            "animation",
            (value) => value.includes("jingle-spinner-rotate") && /\binfinite\b/.test(value)
          )
      )
    )
    requireCss("keyboard-immediate", () =>
      rules.some(
        (rule) =>
          selectorContains(rule, 'html[data-input-modality="keyboard"]') &&
          selectorContains(rule, ".jingle-floating-surface") &&
          hasCssDeclaration(rule, "transition-duration", (value) => value === "0ms")
      )
    )
    const isReducedMotionRule = (rule) =>
      rule.atRules.some((atRule) => /prefers-reduced-motion\s*:\s*reduce/i.test(atRule))
    requireCss("reduced-motion movement", () =>
      rules.some(
        (rule) =>
          isReducedMotionRule(rule) &&
          selectorContains(rule, ".jingle-floating-surface") &&
          selectorContains(rule, ".jingle-dialog-content") &&
          hasCssDeclaration(rule, "transform", (value) => value === "none")
      )
    )
    requireCss("reduced-motion spinner", () =>
      rules.some(
        (rule) =>
          isReducedMotionRule(rule) &&
          selectorContains(rule, ".jingle-spinner") &&
          hasCssDeclaration(rule, "animation", (value) => value === "none")
      )
    )
  }
  for (const [repoFile, fragments] of requiredPrimitiveFragments) {
    const file = parsedFiles.find((entry) => entry.repoFile === repoFile)
    if (!file) {
      missing.push({ file: repoFile, fragment: "file" })
      continue
    }
    const classValues =
      repoFile === `${primitiveRootPath}/button-variants.ts`
        ? sourceStringValues(file.sourceFile)
        : jsxClassValues(file.sourceFile)
    for (const fragment of fragments) {
      if (!classValues.some((value) => value.includes(fragment))) {
        missing.push({ file: repoFile, fragment })
      }
    }
  }

  const grouped = new Map()
  for (const entry of missing) {
    const values = grouped.get(entry.file) ?? []
    values.push(entry.fragment)
    grouped.set(entry.file, values)
  }
  const findings = [...grouped].map(([file, fragments]) =>
    createFinding({
      caseEntry,
      file,
      locations: [{ line: 1, column: 1 }],
      evidence: `missing ${fragments.join(", ")}`,
      message:
        "Restore the shared press, overlay, floating-surface, spinner, keyboard, and reduced-motion contract."
    })
  )
  return {
    findings,
    matchedFiles: requiredPrimitiveFragments.size + 1,
    scannedFiles:
      requiredPrimitiveFragments.size +
      1 -
      missing.filter((entry) => entry.fragment === "file").length
  }
}

function scanUnboundedTransitions(context) {
  const sourceResult = scanStringToken({
    ...context,
    evidenceLabel: "unbounded transition token",
    styleFiles: [],
    patterns: [/\btransition-all\b/g, /transition\s*:\s*all\b/g],
    message: "Name the exact animated properties and use the shared motion tokens."
  })
  const findings = [...sourceResult.findings]
  for (const file of context.parsedFiles) {
    const locations = []
    visit(file.sourceFile, (node) => {
      if (!ts.isPropertyAssignment(node)) {
        return
      }
      const property = propertyNameText(node.name)
      const value =
        ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)
          ? node.initializer.text
          : null
      if (
        value &&
        ((property === "transition" && /^\s*all(?:\s|,|$)/i.test(value)) ||
          (property === "transitionProperty" && /(^|,)\s*all\s*(,|$)/i.test(value)))
      ) {
        locations.push(lineAndColumn(file.sourceFile, node.getStart(file.sourceFile)))
      }
    })
    if (locations.length > 0 && !findings.some((finding) => finding.file === file.repoFile)) {
      findings.push(
        createFinding({
          caseEntry: context.caseEntry,
          file: file.repoFile,
          locations,
          evidence: `${locations.length} unbounded style transition${locations.length === 1 ? "" : "s"}`,
          message: "Name the exact animated properties and use the shared motion tokens."
        })
      )
    }
  }
  for (const file of context.styleFiles) {
    const matches = []
    for (const rule of file.rules) {
      for (const declaration of rule.declarations) {
        const usesAll =
          (declaration.property === "transition" &&
            /(^|,)\s*all(?:\s|,|$)/i.test(declaration.value)) ||
          (declaration.property === "transition-property" &&
            /(^|,)\s*all\s*(,|$)/i.test(declaration.value))
        if (usesAll) {
          matches.push(locationFromOffset(file.sourceText, declaration.offset))
        }
      }
    }
    if (matches.length > 0) {
      findings.push(
        createFinding({
          caseEntry: context.caseEntry,
          file: file.repoFile,
          locations: matches,
          evidence: `${matches.length} unbounded CSS transition${matches.length === 1 ? "" : "s"}`,
          message: "Name the exact animated properties and use the shared motion tokens."
        })
      )
    }
  }
  return {
    findings,
    matchedFiles: context.parsedFiles.length + context.styleFiles.length,
    scannedFiles: context.parsedFiles.length + context.styleFiles.length
  }
}

const scanners = new Map([
  ["JINGLE-BOUNDARY-001", scanRendererBridge],
  ["JINGLE-BOUNDARY-002", scanLowerLayerImports],
  ["JINGLE-UI-001", scanPrimitiveIsolation],
  ["JINGLE-UI-002", scanRadixOwner],
  ["JINGLE-UI-003", scanNativeControls],
  ["JINGLE-UI-004", scanNativeTitle],
  ["JINGLE-MOTION-001", scanUnboundedTransitions],
  ["JINGLE-MOTION-002", scanLoadingMotion],
  ["JINGLE-MOTION-003", scanPerpetualMotion],
  ["JINGLE-MOTION-004", scanMotionContract]
])

export function computeRendererDigest(repoRoot) {
  const rendererRoot = path.join(repoRoot, rendererRootPath)
  const hash = crypto.createHash("sha256")
  for (const absolutePath of discoverFiles(rendererRoot)) {
    const repoFile = toRepoPath(repoRoot, absolutePath)
    hash.update(repoFile)
    hash.update("\0")
    hash.update(fs.readFileSync(absolutePath))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function runJingleFrontendDoctor({ catalog, repoRoot, runId }) {
  const rendererRoot = path.join(repoRoot, rendererRootPath)
  const discoveredFiles = discoverFiles(rendererRoot)
  const sourceFiles = discoveredFiles.filter((file) => sourceExtensions.has(path.extname(file)))
  const cssFiles = discoveredFiles.filter((file) => path.extname(file) === ".css")
  const parseFailures = []
  const typeProgram = ts.createProgram({
    rootNames: sourceFiles,
    options: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      target: ts.ScriptTarget.Latest
    }
  })
  const typeChecker = typeProgram.getTypeChecker()
  const parsedFiles = sourceFiles.map((absolutePath) => {
    const sourceText = fs.readFileSync(absolutePath, "utf8")
    const sourceFile =
      typeProgram.getSourceFile(absolutePath) ??
      ts.createSourceFile(
        absolutePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(absolutePath)
      )
    for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
      const location = lineAndColumn(sourceFile, diagnostic.start ?? 0)
      parseFailures.push({
        file: toRepoPath(repoRoot, absolutePath),
        line: location.line,
        column: location.column,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
      })
    }
    return { absolutePath, repoFile: toRepoPath(repoRoot, absolutePath), sourceFile, sourceText }
  })
  const styleFiles = cssFiles.map((absolutePath) => {
    const sourceText = fs.readFileSync(absolutePath, "utf8")
    const parsed = parseCssRules(sourceText)
    for (const error of parsed.errors) {
      const location = locationFromOffset(sourceText, error.offset)
      parseFailures.push({
        file: toRepoPath(repoRoot, absolutePath),
        line: location.line,
        column: location.column,
        message: error.message
      })
    }
    return {
      absolutePath,
      repoFile: toRepoPath(repoRoot, absolutePath),
      sourceText,
      rules: parsed.rules
    }
  })

  const activeCases = catalog.cases.filter((entry) => entry.status === "active")
  const activeIds = new Set(activeCases.map((entry) => entry.id))
  const unknownCases = activeCases
    .filter((entry) => !scanners.has(entry.id))
    .map((entry) => entry.id)
  const orphanScanners = [...scanners.keys()].filter((id) => !activeIds.has(id))
  if (unknownCases.length > 0 || orphanScanners.length > 0) {
    throw new Error(
      `Doctor catalog/scanner mismatch (missing: ${unknownCases.join(", ") || "none"}; orphaned: ${orphanScanners.join(", ") || "none"})`
    )
  }

  const diagnostics = []
  const ruleCoverage = []
  for (const caseEntry of activeCases) {
    const result = scanners.get(caseEntry.id)({
      caseEntry,
      parsedFiles,
      repoRoot,
      styleFiles,
      typeChecker
    })
    diagnostics.push(...result.findings)
    ruleCoverage.push({
      caseId: caseEntry.id,
      ruleId: caseEntry.ruleId,
      matchedFiles: result.matchedFiles,
      scannedFiles: result.scannedFiles,
      findingCount: result.findings.length
    })
  }
  diagnostics.sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.file.localeCompare(right.file) ||
      left.line - right.line
  )

  return {
    schemaVersion: doctorSchemaVersion,
    runId,
    source: "jingle-doctor",
    status: parseFailures.length === 0 ? "complete" : "incomplete",
    target: rendererRootPath,
    coverage: {
      catalogCaseCount: activeCases.length,
      implementedCaseCount: scanners.size,
      discoveredFileCount: discoveredFiles.length,
      discoveredSourceFileCount: sourceFiles.length,
      scannedSourceFileCount: parsedFiles.length,
      discoveredStyleFileCount: cssFiles.length,
      scannedStyleFileCount: styleFiles.length,
      parseFailureCount: parseFailures.length,
      skippedFiles: []
    },
    ruleCoverage,
    parseFailures,
    diagnostics
  }
}

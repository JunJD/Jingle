"use client"
import { useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneLight } from "react-syntax-highlighter/dist/cjs/styles/prism"
import { Button, CopyButton } from "./button"
import { cn } from "@/lib/utils"

interface CodeBlockTab {
  code: string
  highlightLines?: number[]
  language?: string
  name: string
}

interface CodeBlockProps {
  className?: string
  code?: string
  copiedLabel: string
  copyErrorLabel: string
  copyLabel: string
  filename?: string
  highlightLines?: number[]
  language?: string
  maxLines?: number
  moreLinesLabel: (count: number) => string
  showLineNumbers?: boolean
  tabs?: CodeBlockTab[]
}

const EMPTY_HIGHLIGHT_LINES: number[] = []
const EMPTY_TABS: CodeBlockTab[] = []

const EXTENSION_LANGUAGES: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  diff: "diff",
  htm: "html",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  py: "python",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash"
}

function getLanguageFromFilename(filename: string | undefined): string {
  if (!filename) {
    return "text"
  }

  const baseName = filename.split(/[\\/]/).pop()?.toLowerCase() ?? filename.toLowerCase()

  if (baseName === "dockerfile") {
    return "docker"
  }

  const extension = baseName.includes(".") ? baseName.split(".").pop() : baseName
  return extension ? (EXTENSION_LANGUAGES[extension] ?? "text") : "text"
}

function getVisibleCode(
  code: string,
  maxLines: number | undefined
): { code: string; hidden: number } {
  if (!maxLines) {
    return { code, hidden: 0 }
  }

  const lines = code.split("\n")
  const visibleLines = lines.slice(0, maxLines)
  return {
    code: visibleLines.join("\n"),
    hidden: Math.max(0, lines.length - visibleLines.length)
  }
}

export const CodeBlock = ({
  className,
  language,
  filename,
  code,
  copiedLabel,
  copyErrorLabel,
  copyLabel,
  highlightLines = EMPTY_HIGHLIGHT_LINES,
  maxLines,
  moreLinesLabel,
  showLineNumbers = true,
  tabs = EMPTY_TABS
}: CodeBlockProps): React.JSX.Element => {
  const [activeTab, setActiveTab] = useState(0)

  const tabsExist = tabs.length > 0

  const activeCode = tabsExist ? tabs[activeTab].code : (code ?? "")
  const activeFilename = tabsExist ? tabs[activeTab].name : filename
  const activeLanguage =
    (tabsExist ? tabs[activeTab].language : language) ?? getLanguageFromFilename(activeFilename)
  const activeHighlightLines = tabsExist ? tabs[activeTab].highlightLines || [] : highlightLines
  const visible = getVisibleCode(activeCode, maxLines)
  const showHeader = tabsExist || Boolean(activeFilename)

  return (
    <div
      className={cn(
        "relative min-w-0 max-w-full overflow-hidden rounded-[var(--jingle-radius-panel)] bg-background-secondary/60 px-[var(--jingle-space-3)] py-[var(--jingle-space-2-5)] font-mono [font-size:var(--jingle-font-code)] leading-[var(--jingle-line-code)] text-foreground/85",
        className
      )}
    >
      {showHeader ? (
        <div className="flex flex-col gap-[var(--jingle-gap-sm)] border-b border-border/50 pb-2">
          {tabsExist && (
            <div className="flex flex-wrap gap-1">
              {tabs.map((tab, index) => (
                <Button
                  key={tab.name}
                  type="button"
                  onClick={() => setActiveTab(index)}
                  aria-pressed={activeTab === index}
                  size="sm"
                  variant="ghost"
                  className={`rounded-md px-2 py-1 font-sans [font-size:var(--jingle-font-meta)] leading-4 transition-colors ${
                    activeTab === index
                      ? "bg-background-interactive text-foreground"
                      : "text-muted-foreground hover:bg-background-interactive/60 hover:text-foreground"
                  }`}
                >
                  {tab.name}
                </Button>
              ))}
            </div>
          )}
          {activeFilename ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate font-mono [font-size:var(--jingle-font-meta)] leading-4 text-muted-foreground">
                {activeFilename}
              </div>
              <CopyButton
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-sans [font-size:var(--jingle-font-meta)] leading-4 text-muted-foreground transition-colors hover:bg-background-interactive hover:text-foreground"
                copiedLabel={copiedLabel}
                copyErrorLabel={copyErrorLabel}
                copyLabel={copyLabel}
                iconClassName="size-[14px]"
                text={activeCode}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <SyntaxHighlighter
        language={activeLanguage}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: "0.625rem 0 0",
          background: "transparent",
          color: "var(--foreground)",
          fontSize: "var(--jingle-font-code)",
          lineHeight: "var(--jingle-line-code)",
          overflowX: "auto",
          whiteSpace: "pre"
        }}
        className="code-block-scrollbar"
        codeTagProps={{
          style: {
            background: "transparent",
            color: "inherit",
            fontFamily: "inherit",
            whiteSpace: "pre"
          }
        }}
        lineNumberStyle={{
          color: "var(--muted-foreground)",
          minWidth: "2.25rem",
          opacity: 0.72,
          paddingRight: "0.75rem",
          fontSize: "var(--jingle-font-meta)",
          lineHeight: "var(--jingle-line-code)",
          userSelect: "none"
        }}
        wrapLines
        showLineNumbers={showLineNumbers}
        lineProps={(lineNumber) => ({
          style: {
            backgroundColor: activeHighlightLines.includes(lineNumber)
              ? "color-mix(in srgb, var(--status-info) 10%, transparent)"
              : "transparent",
            display: "block",
            whiteSpace: "pre",
            width: "100%"
          }
        })}
        PreTag="div"
      >
        {visible.code}
      </SyntaxHighlighter>
      {visible.hidden > 0 ? (
        <div className="pt-2 font-sans [font-size:var(--jingle-font-meta)] leading-4 text-muted-foreground">
          {moreLinesLabel(visible.hidden)}
        </div>
      ) : null}
    </div>
  )
}

"use client"
import { useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { atomDark } from "react-syntax-highlighter/dist/cjs/styles/prism"
import { Check, Copy } from "lucide-react"
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
  filename?: string
  highlightLines?: number[]
  language?: string
  maxLines?: number
  showLineNumbers?: boolean
  tabs?: CodeBlockTab[]
}

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
  highlightLines = [],
  maxLines,
  showLineNumbers = true,
  tabs = []
}: CodeBlockProps): React.JSX.Element => {
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  const tabsExist = tabs.length > 0
  const copyToClipboard = async () => {
    const textToCopy = tabsExist ? tabs[activeTab].code : code
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const activeCode = tabsExist ? tabs[activeTab].code : (code ?? "")
  const activeFilename = tabsExist ? tabs[activeTab].name : filename
  const activeLanguage =
    (tabsExist ? tabs[activeTab].language : language) ?? getLanguageFromFilename(activeFilename)
  const activeHighlightLines = tabsExist ? tabs[activeTab].highlightLines || [] : highlightLines
  const visible = getVisibleCode(activeCode, maxLines)

  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-lg bg-slate-900 p-4 font-mono text-sm",
        className
      )}
    >
      <div className="flex flex-col gap-2">
        {tabsExist && (
          <div className="flex overflow-x-auto">
            {tabs.map((tab, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActiveTab(index)}
                className={`px-3 !py-2 font-sans text-xs transition-colors ${
                  activeTab === index ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab.name}
              </button>
            ))}
          </div>
        )}
        {activeFilename ? (
          <div className="flex items-center justify-between py-2">
            <div className="min-w-0 truncate text-xs text-zinc-400">{activeFilename}</div>
            <button
              type="button"
              onClick={copyToClipboard}
              className="flex shrink-0 items-center gap-1 font-sans text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        ) : null}
      </div>
      <SyntaxHighlighter
        language={activeLanguage}
        style={atomDark}
        customStyle={{
          margin: 0,
          padding: 0,
          background: "transparent",
          fontSize: "0.875rem"
        }}
        wrapLines
        showLineNumbers={showLineNumbers}
        lineProps={(lineNumber) => ({
          style: {
            backgroundColor: activeHighlightLines.includes(lineNumber)
              ? "rgba(255,255,255,0.1)"
              : "transparent",
            display: "block",
            width: "100%"
          }
        })}
        PreTag="div"
      >
        {visible.code}
      </SyntaxHighlighter>
      {visible.hidden > 0 ? (
        <div className="pt-2 font-sans text-[11px] leading-4 text-zinc-400">+{visible.hidden}</div>
      ) : null}
    </div>
  )
}

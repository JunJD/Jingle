import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { resolveLocalizedText, type AppLocale } from "@shared/i18n"
import type { LauncherCommandArgumentManifest } from "@shared/launcher-command-owner"
import type { LauncherShellConfig } from "@shared/launcher"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type { LauncherInputElement } from "./input-element"
import type { LauncherCommandOpenOptions, LauncherCommandRoute } from "./pages/types"

type ArgumentInputElement = HTMLInputElement | HTMLSelectElement

function getArgumentLabel(argument: LauncherCommandArgumentManifest, locale: AppLocale): string {
  return resolveLocalizedText(argument.title ?? argument.placeholder, locale, argument.name)
}

function getInitialArgumentValue(argument: LauncherCommandArgumentManifest): string {
  if (argument.type === "dropdown") {
    return String(argument.data?.[0]?.value ?? "")
  }

  return ""
}

function buildInitialArguments(
  argumentsSchema: readonly LauncherCommandArgumentManifest[]
): Record<string, string> {
  return Object.fromEntries(
    argumentsSchema.map((argument) => [argument.name, getInitialArgumentValue(argument)])
  )
}

function resolveArgumentInputType(argument: LauncherCommandArgumentManifest): string {
  return argument.type === "password" ? "password" : "text"
}

function validateRequiredArguments(input: {
  argumentsSchema: readonly LauncherCommandArgumentManifest[]
  values: Record<string, string>
}): string | null {
  for (const argument of input.argumentsSchema) {
    if (argument.required && !input.values[argument.name]?.trim()) {
      return argument.name
    }
  }

  return null
}

function getCommandArgumentsCopy(locale: AppLocale): {
  back: string
  backShortcut: string
  open: string
  required: string
} {
  if (locale === "zh-CN") {
    return {
      back: "返回",
      backShortcut: "Esc",
      open: "打开",
      required: "必填"
    }
  }

  return {
    back: "Back",
    backShortcut: "Esc",
    open: "Open",
    required: "Required"
  }
}

export function LauncherCommandArgumentsPage(props: {
  argumentsSchema: readonly LauncherCommandArgumentManifest[]
  commandTitle: string
  locale: AppLocale
  onBack: () => void
  onSubmit: (options: LauncherCommandOpenOptions) => void
  route: LauncherCommandRoute
  shellConfig: LauncherShellConfig
}): React.JSX.Element {
  const {
    argumentsSchema,
    commandTitle,
    locale,
    onBack,
    onSubmit,
    route,
    shellConfig
  } = props
  const firstInputRef = useRef<ArgumentInputElement | null>(null)
  const launcherInputRef = useRef<LauncherInputElement | null>(null)
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialArguments(argumentsSchema)
  )
  const [invalidArgumentName, setInvalidArgumentName] = useState<string | null>(null)
  const copy = getCommandArgumentsCopy(locale)
  const placeholders = useMemo(() => [commandTitle], [commandTitle])
  const backShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.close) ?? copy.backShortcut
  const primaryActionShortcut = useLauncherCommandShortcut(
    LAUNCHER_COMMAND_IDS.actionsExecutePrimary
  )

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [route.commandName, route.kind])

  const setValue = useCallback((name: string, value: string): void => {
    setValues((current) => ({
      ...current,
      [name]: value
    }))
    setInvalidArgumentName((current) => (current === name ? null : current))
  }, [])

  const submit = useCallback((): void => {
    const invalidName = validateRequiredArguments({ argumentsSchema, values })
    if (invalidName) {
      setInvalidArgumentName(invalidName)
      return
    }

    onSubmit({
      initialAction: route.initialAction,
      launchProps: {
        ...route.launchProps,
        arguments: values
      },
      seedQuery: route.seedQuery
    })
  }, [argumentsSchema, onSubmit, route.initialAction, route.launchProps, route.seedQuery, values])
  return (
    <LauncherChrome
      footer={
        <>
          <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
            <button
              className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
              onClick={onBack}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <ArrowLeft className="h-[var(--ow-icon-sm)] w-[var(--ow-icon-sm)]" />
              <span>{copy.back}</span>
              <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                {backShortcut}
              </span>
            </button>
          </div>
          <div className="flex items-center gap-[var(--ow-gap-sm)]">
            <button
              className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
              onClick={submit}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <span>{copy.open}</span>
              {primaryActionShortcut ? (
                <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                  {primaryActionShortcut}
                </span>
              ) : null}
            </button>
          </div>
        </>
      }
      inputRef={launcherInputRef}
      inputReplacement={
        <div className="min-w-0 flex-1 px-[var(--launcher-input-content-inset-x)] [font-size:var(--ow-font-control)] font-semibold text-foreground">
          {commandTitle}
        </div>
      }
      inputValue=""
      onInputValueChange={() => {}}
      placeholders={placeholders}
      shellConfig={shellConfig}
      showHeaderDivider
      surface="command-arguments"
    >
      <form
        className="launcher-command-arguments"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {argumentsSchema.map((argument, index) => {
          const label = getArgumentLabel(argument, locale)
          const placeholder = resolveLocalizedText(argument.placeholder, locale, "")
          const isInvalid = invalidArgumentName === argument.name

          return (
            <label className="launcher-command-argument-field" key={argument.name}>
              <span className="launcher-command-argument-label">
                <span>{label}</span>
                {argument.required ? (
                  <span className="launcher-command-argument-required">{copy.required}</span>
                ) : null}
              </span>
              {argument.type === "dropdown" ? (
                <select
                  ref={(element) => {
                    if (index === 0) {
                      firstInputRef.current = element
                    }
                  }}
                  className="launcher-command-argument-control"
                  value={values[argument.name] ?? ""}
                  onChange={(event) => setValue(argument.name, event.target.value)}
                >
                  {(argument.data ?? []).map((item) => (
                    <option key={item.value ?? ""} value={item.value ?? ""}>
                      {resolveLocalizedText(item.title, locale, item.value ?? "")}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  ref={(element) => {
                    if (index === 0) {
                      firstInputRef.current = element
                    }
                  }}
                  aria-invalid={isInvalid ? true : undefined}
                  className="launcher-command-argument-control"
                  placeholder={placeholder}
                  type={resolveArgumentInputType(argument)}
                  value={values[argument.name] ?? ""}
                  onChange={(event) => setValue(argument.name, event.target.value)}
                />
              )}
            </label>
          )
        })}
      </form>
    </LauncherChrome>
  )
}

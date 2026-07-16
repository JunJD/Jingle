import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import type { AppLocale } from "@shared/i18n"
import type { LauncherShellConfig } from "@shared/launcher"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type { LauncherCommandArgumentProjection } from "./command-argument-projection"
import type { LauncherInputElement } from "./input-element"
import type { LauncherCommandOpenOptions, LauncherCommandRoute } from "./pages/types"

type ArgumentInputElement = HTMLInputElement | HTMLSelectElement

function buildInitialArguments(
  argumentsProjection: readonly LauncherCommandArgumentProjection[]
): Record<string, string> {
  return Object.fromEntries(
    argumentsProjection.map((argument) => [argument.name, argument.initialValue])
  )
}

function getArgumentValue(values: Record<string, string>, name: string): string {
  if (!Object.hasOwn(values, name)) {
    throw new Error(`Launcher command argument "${name}" has no draft value`)
  }
  return values[name]
}

function validateRequiredArguments(input: {
  argumentsProjection: readonly LauncherCommandArgumentProjection[]
  values: Record<string, string>
}): string | null {
  for (const argument of input.argumentsProjection) {
    if (argument.required && getArgumentValue(input.values, argument.name).trim().length === 0) {
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
  argumentsProjection: readonly LauncherCommandArgumentProjection[]
  commandTitle: string
  locale: AppLocale
  onBack: () => void
  onSubmit: (options: LauncherCommandOpenOptions) => void
  route: LauncherCommandRoute
  shellConfig: LauncherShellConfig
}): React.JSX.Element {
  const { argumentsProjection, commandTitle, locale, onBack, onSubmit, route, shellConfig } = props
  const firstInputRef = useRef<ArgumentInputElement | null>(null)
  const launcherInputRef = useRef<LauncherInputElement | null>(null)
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialArguments(argumentsProjection)
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
    const invalidName = validateRequiredArguments({ argumentsProjection, values })
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
  }, [
    argumentsProjection,
    onSubmit,
    route.initialAction,
    route.launchProps,
    route.seedQuery,
    values
  ])
  return (
    <LauncherChrome
      footer={
        <>
          <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)]">
            <Button
              className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] border-0 px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-control)] font-medium text-foreground"
              onClick={onBack}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="h-[var(--jingle-icon-sm)] w-[var(--jingle-icon-sm)]" />
              <span>{copy.back}</span>
              <span className="launcher-shortcut [font-size:var(--jingle-font-meta)] text-muted-foreground">
                {backShortcut}
              </span>
            </Button>
          </div>
          <div className="flex items-center gap-[var(--jingle-gap-sm)]">
            <Button
              className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--jingle-gap-sm)] rounded-[var(--jingle-radius-md)] border-0 px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-control)] font-medium text-foreground"
              onClick={submit}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
              variant="ghost"
            >
              <span>{copy.open}</span>
              {primaryActionShortcut ? (
                <span className="launcher-shortcut [font-size:var(--jingle-font-meta)] text-muted-foreground">
                  {primaryActionShortcut}
                </span>
              ) : null}
            </Button>
          </div>
        </>
      }
      inputRef={launcherInputRef}
      inputReplacement={
        <div className="min-w-0 flex-1 px-[var(--launcher-input-content-inset-x)] [font-size:var(--jingle-font-control)] font-semibold text-foreground">
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
        {argumentsProjection.map((argument, index) => {
          const isInvalid = invalidArgumentName === argument.name
          const value = getArgumentValue(values, argument.name)

          return (
            <label className="launcher-command-argument-field" key={argument.name}>
              <span className="launcher-command-argument-label">
                <span>{argument.label}</span>
                {argument.required ? (
                  <span className="launcher-command-argument-required">{copy.required}</span>
                ) : null}
              </span>
              {argument.control === "select" ? (
                <Select
                  ref={(element) => {
                    if (index === 0) {
                      firstInputRef.current = element
                    }
                  }}
                  className="launcher-command-argument-control"
                  wrapperClassName="w-full"
                  value={value}
                  onChange={(event) => setValue(argument.name, event.target.value)}
                >
                  {argument.options.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  ref={(element) => {
                    if (index === 0) {
                      firstInputRef.current = element
                    }
                  }}
                  aria-invalid={isInvalid ? true : undefined}
                  className="launcher-command-argument-control"
                  placeholder={argument.placeholder}
                  type={argument.inputType}
                  value={value}
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

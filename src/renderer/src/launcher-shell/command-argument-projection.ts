import { resolveLocalizedText, type AppLocale } from "@shared/i18n"
import type { LauncherCommandArgumentManifest } from "@shared/launcher-command-owner"

interface LauncherCommandArgumentBaseProjection {
  initialValue: string
  label: string
  name: string
  placeholder?: string
  required: boolean
}

export interface LauncherCommandSelectOptionProjection {
  label: string
  value: string
}

export interface LauncherCommandSelectArgumentProjection
  extends LauncherCommandArgumentBaseProjection {
  control: "select"
  options: readonly LauncherCommandSelectOptionProjection[]
}

export interface LauncherCommandTextArgumentProjection
  extends LauncherCommandArgumentBaseProjection {
  control: "input"
  inputType: "password" | "text"
}

export type LauncherCommandArgumentProjection =
  | LauncherCommandSelectArgumentProjection
  | LauncherCommandTextArgumentProjection

export function projectLauncherCommandArguments(
  argumentsSchema: readonly LauncherCommandArgumentManifest[],
  locale: AppLocale
): readonly LauncherCommandArgumentProjection[] {
  return argumentsSchema.map((argument) => {
    const base = {
      initialValue: "",
      label: resolveLocalizedText(argument.title, locale),
      name: argument.name,
      placeholder:
        argument.placeholder === undefined
          ? undefined
          : resolveLocalizedText(argument.placeholder, locale),
      required: argument.required === true
    }

    if (argument.type === "dropdown") {
      return {
        ...base,
        control: "select" as const,
        initialValue: argument.data[0].value,
        options: argument.data.map((option) => ({
          label: resolveLocalizedText(option.title, locale),
          value: option.value
        }))
      }
    }

    return {
      ...base,
      control: "input" as const,
      inputType: argument.type === "password" ? ("password" as const) : ("text" as const)
    }
  })
}

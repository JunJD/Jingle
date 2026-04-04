import { useLayoutEffect } from "react"
import type { RefObject } from "react"
import {
  validateLauncherChromeMeasurement,
  type LauncherShellConfig
} from "../../../../shared/launcher"

export function useLauncherChromeAudit(params: {
  footerRef?: RefObject<HTMLElement | null>
  hasFooter: boolean
  headerRef: RefObject<HTMLElement | null>
  shellConfig: LauncherShellConfig
  surface: string
}): void {
  const { footerRef, hasFooter, headerRef, shellConfig, surface } = params

  useLayoutEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const headerElement = headerRef.current
    if (!headerElement) {
      return
    }

    const issues = validateLauncherChromeMeasurement(shellConfig, {
      footerHeight: hasFooter ? footerRef?.current?.offsetHeight : undefined,
      headerHeight: headerElement.offsetHeight
    })

    if (issues.length === 0) {
      return
    }

    console.warn(`[Launcher] ${surface} chrome contract drift detected`, {
      issues,
      shellConfig
    })
  }, [footerRef, hasFooter, headerRef, shellConfig, surface])
}

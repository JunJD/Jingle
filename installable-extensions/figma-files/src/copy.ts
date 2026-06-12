import {
  resolveLocalizedText,
  useRuntimeAppLocale,
  type AppLocale,
  type LocalizedTextValue
} from "@openwork/extension-api"

export interface FigmaRuntimeCopy {
  connectFigmaInSettings: string
  addTeamIds: string
  addTeamIdsDescription: string
  addToStarredFiles: string
  allFiles: string
  browsePages: string
  clearedRecentFiles: string
  clearRecentFiles: string
  configureTeamIds: string
  connectFigma: string
  copyFileLink: string
  copyPageLink: string
  emptyProject: string
  failedToClearRecentFiles: string
  failedToLoadFigmaFiles: string
  failedToLoadPages: string
  failedToReloadFiles: string
  fileSearchNeedsToken: string
  maintenance: string
  noFigmaFilesFound: string
  noPagesFound: string
  openBranch: string
  openExtensionSettings: string
  openFile: string
  openPage: string
  recentFiles: string
  reloadedFigmaFiles: string
  reloadFiles: string
  removeFromStarredFiles: string
  retry: string
  searchFigmaFiles: string
  starredFiles: string
  starredFilesLimitReached: string
}

function localized(en_US: string, zh_Hans: string): LocalizedTextValue {
  return { en_US, zh_Hans }
}

function resolveCopy(locale: AppLocale, value: LocalizedTextValue): string {
  return resolveLocalizedText(value, locale)
}

export function getFigmaRuntimeCopy(locale: AppLocale): FigmaRuntimeCopy {
  return {
    connectFigmaInSettings: resolveCopy(
      locale,
      localized("Connect Figma in Settings", "在设置中连接 Figma")
    ),
    addTeamIds: resolveCopy(locale, localized("Add Team IDs", "添加团队 ID")),
    addTeamIdsDescription: resolveCopy(
      locale,
      localized(
        "Add one or more Figma team IDs in Settings to load team files.",
        "在设置中添加一个或多个 Figma 团队 ID 后才能加载团队文件。"
      )
    ),
    addToStarredFiles: resolveCopy(
      locale,
      localized("Add to Starred Files", "加入加星文件")
    ),
    allFiles: resolveCopy(locale, localized("All Files", "全部文件")),
    browsePages: resolveCopy(locale, localized("Browse Pages", "浏览页面")),
    clearedRecentFiles: resolveCopy(
      locale,
      localized("Cleared Recent Files", "已清除最近文件")
    ),
    clearRecentFiles: resolveCopy(
      locale,
      localized("Clear Recent Files", "清除最近文件")
    ),
    configureTeamIds: resolveCopy(
      locale,
      localized("Configure Team IDs", "配置团队 ID")
    ),
    connectFigma: resolveCopy(locale, localized("Connect Figma", "连接 Figma")),
    copyFileLink: resolveCopy(locale, localized("Copy File Link", "复制文件链接")),
    copyPageLink: resolveCopy(locale, localized("Copy Page Link", "复制页面链接")),
    emptyProject: resolveCopy(locale, localized("Empty Project", "空项目")),
    failedToClearRecentFiles: resolveCopy(
      locale,
      localized("Failed to Clear Recent Files", "清除最近文件失败")
    ),
    failedToLoadFigmaFiles: resolveCopy(
      locale,
      localized("Failed to Load Figma Files", "加载 Figma 文件失败")
    ),
    failedToLoadPages: resolveCopy(
      locale,
      localized("Failed to Load Pages", "加载页面失败")
    ),
    failedToReloadFiles: resolveCopy(
      locale,
      localized("Failed to Reload Files", "刷新文件失败")
    ),
    fileSearchNeedsToken: resolveCopy(
      locale,
      localized(
        "Connect Figma in Settings before loading files.",
        "加载文件前请先在设置中连接 Figma。"
      )
    ),
    maintenance: resolveCopy(locale, localized("Maintenance", "维护")),
    noFigmaFilesFound: resolveCopy(
      locale,
      localized("No Figma Files Found", "未找到 Figma 文件")
    ),
    noPagesFound: resolveCopy(locale, localized("No Pages Found", "未找到页面")),
    openBranch: resolveCopy(locale, localized("Open Branch", "打开分支")),
    openExtensionSettings: resolveCopy(
      locale,
      localized("Open Extension Settings", "打开扩展设置")
    ),
    openFile: resolveCopy(locale, localized("Open File", "打开文件")),
    openPage: resolveCopy(locale, localized("Open Page", "打开页面")),
    recentFiles: resolveCopy(locale, localized("Recent Files", "最近文件")),
    reloadedFigmaFiles: resolveCopy(
      locale,
      localized("Reloaded Figma Files", "已刷新 Figma 文件")
    ),
    reloadFiles: resolveCopy(locale, localized("Reload Files", "刷新文件")),
    removeFromStarredFiles: resolveCopy(
      locale,
      localized("Remove from Starred Files", "移出加星文件")
    ),
    retry: resolveCopy(locale, localized("Retry", "重试")),
    searchFigmaFiles: resolveCopy(
      locale,
      localized("Search Figma files", "搜索 Figma 文件")
    ),
    starredFiles: resolveCopy(locale, localized("Starred Files", "加星文件")),
    starredFilesLimitReached: resolveCopy(
      locale,
      localized("Starred Files Limit Reached", "已达到加星文件上限")
    )
  }
}

export function useFigmaRuntimeCopy(): FigmaRuntimeCopy {
  const locale = useRuntimeAppLocale()
  return getFigmaRuntimeCopy(locale)
}

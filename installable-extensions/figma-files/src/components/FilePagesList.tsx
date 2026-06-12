import { Action, ActionPanel, getPreferenceValues, Icon, List, openNativeExtensionSettings } from "@openwork/extension-api"
import { useCachedPromise } from "@openwork/extension-utils"
import { fetchPages } from "../api"
import { useFigmaRuntimeCopy } from "../copy"
import { openFigmaPage, pageBrowserUrl } from "../open"
import type { FigmaFile, FigmaFilesPreferences, FigmaNode } from "../types"

function createPageKeywords(file: FigmaFile, node: FigmaNode): string[] {
  return [file.name, node.name]
}

export default function FilePagesList(props: {
  file: FigmaFile
  onVisit: (file: FigmaFile) => Promise<void>
}): React.JSX.Element {
  const copy = useFigmaRuntimeCopy()
  const preferences = getPreferenceValues<FigmaFilesPreferences>()
  const { data, error, isLoading, revalidate } = useCachedPromise(
    fetchPages,
    [props.file.key, props.file.last_modified],
    {
      keepPreviousData: true
    }
  )
  const pages = data ?? []

  return (
    <List isLoading={isLoading} navigationTitle={`${props.file.name} Pages`}>
      {error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={Icon.ArrowDownCircle}
                onAction={() => {
                  void revalidate()
                }}
                title={copy.retry}
              />
              <Action
                icon={Icon.BlankDocument}
                onAction={() => {
                  void openNativeExtensionSettings({})
                }}
                title={copy.openExtensionSettings}
              />
            </ActionPanel>
          }
          description={error.message}
          title={copy.failedToLoadPages}
        />
      ) : pages.length === 0 && !isLoading ? (
        <List.EmptyView title={copy.noPagesFound} />
      ) : null}

      {pages.map((node) => (
        <List.Item
          key={node.id}
          icon={Icon.BlankDocument}
          keywords={createPageKeywords(props.file, node)}
          subtitle={props.file.name}
          title={node.name}
          actions={
            <ActionPanel>
              <Action
                icon={Icon.ArrowNe}
                onAction={async () => {
                  await props.onVisit(props.file)
                  await openFigmaPage(props.file, node, preferences.open_in)
                }}
                title={copy.openPage}
              />
              <Action.CopyToClipboard content={pageBrowserUrl(props.file.key, node.id)} title={copy.copyPageLink} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}

import React from "react"
void React
import type { RuntimeOpenApplication } from "@jingle/extension-api"
import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  confirmAlert,
  getPreferenceValues,
  Icon,
  open,
  Image,
  List,
  Keyboard
} from "@jingle/extension-api"
import { format, formatDistanceToNow } from "date-fns"
import { useMemo } from "react"
import type { ReactNode } from "react"

import {
  DatabaseProperty,
  deleteDatabase,
  deletePage,
  getPageIcon,
  notionColorToTintColor,
  Page,
  PageProperty,
  User
} from "../../domain"
import { handleOnOpenPage, isNotionApp } from "../utils/openPage"
import { DatabaseView } from "../utils/types"

import { PageDetail } from "./PageDetail"
import { ActionEditPageProperty } from "./actions/ActionEditPageProperty"
import ActionCreateQuicklink from "./actions/ActionCreateQuicklink"
import { ActionSetVisibleProperties } from "./actions/ActionSetVisibleProperties"
import { AppendToPageForm } from "./forms/AppendToPageForm"
import { CreatePageForm } from "./forms/CreatePageForm"
import { DatabaseViewForm } from "./forms/DatabaseViewForm"

type PageListItemProps = {
  page: Page
  databaseId?: string
  databaseView?: DatabaseView
  databaseProperties?: DatabaseProperty[]
  setDatabaseView?: (databaseView: DatabaseView) => Promise<void>
  setRecentPage: (page: Page) => Promise<void>
  removeRecentPage: (id: string) => Promise<void>
  mutate: () => Promise<void>
  renderDatabaseTarget: (page: Page) => ReactNode
  users?: User[]
  icon?: Image.ImageLike
  customActions?: ReactNode[]
  isPinned?: boolean
  setPinnedPage?: (page: Page) => Promise<void>
  removePinnedPage?: (id: string) => Promise<void>
}

type SearchPagePreferences = {
  open_in?: RuntimeOpenApplication
  primaryAction?: string
}

type NotionPrimaryAction = "jingle" | "notion"

function normalizePrimaryAction(value: string | undefined): NotionPrimaryAction {
  if (value === "notion") {
    return "notion"
  }
  if (value === "jingle" || value === undefined) {
    return "jingle"
  }
  throw new Error(`Unsupported Notion primary action preference: ${value}`)
}

export function PageListItem({
  page,
  databaseId,
  customActions,
  databaseProperties,
  databaseView,
  setRecentPage,
  removeRecentPage,
  setDatabaseView,
  icon = getPageIcon(page),
  users,
  mutate,
  renderDatabaseTarget,
  isPinned,
  setPinnedPage,
  removePinnedPage
}: PageListItemProps) {
  const accessories: List.Item.Accessory[] = []

  if (databaseView && databaseView.properties) {
    const pagePropertiesById = new Map(Object.entries(page.properties).map(([name, property]) => [property.id, { name, property }]))
    const propertyAccessories: Array<List.Item.Accessory | List.Item.Accessory[]> = []
    for (const propId of Object.keys(databaseView.properties)) {
      const visibleProperty = pagePropertiesById.get(propId)
      if (!visibleProperty) continue
      const accessory = getPropertyAccessory(visibleProperty.property, visibleProperty.name, users)
      if (accessory) propertyAccessories.push(accessory)
    }

    accessories.push(...(propertyAccessories.flat() as List.Item.Accessory[]))
  }

  const lastEditedUser = users?.find((u) => u.id === page.last_edited_user)
  if (page.last_edited_time) {
    const date = new Date(page.last_edited_time)
    accessories.push({
      date,
      icon: lastEditedUser?.avatar_url
        ? { source: lastEditedUser.avatar_url, mask: Image.Mask.Circle }
        : undefined,
      tooltip: `Last Edited: ${format(date, "EEE d MMM yyyy 'at' HH:mm")}${
        lastEditedUser ? ` by ${lastEditedUser.name}` : ""
      }`
    })
  }

  const quickEditablePropertyTypes = new Set(["checkbox", "date", "status", "select", "multi_select", "people"])
  const quickEditProperties = databaseProperties?.filter((property) => quickEditablePropertyTypes.has(property.type))

  const visiblePropertiesIds: string[] = []
  for (const dp of databaseProperties ?? []) {
    if (databaseView?.properties?.[dp.id]) visiblePropertiesIds.push(dp.id)
  }

  const title = page.title ? page.title : "Untitled"
  const viewDatabaseId = databaseId ?? page.parent_database_id
  const pageDetailTarget = useMemo(
    () => <PageDetail page={page} setRecentPage={setRecentPage} users={users} />,
    [page, setRecentPage, users]
  )
  const databaseTarget = useMemo(
    () => (page.object === "database" ? renderDatabaseTarget(page) : null),
    [page, renderDatabaseTarget]
  )
  const appendToPageTarget = useMemo(() => <AppendToPageForm page={page} />, [page])
  const createPageTarget = useMemo(
    () => <CreatePageForm defaults={{ database: page.id }} mutate={mutate} />,
    [mutate, page.id]
  )
  const databaseViewTarget = useMemo(
    () =>
      viewDatabaseId && setDatabaseView ? (
        <DatabaseViewForm
          databaseId={viewDatabaseId}
          databaseView={databaseView}
          setDatabaseView={setDatabaseView}
        />
      ) : null,
    [databaseView, setDatabaseView, viewDatabaseId]
  )

  const PreviewInJingleAction =
    page.object == "page" ? (
      <Action.Push
        title="Preview Page"
        icon={Icon.BlankDocument}
        target={pageDetailTarget}
      />
    ) : (
      <Action.Push
        title="Navigate to Database"
        icon={Icon.List}
        target={databaseTarget}
      />
    )
  const OpenInAppAction = (
    <Action
      title={`Open in App`}
      icon={"notion-logo.png"}
      onAction={() => handleOnOpenPage(page, setRecentPage)}
    />
  )
  const { primaryAction, open_in } = getPreferenceValues<SearchPagePreferences>()
  const normalizedPrimaryAction = normalizePrimaryAction(primaryAction)

  const OpenInBrowserAction = (
    <Action
      title={`Open in Browser`}
      icon={Icon.Globe}
      onAction={async () => {
        if (!page.url) return
        // When the preferred app is Notion, "Open in Browser" should still
        // open in the default browser — not hand the HTTPS URL to the Notion
        // app (which just activates it without navigating).
        if (isNotionApp(open_in)) {
          await open(page.url)
        } else {
          await open(page.url, open_in)
        }
        await setRecentPage(page)
        await closeMainWindow()
      }}
    />
  )

  const OpenPageActions = isNotionApp(open_in) // Default app is Notion
    ? normalizedPrimaryAction == "notion"
      ? [OpenInAppAction, PreviewInJingleAction, OpenInBrowserAction]
      : [PreviewInJingleAction, OpenInAppAction, OpenInBrowserAction]
    : normalizedPrimaryAction == "notion"
      ? [OpenInBrowserAction, PreviewInJingleAction]
      : [PreviewInJingleAction, OpenInBrowserAction]

  const pageWord = page.object.charAt(0).toUpperCase() + page.object.slice(1)

  return (
    <List.Item
      title={title}
      icon={{ value: icon, tooltip: pageWord }}
      actions={
        <PageListItemActions
          appendToPageTarget={appendToPageTarget}
          createPageTarget={createPageTarget}
          customActions={customActions}
          databaseProperties={databaseProperties}
          databaseView={databaseView}
          databaseViewTarget={databaseViewTarget}
          isPinned={isPinned}
          mutate={mutate}
          openPageActions={OpenPageActions}
          page={page}
          pageWord={pageWord}
          quickEditProperties={quickEditProperties}
          removePinnedPage={removePinnedPage}
          removeRecentPage={removeRecentPage}
          setDatabaseView={setDatabaseView}
          setPinnedPage={setPinnedPage}
          title={title}
          users={users}
          viewDatabaseId={viewDatabaseId}
          visiblePropertiesIds={visiblePropertiesIds}
        />
      }
      accessories={accessories}
    />
  )
}

type PageListItemActionsProps = {
  appendToPageTarget: ReactNode
  createPageTarget: ReactNode
  customActions?: ReactNode[]
  databaseProperties?: DatabaseProperty[]
  databaseView?: DatabaseView
  databaseViewTarget: ReactNode
  isPinned?: boolean
  mutate: () => Promise<void>
  openPageActions: ReactNode[]
  page: Page
  pageWord: string
  quickEditProperties?: DatabaseProperty[]
  removePinnedPage?: (id: string) => Promise<void>
  removeRecentPage: (id: string) => Promise<void>
  setDatabaseView?: (databaseView: DatabaseView) => Promise<void>
  setPinnedPage?: (page: Page) => Promise<void>
  title: string
  users?: User[]
  viewDatabaseId?: string
  visiblePropertiesIds: string[]
}

function PageListItemActions({
  appendToPageTarget,
  createPageTarget,
  customActions,
  databaseProperties,
  databaseView,
  databaseViewTarget,
  isPinned,
  mutate,
  openPageActions,
  page,
  pageWord,
  quickEditProperties,
  removePinnedPage,
  removeRecentPage,
  setDatabaseView,
  setPinnedPage,
  title,
  users,
  viewDatabaseId,
  visiblePropertiesIds
}: PageListItemActionsProps) {
  return (
    <ActionPanel>
      <ActionPanel.Section title={title}>
        {...openPageActions}
        {customActions?.map((action) => action)}
        {databaseProperties ? (
          <ActionPanel.Submenu
            title="Edit Property"
            icon={Icon.BulletPoints}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "p" },
              Windows: { modifiers: ["ctrl", "shift"], key: "p" },
              Linux: { modifiers: ["ctrl", "shift"], key: "p" }
            }}
          >
            {quickEditProperties?.map((dp: DatabaseProperty) => (
              <ActionEditPageProperty
                key={dp.id}
                databaseProperty={dp}
                pageId={page.id}
                pageProperty={Object.values(page.properties).find(
                  (property) => property.id === dp.id
                )}
                mutate={mutate}
                users={users}
              />
            ))}
          </ActionPanel.Submenu>
        ) : null}
      </ActionPanel.Section>

      <ActionPanel.Section>
        {page.object === "page" ? (
          <Action.Push
            title="Append Content to Page"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={appendToPageTarget}
          />
        ) : (
          <Action.Push
            title="Create New Page"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={createPageTarget}
          />
        )}

        {isPinned ? (
          <Action
            title="Unpin Page"
            icon={Icon.PinDisabled}
            shortcut={Keyboard.Shortcut.Common.Pin}
            onAction={async () => {
              await removePinnedPage?.(page.id)
            }}
          />
        ) : (
          <Action
            title="Pin Page"
            icon={Icon.Pin}
            shortcut={Keyboard.Shortcut.Common.Pin}
            onAction={async () => {
              await setPinnedPage?.(page)
            }}
          />
        )}

        <ActionCreateQuicklink page={page} />

        <Action
          title={`Delete ${pageWord}`}
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={Keyboard.Shortcut.Common.Remove}
          onAction={async () => {
            if (
              await confirmAlert({
                title: `Delete ${pageWord}`,
                icon: { source: Icon.Trash, tintColor: Color.Red },
                message: `Do you want to delete this ${page.object}? Don't worry, you'll be able to restore it from Notion's trash.`
              })
            ) {
              if (page.object === "database") {
                await deleteDatabase(page.id)
              } else {
                await deletePage(page.id)
              }
              await removeRecentPage(page.id)
              await mutate()
            }
          }}
        />
      </ActionPanel.Section>

      {databaseProperties && setDatabaseView ? (
        <ActionPanel.Section title="View options">
          {viewDatabaseId ? (
            <Action.Push
              title="Set View Type"
              icon={
                databaseView?.type
                  ? `./icon/view_${databaseView.type}.png`
                  : "./icon/view_list.png"
              }
              shortcut={{
                macOS: { modifiers: ["cmd", "opt", "shift"], key: "v" },
                Windows: { modifiers: ["ctrl", "opt", "shift"], key: "v" },
                Linux: { modifiers: ["ctrl", "opt", "shift"], key: "v" }
              }}
              target={databaseViewTarget}
            />
          ) : null}
          <ActionSetVisibleProperties
            databaseProperties={databaseProperties}
            selectedPropertiesIds={visiblePropertiesIds}
            onSelect={(propertyId: string) => {
              setDatabaseView({
                ...databaseView,
                properties: { ...databaseView?.properties, [propertyId]: {} }
              })
            }}
            onUnselect={(propertyId: string) => {

              const { [propertyId]: _, ...remainingProperties } = databaseView?.properties ?? {}

              setDatabaseView({
                ...databaseView,
                properties: remainingProperties
              })
            }}
          />
        </ActionPanel.Section>
      ) : null}

      {page.url ? (
        <ActionPanel.Section>
          <Action.CopyToClipboard
            title={`Copy ${pageWord} URL`}
            content={page.url}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action.CopyToClipboard
            title="Copy Formatted URL"
            content={{
              html: `<a href="${page.url}" title="${title}">${title}</a>`,
              text: title
            }}
            shortcut={Keyboard.Shortcut.Common.CopyName}
          />
          <Action.Paste
            title={`Paste ${pageWord} URL`}
            content={page.url}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "v" },
              Windows: { modifiers: ["ctrl", "shift"], key: "v" },
              Linux: { modifiers: ["ctrl", "shift"], key: "v" }
            }}
          />
          <Action.CopyToClipboard
            title={`Copy ${pageWord} Title`}
            content={title}
            shortcut={Keyboard.Shortcut.Common.CopyPath}
          />
        </ActionPanel.Section>
      ) : null}
    </ActionPanel>
  )
}

function getPropertyAccessory(
  property: PageProperty | Extract<PageProperty, { type: "formula" }>["value"],
  title: string,
  users?: User[]
): List.Item.Accessory | List.Item.Accessory[] | undefined {
  if (property.value === null) return
  switch (property.type) {
    case "boolean":
    case "checkbox":
      return {
        icon: property.value ? Icon.CheckCircle : Icon.Circle,
        tooltip: `${title}: ${property.value ? "Checked" : "Unchecked"}`
      }
    case "date": {
      const start = new Date(property.value.start)
      return {
        text: formatDistanceToNow(start, { addSuffix: true }),
        tooltip: `${title}: ${format(start, "EEE d MMM yyyy")}`
      }
    }
    case "email":
    case "phone_number":
    case "url":
      return { text: property.value, tooltip: `${title}: ${property.value}` }
    case "formula":
      return getPropertyAccessory(property.value, title)
    case "multi_select":
      return property.value.map((option) => {
        return {
          tag: { value: option.name, color: notionColorToTintColor(option.color) },
          tooltip: `${title}: ${option.name}`
        }
      })
    case "number":
      return { text: property.value.toString(), tooltip: `${title}: ${property.value}` }
    case "people":
      return property.value.map((person) => {
        const user = users?.find((u) => u.id === person.id)
        return {
          text: user?.name ?? "Unknown",
          icon: user?.avatar_url
            ? { source: user.avatar_url, mask: Image.Mask.Circle }
            : Icon.Person,
          tooltip: `${title}: ${user?.name ?? "Unknown"}`
        }
      })
    case "rich_text":
    case "title": {
      if (property.value.length == 0 && property.type == "rich_text") return
      const text = property.value[0]?.plain_text ?? "Untitled"
      return { text, tooltip: `${title}: ${text}` }
    }
    case "select":
    case "status":
      return {
        tag: { value: property.value.name, color: notionColorToTintColor(property.value.color) },
        tooltip: `${title}: ${property.value.name}`
      }
    default:
      return undefined
  }
}

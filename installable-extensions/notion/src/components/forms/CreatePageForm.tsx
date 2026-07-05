import React from "react"
void React
import type { RuntimeOpenApplication } from "@jingle/extension-api"
import {
  ActionPanel,
  Clipboard,
  Icon,
  Form,
  showToast,
  useNavigation,
  Action,
  Toast,
  getPreferenceValues,
  closeMainWindow,
  PopToRootType,
  Keyboard
} from "@jingle/extension-api"
import { FormValidation, useForm } from "@jingle/extension-utils"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  useDatabaseProperties,
  useDatabases,
  useVisibleDatabasePropIds,
  useRecentPages,
  useRelations,
  useUsers
} from "../../hooks"
import { createDatabasePage, DatabaseProperty } from "../../../domain"
import { handleOnOpenPage } from "../../utils/openPage"
import { Quicklink } from "../../utils/types"
import { createNotionCommandUrl, NOTION_COMMAND_NAMES } from "../../../identity"
import { ActionSetOrderProperties } from "../actions/ActionSetOrderProperties"
import { ActionSetVisibleProperties } from "../actions/ActionSetVisibleProperties"

import { PagePropertyField } from "./PagePropertyField"

export type CreatePageFormValues = {
  database: string | undefined
  [K: string]: Form.Value | undefined
  closeAfterSave?: boolean
  content: string
}

type LaunchContext = {
  visiblePropIds?: string[]
  defaults?: CreatePageFormValues
}

type CreatePageFormProps = {
  mutate?: () => Promise<void>
  launchContext?: LaunchContext
  defaults?: Partial<CreatePageFormValues>
}

type CreateDatabasePagePreferences = {
  accessToken?: string
  apiBaseUrl?: string
  closeAfterCreate?: boolean
  open_in?: RuntimeOpenApplication
  properties_in_page_previews?: boolean
  useClipboard?: string
}

const createPropertyId = (property: DatabaseProperty) =>
  "property::" + property.type + "::" + property.id

const NON_EDITABLE_PROPETY_TYPES = new Set(["formula"])
const filterNoEditableProperties = (dp: DatabaseProperty) =>
  !NON_EDITABLE_PROPETY_TYPES.has(dp.type)

async function beginCreatePage(closeAfterSave: boolean | undefined) {
  if (closeAfterSave) {
    await closeMainWindow({ popToRootType: PopToRootType.Suspended })
  }

  await showToast({ style: Toast.Style.Animated, title: "Creating page" })
}

type CreatePageSubmitActionProps = {
  closeAfterCreate?: boolean
  handleSubmit: ReturnType<typeof useForm<CreatePageFormValues>>["handleSubmit"]
  type: "main" | "second"
}

function CreatePageSubmitAction({
  closeAfterCreate,
  handleSubmit,
  type
}: CreatePageSubmitActionProps) {
  const shortcut: Keyboard.Shortcut | undefined =
    type === "second"
      ? {
          macOS: { modifiers: ["cmd", "shift"], key: "enter" },
          Windows: { modifiers: ["ctrl", "shift"], key: "enter" }
        }
      : undefined

  if ((!closeAfterCreate && type === "main") || (closeAfterCreate && type === "second")) {
    return (
      <Action.SubmitForm
        title="Create Page"
        icon={Icon.Plus}
        onSubmit={handleSubmit}
        shortcut={shortcut}
      />
    )
  }

  return (
    <Action.SubmitForm
      title="Create Page and Close"
      icon={Icon.Plus}
      onSubmit={(values: CreatePageFormValues) => handleSubmit({ ...values, closeAfterSave: true })}
      shortcut={shortcut}
    />
  )
}

export function CreatePageForm({ mutate, launchContext, defaults }: CreatePageFormProps) {
  const preferences = getPreferenceValues<CreateDatabasePagePreferences>()
  const { pop } = useNavigation()
  const defaultValues = launchContext?.defaults ?? defaults
  const initialDatabaseId = defaultValues?.database
  const { data: databases, isLoading: isLoadingDatabases } = useDatabases()
  const defaultDatabaseId = initialDatabaseId ?? databases[0]?.id

  const [databaseId, setDatabaseId] = useState<string | null>(
    initialDatabaseId ? initialDatabaseId : null
  )
  const effectiveDatabaseId = databaseId ?? defaultDatabaseId ?? null
  const { data: databaseProperties } = useDatabaseProperties(
    effectiveDatabaseId,
    filterNoEditableProperties
  )
  const { visiblePropIds, setVisiblePropIds } = useVisibleDatabasePropIds(
    effectiveDatabaseId,
    launchContext?.visiblePropIds
  )
  const visibleDatabaseProperties = useMemo(() => {
    if (!visiblePropIds) return databaseProperties
    const visiblePropIdSet = new Set(visiblePropIds)
    return databaseProperties.filter((dp) => visiblePropIdSet.has(dp.id))
  }, [databaseProperties, visiblePropIds])
  const { data: users } = useUsers()
  const { data: relationPages, isLoading: isLoadingRelationPages } =
    useRelations(visibleDatabaseProperties)
  const { setRecentPage } = useRecentPages()
  const hasShownNoDatabasesToast = useRef(false)

  const databasePropertyIds = databaseProperties.map((dp) => dp.id)

  const initialValues = useMemo(() => {
    const values: Partial<CreatePageFormValues> = {
      database: effectiveDatabaseId ?? undefined
    }

    for (const { id, type } of databaseProperties) {
      if (NON_EDITABLE_PROPETY_TYPES.has(type)) continue
      const key = "property::" + type + "::" + id
      let value = defaultValues?.[key]
      if (type == "date" && value) value = new Date(value as string)
      values[key] = value
    }

    return values
  }, [databaseProperties, defaultValues, effectiveDatabaseId])
  const validation: Parameters<typeof useForm<CreatePageFormValues>>[0]["validation"] = {}
  for (const { id, type } of databaseProperties) {
    if (NON_EDITABLE_PROPETY_TYPES.has(type)) continue
    const key = "property::" + type + "::" + id
    if (type == "title") validation[key] = FormValidation.Required
  }

  const { itemProps, values, handleSubmit, reset, focus, setValue } = useForm<CreatePageFormValues>(
    {
      initialValues,
      validation,
      async onSubmit(values) {
        const { closeAfterSave, ...pageValues } = values
        try {
          const beginCreatePagePromise = beginCreatePage(closeAfterSave)

          const page = await createDatabasePage({
            ...initialValues,
            ...pageValues
          })
          await beginCreatePagePromise
          const showCreatedToastPromise = showToast({
            style: Toast.Style.Success,
            title: "Page created",
            primaryAction: {
              title: "Open Page",
              shortcut: {
                macOS: { modifiers: ["cmd"], key: "o" },
                Windows: { modifiers: ["ctrl"], key: "o" }
              },
              onAction: () => handleOnOpenPage(page, setRecentPage)
            },
            secondaryAction: page.url
              ? {
                  title: "Copy URL",
                  shortcut: {
                    macOS: { modifiers: ["cmd", "shift"], key: "c" },
                    Windows: { modifiers: ["ctrl", "shift"], key: "c" }
                  },
                  onAction: () => {
                    Clipboard.copy(page.url as string)
                  }
                }
              : undefined
          })

          if (mutate) {
            await mutate()
            await showCreatedToastPromise
            pop()
          } else {
            reset(initialValues)
            const titleProperty = databaseProperties?.find((dp) => dp.type == "title")
            if (titleProperty) {
              focus(createPropertyId(titleProperty))
            }
            await showCreatedToastPromise
          }
        } catch (error) {
          console.error(error)
          await showToast({ style: Toast.Style.Failure, title: "Failed to create page" })
        }
      }
    }
  )

  useEffect(() => {
    if (!preferences.useClipboard) return

    let canceled = false

    async function prefillFromClipboard() {
      try {
        const text = await Clipboard.readText()
        if (!text || canceled) return
        switch (preferences.useClipboard) {
          case "title":
            setValue("property::title::title", text)
            break
          case "content":
            setValue("content", text)
            break
        }
      } catch {
        if (canceled) return
        await showToast({ style: Toast.Style.Failure, title: "Failed to read clipboard" })
      }
    }

    void prefillFromClipboard()

    return () => {
      canceled = true
    }
  }, [preferences.useClipboard, setValue])

  function sortProperties(a: DatabaseProperty, b: DatabaseProperty) {
    if (!visiblePropIds) {
      if (a.type == "title") return -1
      if (b.type == "title") return 1
      return 0
    }

    const valueA = visiblePropIds.indexOf(a.id)
    const valueB = visiblePropIds.indexOf(b.id)
    if (valueA > valueB) return 1
    if (valueA < valueB) return -1
    return 0
  }

  function getQuicklink(): Quicklink {
    const url = createNotionCommandUrl(NOTION_COMMAND_NAMES.createDatabasePage)
    const launchContext: LaunchContext = {
      defaults: values,
      visiblePropIds: visiblePropIds ?? databasePropertyIds
    }
    let name: string | undefined
    const databaseTitle = databases.find((d) => d.id == effectiveDatabaseId)?.title
    if (databaseTitle) name = "Create new page in " + databaseTitle
    return {
      name: name ?? "Quicklink",
      link: url + "?launchContext=" + encodeURIComponent(JSON.stringify(launchContext))
    }
  }

  useEffect(() => {
    if (isLoadingDatabases || databases.length || hasShownNoDatabasesToast.current) return
    hasShownNoDatabasesToast.current = true
    void showToast({
      style: Toast.Style.Failure,
      title: "No databases found",
      message: "Please make sure you have access to at least one database"
    })
  }, [databases.length, isLoadingDatabases])

  return (
    <Form
      isLoading={isLoadingDatabases || isLoadingRelationPages}
      navigationTitle={initialDatabaseId ? "Create New Page" : "Create Database Page"}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <CreatePageSubmitAction
              closeAfterCreate={preferences.closeAfterCreate}
              handleSubmit={handleSubmit}
              type="main"
            />
            <CreatePageSubmitAction
              closeAfterCreate={preferences.closeAfterCreate}
              handleSubmit={handleSubmit}
              type="second"
            />
            <Action.CreateQuicklink
              title="Create Quicklink to Command as Configured"
              quicklink={getQuicklink()}
              icon={Icon.Link}
            />
          </ActionPanel.Section>
          {databaseProperties ? (
            <ActionPanel.Section title="View options">
              <ActionSetVisibleProperties
                databaseProperties={databaseProperties.filter((dp) => dp.id !== "title")}
                selectedPropertiesIds={visiblePropIds || databasePropertyIds}
                onSelect={(propertyId) =>
                  setVisiblePropIds(visiblePropIds ? [...visiblePropIds, propertyId] : [propertyId])
                }
                onUnselect={(propertyId) =>
                  setVisiblePropIds(
                    (visiblePropIds || databasePropertyIds).filter((pid) => pid !== propertyId)
                  )
                }
              />
              <ActionSetOrderProperties
                databaseProperties={databaseProperties}
                propertiesOrder={visiblePropIds || databasePropertyIds}
                onChangeOrder={setVisiblePropIds}
              />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    >
      {initialDatabaseId ? null : (
        <>
          <Form.Dropdown
            title="Database"
            {...itemProps.database}
            onChange={(value) => {
              setDatabaseId(value)
              itemProps.database.onChange?.(value)
            }}
          >
            {databases?.map((d) => {
              return (
                <Form.Dropdown.Item
                  key={d.id}
                  value={d.id}
                  title={d.title ? d.title : "Untitled"}
                  icon={
                    d.icon_emoji
                      ? d.icon_emoji
                      : d.icon_file
                        ? d.icon_file
                        : d.icon_external
                          ? d.icon_external
                          : Icon.List
                  }
                />
              )
            })}
          </Form.Dropdown>
          <Form.Separator key="separator" />
        </>
      )}

      {visibleDatabaseProperties.toSorted(sortProperties).map((dp) => {
        const id = createPropertyId(dp)
        return (
          <PagePropertyField
            type={dp.type}
            databaseProperty={dp}
            itemProps={itemProps[id]}
            relationPages={relationPages}
            users={users}
            key={id}
          />
        )
      })}
      <Form.Separator />
      <Form.TextArea
        {...itemProps["content"]}
        id="content"
        title="Page Content"
        enableMarkdown
        info="Parses Markdown to Notion Blocks.

It supports:
- Headings (levels 4 to 6 are treated as 3 on Notion)
- Numbered, bulleted, and to-do lists
- Code blocks, block quotes, and tables
- Text formatting; italics, bold, strikethrough, inline code, hyperlinks

Please note that HTML tags and thematic breaks are not supported in Notion due to its limitations."
      />
    </Form>
  )
}

import React from "react"
void React
import { Action, ActionPanel, Icon, Keyboard, List } from "@jingle/extension-api";
import { useCachedPromise } from "@jingle/extension-utils";
import { createElement } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useDatabaseProperties, useDatabasesView } from "../hooks";
import { queryDatabase, getPageName, Page, User } from "../../domain";

import { DatabaseView } from "./DatabaseView";
import { CreatePageForm } from "./forms/CreatePageForm";

type DatabaseListProps = {
  databasePage: Page;
  setRecentPage: (page: Page) => Promise<void>;
  removeRecentPage: (id: string) => Promise<void>;
  users?: User[];
};

export function DatabaseList({ databasePage, setRecentPage, removeRecentPage, users }: DatabaseListProps) {
  const databaseId = databasePage.id;
  const databaseName = getPageName(databasePage);
  const [searchText, setSearchText] = useState<string>();
  const [sort, setSort] = useState<"last_edited_time" | "created_time">("last_edited_time");
  const {
    data: databasePages,
    isLoading,
    mutate,
  } = useCachedPromise(
    (databaseId, searchText, sort) => queryDatabase(databaseId, searchText, sort),
    [databaseId, searchText, sort],
  );
  const { data: databaseProperties, isLoading: isLoadingDatabaseProperties } = useDatabaseProperties(databaseId);
  const { data: databaseView, isLoading: isLoadingDatabaseViews, setDatabaseView } = useDatabasesView(databaseId);

  const navigationTitle = databaseView?.name
    ? (databasePage.icon_emoji ? databasePage.icon_emoji + " " : "") + databaseView.name
    : databaseName;
  const renderDatabaseTarget = useCallback(
    (page: Page) => (
      <DatabaseList
        databasePage={page}
        setRecentPage={setRecentPage}
        removeRecentPage={removeRecentPage}
        users={users}
      />
    ),
    [removeRecentPage, setRecentPage, users]
  );

  useEffect(() => {
    void setRecentPage(databasePage)
  }, [databasePage, setRecentPage])

  if (isLoadingDatabaseProperties || isLoadingDatabaseViews) {
    return <List isLoading navigationTitle={navigationTitle} />;
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter pages"
      navigationTitle={navigationTitle}
      onSearchTextChange={setSearchText}
      searchBarAccessory={createElement(DatabaseListSortDropdown, {
        onChange: setSort,
        value: sort
      })}
      throttle
    >
      <DatabaseView
        databaseId={databaseId}
        databasePages={databasePages ?? []}
        databaseProperties={databaseProperties}
        databaseView={databaseView}
        setDatabaseView={setDatabaseView}
        sort={sort}
        mutate={mutate}
        renderDatabaseTarget={renderDatabaseTarget}
        setRecentPage={setRecentPage}
        removeRecentPage={removeRecentPage}
        users={users}
      />

      <List.EmptyView
        title="No pages found"
        description="Create a new page for this database by pressing ⏎"
        actions={createElement(DatabaseListEmptyActions, { databaseId, mutate })}
      />
    </List>
  );
}

const DatabaseListSortDropdown = memo(function DatabaseListSortDropdown({
  onChange,
  value
}: {
  onChange: (value: "last_edited_time" | "created_time") => void
  value: "last_edited_time" | "created_time"
}) {
  return (
    <List.Dropdown
      tooltip="Sort by"
      storeValue
      value={value}
      onChange={(value) => onChange(value as "last_edited_time" | "created_time")}
    >
      <List.Dropdown.Item title="Last Edited At" value="last_edited_time" />
      <List.Dropdown.Item title="Last Created At" value="created_time" />
    </List.Dropdown>
  )
})

function DatabaseListEmptyActions({
  databaseId,
  mutate
}: {
  databaseId: string
  mutate: () => Promise<void>
}) {
  return (
    <ActionPanel>
      <DatabaseListCreatePageAction databaseId={databaseId} mutate={mutate} />
    </ActionPanel>
  )
}

function DatabaseListCreatePageAction({
  databaseId,
  mutate
}: {
  databaseId: string
  mutate: () => Promise<void>
}) {
  const target = useMemo(
    () => createElement(CreatePageForm, { defaults: { database: databaseId }, mutate }),
    [databaseId, mutate]
  )

  return (
    <Action.Push
      title="Create New Page"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={target}
    />
  )
}

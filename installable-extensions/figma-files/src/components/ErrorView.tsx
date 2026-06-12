import React from "react"
void React
import { Detail } from "@openwork/extension-api";

export function ErrorView() {
  const markdown = `
  # Error
  Please check your Figma connection and team ID.

  ## Figma Connection
  Connect Figma from Openwork Settings > Extensions.

  ## Team ID
  You can extract the team ID by navigating to your team page in Figma and then looking at the URL in the browser, for example:
  https://www.figma.com/files/team/<TEAM_ID>/

  Update the value for <TEAM_ID> in Openwork Preferences > Extensions > Figma...
  then reopen the command.
  `;

  return <Detail markdown={markdown} />;
}

import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints"
import { subMinutes } from "date-fns"

import { getLocalTimezone } from "./timezone"

export function getDateMention(date: Date = new Date()): BlockObjectRequest {
  const localTime = subMinutes(new Date(date), new Date().getTimezoneOffset()).toISOString()
  return {
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "mention",
          mention: {
            date: {
              start: localTime,
              time_zone: getLocalTimezone()
            }
          }
        }
      ]
    }
  }
}

export function prependDateDivider(children: BlockObjectRequest[]): BlockObjectRequest[] {
  return [{ type: "divider", divider: {} }, getDateMention(), ...children]
}

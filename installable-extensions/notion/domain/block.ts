import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints"
import { subMinutes } from "date-fns"

import { getLocalTimezone } from "./timezone"

export const NOTION_BLOCK_CHILDREN_BATCH_SIZE = 100

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

export function chunkBlockChildren(children: BlockObjectRequest[]): BlockObjectRequest[][] {
  const batches: BlockObjectRequest[][] = []

  for (let index = 0; index < children.length; index += NOTION_BLOCK_CHILDREN_BATCH_SIZE) {
    batches.push(children.slice(index, index + NOTION_BLOCK_CHILDREN_BATCH_SIZE))
  }

  return batches
}

import { isNotionClientError } from "@notionhq/client"
import { showToast, Toast } from "@openwork/extension-api"

export function isNotNullOrUndefined<T>(input: null | undefined | T): input is T {
  return input != null
}

export function handleError<T>(err: unknown, title: string, returnValue: T): T {
  console.error(err)
  if (isNotionClientError(err)) {
    showToast({
      style: Toast.Style.Failure,
      title: err.message
    })
  } else {
    showToast({
      style: Toast.Style.Failure,
      title
    })
  }
  return returnValue
}

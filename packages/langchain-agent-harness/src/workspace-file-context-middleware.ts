import { createMiddleware } from "langchain"
import {
  appendTextToJingleHumanMessage,
  readJingleLangChainMessageText,
  readLastJingleHumanMessage
} from "./langchain-message-reader"

export interface JingleWorkspaceFileContextRequest {
  messageRefs: unknown
  messageText: string
}

export interface CreateJingleWorkspaceFileContextMiddlewareOptions {
  resolveContext: (request: JingleWorkspaceFileContextRequest) => Promise<string | null>
}

export function createJingleWorkspaceFileContextMiddleware(
  options: CreateJingleWorkspaceFileContextMiddlewareOptions
) {
  return createMiddleware({
    name: "WorkspaceFileContextMiddleware",
    wrapModelCall: async (request, handler) => {
      const messages = Array.isArray(request.messages) ? request.messages : []
      const message = readLastJingleHumanMessage(messages)
      if (!message) {
        return handler(request)
      }

      const fileContext = await options.resolveContext({
        messageRefs: message.additional_kwargs?.refs,
        messageText: readJingleLangChainMessageText(message.content)
      })
      if (!fileContext) {
        return handler(request)
      }

      const nextMessages = messages.map((entry) =>
        entry === message ? appendTextToJingleHumanMessage(message, fileContext) : entry
      )

      return handler({
        ...request,
        messages: nextMessages
      })
    }
  })
}

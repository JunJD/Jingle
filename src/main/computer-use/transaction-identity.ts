import { createHash } from "node:crypto"

const COMPUTER_USE_TRANSACTION_ID_DOMAIN = "jingle:computer-use:transaction:v1"
const COMPUTER_USE_CALLER_ID_UTF8_BYTE_LIMIT = 1_024

export interface ComputerUseTransactionIdentityInput {
  runId: string
  toolCallId: string
}

export function createComputerUseTransactionId(input: ComputerUseTransactionIdentityInput): string {
  const runId = encodeCallerId(input.runId, "runId")
  const toolCallId = encodeCallerId(input.toolCallId, "toolCallId")
  const digest = createHash("sha256")
    .update(COMPUTER_USE_TRANSACTION_ID_DOMAIN, "utf8")
    .update(Buffer.from([0]))
    .update(frame(runId))
    .update(frame(toolCallId))
    .digest("hex")

  return `${COMPUTER_USE_TRANSACTION_ID_DOMAIN}:sha256:${digest}`
}

function encodeCallerId(value: unknown, field: "runId" | "toolCallId"): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`Computer-use ${field} must be a non-empty canonical string.`)
  }
  const encoded = Buffer.from(value, "utf8")
  if (encoded.toString("utf8") !== value) {
    throw new Error(`Computer-use ${field} must contain valid Unicode.`)
  }
  if (encoded.byteLength > COMPUTER_USE_CALLER_ID_UTF8_BYTE_LIMIT) {
    throw new Error(
      `Computer-use ${field} exceeds ${COMPUTER_USE_CALLER_ID_UTF8_BYTE_LIMIT} UTF-8 bytes.`
    )
  }
  return encoded
}

function frame(value: Buffer): Buffer {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(value.byteLength)
  return Buffer.concat([length, value])
}

import { lookup } from "dns/promises"
import { isIP } from "net"

const PRIVATE_HOST_SUFFIXES = [".internal", ".local", ".localhost"]
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"])
const MAX_URL_LENGTH = 2_048

function parsePublicHttpUrl(rawUrl: string): URL {
  const normalizedInput = rawUrl.trim()
  if (!normalizedInput) {
    throw new Error("URL must be non-empty.")
  }

  if (normalizedInput.length > MAX_URL_LENGTH) {
    throw new Error("URL is too long.")
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(normalizedInput)
  } catch {
    throw new Error("Invalid URL. Use a fully qualified http:// or https:// URL.")
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only public http:// and https:// URLs are supported.")
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Authenticated URLs are not supported.")
  }

  if (!parsedUrl.hostname.trim()) {
    throw new Error("URL is missing a hostname.")
  }

  return parsedUrl
}

function parseIpv4Octets(address: string): number[] | null {
  const parts = address.split(".")
  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => Number(part))
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4Octets(address)
  if (!octets) {
    return false
  }

  const [first, second] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase()

  if (normalized === "::" || normalized === "::1") {
    return true
  }

  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length))
  }

  return (
    normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")
  )
}

function isPrivateIpAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    return isPrivateIpv4(address)
  }

  if (version === 6) {
    return isPrivateIpv6(address)
  }

  return false
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    LOCAL_HOSTNAMES.has(normalized) ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  )
}

async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    return records.some((record) => isPrivateIpAddress(record.address))
  } catch {
    return false
  }
}

export function normalizePublicHttpUrl(rawUrl: string): string | null {
  try {
    return parsePublicHttpUrl(rawUrl).toString()
  } catch {
    return null
  }
}

export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  const parsedUrl = parsePublicHttpUrl(rawUrl)
  const hostname = parsedUrl.hostname.trim().toLowerCase()
  if (isBlockedHostname(hostname)) {
    throw new Error("Fetching localhost or private-network hosts is not allowed.")
  }

  if (isPrivateIpAddress(hostname)) {
    throw new Error("Fetching localhost or private-network IP addresses is not allowed.")
  }

  if (await resolvesToPrivateAddress(hostname)) {
    throw new Error("Fetching hosts that resolve to private-network IP addresses is not allowed.")
  }

  return parsedUrl
}

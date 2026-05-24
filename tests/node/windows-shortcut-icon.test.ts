import test from "node:test"
import assert from "node:assert/strict"
import {
  isWindowsShortcutPath,
  resolveWindowsApplicationIconPathCandidates
} from "../../src/main/services/launcher-search/providers/windows-shortcut-icon"

test("isWindowsShortcutPath detects .lnk files case-insensitively", () => {
  assert.equal(isWindowsShortcutPath("C:\\Users\\me\\AppData\\Roaming\\App.LNK"), true)
  assert.equal(isWindowsShortcutPath("C:\\Program Files\\App\\App.exe"), false)
})

test("resolveWindowsApplicationIconPathCandidates prefers explicit .ico over shortcut target", () => {
  assert.deepEqual(
    resolveWindowsApplicationIconPathCandidates({
      applicationPath: "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\App.lnk",
      shortcutIconPath: "C:\\Program Files\\App\\app.ico",
      shortcutTargetPath: "C:\\Program Files\\App\\App.exe"
    }),
    [
      "C:\\Program Files\\App\\app.ico",
      "C:\\Program Files\\App\\App.exe",
      "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\App.lnk"
    ]
  )
})

test("resolveWindowsApplicationIconPathCandidates prefers shortcut target over non-.ico icon sources", () => {
  assert.deepEqual(
    resolveWindowsApplicationIconPathCandidates({
      applicationPath: "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\App.lnk",
      shortcutIconPath: "C:\\Windows\\System32\\shell32.dll",
      shortcutTargetPath: "C:\\Program Files\\App\\App.exe"
    }),
    [
      "C:\\Program Files\\App\\App.exe",
      "C:\\Windows\\System32\\shell32.dll",
      "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\App.lnk"
    ]
  )
})

test("resolveWindowsApplicationIconPathCandidates de-duplicates repeated paths", () => {
  assert.deepEqual(
    resolveWindowsApplicationIconPathCandidates({
      applicationPath: "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\App.lnk",
      shortcutIconPath: "C:\\Program Files\\App\\App.exe",
      shortcutTargetPath: "C:\\Program Files\\App\\App.exe"
    }),
    [
      "C:\\Program Files\\App\\App.exe",
      "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\App.lnk"
    ]
  )
})

test("resolveWindowsApplicationIconPathCandidates keeps direct executables unchanged", () => {
  assert.deepEqual(
    resolveWindowsApplicationIconPathCandidates({
      applicationPath: "C:\\Program Files\\App\\App.exe",
      shortcutIconPath: "C:\\Program Files\\App\\app.ico",
      shortcutTargetPath: "C:\\Program Files\\App\\Other.exe"
    }),
    ["C:\\Program Files\\App\\App.exe"]
  )
})

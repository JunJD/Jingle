import assert from "node:assert/strict"
import test from "node:test"
import { createWindowsApplicationInventoryFingerprint } from "../../src/main/services/launcher-search/providers/applications"
import {
  WINDOWS_APPLICATION_CATALOG_CACHE_MAX_APP_USER_MODEL_ID_LENGTH,
  WINDOWS_APPLICATION_CATALOG_CACHE_MAX_RECORDS,
  WindowsApplicationCatalogCacheRepository,
  decodeWindowsApplicationCatalogCache,
  encodeWindowsApplicationCatalogCache,
  type WindowsApplicationCatalogCacheSnapshot,
  type WindowsApplicationCatalogCacheStoreAdapter
} from "../../src/main/services/launcher-search/windows-application-catalog-cache"

const SNAPSHOT: WindowsApplicationCatalogCacheSnapshot = {
  enrichedAt: 1_726_000_000_000,
  inventoryFingerprint: "sha256:abcdef",
  records: [
    {
      appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
      displayName: "Sound Recorder",
      iconPath: "C:\\Program Files\\WindowsApps\\Recorder\\Assets\\icon.png"
    },
    {
      appUserModelId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
      displayName: "Calculator"
    }
  ]
}

class MemoryStore implements WindowsApplicationCatalogCacheStoreAdapter {
  value: unknown

  get(): unknown {
    return this.value
  }

  set(_key: "catalog", value: unknown): void {
    this.value = value
  }
}

test("Windows application inventory fingerprint is stable across order and casing", () => {
  const left = createWindowsApplicationInventoryFingerprint([
    {
      appUserModelId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
      displayName: "Calculator"
    },
    {
      appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
      displayName: "Sound Recorder"
    }
  ])
  const right = createWindowsApplicationInventoryFingerprint([
    {
      appUserModelId: "MICROSOFT.WINDOWSSOUNDRECORDER_8WEKYB3D8BBWE!APP",
      displayName: "sound recorder"
    },
    {
      appUserModelId: "microsoft.windowscalculator_8wekyb3d8bbwe!app",
      displayName: "CALCULATOR"
    }
  ])

  assert.match(left, /^sha256:[a-f0-9]{64}$/)
  assert.equal(right, left)
})

test("Windows application catalog cache codec persists only the versioned minimal snapshot", () => {
  const encoded = encodeWindowsApplicationCatalogCache(
    {
      ...SNAPSHOT,
      inventoryFingerprint: "  SHA256:ABCDEF  ",
      records: [
        {
          ...SNAPSHOT.records[0]!,
          displayName: "  Sound Recorder  ",
          iconPath: "  C:\\Recorder\\icon.png  ",
          keywords: ["must-not-persist"],
          iconDataUrl: "data:image/png;base64,aWNvbg=="
        } as WindowsApplicationCatalogCacheSnapshot["records"][number]
      ]
    },
    "win32"
  )

  assert.deepEqual(encoded, {
    platform: "win32",
    schemaVersion: 1,
    snapshot: {
      enrichedAt: SNAPSHOT.enrichedAt,
      inventoryFingerprint: "sha256:abcdef",
      records: [
        {
          appUserModelId: "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App",
          displayName: "Sound Recorder",
          iconPath: "C:\\Recorder\\icon.png"
        }
      ]
    }
  })
})

test("Windows application catalog cache codec round-trips a valid snapshot", () => {
  const encoded = encodeWindowsApplicationCatalogCache(SNAPSHOT, "win32")

  assert.deepEqual(decodeWindowsApplicationCatalogCache(encoded, "win32"), SNAPSHOT)
})

test("Windows application catalog cache codec treats incompatible or corrupted values as misses", () => {
  const encoded = encodeWindowsApplicationCatalogCache(SNAPSHOT, "win32")
  const invalidValues: unknown[] = [
    undefined,
    [],
    { ...encoded, schemaVersion: 2 },
    { ...encoded, platform: "linux" },
    { ...encoded, unexpected: true },
    { ...encoded, snapshot: { ...encoded.snapshot, enrichedAt: -1 } },
    {
      ...encoded,
      snapshot: { ...encoded.snapshot, inventoryFingerprint: " SHA256:ABCDEF " }
    },
    {
      ...encoded,
      snapshot: {
        ...encoded.snapshot,
        records: [
          {
            appUserModelId: "not-an-aumid",
            displayName: "Broken"
          }
        ]
      }
    },
    {
      ...encoded,
      snapshot: {
        ...encoded.snapshot,
        records: [
          {
            appUserModelId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
            displayName: "Calculator",
            iconDataUrl: "data:image/png;base64,aWNvbg=="
          }
        ]
      }
    },
    {
      ...encoded,
      snapshot: {
        ...encoded.snapshot,
        records: [
          {
            appUserModelId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
            displayName: "Calculator",
            iconPath: "data:image/png;base64,aWNvbg=="
          }
        ]
      }
    },
    {
      ...encoded,
      snapshot: {
        ...encoded.snapshot,
        records: new Array(WINDOWS_APPLICATION_CATALOG_CACHE_MAX_RECORDS + 1).fill(
          SNAPSHOT.records[0]
        )
      }
    }
  ]

  for (const value of invalidValues) {
    assert.equal(decodeWindowsApplicationCatalogCache(value, "win32"), null)
  }
  assert.equal(decodeWindowsApplicationCatalogCache(encoded, "linux"), null)
})

test("Windows application catalog cache codec rejects invalid write input", () => {
  assert.throws(
    () => encodeWindowsApplicationCatalogCache(SNAPSHOT, "linux"),
    /can only be written on Windows/
  )
  assert.throws(
    () =>
      encodeWindowsApplicationCatalogCache(
        {
          ...SNAPSHOT,
          records: [
            {
              appUserModelId: `${"a".repeat(
                WINDOWS_APPLICATION_CATALOG_CACHE_MAX_APP_USER_MODEL_ID_LENGTH
              )}!App`,
              displayName: "Oversized"
            }
          ]
        },
        "win32"
      ),
    /appUserModelId is invalid/
  )
  assert.throws(
    () =>
      encodeWindowsApplicationCatalogCache(
        {
          ...SNAPSHOT,
          records: [{ ...SNAPSHOT.records[0]!, iconPath: "data:image/png;base64,aWNvbg==" }]
        },
        "win32"
      ),
    /iconPath is invalid/
  )
})

test("Windows application catalog cache repository reads and writes through the injected store", () => {
  const store = new MemoryStore()
  const repository = new WindowsApplicationCatalogCacheRepository({ platform: "win32", store })

  assert.equal(repository.read(), null)
  repository.write(SNAPSHOT)
  assert.deepEqual(repository.read(), SNAPSHOT)

  store.value = { schemaVersion: 0, platform: "win32", snapshot: SNAPSHOT }
  assert.equal(repository.read(), null)
})

test("Windows application catalog cache repository propagates storage failures", () => {
  const readFailure = new WindowsApplicationCatalogCacheRepository({
    platform: "win32",
    store: {
      get: () => {
        throw new Error("read failed")
      },
      set: () => undefined
    }
  })
  assert.throws(() => readFailure.read(), /read failed/)

  const writeFailure = new WindowsApplicationCatalogCacheRepository({
    platform: "win32",
    store: {
      get: () => undefined,
      set: () => {
        throw new Error("write failed")
      }
    }
  })
  assert.throws(() => writeFailure.write(SNAPSHOT), /write failed/)
})

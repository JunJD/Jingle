import assert from "node:assert/strict"
import test from "node:test"
import {
  getLauncherSnapGuideLines,
  resolveLauncherSnapBounds
} from "../../src/main/windows/launcher-snap-geometry"

test("getLauncherSnapGuideLines returns guide positions relative to the display", () => {
  assert.deepEqual(
    getLauncherSnapGuideLines({
      displayBounds: { x: 100, y: 40, width: 1440, height: 900 },
      guideBounds: { x: 440, y: 180, width: 760, height: 480 }
    }),
    {
      height: 900,
      horizontalTop: 140,
      verticalLeft: 340,
      verticalRight: 1100,
      width: 1440
    }
  )
})

test("resolveLauncherSnapBounds snaps both axes when the launcher is close to the guide", () => {
  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 446, y: 186, width: 760, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    {
      x: 440,
      y: 180,
      width: 760,
      height: 420
    }
  )
})

test("resolveLauncherSnapBounds snaps to a fixed viewport guide instead of the current origin", () => {
  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 446, y: 238, width: 760, height: 420 },
      guideBounds: { x: 440, y: 240, width: 760, height: 420 }
    }),
    {
      x: 440,
      y: 240,
      width: 760,
      height: 420
    }
  )
})

test("resolveLauncherSnapBounds snaps axes independently", () => {
  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 446, y: 260, width: 760, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    {
      x: 440,
      y: 260,
      width: 760,
      height: 420
    }
  )

  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 520, y: 186, width: 760, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    {
      x: 520,
      y: 180,
      width: 760,
      height: 420
    }
  )
})

test("resolveLauncherSnapBounds snaps to the nearest vertical guide edge", () => {
  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 446, y: 260, width: 380, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    {
      x: 440,
      y: 260,
      width: 380,
      height: 420
    }
  )

  assert.deepEqual(
    resolveLauncherSnapBounds({
      currentBounds: { x: 812, y: 260, width: 380, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    {
      x: 820,
      y: 260,
      width: 380,
      height: 420
    }
  )
})

test("resolveLauncherSnapBounds leaves distant launcher bounds alone", () => {
  assert.equal(
    resolveLauncherSnapBounds({
      currentBounds: { x: 520, y: 230, width: 760, height: 420 },
      guideBounds: { x: 440, y: 180, width: 760, height: 420 }
    }),
    null
  )
})

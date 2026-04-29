import assert from "node:assert/strict"
import test from "node:test"
import {
  clickScreenPoint,
  findAxElements,
  openApplication,
  openDesktopRoute,
  pressAxElement,
  type DesktopAutomationRunner
} from "../../src/main/services/desktop-automation"
import {
  parseClickScreenPointRequest,
  parseFindAxElementsRequest,
  parseOpenApplicationRequest,
  parseOpenDesktopRouteRequest,
  parsePressAxElementRequest
} from "../../src/main/services/desktop-automation-parser"

test("parseOpenApplicationRequest requires bundleId or name", () => {
  assert.throws(() => parseOpenApplicationRequest({}), /bundleId|name/)
  assert.deepEqual(parseOpenApplicationRequest({ bundleId: "com.netease.163music" }), {
    bundleId: "com.netease.163music",
    name: undefined
  })
})

test("parseOpenDesktopRouteRequest validates absolute URLs", () => {
  assert.throws(() => parseOpenDesktopRouteRequest({}), /url/)
  assert.throws(() => parseOpenDesktopRouteRequest({ url: "网易云" }), /valid "url"/)
  assert.deepEqual(
    parseOpenDesktopRouteRequest({
      bundleId: "com.netease.163music",
      url: "orpheus://songrcmd?autoplay=1"
    }),
    {
      bundleId: "com.netease.163music",
      url: "orpheus://songrcmd?autoplay=1"
    }
  )
})

test("parseFindAxElementsRequest defaults the AX limit", () => {
  assert.deepEqual(parseFindAxElementsRequest({ bundleId: "com.netease.163music" }), {
    bundleId: "com.netease.163music",
    limit: 10,
    name: undefined,
    role: undefined,
    titleContains: undefined
  })
  assert.throws(
    () => parseFindAxElementsRequest({ bundleId: "com.netease.163music", limit: 0 }),
    /between 1 and 25/
  )
})

test("parsePressAxElementRequest validates titleContains and matchIndex", () => {
  assert.throws(() => parsePressAxElementRequest({ bundleId: "com.netease.163music" }), /titleContains/)
  assert.throws(
    () =>
      parsePressAxElementRequest({
        bundleId: "com.netease.163music",
        matchIndex: -1,
        titleContains: "今日推荐"
      }),
    /matchIndex/
  )
})

test("parseClickScreenPointRequest requires finite coordinates", () => {
  assert.throws(() => parseClickScreenPointRequest({ x: Number.NaN, y: 1 }), /finite/)
  assert.deepEqual(
    parseClickScreenPointRequest({
      bundleId: "com.netease.163music",
      hideCursor: true,
      x: 120,
      y: 40.5
    }),
    {
      bundleId: "com.netease.163music",
      hideCursor: true,
      x: 120,
      y: 40.5
    }
  )
})

test("desktop automation service forwards open_application to the runner", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "darwin",
    run: async (request) => {
      assert.deepEqual(request, {
        bundleId: "com.netease.163music",
        type: "open_application"
      })
      return {
        application: {
          bundleId: "com.netease.163music",
          name: "NeteaseMusic",
          pid: 42
        },
        type: "open_application"
      }
    }
  }

  assert.deepEqual(await openApplication({ bundleId: "com.netease.163music" }, runner), {
    bundleId: "com.netease.163music",
    name: "NeteaseMusic",
    pid: 42
  })
})

test("desktop automation service forwards open_desktop_route to the runner", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "darwin",
    run: async (request) => {
      assert.deepEqual(request, {
        bundleId: "com.netease.163music",
        type: "open_desktop_route",
        url: "orpheus://songrcmd?autoplay=1"
      })
      return {
        type: "open_desktop_route",
        url: "orpheus://songrcmd?autoplay=1"
      }
    }
  }

  assert.deepEqual(
    await openDesktopRoute(
      {
        bundleId: "com.netease.163music",
        url: "orpheus://songrcmd?autoplay=1"
      },
      runner
    ),
    {
      type: "open_desktop_route",
      url: "orpheus://songrcmd?autoplay=1"
    }
  )
})

test("desktop automation service forwards find_ax_elements to the runner", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "darwin",
    run: async (request) => {
      assert.deepEqual(request, {
        bundleId: "com.netease.163music",
        limit: 2,
        titleContains: "推荐",
        type: "find_ax_elements"
      })
      return {
        application: {
          bundleId: "com.netease.163music",
          name: "NeteaseMusic",
          pid: 42
        },
        elements: [
          {
            actions: ["AXPress"],
            description: null,
            identifier: null,
            index: 0,
            role: "AXButton",
            subrole: null,
            title: "今日推荐",
            value: null
          }
        ],
        type: "find_ax_elements"
      }
    }
  }

  const result = await findAxElements(
    {
      bundleId: "com.netease.163music",
      limit: 2,
      titleContains: "推荐"
    },
    runner
  )

  assert.equal(result.application.bundleId, "com.netease.163music")
  assert.equal(result.elements[0]?.title, "今日推荐")
})

test("desktop automation service forwards press_ax_element to the runner", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "darwin",
    run: async (request) => {
      assert.deepEqual(request, {
        activate: false,
        bundleId: "com.netease.163music",
        matchIndex: 1,
        titleContains: "推荐",
        type: "press_ax_element"
      })
      return {
        application: {
          bundleId: "com.netease.163music",
          name: "NeteaseMusic",
          pid: 42
        },
        element: {
          actions: ["AXPress"],
          description: null,
          identifier: null,
          index: 1,
          role: "AXButton",
          subrole: null,
          title: "每日推荐",
          value: null
        },
        type: "press_ax_element"
      }
    }
  }

  const result = await pressAxElement(
    {
      activate: false,
      bundleId: "com.netease.163music",
      matchIndex: 1,
      titleContains: "推荐"
    },
    runner
  )

  assert.equal(result.element.index, 1)
  assert.equal(result.element.title, "每日推荐")
})

test("desktop automation service forwards click_screen_point to the runner", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "darwin",
    run: async (request) => {
      assert.deepEqual(request, {
        bundleId: "com.netease.163music",
        hideCursor: true,
        type: "click_screen_point",
        x: 320,
        y: 180
      })
      return {
        hideCursor: true,
        type: "click_screen_point",
        x: 320,
        y: 180
      }
    }
  }

  assert.deepEqual(
    await clickScreenPoint(
      { bundleId: "com.netease.163music", hideCursor: true, x: 320, y: 180 },
      runner
    ),
    {
      hideCursor: true,
      type: "click_screen_point",
      x: 320,
      y: 180
    }
  )
})

test("desktop automation service stays macOS-only", async () => {
  const runner: DesktopAutomationRunner = {
    platform: "linux",
    run: async () => {
      throw new Error("unreachable")
    }
  }

  await assert.rejects(
    () => openApplication({ bundleId: "com.netease.163music" }, runner),
    /macOS/
  )
})

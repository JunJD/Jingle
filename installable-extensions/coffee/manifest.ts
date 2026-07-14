import { defineLocalizedText as l, defineNativeExtensionManifest } from "@jingle/extension-api"
import { COFFEE_EXTENSION_ID, COFFEE_SOURCE_ID } from "./contracts"

export const coffeeManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "Manage macOS sleep prevention with Coffee.",
    guide:
      "Coffee controls the current Mac's caffeinate process. Check status before changing it. Starting Coffee keeps the Mac awake; stopping Coffee allows normal sleep behavior again.",
    id: COFFEE_SOURCE_ID,
    instructions: [
      "Use Coffee when the user wants to keep this Mac awake or stop sleep prevention.",
      "Check caffeination status before changing it.",
      "Use caffeinateFor when the user gives a duration.",
      "Use caffeinate for open-ended sleep prevention.",
      "Use decaffeinate when the user asks to stop keeping the Mac awake."
    ],
    mention: {
      label: l("Coffee", "Coffee"),
      value: "coffee"
    },
    supportedPlatforms: ["darwin"],
    title: l("Coffee", "Coffee"),
    toolDisplays: {
      caffeinate: {
        description: l(
          "Keep the Mac awake until Coffee is manually stopped.",
          "让 Mac 保持唤醒，直到手动停止 Coffee。"
        ),
        title: l("Caffeinate", "保持唤醒")
      },
      caffeinateFor: {
        description: l(
          "Keep the Mac awake for a specified duration.",
          "让 Mac 在指定时长内保持唤醒。"
        ),
        title: l("Caffeinate for Duration", "按时长保持唤醒")
      },
      checkCaffeinationStatus: {
        description: l(
          "Check whether Coffee is currently active.",
          "检查 Coffee 当前是否正在保持唤醒。"
        ),
        title: l("Check Caffeination Status", "检查唤醒状态")
      },
      decaffeinate: {
        description: l(
          "Stop Coffee and allow normal sleep behavior.",
          "停止 Coffee，恢复正常睡眠行为。"
        ),
        title: l("Decaffeinate", "停止保持唤醒")
      }
    },
    toolNames: ["checkCaffeinationStatus", "caffeinate", "caffeinateFor", "decaffeinate"]
  },
  capabilities: ["rpc", "surface"],
  commands: [
    {
      description: l("Prevent your Mac from sleeping.", "阻止 Mac 进入睡眠。"),
      keywords: ["coffee", "caffeinate", "awake", "sleep"],
      mode: "no-view",
      name: "caffeinate",
      runtime: {},
      title: l("Caffeinate", "保持唤醒")
    },
    {
      description: l("Turn off Coffee sleep prevention.", "关闭 Coffee 的睡眠阻止。"),
      keywords: ["coffee", "decaffeinate", "sleep"],
      mode: "no-view",
      name: "decaffeinate",
      runtime: {},
      title: l("Decaffeinate", "停止保持唤醒")
    },
    {
      description: l("Toggle Coffee sleep prevention.", "切换 Coffee 睡眠阻止状态。"),
      keywords: ["coffee", "toggle", "caffeinate"],
      mode: "no-view",
      name: "caffeinateToggle",
      runtime: {},
      title: l("Toggle Caffeinate", "切换保持唤醒")
    },
    {
      arguments: [
        {
          name: "hours",
          placeholder: l("Hours", "小时"),
          required: false,
          title: l("Hours", "小时"),
          type: "text"
        },
        {
          name: "minutes",
          placeholder: l("Minutes", "分钟"),
          required: false,
          title: l("Minutes", "分钟"),
          type: "text"
        },
        {
          name: "seconds",
          placeholder: l("Seconds", "秒"),
          required: false,
          title: l("Seconds", "秒"),
          type: "text"
        }
      ],
      description: l(
        "Prevent your Mac from sleeping for a duration.",
        "让 Mac 在一段时间内保持唤醒。"
      ),
      keywords: ["coffee", "caffeinate", "duration", "timer"],
      mode: "no-view",
      name: "caffeinateFor",
      requiresLauncherArguments: true,
      runtime: {},
      title: l("Caffeinate for ...", "保持唤醒一段时间")
    },
    {
      arguments: [
        {
          name: "time",
          placeholder: l("17:30", "17:30"),
          required: true,
          type: "text"
        }
      ],
      description: l(
        "Prevent your Mac from sleeping until a time.",
        "让 Mac 保持唤醒直到指定时间。"
      ),
      keywords: ["coffee", "caffeinate", "until", "time"],
      mode: "no-view",
      name: "caffeinateUntil",
      requiresLauncherArguments: true,
      runtime: {},
      title: l("Caffeinate Until", "保持唤醒直到")
    },
    {
      description: l("Show Coffee status in the menu bar.", "在菜单栏显示 Coffee 状态。"),
      keywords: ["coffee", "menu bar", "caffeinate", "status"],
      mode: "menu-bar",
      name: "index",
      preferences: [
        {
          default: false,
          description: l(
            "Hide the menu bar icon when Coffee is inactive.",
            "Coffee 未启用时隐藏菜单栏图标。"
          ),
          label: l("Hide the icon", "隐藏图标"),
          name: "hiddenWhenDecaffeinated",
          title: l("When Decaffeinated", "未保持唤醒时"),
          type: "checkbox"
        }
      ],
      runtime: {},
      title: l("Caffeinate Status Menu Bar", "Coffee 菜单栏状态")
    },
    {
      description: l("Show the current Coffee status.", "显示当前 Coffee 状态。"),
      keywords: ["coffee", "status", "caffeinate"],
      mode: "no-view",
      name: "status",
      runtime: {},
      title: l("Caffeinate Status", "唤醒状态")
    }
  ],
  connection: {
    auth: {
      type: "none"
    },
    id: "default",
    provider: COFFEE_EXTENSION_ID,
    title: l("Coffee", "Coffee")
  },
  description: l(
    "Prevent your Mac from sleeping with macOS caffeinate.",
    "使用 macOS caffeinate 阻止 Mac 进入睡眠。"
  ),
  icon: "assets/logo.png",
  iconName: "coffee",
  name: COFFEE_EXTENSION_ID,
  preferences: [
    {
      default: true,
      description: l("Prevent the display from sleeping.", "阻止显示器进入睡眠。"),
      label: l("Prevent display sleep", "阻止显示器睡眠"),
      name: "preventDisplay",
      title: l("Options", "选项"),
      type: "checkbox"
    },
    {
      default: true,
      description: l("Prevent the system from sleeping.", "阻止系统进入睡眠。"),
      label: l("Prevent system sleep", "阻止系统睡眠"),
      name: "preventSystem",
      type: "checkbox"
    },
    {
      default: true,
      description: l("Prevent the disk from sleeping.", "阻止磁盘进入睡眠。"),
      label: l("Prevent disk sleep", "阻止磁盘睡眠"),
      name: "preventDisk",
      type: "checkbox"
    },
    {
      data: [
        { title: l("Pot", "咖啡壶"), value: "pot" },
        { title: l("Mug", "马克杯"), value: "mug" },
        { title: l("Cup", "咖啡杯"), value: "cup" },
        { title: l("Paper Cup", "纸杯"), value: "paper-cup" }
      ],
      default: "pot",
      description: l("Select icon set for the menu bar.", "选择菜单栏图标样式。"),
      name: "icon",
      title: l("Menu Bar Icon", "菜单栏图标"),
      type: "dropdown"
    }
  ],
  rpcMethods: ["get-status", "start", "stop", "toggle"],
  runtimeCapabilities: ["preferences", "rpc", "toast"],
  supportedPlatforms: ["darwin"],
  title: l("Coffee", "Coffee")
})

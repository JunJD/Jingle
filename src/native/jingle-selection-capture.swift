import AppKit
import ApplicationServices
import Darwin
import Foundation

struct SelectionAnchor: Codable {
    let x: Double
    let y: Double
}

struct SelectionActivatedEvent: Codable {
    let anchor: SelectionAnchor
    let sourceApplicationName: String?
    let sourceBundleId: String?
    let text: String
    let type = "selectionActivated"

    enum CodingKeys: String, CodingKey {
        case anchor
        case sourceApplicationName
        case sourceBundleId
        case text
        case type
    }
}

struct SelectionCommand: Decodable {
    let type: String
}

struct CapturedSelection {
    let anchor: NSPoint
    let sourceApplicationName: String?
    let sourceBundleId: String?
    let text: String
}

final class SelectionDotPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 24, height: 24),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        hasShadow = true
        hidesOnDeactivate = false
        isOpaque = false
        level = .floating
    }
}

final class SelectionDotView: NSView {
    var onClick: (() -> Void)?

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let outerPath = NSBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
        NSColor(calibratedWhite: 0, alpha: 0.18).setFill()
        outerPath.fill()

        let innerPath = NSBezierPath(ovalIn: bounds.insetBy(dx: 5, dy: 5))
        NSColor(calibratedRed: 0.1, green: 0.82, blue: 0.35, alpha: 1).setFill()
        innerPath.fill()
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
    }
}

final class SelectionCaptureController {
    private var dotPanel: SelectionDotPanel?
    private var eventMonitor: Any?
    private var lastSelectionKey: String?
    private var leftMouseDownAnchor: NSPoint?
    private var pendingCapture: DispatchWorkItem?
    private var selectedContext: CapturedSelection?

    func start() {
        let mask: NSEvent.EventTypeMask = [
            .keyUp,
            .leftMouseDown,
            .leftMouseUp,
            .rightMouseDown,
            .scrollWheel
        ]
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handleGlobalEvent(event)
        }
    }

    func stop() {
        pendingCapture?.cancel()
        pendingCapture = nil
        hideDot()

        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
    }

    private func handleGlobalEvent(_ event: NSEvent) {
        switch event.type {
        case .leftMouseUp:
            let mouseLocation = NSEvent.mouseLocation
            if didDragSelection(to: mouseLocation) {
                scheduleSelectionCapture(anchor: mouseLocation)
            }
            leftMouseDownAnchor = nil
        case .keyUp:
            if shouldInspectKeySelection(event) {
                scheduleSelectionCapture(anchor: NSEvent.mouseLocation)
            }
        case .leftMouseDown:
            leftMouseDownAnchor = NSEvent.mouseLocation
            hideDot()
        case .rightMouseDown, .scrollWheel:
            hideDot()
        default:
            break
        }
    }

    private func didDragSelection(to mouseLocation: NSPoint) -> Bool {
        guard let leftMouseDownAnchor else {
            return false
        }

        let dx = mouseLocation.x - leftMouseDownAnchor.x
        let dy = mouseLocation.y - leftMouseDownAnchor.y
        return sqrt(dx * dx + dy * dy) >= 6
    }

    private func shouldInspectKeySelection(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let arrowOrRangeKeys: Set<UInt16> = [115, 116, 119, 121, 123, 124, 125, 126]

        if modifiers.contains(.shift) && arrowOrRangeKeys.contains(event.keyCode) {
            return true
        }

        return modifiers.contains(.command) && event.keyCode == 0
    }

    private func scheduleSelectionCapture(anchor: NSPoint) {
        pendingCapture?.cancel()

        let workItem = DispatchWorkItem { [weak self] in
            self?.captureSelection(anchor: anchor)
        }
        pendingCapture = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: workItem)
    }

    private func captureSelection(anchor: NSPoint) {
        pendingCapture = nil

        guard accessibilityTrusted() else {
            hideDot()
            return
        }

        guard let selection = readSelectedText(anchor: anchor) else {
            hideDot()
            return
        }

        let selectionKey = "\(selection.sourceBundleId ?? ""):\(selection.text)"
        if selectionKey == lastSelectionKey, dotPanel?.isVisible == true {
            return
        }

        lastSelectionKey = selectionKey
        selectedContext = selection
        showDot(anchor: anchor)
    }

    private func accessibilityTrusted() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    private func readSelectedText(anchor: NSPoint) -> CapturedSelection? {
        guard let application = NSWorkspace.shared.frontmostApplication else {
            return nil
        }

        let bundleId = application.bundleIdentifier
        let appName = application.localizedName
        let text =
            selectedTextFromAccessibility(pid: application.processIdentifier)
            ?? selectedTextFromBrowser(bundleId: bundleId)

        guard let text else {
            return nil
        }

        return CapturedSelection(
            anchor: anchor,
            sourceApplicationName: appName,
            sourceBundleId: bundleId,
            text: text
        )
    }

    private func selectedTextFromAccessibility(pid: pid_t) -> String? {
        let appElement = AXUIElementCreateApplication(pid)
        var focusedValue: CFTypeRef?
        let focusedResult = AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedValue
        )

        guard focusedResult == .success, let focusedValue else {
            return nil
        }

        let focusedElement = focusedValue as! AXUIElement
        var selectedValue: CFTypeRef?
        let selectedResult = AXUIElementCopyAttributeValue(
            focusedElement,
            kAXSelectedTextAttribute as CFString,
            &selectedValue
        )

        guard selectedResult == .success, let text = selectedValue as? String else {
            return nil
        }

        return normalizedSelectionText(text)
    }

    private func selectedTextFromBrowser(bundleId: String?) -> String? {
        guard let bundleId else {
            return nil
        }

        let chromeFamilyBundleIds: Set<String> = [
            "com.brave.Browser",
            "com.google.Chrome",
            "com.microsoft.edgemac",
            "com.operasoftware.Opera",
            "com.vivaldi.Vivaldi"
        ]

        if bundleId == "com.apple.Safari" {
            return runAppleScript("""
            tell application id "\(bundleId)"
                if not (exists front document) then return ""
                do JavaScript "window.getSelection().toString()" in front document
            end tell
            """)
        }

        if chromeFamilyBundleIds.contains(bundleId) {
            return runAppleScript("""
            tell application id "\(bundleId)"
                if not (exists front window) then return ""
                tell active tab of front window to execute javascript "window.getSelection().toString()"
            end tell
            """)
        }

        return nil
    }

    private func runAppleScript(_ source: String) -> String? {
        var error: NSDictionary?
        guard let script = NSAppleScript(source: source) else {
            return nil
        }

        let result = script.executeAndReturnError(&error)
        return normalizedSelectionText(result.stringValue ?? "")
    }

    private func normalizedSelectionText(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func showDot(anchor: NSPoint) {
        let panel = dotPanel ?? createDotPanel()
        let origin = safeDotOrigin(anchor: anchor, size: panel.frame.size)
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
    }

    private func createDotPanel() -> SelectionDotPanel {
        let panel = SelectionDotPanel()
        let dotView = SelectionDotView(frame: panel.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 24, height: 24))
        dotView.autoresizingMask = [.width, .height]
        dotView.onClick = { [weak self] in
            self?.activateSelection()
        }
        panel.contentView = dotView
        dotPanel = panel
        return panel
    }

    private func safeDotOrigin(anchor: NSPoint, size: NSSize) -> NSPoint {
        let screen =
            NSScreen.screens.first(where: { $0.frame.contains(anchor) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        let visibleFrame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let margin: CGFloat = 4
        let rawX = anchor.x + 12
        let rawY = anchor.y - size.height - 12
        let x = min(max(rawX, visibleFrame.minX + margin), visibleFrame.maxX - size.width - margin)
        let y = min(max(rawY, visibleFrame.minY + margin), visibleFrame.maxY - size.height - margin)

        return NSPoint(x: x, y: y)
    }

    private func activateSelection() {
        guard let selectedContext else {
            hideDot()
            return
        }

        emitSelection(selectedContext)
        hideDot()
    }

    private func hideDot() {
        dotPanel?.orderOut(nil)
    }

    private func emitSelection(_ selection: CapturedSelection) {
        let event = SelectionActivatedEvent(
            anchor: SelectionAnchor(x: Double(selection.anchor.x), y: Double(selection.anchor.y)),
            sourceApplicationName: selection.sourceApplicationName,
            sourceBundleId: selection.sourceBundleId,
            text: selection.text
        )

        guard
            let data = try? JSONEncoder().encode(event),
            let line = String(data: data, encoding: .utf8)
        else {
            return
        }

        print(line)
        fflush(stdout)
    }
}

final class SelectionCommandReader {
    private var buffer = ""

    func start() {
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                DispatchQueue.main.async {
                    NSApp.terminate(nil)
                }
                return
            }

            guard let chunk = String(data: data, encoding: .utf8) else {
                return
            }

            self.consume(chunk: chunk)
        }
    }

    private func consume(chunk: String) {
        buffer.append(chunk)
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""

        for line in lines.dropLast() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard
                !trimmed.isEmpty,
                let data = trimmed.data(using: .utf8),
                let command = try? JSONDecoder().decode(SelectionCommand.self, from: data),
                command.type == "quit"
            else {
                continue
            }

            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }

    func stop() {
        FileHandle.standardInput.readabilityHandler = nil
    }
}

final class ParentProcessMonitor {
    private let parentPid: pid_t?
    private var timer: Timer?

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        if let value = environment["JINGLE_PARENT_PID"], let pid = Int32(value), pid > 1 {
            parentPid = pid
        } else {
            parentPid = nil
        }
    }

    func start() {
        guard let parentPid else {
            return
        }

        let timer = Timer(timeInterval: 1, repeats: true) { _ in
            if getppid() == 1 || (kill(parentPid, 0) == -1 && errno == ESRCH) {
                NSApp.terminate(nil)
            }
        }

        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let controller = SelectionCaptureController()
    private let parentMonitor = ParentProcessMonitor()
    private let reader = SelectionCommandReader()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        controller.start()
        reader.start()
        parentMonitor.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller.stop()
        reader.stop()
        parentMonitor.stop()
    }
}

@main
struct JingleSelectionCaptureApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

import AppKit
import Darwin
import Foundation

enum IslandState: String, Codable {
    case idle
    case approval
    case working
}

struct IslandCommand: Codable {
    let state: IslandState?
    let type: String
}

enum IslandAction: String, Codable {
    case openLauncher
    case openMainWindow
    case openSettings
    case quit
}

struct IslandActionEvent: Codable {
    let action: IslandAction
    let type: String
}

extension NSScreen {
    var openworkBuiltinDisplay: Bool {
        guard let screenNumber = deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else {
            return false
        }

        return CGDisplayIsBuiltin(screenNumber) != 0
    }

    static var openworkPreferredIslandScreen: NSScreen? {
        if let builtinScreen = screens.first(where: { $0.openworkBuiltinDisplay }) {
            return builtinScreen
        }

        return main ?? screens.first
    }
}

final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct IslandActionButton {
    let action: IslandAction
    let frame: NSRect
    let title: String
}

private let spriteTiles: [[Bool]] = [
    [true, false, true, false, true],
    [true, true, false, true, true],
    [false, true, true, true, false],
    [true, true, true, true, true],
    [false, true, true, true, false]
]

private func compactTitle(for state: IslandState) -> String {
    switch state {
    case .idle:
        return "Jingle"
    case .working:
        return "Working"
    case .approval:
        return "Review"
    }
}

private func expandedTitle(for state: IslandState) -> String {
    switch state {
    case .idle:
        return "Jingle is ready"
    case .working:
        return "Agent is working"
    case .approval:
        return "Review needed"
    }
}

private func expandedSubtitle(for state: IslandState) -> String {
    switch state {
    case .idle:
        return "Start from the launcher or keep working in the current thread."
    case .working:
        return "The current task is running. Jingle will keep the status here."
    case .approval:
        return "A tool action needs your decision before the run can continue."
    }
}

private func spriteFillColor(for state: IslandState, phase: CGFloat) -> NSColor {
    switch state {
    case .working:
        let pulse = (sin(phase * 6.4) + 1) / 2
        return NSColor(calibratedRed: 0.34, green: 0.68 + pulse * 0.04, blue: 1.0, alpha: 1.0)
    case .approval:
        let pulse = (sin(phase * 9.6) + 1) / 2
        return NSColor(calibratedRed: 1.0, green: 0.42 + pulse * 0.08, blue: 0.16, alpha: 1.0)
    case .idle:
        return NSColor(calibratedRed: 0.72, green: 0.66, blue: 0.54, alpha: 0.92)
    }
}

private func spriteGlowColor(for state: IslandState, phase: CGFloat) -> NSColor {
    switch state {
    case .working:
        return NSColor(calibratedRed: 0.34, green: 0.68, blue: 1.0, alpha: 0.36)
    case .approval:
        let pulse = (sin(phase * 9.6) + 1) / 2
        return NSColor(calibratedRed: 1.0, green: 0.38 + pulse * 0.06, blue: 0.12, alpha: 0.42 + pulse * 0.14)
    case .idle:
        return NSColor(calibratedWhite: 1.0, alpha: 0.12)
    }
}

private func drawIslandSprite(in rect: NSRect, state: IslandState, phase: CGFloat) {
    guard let context = NSGraphicsContext.current?.cgContext else {
        return
    }

    let tileWidth = rect.width / 5
    let tileHeight = rect.height / 5

    context.saveGState()
    context.setShadow(offset: .zero, blur: rect.width / 7, color: spriteGlowColor(for: state, phase: phase).cgColor)
    spriteFillColor(for: state, phase: phase).setFill()

    for (rowIndex, row) in spriteTiles.enumerated() {
        for (columnIndex, isFilled) in row.enumerated() where isFilled {
            let tileRect = NSRect(
                x: rect.minX + CGFloat(columnIndex) * tileWidth,
                y: rect.maxY - CGFloat(rowIndex + 1) * tileHeight,
                width: tileWidth,
                height: tileHeight
            ).insetBy(dx: tileWidth * 0.06, dy: tileHeight * 0.06)

            NSBezierPath(
                roundedRect: tileRect,
                xRadius: tileWidth * 0.18,
                yRadius: tileWidth * 0.18
            ).fill()
        }
    }

    context.restoreGState()
}

final class StatusIslandView: NSView {
    var onClick: (() -> Void)?
    var state: IslandState = .idle {
        didSet {
            needsDisplay = true
        }
    }
    var animationPhase: CGFloat = 0 {
        didSet {
            needsDisplay = true
        }
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let pillHeight = min(bounds.height - 2, 28)
        let pillRect = NSRect(
            x: 1,
            y: (bounds.height - pillHeight) / 2,
            width: bounds.width - 2,
            height: pillHeight
        )

        NSColor.black.withAlphaComponent(0.96).setFill()
        NSBezierPath(
            roundedRect: pillRect,
            xRadius: pillRect.height / 2,
            yRadius: pillRect.height / 2
        ).fill()

        let spriteRect = NSRect(
            x: pillRect.minX + 10,
            y: pillRect.midY - 8,
            width: 16,
            height: 16
        )
        drawIslandSprite(in: spriteRect, state: state, phase: animationPhase)

        let label = compactTitle(for: state)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.white.withAlphaComponent(0.92)
        ]
        let labelSize = label.size(withAttributes: attributes)
        label.draw(
            at: NSPoint(x: spriteRect.maxX + 7, y: pillRect.midY - labelSize.height / 2),
            withAttributes: attributes
        )
    }
}

final class ExpandedIslandView: NSView {
    var onAction: ((IslandAction) -> Void)?
    var state: IslandState = .idle {
        didSet {
            needsDisplay = true
        }
    }
    var animationPhase: CGFloat = 0 {
        didSet {
            needsDisplay = true
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let button = actionButtons().first(where: { $0.frame.contains(point) }) else {
            return
        }

        onAction?(button.action)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let cardRect = bounds.insetBy(dx: 1, dy: 1)
        NSColor(calibratedRed: 0.98, green: 0.97, blue: 0.93, alpha: 0.98).setFill()
        NSBezierPath(roundedRect: cardRect, xRadius: 30, yRadius: 30).fill()

        let title = expandedTitle(for: state)
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 20, weight: .bold),
            .foregroundColor: NSColor(calibratedWhite: 0.05, alpha: 1)
        ]
        title.draw(
            at: NSPoint(x: 30, y: bounds.height - 56),
            withAttributes: titleAttributes
        )

        let subtitle = expandedSubtitle(for: state)
        let subtitleAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.24, alpha: 1)
        ]
        subtitle.draw(
            in: NSRect(x: 30, y: bounds.height - 98, width: bounds.width - 60, height: 34),
            withAttributes: subtitleAttributes
        )

        let spriteSize: CGFloat = state == .working ? 56 : 52
        let spriteRect = NSRect(
            x: bounds.midX - spriteSize / 2,
            y: 78,
            width: spriteSize,
            height: spriteSize
        )
        drawIslandSprite(in: spriteRect, state: state, phase: animationPhase)

        drawActionButtons()
        drawProgressLine()
    }

    private func drawProgressLine() {
        let trackRect = NSRect(x: 28, y: 22, width: bounds.width - 56, height: 7)
        NSColor(calibratedWhite: 0.86, alpha: 1).setFill()
        NSBezierPath(roundedRect: trackRect, xRadius: 4, yRadius: 4).fill()

        let progress: CGFloat
        switch state {
        case .idle:
            progress = 0.18
        case .working:
            progress = 0.62 + sin(animationPhase * 2.6) * 0.08
        case .approval:
            progress = 0.82
        }

        let fillRect = NSRect(
            x: trackRect.minX,
            y: trackRect.minY,
            width: max(16, trackRect.width * progress),
            height: trackRect.height
        )
        spriteFillColor(for: state, phase: animationPhase).setFill()
        NSBezierPath(roundedRect: fillRect, xRadius: 4, yRadius: 4).fill()
    }

    private func actionButtons() -> [IslandActionButton] {
        let y: CGFloat = 48
        let gap: CGFloat = 8
        let buttonWidth: CGFloat = (bounds.width - 56 - gap * 3) / 4
        let buttonHeight: CGFloat = 26
        let titles: [(IslandAction, String)] = [
            (.openLauncher, "Launcher"),
            (.openMainWindow, "Main"),
            (.openSettings, "Settings"),
            (.quit, "Quit")
        ]

        return titles.enumerated().map { index, item in
            IslandActionButton(
                action: item.0,
                frame: NSRect(
                    x: 28 + CGFloat(index) * (buttonWidth + gap),
                    y: y,
                    width: buttonWidth,
                    height: buttonHeight
                ),
                title: item.1
            )
        }
    }

    private func drawActionButtons() {
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: NSColor(calibratedWhite: 0.08, alpha: 0.92)
        ]

        for button in actionButtons() {
            NSColor.white.withAlphaComponent(0.62).setFill()
            NSBezierPath(roundedRect: button.frame, xRadius: 8, yRadius: 8).fill()
            NSColor(calibratedWhite: 0.86, alpha: 0.9).setStroke()
            NSBezierPath(roundedRect: button.frame, xRadius: 8, yRadius: 8).stroke()

            let titleSize = button.title.size(withAttributes: titleAttributes)
            button.title.draw(
                at: NSPoint(
                    x: button.frame.midX - titleSize.width / 2,
                    y: button.frame.midY - titleSize.height / 2
                ),
                withAttributes: titleAttributes
            )
        }
    }
}

final class IslandController: NSObject {
    private static let collapsedWidth: CGFloat = 112
    private static let expandedSize = NSSize(width: 360, height: 220)

    private let statusItem = NSStatusBar.system.statusItem(withLength: IslandController.collapsedWidth)
    private let statusView = StatusIslandView(frame: NSRect(x: 0, y: 0, width: IslandController.collapsedWidth, height: 28))
    private let expandedView = ExpandedIslandView(frame: NSRect(origin: .zero, size: IslandController.expandedSize))
    private var animationTimer: Timer?
    private var panel: IslandPanel?
    private var state: IslandState = .idle
    private var isExpanded = false

    override init() {
        super.init()
        expandedView.onAction = { [weak self] action in
            Self.emitAction(action)
            self?.setExpanded(false)
        }
        configureStatusItem()
        startAnimationTimer()
    }

    func show() {
        updateStatusItem()
    }

    func refreshLayout() {
        guard isExpanded else {
            return
        }

        updatePanelFrame(animated: false)
    }

    func setState(_ state: IslandState) {
        self.state = state
        statusView.state = state
        expandedView.state = state
        updateStatusItem()
    }

    func stop() {
        animationTimer?.invalidate()
        animationTimer = nil
        panel?.orderOut(nil)
        NSStatusBar.system.removeStatusItem(statusItem)
    }

    private func configureStatusItem() {
        statusView.onClick = { [weak self] in
            self?.toggleExpanded()
        }
        statusItem.view = statusView
    }

    private func updateStatusItem() {
        statusItem.length = IslandController.collapsedWidth
        statusView.toolTip = compactTitle(for: state)
        statusView.needsDisplay = true
    }

    private func startAnimationTimer() {
        let timer = Timer(timeInterval: 1 / 30, repeats: true) { [weak self] _ in
            guard let self else {
                return
            }

            self.statusView.animationPhase += 1 / 30
            self.expandedView.animationPhase += 1 / 30
        }

        animationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func toggleExpanded() {
        setExpanded(!isExpanded)
    }

    private func setExpanded(_ nextIsExpanded: Bool) {
        isExpanded = nextIsExpanded

        if nextIsExpanded {
            let panel = ensurePanel()
            panel.orderFrontRegardless()
            updatePanelFrame(animated: false)
            return
        }

        panel?.orderOut(nil)
    }

    private func ensurePanel() -> IslandPanel {
        if let panel {
            return panel
        }

        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: IslandController.expandedSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovable = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.acceptsMouseMovedEvents = false
        panel.ignoresMouseEvents = false
        panel.contentView = expandedView
        self.panel = panel
        return panel
    }

    private func updatePanelFrame(animated: Bool) {
        guard let panel else {
            return
        }

        let nextFrame = NSRect(origin: panelOrigin(for: IslandController.expandedSize), size: IslandController.expandedSize)

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.16
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                panel.animator().setFrame(nextFrame, display: true)
            }
        } else {
            panel.setFrame(nextFrame, display: true)
        }
    }

    private func panelOrigin(for size: NSSize) -> NSPoint {
        guard let anchorRect = statusItemAnchorRect() else {
            let screen = NSScreen.openworkPreferredIslandScreen
            let frame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            return NSPoint(x: frame.midX - size.width / 2, y: frame.maxY - size.height - 8)
        }

        let screenFrame = screenFrame(containing: anchorRect).visibleFrame
        let x = min(max(anchorRect.midX - size.width / 2, screenFrame.minX + 8), screenFrame.maxX - size.width - 8)
        let y = anchorRect.minY - size.height - 8

        return NSPoint(x: x, y: y)
    }

    private func screenFrame(containing rect: NSRect) -> NSScreen {
        NSScreen.screens.first(where: { $0.frame.intersects(rect) })
            ?? NSScreen.openworkPreferredIslandScreen
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }

    private func statusItemAnchorRect() -> NSRect? {
        guard
            let window = statusView.window
        else {
            return nil
        }

        let rectInWindow = statusView.convert(statusView.bounds, to: nil)
        return window.convertToScreen(rectInWindow)
    }

    private static func emitAction(_ action: IslandAction) {
        guard
            let data = try? JSONEncoder().encode(IslandActionEvent(action: action, type: "action")),
            let line = String(data: data, encoding: .utf8)
        else {
            return
        }

        print(line)
        fflush(stdout)
    }
}

final class CommandReader {
    private let controller: IslandController
    private var buffer = ""

    init(controller: IslandController) {
        self.controller = controller
    }

    func start() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
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

            self?.consume(chunk: chunk)
        }
    }

    private func consume(chunk: String) {
        buffer.append(chunk)
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""

        for line in lines.dropLast() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                continue
            }

            guard
                let data = trimmed.data(using: .utf8),
                let command = try? JSONDecoder().decode(IslandCommand.self, from: data)
            else {
                continue
            }

            DispatchQueue.main.async { [controller] in
                switch command.type {
                case "setState":
                    if let state = command.state {
                        controller.setState(state)
                    }
                case "quit":
                    NSApp.terminate(nil)
                default:
                    break
                }
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
        if let value = environment["OPENWORK_PARENT_PID"], let pid = Int32(value), pid > 1 {
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
    private let controller = IslandController()
    private lazy var reader = CommandReader(controller: controller)
    private let parentMonitor = ParentProcessMonitor()
    private var screenObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        controller.setState(.idle)
        controller.show()
        reader.start()
        parentMonitor.start()
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.controller.refreshLayout()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        reader.stop()
        parentMonitor.stop()
        controller.stop()
        if let screenObserver {
            NotificationCenter.default.removeObserver(screenObserver)
            self.screenObserver = nil
        }
    }
}

@main
struct OpenworkMinimalIslandApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

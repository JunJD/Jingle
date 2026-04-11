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

final class IslandView: NSView {
    private struct MotionStyle {
        let rotationDegrees: CGFloat
        let scale: CGFloat
        let translationX: CGFloat
        let translationY: CGFloat
        let glowBlur: CGFloat
    }

    private let spriteTiles: [[Bool]] = [
        [true, false, true, false, true],
        [true, true, false, true, true],
        [false, true, true, true, false],
        [true, true, true, true, true],
        [false, true, true, true, false]
    ]
    private var animationTimer: Timer?
    private var animationPhase: CGFloat = 0

    var onToggle: (() -> Void)?
    var state: IslandState = .working {
        didSet {
            needsDisplay = true
        }
    }
    var isExpanded = false {
        didSet {
            layer?.cornerRadius = isExpanded ? 26 : 14
            needsDisplay = true
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.98).cgColor
        layer?.cornerCurve = .continuous
        layer?.cornerRadius = 14
        startAnimationTimer()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        animationTimer?.invalidate()
    }

    override func mouseDown(with event: NSEvent) {
        onToggle?()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        guard let context = NSGraphicsContext.current?.cgContext else {
            return
        }

        let motionStyle = currentMotionStyle()
        let spriteSize = currentSpriteSize()
        let spriteRect = NSRect(
            x: -spriteSize.width / 2,
            y: -spriteSize.height / 2,
            width: spriteSize.width,
            height: spriteSize.height
        )

        context.saveGState()
        context.translateBy(
            x: bounds.midX + motionStyle.translationX,
            y: bounds.midY + motionStyle.translationY
        )
        context.rotate(by: motionStyle.rotationDegrees * .pi / 180)
        context.scaleBy(x: motionStyle.scale, y: motionStyle.scale)

        context.setShadow(
            offset: .zero,
            blur: motionStyle.glowBlur,
            color: spriteGlowColor().cgColor
        )
        drawSprite(in: spriteRect)
        context.restoreGState()
    }

    private func startAnimationTimer() {
        let timer = Timer(timeInterval: 1 / 30, repeats: true) { [weak self] _ in
            guard let self else {
                return
            }

            self.animationPhase += 1 / 30
            self.needsDisplay = true
        }

        animationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func currentMotionStyle() -> MotionStyle {
        switch state {
        case .working:
            if isExpanded {
                return MotionStyle(
                    rotationDegrees: 0,
                    scale: 1,
                    translationX: sin(animationPhase * 2.2) * 9,
                    translationY: 0,
                    glowBlur: 8
                )
            }

            return MotionStyle(
                rotationDegrees: 0,
                scale: 1,
                translationX: sin(animationPhase * 2.2) * 2.8,
                translationY: 0,
                glowBlur: 2.5
            )
        case .approval:
            let jitterDirection: CGFloat = sin(animationPhase * 18) >= 0 ? 1 : -1
            if isExpanded {
                return MotionStyle(
                    rotationDegrees: 0,
                    scale: 1,
                    translationX: jitterDirection * 6,
                    translationY: 0,
                    glowBlur: 14
                )
            }

            return MotionStyle(
                rotationDegrees: 0,
                scale: 1,
                translationX: jitterDirection * 2.5,
                translationY: 0,
                glowBlur: 5
            )
        case .idle:
            if isExpanded {
                return MotionStyle(
                    rotationDegrees: 0,
                    scale: 1 + sin(animationPhase * 1.4) * 0.006,
                    translationX: 0,
                    translationY: 0,
                    glowBlur: 4
                )
            }

            return MotionStyle(
                rotationDegrees: 0,
                scale: 1 + sin(animationPhase * 1.4) * 0.004,
                translationX: 0,
                translationY: 0,
                glowBlur: 1.5
            )
        }
    }

    private func currentSpriteSize() -> NSSize {
        if isExpanded {
            return NSSize(width: 100, height: 100)
        }

        return NSSize(width: 18, height: 18)
    }

    private func drawSprite(in rect: NSRect) {
        let tileWidth = rect.width / 5
        let tileHeight = rect.height / 5
        let fillColor = spriteFillColor()
        fillColor.setFill()

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
    }

    private func spriteFillColor() -> NSColor {
        switch state {
        case .working:
            let pulse = (sin(animationPhase * 6.4) + 1) / 2
            return NSColor(
                calibratedRed: 0.34,
                green: 0.68 + pulse * 0.04,
                blue: 1.0,
                alpha: 1.0
            )
        case .approval:
            let pulse = (sin(animationPhase * 9.6) + 1) / 2
            return NSColor(
                calibratedRed: 1.0,
                green: 0.42 + pulse * 0.08,
                blue: 0.16,
                alpha: 1.0
            )
        case .idle:
            return NSColor(calibratedRed: 0.72, green: 0.66, blue: 0.54, alpha: 0.92)
        }
    }

    private func spriteGlowColor() -> NSColor {
        switch state {
        case .working:
            return NSColor(calibratedRed: 0.34, green: 0.68, blue: 1.0, alpha: 0.36)
        case .approval:
            let pulse = (sin(animationPhase * 9.6) + 1) / 2
            return NSColor(
                calibratedRed: 1.0,
                green: 0.38 + pulse * 0.06,
                blue: 0.12,
                alpha: 0.42 + pulse * 0.14
            )
        case .idle:
            return NSColor(calibratedWhite: 1.0, alpha: 0.12)
        }
    }
}

final class IslandController {
    private let collapsedSize = NSSize(width: 112, height: 28)
    private let expandedSize = NSSize(width: 200, height: 200)
    private let view = IslandView(frame: .zero)
    private var panel: IslandPanel?
    private var isExpanded = false

    init() {
        view.onToggle = { [weak self] in
            self?.toggle()
        }
    }

    func show() {
        let panel = ensurePanel()
        panel.orderFrontRegardless()
        update(animated: false)
    }

    func refreshLayout() {
        guard panel != nil else {
            return
        }

        update(animated: false)
    }

    func setState(_ state: IslandState) {
        view.state = state
    }

    private func toggle() {
        isExpanded.toggle()
        update(animated: true)
    }

    private func ensurePanel() -> IslandPanel {
        if let panel {
            return panel
        }

        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: collapsedSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .mainMenu + 3
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
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
        panel.contentView = view
        self.panel = panel
        return panel
    }

    private func update(animated: Bool) {
        guard let panel else {
            return
        }

        let nextSize = isExpanded ? expandedSize : collapsedSize
        let nextFrame = NSRect(origin: panelOrigin(for: nextSize), size: nextSize)

        view.isExpanded = isExpanded

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.2
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                panel.animator().setFrame(nextFrame, display: true)
            }
        } else {
            panel.setFrame(nextFrame, display: true)
        }
    }

    private func panelOrigin(for size: NSSize) -> NSPoint {
        let screen = NSScreen.openworkPreferredIslandScreen
        let frame = screen?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)

        return NSPoint(
            x: frame.midX - size.width / 2,
            y: frame.maxY - size.height
        )
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
        // 本地调样式时，直接把 `.idle` 改成 `.working` 或 `.approval`；
        // 真正运行时也可以继续通过 main 进程发 `{"type":"setState","state":"idle|working|approval"}` 来切换。
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

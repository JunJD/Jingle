import AppKit
import ApplicationServices
import Foundation

struct DesktopAutomationError: Error, CustomStringConvertible {
    let description: String
}

struct ApplicationRecord: Encodable {
    let bundleId: String?
    let name: String?
    let pid: Int32?
}

struct AXElementRecord: Encodable {
    let actions: [String]
    let description: String?
    let identifier: String?
    let index: Int
    let role: String?
    let subrole: String?
    let title: String?
    let value: String?
}

struct DesktopAutomationRequest: Decodable {
    let activate: Bool?
    let bundleId: String?
    let hideCursor: Bool?
    let limit: Int?
    let matchIndex: Int?
    let name: String?
    let role: String?
    let titleContains: String?
    let type: String
    let url: String?
    let x: Double?
    let y: Double?
}

struct OpenApplicationResponse: Encodable {
    let application: ApplicationRecord
    let type = "open_application"
}

struct OpenDesktopRouteResponse: Encodable {
    let type = "open_desktop_route"
    let url: String
}

struct FindAXElementsResponse: Encodable {
    let application: ApplicationRecord
    let elements: [AXElementRecord]
    let type = "find_ax_elements"
}

struct PressAXElementResponse: Encodable {
    let application: ApplicationRecord
    let element: AXElementRecord
    let type = "press_ax_element"
}

struct ClickScreenPointResponse: Encodable {
    let hideCursor: Bool
    let type = "click_screen_point"
    let x: Double
    let y: Double
}

private let maxTraversalDepth = 8
private let maxTraversalNodeCount = 400

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

func readRequest() throws -> DesktopAutomationRequest {
    guard CommandLine.arguments.count >= 2 else {
        throw DesktopAutomationError(description: "Missing desktop automation request JSON.")
    }

    let payload = CommandLine.arguments[1]
    guard let data = payload.data(using: .utf8) else {
        throw DesktopAutomationError(description: "Desktop automation request is not valid UTF-8.")
    }

    return try JSONDecoder().decode(DesktopAutomationRequest.self, from: data)
}

func writeResponse<T: Encodable>(_ response: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(response)
    FileHandle.standardOutput.write(data)
}

func normalize(_ value: String?) -> String? {
    guard let value else {
        return nil
    }

    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

func accessibilityPromptOptions() -> CFDictionary {
    [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
    ] as CFDictionary
}

func desktopAutomationExecutablePath() -> String {
    URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path
}

func requireAccessibilityTrust() throws {
    if !AXIsProcessTrusted() {
        _ = AXIsProcessTrustedWithOptions(accessibilityPromptOptions())
        throw DesktopAutomationError(
            description: """
            Accessibility permission is required for AX and click desktop automation.
            Grant access in System Settings > Privacy & Security > Accessibility for:
            \(desktopAutomationExecutablePath())
            Then retry the tool call.
            """
        )
    }
}

func runningApplication(bundleId: String?, name: String?) -> NSRunningApplication? {
    if let bundleId = normalize(bundleId) {
        return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
    }

    guard let name = normalize(name) else {
        return nil
    }

    return NSWorkspace.shared.runningApplications.first(where: {
        normalize($0.localizedName)?.caseInsensitiveCompare(name) == .orderedSame
    })
}

func applicationSearchDirectories() -> [URL] {
    let fileManager = FileManager.default
    let applicationDirectories = fileManager.urls(for: .applicationDirectory, in: .allDomainsMask)
    let utilityDirectories = applicationDirectories.map { $0.appendingPathComponent("Utilities") }

    return applicationDirectories + utilityDirectories
}

func applicationURL(name: String, in directory: URL) -> URL? {
    let fileManager = FileManager.default
    guard
        let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isApplicationKey],
            options: [.skipsHiddenFiles]
        )
    else {
        return nil
    }

    return contents.first(where: { candidate in
        guard candidate.pathExtension == "app" else {
            return false
        }

        let displayName = candidate.deletingPathExtension().lastPathComponent
        return displayName.caseInsensitiveCompare(name) == .orderedSame
    })
}

func applicationURL(bundleId: String?, name: String?) -> URL? {
    if let bundleId = normalize(bundleId) {
        return NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)
    }

    guard let name = normalize(name) else {
        return nil
    }

    return applicationSearchDirectories()
        .lazy
        .compactMap { applicationURL(name: name, in: $0) }
        .first
}

func encodeApplication(_ application: NSRunningApplication?) -> ApplicationRecord {
    ApplicationRecord(
        bundleId: normalize(application?.bundleIdentifier),
        name: normalize(application?.localizedName),
        pid: application.map(\.processIdentifier)
    )
}

func copyAttributeValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success else {
        return nil
    }

    return value
}

func copyStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    if let stringValue = copyAttributeValue(element, attribute) as? String {
        return normalize(stringValue)
    }

    if let numberValue = copyAttributeValue(element, attribute) as? NSNumber {
        return numberValue.stringValue
    }

    return nil
}

func copyElementArrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
    if let array = copyAttributeValue(element, attribute) as? [AXUIElement] {
        return array
    }

    if let array = copyAttributeValue(element, attribute) as? NSArray {
        return array.map { $0 as! AXUIElement }
    }

    return []
}

func copyActionNames(_ element: AXUIElement) -> [String] {
    var actionNames: CFArray?
    let error = AXUIElementCopyActionNames(element, &actionNames)
    guard error == .success, let actionNames else {
        return []
    }

    return (actionNames as NSArray).compactMap { $0 as? String }
}

func makeAXRecord(element: AXUIElement, index: Int) -> AXElementRecord {
    let value = copyStringAttribute(element, kAXValueAttribute as String)
    return AXElementRecord(
        actions: copyActionNames(element),
        description: copyStringAttribute(element, kAXDescriptionAttribute as String),
        identifier: copyStringAttribute(element, kAXIdentifierAttribute as String),
        index: index,
        role: copyStringAttribute(element, kAXRoleAttribute as String),
        subrole: copyStringAttribute(element, kAXSubroleAttribute as String),
        title: copyStringAttribute(element, kAXTitleAttribute as String),
        value: value
    )
}

func matchesElement(record: AXElementRecord, role: String?, titleContains: String?) -> Bool {
    if let role = normalize(role), record.role?.caseInsensitiveCompare(role) != .orderedSame {
        return false
    }

    guard let titleContains = normalize(titleContains)?.lowercased() else {
        return true
    }

    let haystacks = [record.title, record.description, record.value]
    return haystacks.contains(where: { $0?.lowercased().contains(titleContains) == true })
}

func findAXMatches(for request: DesktopAutomationRequest) throws -> (NSRunningApplication, [(AXUIElement, AXElementRecord)]) {
    try requireAccessibilityTrust()

    guard let application = runningApplication(bundleId: request.bundleId, name: request.name) else {
        throw DesktopAutomationError(
            description: "Target application is not running. Use open_application first."
        )
    }

    let appElement = AXUIElementCreateApplication(application.processIdentifier)
    let roots = copyElementArrayAttribute(appElement, kAXWindowsAttribute as String)
    var queue = roots.map { ($0, 0) }
    if queue.isEmpty {
        queue = [(appElement, 0)]
    }

    var visited = Set<CFHashCode>()
    var results: [(AXUIElement, AXElementRecord)] = []
    let limit = min(max(request.limit ?? 10, 1), 25)

    while !queue.isEmpty && visited.count < maxTraversalNodeCount {
        let (element, depth) = queue.removeFirst()
        let hash = CFHash(element)
        if !visited.insert(hash).inserted {
            continue
        }

        let record = makeAXRecord(element: element, index: results.count)
        if matchesElement(record: record, role: request.role, titleContains: request.titleContains) {
            results.append((element, record))
            if results.count >= limit {
                break
            }
        }

        if depth >= maxTraversalDepth {
            continue
        }

        let children = copyElementArrayAttribute(element, kAXChildrenAttribute as String)
        for child in children {
            queue.append((child, depth + 1))
        }
    }

    return (application, results)
}

func performOpenApplication(_ request: DesktopAutomationRequest) throws -> OpenApplicationResponse {
    if let existing = runningApplication(bundleId: request.bundleId, name: request.name) {
        return OpenApplicationResponse(application: encodeApplication(existing))
    }

    guard let url = applicationURL(bundleId: request.bundleId, name: request.name) else {
        throw DesktopAutomationError(description: "Unable to resolve the target application.")
    }

    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true

    let semaphore = DispatchSemaphore(value: 0)
    var openedApplication: NSRunningApplication?
    var openError: Error?

    NSWorkspace.shared.openApplication(at: url, configuration: configuration) { application, error in
        openedApplication = application
        openError = error
        semaphore.signal()
    }

    semaphore.wait()

    if let openError {
        throw openError
    }

    return OpenApplicationResponse(application: encodeApplication(openedApplication))
}

func performOpenDesktopRoute(_ request: DesktopAutomationRequest) throws -> OpenDesktopRouteResponse {
    guard let rawURL = normalize(request.url), let url = URL(string: rawURL) else {
        throw DesktopAutomationError(description: "Desktop route request requires a valid URL.")
    }

    guard NSWorkspace.shared.open(url) else {
        throw DesktopAutomationError(description: "Launch Services failed to open the desktop route.")
    }

    return OpenDesktopRouteResponse(url: url.absoluteString)
}

func performFindAXElements(_ request: DesktopAutomationRequest) throws -> FindAXElementsResponse {
    let (application, matches) = try findAXMatches(for: request)
    return FindAXElementsResponse(
        application: encodeApplication(application),
        elements: matches.enumerated().map { offset, match in
            AXElementRecord(
                actions: match.1.actions,
                description: match.1.description,
                identifier: match.1.identifier,
                index: offset,
                role: match.1.role,
                subrole: match.1.subrole,
                title: match.1.title,
                value: match.1.value
            )
        }
    )
}

func performPressAXElement(_ request: DesktopAutomationRequest) throws -> PressAXElementResponse {
    let (application, matches) = try findAXMatches(for: request)
    guard !matches.isEmpty else {
        throw DesktopAutomationError(description: "No matching AX element was found.")
    }

    if request.activate == true {
        application.activate()
    }

    let matchIndex = request.matchIndex ?? 0
    guard matchIndex >= 0 && matchIndex < matches.count else {
        throw DesktopAutomationError(description: "Requested AX matchIndex is out of range.")
    }

    let (element, record) = matches[matchIndex]
    let actionError = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard actionError == .success else {
        throw DesktopAutomationError(description: "AXPress failed for the selected element.")
    }

    return PressAXElementResponse(
        application: encodeApplication(application),
        element: AXElementRecord(
            actions: record.actions,
            description: record.description,
            identifier: record.identifier,
            index: matchIndex,
            role: record.role,
            subrole: record.subrole,
            title: record.title,
            value: record.value
        )
    )
}

func performClickScreenPoint(_ request: DesktopAutomationRequest) throws -> ClickScreenPointResponse {
    try requireAccessibilityTrust()

    guard let x = request.x, let y = request.y else {
        throw DesktopAutomationError(description: "Click request requires x and y coordinates.")
    }

    guard let eventSource = CGEventSource(stateID: .hidSystemState) else {
        throw DesktopAutomationError(description: "Unable to create a macOS event source.")
    }

    let hideCursor = request.hideCursor == true
    if hideCursor {
        CGDisplayHideCursor(CGMainDisplayID())
    }

    defer {
        if hideCursor {
            CGDisplayShowCursor(CGMainDisplayID())
        }
    }

    let point = CGPoint(x: x, y: y)
    guard let mouseDown = CGEvent(
        mouseEventSource: eventSource,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ), let mouseUp = CGEvent(
        mouseEventSource: eventSource,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else {
        throw DesktopAutomationError(description: "Unable to create macOS click events.")
    }

    mouseDown.post(tap: .cghidEventTap)
    mouseUp.post(tap: .cghidEventTap)

    return ClickScreenPointResponse(hideCursor: hideCursor, x: x, y: y)
}

@main
struct JingleDesktopAutomationMain {
    static func main() {
        do {
            let request = try readRequest()

            switch request.type {
            case "open_application":
                try writeResponse(performOpenApplication(request))
            case "open_desktop_route":
                try writeResponse(performOpenDesktopRoute(request))
            case "find_ax_elements":
                try writeResponse(performFindAXElements(request))
            case "press_ax_element":
                try writeResponse(performPressAXElement(request))
            case "click_screen_point":
                try writeResponse(performClickScreenPoint(request))
            default:
                throw DesktopAutomationError(description: "Unsupported desktop automation request type.")
            }
        } catch let error as DesktopAutomationError {
            fail(error.description)
        } catch {
            fail(error.localizedDescription)
        }
    }
}

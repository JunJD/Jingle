import AppKit
import ApplicationServices
import Darwin
import Foundation

private struct NativeError: Error, CustomStringConvertible {
    let description: String
}

private struct Request: Decodable {
    let method: String
    let request: OperationRequest?
    let sessionId: String?
}

private struct OperationRequest: Decodable {
    let actions: [SemanticAction]?
    let applicationId: String?
    let applicationName: String?
    let authorization: AuthorizationGrant?
    let base: Observation?
    let delivery: String?
    let windowId: String?
}

private struct AuthorizationGrant: Decodable {
    let expiresAt: Int64
    let window: WindowIdentity
}

private struct SemanticAction: Codable {
    let kind: String
    let ref: String
    let value: String?
}

private struct WindowIdentity: Codable, Equatable {
    let generation: String
    let nativeId: String
    let pid: Int32
    let platform: String
}

private struct ApplicationIdentity: Codable {
    let id: String
    let name: String
}

private struct ElementRecord: Codable {
    let actions: [String]
    let description: String?
    let identifier: String?
    let index: Int
    let ref: String
    let role: String
    let title: String?
    let value: String?
}

private struct Observation: Codable {
    let application: ApplicationIdentity
    let capturedAt: Int64
    let elements: [ElementRecord]
    let epoch: Int?
    let resourceKey: String
    let stateId: String?
    let window: WindowIdentity

    enum CodingKeys: String, CodingKey {
        case application, capturedAt, elements, epoch, resourceKey, stateId, window
    }
}

private struct Evidence: Encodable {
    let delivery = "semantic"
    let noSideEffectProof: Bool
    let route: String
    let verification: String
}

private struct StepResult: Encodable {
    let action: SemanticAction
    let evidence: Evidence
    let outcome: String
}

private struct ExecutionResult: Encodable {
    let baseStateId: String
    let outcome: String
    let steps: [StepResult]
    let stoppedAt: Int?
}

private struct ProbeResult: Encodable {
    struct Capability: Encodable {
        let action: String
        let background: String
        let foreground: String
        let route: String
    }
    let capabilities: [Capability]
    let environment = "macos-quartz"
    let platform = "macos"
    let protocolVersion = 1

    init(accessibilityTrusted: Bool) {
        let semantic = accessibilityTrusted ? "verified" : "unavailable"
        capabilities = [
            Capability(action: "press", background: semantic, foreground: "unavailable", route: "ax_action"),
            Capability(action: "set_value", background: semantic, foreground: "unavailable", route: "ax_value"),
            Capability(action: "type_text", background: semantic, foreground: "unavailable", route: "ax_value"),
            Capability(action: "keypress", background: "refused", foreground: "unavailable", route: "unavailable"),
            Capability(action: "scroll", background: "unavailable", foreground: "unavailable", route: "unavailable")
        ]
    }
}

private struct ResolvedWindow {
    let application: NSRunningApplication
    let element: AXUIElement
    let identity: WindowIdentity
}

private let maxDepth = 9
private let maxNodes = 500
private let maxElements = 200

private func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return result.isEmpty ? nil : result
}

private func stableHash(_ value: String) -> String {
    var hash: UInt64 = 14_695_981_039_346_656_037
    for byte in value.utf8 {
        hash ^= UInt64(byte)
        hash &*= 1_099_511_628_211
    }
    return String(format: "%016llx", hash)
}

private func copyValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func stringValue(_ element: AXUIElement, _ attribute: String) -> String? {
    if let value = copyValue(element, attribute) as? String { return normalized(value) }
    if let value = copyValue(element, attribute) as? NSNumber { return value.stringValue }
    return nil
}

private func elementValues(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
    if let values = copyValue(element, attribute) as? [AXUIElement] { return values }
    return []
}

private func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let names else { return [] }
    return (names as NSArray).compactMap { $0 as? String }
}

private func processGeneration(pid: pid_t) throws -> String {
    var info = proc_bsdinfo()
    let size = MemoryLayout<proc_bsdinfo>.stride
    let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: UInt8.self, capacity: size) {
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(size))
        }
    }
    guard result == size else { throw NativeError(description: "Unable to resolve target process generation.") }
    return "\(pid):\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}

private func windowNumber(pid: pid_t, title: String?) -> CGWindowID? {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    let candidates = rows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid }
    guard let title = normalized(title) else { return nil }
    let exact = candidates.filter {
        normalized($0[kCGWindowName as String] as? String) == title
    }
    guard exact.count == 1 else { return nil }
    return (exact[0][kCGWindowNumber as String] as? NSNumber)?.uint32Value
}

private func runningApplication(id: String?, name: String?, pid: pid_t? = nil) -> NSRunningApplication? {
    if let pid { return NSRunningApplication(processIdentifier: pid) }
    let matches: [NSRunningApplication]
    if let id = normalized(id) {
        matches = NSRunningApplication.runningApplications(withBundleIdentifier: id)
    } else if let name = normalized(name) {
        matches = NSWorkspace.shared.runningApplications.filter {
            normalized($0.localizedName)?.caseInsensitiveCompare(name) == .orderedSame
        }
    } else {
        return nil
    }
    return matches.count == 1 ? matches[0] : nil
}

private func requireAccessibility() throws {
    guard AXIsProcessTrusted() else {
        throw NativeError(description: "macOS Accessibility permission is required for Computer Use.")
    }
}

private func resolveWindow(_ request: OperationRequest, expected: WindowIdentity? = nil) throws -> ResolvedWindow {
    try requireAccessibility()
    let expectedPid = expected.map { pid_t($0.pid) }
    guard let app = runningApplication(id: request.applicationId, name: request.applicationName, pid: expectedPid) else {
        throw NativeError(description: "Target application is not running.")
    }
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    let windows = elementValues(appElement, kAXWindowsAttribute as String)
    guard !windows.isEmpty else { throw NativeError(description: "Target application exposes no AX window.") }

    let requestedId = expected?.nativeId ?? normalized(request.windowId)
    var matches: [(AXUIElement, CGWindowID)] = []
    for window in windows {
        guard let number = windowNumber(pid: app.processIdentifier, title: stringValue(window, kAXTitleAttribute as String)) else { continue }
        if requestedId == nil || requestedId == String(number) {
            matches.append((window, number))
        }
    }
    guard matches.count == 1 else {
        throw NativeError(description: "Requested native window cannot be mapped to exactly one AX window.")
    }
    let resolved = matches[0]
    let generationMaterial = [
        try processGeneration(pid: app.processIdentifier),
        String(resolved.1),
        stringValue(resolved.0, kAXIdentifierAttribute as String) ?? "",
        stringValue(resolved.0, kAXRoleAttribute as String) ?? "",
        stringValue(resolved.0, kAXSubroleAttribute as String) ?? ""
    ].joined(separator: "\u{0}")
    let identity = WindowIdentity(
        generation: stableHash(generationMaterial),
        nativeId: String(resolved.1),
        pid: app.processIdentifier,
        platform: "macos"
    )
    if let expected, identity != expected {
        throw NativeError(description: "Target window identity changed; refusing stale semantic action.")
    }
    return ResolvedWindow(application: app, element: resolved.0, identity: identity)
}

private func semanticActions(_ element: AXUIElement) -> [String] {
    var result: [String] = []
    if actionNames(element).contains(kAXPressAction as String) { result.append("press") }
    var settable = DarwinBoolean(false)
    if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue {
        result.append("set_value")
        result.append("type_text")
    }
    return result
}

private func collectElements(window: ResolvedWindow) -> [(AXUIElement, ElementRecord)] {
    var queue: [(AXUIElement, [Int], Int)] = [(window.element, [], 0)]
    var visited = Set<CFHashCode>()
    var records: [(AXUIElement, ElementRecord)] = []
    while !queue.isEmpty && visited.count < maxNodes && records.count < maxElements {
        let (element, path, depth) = queue.removeFirst()
        guard visited.insert(CFHash(element)).inserted else { continue }
        let supported = semanticActions(element)
        if !supported.isEmpty {
            let index = records.count
            let role = stringValue(element, kAXRoleAttribute as String) ?? "AXUnknown"
            let identifier = stringValue(element, kAXIdentifierAttribute as String)
            let refMaterial = [
                window.identity.generation,
                path.map(String.init).joined(separator: "."),
                role,
                identifier ?? "",
                stringValue(element, kAXTitleAttribute as String) ?? "",
                stringValue(element, kAXDescriptionAttribute as String) ?? ""
            ].joined(separator: "\u{0}")
            let ref = "macos:\(stableHash(refMaterial))"
            records.append((element, ElementRecord(
                actions: supported,
                description: stringValue(element, kAXDescriptionAttribute as String),
                identifier: identifier,
                index: index,
                ref: ref,
                role: role,
                title: stringValue(element, kAXTitleAttribute as String),
                value: stringValue(element, kAXValueAttribute as String)
            )))
        }
        if depth < maxDepth {
            queue.append(contentsOf: elementValues(element, kAXChildrenAttribute as String).enumerated().map {
                ($0.element, path + [$0.offset], depth + 1)
            })
        }
    }
    return records
}

private func observe(_ request: OperationRequest) throws -> Observation {
    let window = try resolveWindow(request)
    let elements = collectElements(window: window).map(\.1)
    let appId = normalized(window.application.bundleIdentifier) ?? "pid:\(window.application.processIdentifier)"
    return Observation(
        application: ApplicationIdentity(id: appId, name: normalized(window.application.localizedName) ?? appId),
        capturedAt: Int64(Date().timeIntervalSince1970 * 1000),
        elements: elements,
        epoch: nil,
        resourceKey: "macos:\(window.identity.pid):\(window.identity.nativeId):\(window.identity.generation)",
        stateId: nil,
        window: window.identity
    )
}

private func failedStep(_ action: SemanticAction, route: String, outcome: String, noSideEffect: Bool) -> StepResult {
    StepResult(action: action, evidence: Evidence(
        noSideEffectProof: noSideEffect,
        route: route,
        verification: outcome == "worked" ? "verified" : (outcome == "unknown" ? "unverifiable" : "failed")
    ), outcome: outcome)
}

private func execute(_ request: OperationRequest) throws -> ExecutionResult {
    guard request.delivery == "background" else {
        throw NativeError(description: "macOS Computer Use helper only accepts background semantic delivery.")
    }
    guard let base = request.base, let baseStateId = base.stateId, let actions = request.actions else {
        throw NativeError(description: "Execute requires base observation, stateId, and actions.")
    }
    guard let authorization = request.authorization,
          authorization.expiresAt > Int64(Date().timeIntervalSince1970 * 1000),
          authorization.window == base.window else {
        throw NativeError(description: "Computer-use authorization is missing, expired, or belongs to another target resource.")
    }
    let window = try resolveWindow(request, expected: base.window)
    let current = collectElements(window: window)
    let byRef = Dictionary(uniqueKeysWithValues: current.map { ($0.1.ref, $0) })
    var steps: [StepResult] = []

    for (index, action) in actions.enumerated() {
        let expectedRoute = action.kind == "press" ? "ax_action" : (action.kind == "set_value" || action.kind == "type_text" ? "ax_value" : "unavailable")
        guard let target = byRef[action.ref], target.1.actions.contains(action.kind) else {
            steps.append(failedStep(action, route: expectedRoute, outcome: "didnt", noSideEffect: true))
            return ExecutionResult(baseStateId: baseStateId, outcome: "didnt", steps: steps, stoppedAt: index)
        }
        let error: AXError
        let route: String
        switch action.kind {
        case "press":
            route = "ax_action"
            error = AXUIElementPerformAction(target.0, kAXPressAction as CFString)
        case "set_value", "type_text":
            guard let value = action.value else {
                steps.append(failedStep(action, route: "ax_value", outcome: "refused", noSideEffect: true))
                return ExecutionResult(baseStateId: baseStateId, outcome: "refused", steps: steps, stoppedAt: index)
            }
            route = "ax_value"
            error = AXUIElementSetAttributeValue(target.0, kAXValueAttribute as CFString, value as CFTypeRef)
        default:
            steps.append(failedStep(action, route: expectedRoute, outcome: "refused", noSideEffect: true))
            return ExecutionResult(baseStateId: baseStateId, outcome: "refused", steps: steps, stoppedAt: index)
        }
        guard error == .success else {
            steps.append(failedStep(action, route: route, outcome: "unknown", noSideEffect: false))
            return ExecutionResult(baseStateId: baseStateId, outcome: "unknown", steps: steps, stoppedAt: index)
        }
        if action.kind != "press", stringValue(target.0, kAXValueAttribute as String) != action.value {
            steps.append(failedStep(action, route: route, outcome: "unknown", noSideEffect: false))
            return ExecutionResult(baseStateId: baseStateId, outcome: "unknown", steps: steps, stoppedAt: index)
        }
        let outcome = action.kind == "press" ? "unknown" : "worked"
        steps.append(failedStep(action, route: route, outcome: outcome, noSideEffect: false))
        if outcome == "unknown" {
            return ExecutionResult(baseStateId: baseStateId, outcome: outcome, steps: steps, stoppedAt: index)
        }
    }
    return ExecutionResult(baseStateId: baseStateId, outcome: "worked", steps: steps, stoppedAt: nil)
}

private func readRequest() throws -> Request {
    guard CommandLine.arguments.count == 2, let data = CommandLine.arguments[1].data(using: .utf8) else {
        throw NativeError(description: "Expected one UTF-8 JSON argv request.")
    }
    return try JSONDecoder().decode(Request.self, from: data)
}

private func write<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(value))
}

@main
private enum JingleComputerUseMacOS {
    static func main() {
        do {
            let command = try readRequest()
            switch command.method {
            case "probe":
                try write(ProbeResult(accessibilityTrusted: AXIsProcessTrusted()))
            case "observe":
                guard let request = command.request else { throw NativeError(description: "Observe request is missing.") }
                try write(try observe(request))
            case "execute":
                guard let request = command.request else { throw NativeError(description: "Execute request is missing.") }
                try write(try execute(request))
            case "dispose_session":
                guard normalized(command.sessionId) != nil else { throw NativeError(description: "Session id is missing.") }
                try write(Optional<String>.none)
            default:
                throw NativeError(description: "Unsupported Computer Use method: \(command.method)")
            }
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }
}

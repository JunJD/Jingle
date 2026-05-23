import AppKit
import EventKit
import Foundation

struct AppleRemindersRequest: Decodable {
    let method: String
    let payload: Payload?

    struct Payload: Decodable {
        let completed: Bool?
        let dueDate: String?
        let includeCompleted: Bool?
        let listId: String?
        let limit: Int?
        let notes: String?
        let priority: String?
        let reminderId: String?
        let title: String?
    }
}

struct AppleReminderList: Encodable {
    let color: String
    let id: String
    let isDefault: Bool
    let title: String
}

struct AppleReminder: Encodable {
    let completionDate: String?
    let creationDate: String?
    let dueDate: String?
    let id: String
    let isCompleted: Bool
    let list: AppleReminderList?
    let notes: String
    let openUrl: String
    let priority: String?
    let title: String

    enum CodingKeys: String, CodingKey {
        case completionDate
        case creationDate
        case dueDate
        case id
        case isCompleted
        case list
        case notes
        case openUrl
        case priority
        case title
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try encodeNullable(completionDate, forKey: .completionDate, in: &container)
        try encodeNullable(creationDate, forKey: .creationDate, in: &container)
        try encodeNullable(dueDate, forKey: .dueDate, in: &container)
        try container.encode(id, forKey: .id)
        try container.encode(isCompleted, forKey: .isCompleted)
        try encodeNullable(list, forKey: .list, in: &container)
        try container.encode(notes, forKey: .notes)
        try container.encode(openUrl, forKey: .openUrl)
        try encodeNullable(priority, forKey: .priority, in: &container)
        try container.encode(title, forKey: .title)
    }
}

struct AppleRemindersData: Encodable {
    let lists: [AppleReminderList]
    let reminders: [AppleReminder]
}

struct DeleteReminderResponse: Encodable {
    let reminderId: String
}

enum AppleRemindersError: Error, CustomStringConvertible {
    case accessDenied
    case invalidRequest(String)
    case listNotFound
    case reminderNotFound
    case saveFailed
    case unsupportedMethod(String)

    var description: String {
        switch self {
        case .accessDenied:
            return "OpenworkRemindersAccessDenied"
        case .invalidRequest(let message):
            return "OpenworkInvalidRemindersRequest: \(message)"
        case .listNotFound:
            return "OpenworkReminderListNotFound"
        case .reminderNotFound:
            return "OpenworkReminderNotFound"
        case .saveFailed:
            return "OpenworkReminderSaveFailed"
        case .unsupportedMethod(let method):
            return "OpenworkUnsupportedMethod: \(method)"
        }
    }
}

let isoDateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

let dateOnlyFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
}()

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

func readRequest() throws -> AppleRemindersRequest {
    guard CommandLine.arguments.count >= 2 else {
        throw AppleRemindersError.invalidRequest("Missing request JSON.")
    }

    guard let data = CommandLine.arguments[1].data(using: .utf8) else {
        throw AppleRemindersError.invalidRequest("Request JSON is not valid UTF-8.")
    }

    return try JSONDecoder().decode(AppleRemindersRequest.self, from: data)
}

func writeResponse<T: Encodable>(_ response: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(response)
    FileHandle.standardOutput.write(data)
}

func writeNullResponse() {
    FileHandle.standardOutput.write(Data("null".utf8))
}

func encodeNullable<T: Encodable, K: CodingKey>(
    _ value: T?,
    forKey key: K,
    in container: inout KeyedEncodingContainer<K>
) throws {
    if let value {
        try container.encode(value, forKey: key)
    } else {
        try container.encodeNil(forKey: key)
    }
}

func requestRemindersAccess(_ eventStore: EKEventStore) async throws {
    let granted: Bool
    if #available(macOS 14.0, *) {
        granted = try await eventStore.requestFullAccessToReminders()
    } else {
        granted = try await eventStore.requestAccess(to: .reminder)
    }

    if !granted {
        throw AppleRemindersError.accessDenied
    }
}

func hexColor(_ color: CGColor?) -> String {
    guard let components = color?.components, components.count >= 3 else {
        return ""
    }

    let red = max(0, min(255, Int(components[0] * 255)))
    let green = max(0, min(255, Int(components[1] * 255)))
    let blue = max(0, min(255, Int(components[2] * 255)))
    return String(format: "#%02X%02X%02X", red, green, blue)
}

func serializeList(_ calendar: EKCalendar, defaultListId: String?) -> AppleReminderList {
    AppleReminderList(
        color: hexColor(calendar.cgColor),
        id: calendar.calendarIdentifier,
        isDefault: defaultListId != nil && calendar.calendarIdentifier == defaultListId,
        title: calendar.title
    )
}

func serializePriority(_ value: Int) -> String? {
    if value <= 0 {
        return nil
    }

    if value <= 4 {
        return "high"
    }

    if value == 5 {
        return "medium"
    }

    return "low"
}

func nativePriority(_ value: String?) -> Int {
    switch value {
    case "high":
        return 1
    case "medium":
        return 5
    case "low":
        return 9
    default:
        return 0
    }
}

func serializeDueDate(_ components: DateComponents?) -> String? {
    guard let components, let date = Calendar.current.date(from: components) else {
        return nil
    }

    if components.hour != nil || components.minute != nil || components.second != nil {
        return isoDateFormatter.string(from: date)
    }

    return dateOnlyFormatter.string(from: date)
}

func serializeDate(_ date: Date?) -> String? {
    guard let date else {
        return nil
    }

    return isoDateFormatter.string(from: date)
}

func serializeReminder(_ reminder: EKReminder, defaultListId: String?) -> AppleReminder {
    AppleReminder(
        completionDate: serializeDate(reminder.completionDate),
        creationDate: serializeDate(reminder.creationDate),
        dueDate: serializeDueDate(reminder.dueDateComponents),
        id: reminder.calendarItemIdentifier,
        isCompleted: reminder.isCompleted,
        list: serializeList(reminder.calendar, defaultListId: defaultListId),
        notes: reminder.notes ?? "",
        openUrl: "x-apple-reminderkit://REMCDReminder/\(reminder.calendarItemIdentifier)",
        priority: serializePriority(reminder.priority),
        title: reminder.title ?? ""
    )
}

func fetchReminders(eventStore: EKEventStore, predicate: NSPredicate) async -> [EKReminder]? {
    await withCheckedContinuation { continuation in
        eventStore.fetchReminders(matching: predicate) { reminders in
            continuation.resume(returning: reminders)
        }
    }
}

func getDefaultListId(_ eventStore: EKEventStore) -> String? {
    eventStore.defaultCalendarForNewReminders()?.calendarIdentifier
}

func getData(_ eventStore: EKEventStore, payload: AppleRemindersRequest.Payload?) async throws -> AppleRemindersData {
    let incompletePredicate = eventStore.predicateForIncompleteReminders(
        withDueDateStarting: nil,
        ending: nil,
        calendars: nil
    )
    let incompleteReminders = await fetchReminders(eventStore: eventStore, predicate: incompletePredicate) ?? []
    let completedReminders: [EKReminder]
    if payload?.includeCompleted == false {
        completedReminders = []
    } else {
        let completedPredicate = eventStore.predicateForCompletedReminders(
            withCompletionDateStarting: nil,
            ending: nil,
            calendars: nil
        )
        completedReminders = await fetchReminders(eventStore: eventStore, predicate: completedPredicate) ?? []
    }
    var seenReminderIds = Set<String>()
    let reminders = (incompleteReminders + completedReminders).filter { reminder in
        seenReminderIds.insert(reminder.calendarItemIdentifier).inserted
    }
    let defaultListId = getDefaultListId(eventStore)
    let lists = eventStore.calendars(for: .reminder)
    let limit = min(max(0, payload?.limit ?? 1000), 1000)

    return AppleRemindersData(
        lists: lists.map { serializeList($0, defaultListId: defaultListId) },
        reminders: reminders.prefix(limit).map { serializeReminder($0, defaultListId: defaultListId) }
    )
}

func parseDateOnly(_ value: String) -> Date? {
    dateOnlyFormatter.date(from: value)
}

func parseDateTime(_ value: String) -> Date? {
    if let date = isoDateFormatter.date(from: value) {
        return date
    }

    return ISO8601DateFormatter().date(from: value)
}

func setDueDate(_ reminder: EKReminder, _ value: String?) {
    guard let value, !value.isEmpty else {
        reminder.dueDateComponents = nil
        return
    }

    if value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
       let date = parseDateOnly(value) {
        reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return
    }

    if let date = parseDateTime(value) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: date
        )
        reminder.addAlarm(EKAlarm(absoluteDate: date))
    }
}

func findReminder(_ eventStore: EKEventStore, reminderId: String?) throws -> EKReminder {
    guard let reminderId, !reminderId.isEmpty else {
        throw AppleRemindersError.invalidRequest("Missing reminderId.")
    }

    guard let reminder = eventStore.calendarItem(withIdentifier: reminderId) as? EKReminder else {
        throw AppleRemindersError.reminderNotFound
    }

    return reminder
}

func createReminder(_ eventStore: EKEventStore, payload: AppleRemindersRequest.Payload?) throws -> AppleReminder {
    guard let title = payload?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        throw AppleRemindersError.invalidRequest("Missing title.")
    }

    let reminder = EKReminder(eventStore: eventStore)
    reminder.title = title
    reminder.notes = payload?.notes ?? ""
    reminder.priority = nativePriority(payload?.priority)

    if let listId = payload?.listId, !listId.isEmpty {
        guard let list = eventStore.calendar(withIdentifier: listId) else {
            throw AppleRemindersError.listNotFound
        }
        reminder.calendar = list
    } else {
        guard let defaultList = eventStore.defaultCalendarForNewReminders() else {
            throw AppleRemindersError.listNotFound
        }
        reminder.calendar = defaultList
    }

    setDueDate(reminder, payload?.dueDate ?? nil)

    do {
        try eventStore.save(reminder, commit: true)
    } catch {
        throw AppleRemindersError.saveFailed
    }

    return serializeReminder(reminder, defaultListId: getDefaultListId(eventStore))
}

func setReminderCompleted(_ eventStore: EKEventStore, payload: AppleRemindersRequest.Payload?) throws -> AppleReminder {
    let reminder = try findReminder(eventStore, reminderId: payload?.reminderId)
    reminder.isCompleted = payload?.completed == true

    do {
        try eventStore.save(reminder, commit: true)
    } catch {
        throw AppleRemindersError.saveFailed
    }

    return serializeReminder(reminder, defaultListId: getDefaultListId(eventStore))
}

func deleteReminder(_ eventStore: EKEventStore, payload: AppleRemindersRequest.Payload?) throws -> DeleteReminderResponse {
    let reminderId = payload?.reminderId
    let reminder = try findReminder(eventStore, reminderId: reminderId)

    do {
        try eventStore.remove(reminder, commit: true)
    } catch {
        throw AppleRemindersError.saveFailed
    }

    return DeleteReminderResponse(reminderId: reminderId ?? "")
}

func showReminder(_ eventStore: EKEventStore, payload: AppleRemindersRequest.Payload?) throws {
    let reminder = try findReminder(eventStore, reminderId: payload?.reminderId)
    let url = URL(string: "x-apple-reminderkit://REMCDReminder/\(reminder.calendarItemIdentifier)")!
    NSWorkspace.shared.open(url)
}

@main
struct OpenworkAppleRemindersMain {
    static func main() async {
        do {
            let request = try readRequest()
            let eventStore = EKEventStore()
            try await requestRemindersAccess(eventStore)

            switch request.method {
            case "get-data":
                try await writeResponse(getData(eventStore, payload: request.payload))
            case "create-reminder":
                try writeResponse(createReminder(eventStore, payload: request.payload))
            case "set-reminder-completed":
                try writeResponse(setReminderCompleted(eventStore, payload: request.payload))
            case "delete-reminder":
                try writeResponse(deleteReminder(eventStore, payload: request.payload))
            case "show-reminder":
                try showReminder(eventStore, payload: request.payload)
                writeNullResponse()
            default:
                throw AppleRemindersError.unsupportedMethod(request.method)
            }
        } catch let error as AppleRemindersError {
            fail(error.description)
        } catch {
            fail(error.localizedDescription)
        }
    }
}

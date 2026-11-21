import SwiftUI
import UserNotifications

/// A reminder as the notification center needs it. The shared module hands over `PlannedReminder`s;
/// `ReminderRunner` turns them into these, so this file does not need the shared framework.
struct ReminderItem {
    let id: String
    let fireAt: Date
    let title: String
    let body: String
    let linkKind: String
    let linkId: String?
}

/// A link that came with a tapped notification and waits until the main screen opens it.
struct PendingReminderLink: Identifiable, Equatable {
    let id = UUID()
    let kind: String
    let linkId: String?
}

@MainActor
final class ReminderInbox: ObservableObject {
    static let shared = ReminderInbox()
    @Published var pending: PendingReminderLink?

    func offer(kind: String, linkId: String?) {
        pending = PendingReminderLink(kind: kind, linkId: linkId)
    }
}

enum ReminderUserInfo {
    static let kind = "linkKind"
    static let linkId = "linkId"
}

/// The local notifications: the plan replaces what is pending, and the permission is asked here.
@MainActor
enum ReminderCenter {
    /// iOS keeps 64 pending requests; the plan has at most 60.
    private static let maxPending = 60

    static func apply(_ items: [ReminderItem]) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        let now = Date()
        for item in items.prefix(maxPending) {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            var info: [String: String] = [ReminderUserInfo.kind: item.linkKind]
            if let linkId = item.linkId { info[ReminderUserInfo.linkId] = linkId }
            content.userInfo = info
            // A reminder that is due already is delivered at once (a nil trigger).
            var trigger: UNNotificationTrigger?
            if item.fireAt > now.addingTimeInterval(1) {
                let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
                trigger = UNCalendarNotificationTrigger(
                    dateMatching: Calendar.current.dateComponents(parts, from: item.fireAt),
                    repeats: false
                )
            }
            let request = UNNotificationRequest(identifier: item.id, content: content, trigger: trigger)
            center.add(request) { error in
                if let error { NSLog("reminder could not be scheduled: %@", error.localizedDescription) }
            }
        }
    }

    static func cancelAll() {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    /// The system's answer as the settings store names it: "granted", "denied" or "undetermined".
    static func permission(granted: String, denied: String, undetermined: String, done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let value: String = switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: granted
            case .denied: denied
            default: undetermined
            }
            DispatchQueue.main.async { done(value) }
        }
    }

    /// Shows the system's permission dialog; `done` is called afterwards.
    static func requestPermission(done: @escaping () -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
            if let error { NSLog("notification permission failed: %@", error.localizedDescription) }
            DispatchQueue.main.async { done() }
        }
    }
}

/// Shows banners while the app is open and opens the link of a tapped notification.
///
/// A retained singleton: `UNUserNotificationCenter.delegate` is a weak reference. It is assigned at
/// launch (`AppDelegate`), because a tap that starts the app is delivered right after.
final class ReminderNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = ReminderNotificationDelegate()

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let kind = info[ReminderUserInfo.kind] as? String
        let linkId = info[ReminderUserInfo.linkId] as? String
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if let kind { ReminderInbox.shared.offer(kind: kind, linkId: linkId) }
            }
            completionHandler()
        }
    }
}

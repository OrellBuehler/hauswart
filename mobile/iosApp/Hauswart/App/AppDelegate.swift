import UIKit
import UserNotifications

/// Sets up what has to exist before the app has finished launching: the notification delegate (a tap
/// on a reminder that starts the app is delivered right after) and the background refresh.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = ReminderNotificationDelegate.shared
        ReminderRunner.registerBackgroundTask()
        return true
    }
}

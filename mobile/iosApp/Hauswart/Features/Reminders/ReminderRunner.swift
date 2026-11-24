import BackgroundTasks
import shared
import SwiftUI

/// Plans the reminders from the server's data and hands the plan to the notification center: when the
/// app comes to the foreground, after tasks or appointments changed, and in the background through
/// a `BGAppRefreshTask`, which also syncs the phone's contacts (`PhoneContactRunner`).
@MainActor
enum ReminderRunner {
    /// Must be listed under `BGTaskSchedulerPermittedIdentifiers` in project.yml.
    static let taskIdentifier = "ch.orellbuehler.hauswart.refresh"

    private static let sync = ReminderSync(app: AppEnv.app)
    private static var watching: StoreSubscription?

    /// Plans now and replaces what is pending.
    static func syncNow() {
        ReminderCenter.clearSessionEnded()
        sync.run { plan in
            ReminderCenter.apply(items(of: plan))
        }
    }

    /// Plans again whenever tasks or appointments change while the app runs. Call once.
    static func start() {
        guard watching == nil else { return }
        watching = sync.watch { plan in
            ReminderCenter.apply(items(of: plan))
        }
    }

    /// Takes everything away: the person signed out.
    static func signedOut() {
        sync.forget()
        ReminderCenter.cancelAll()
    }

    /// Registers the launch handler. Must run before the app finishes launching.
    static func registerBackgroundTask() {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: .main) { task in
            MainActor.assumeIsolated {
                handle(task)
            }
        }
        if !registered {
            NSLog("background refresh could not be registered")
        }
        scheduleRefresh()
    }

    /// Asks for the next background run. The date is an earliest time, iOS picks the actual one.
    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 60 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            NSLog("background refresh could not be scheduled: %@", error.localizedDescription)
        }
    }

    /// The background run that is going on, so that it is completed once only.
    private static var running: BGTask?

    private static func handle(_ task: BGTask) {
        scheduleRefresh()
        running = task
        // iOS ends the run when its time is up: complete the task, or the system holds it against the app.
        task.expirationHandler = {
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    finish(task, success: false)
                }
            }
        }
        sync.run { plan in
            ReminderCenter.apply(items(of: plan))
            // The server refused the token: nobody sees the app, so say that the person has to sign in again.
            if sync.sessionEnded {
                for item in items(of: [sync.sessionEndedNotice()]) {
                    ReminderCenter.deliver(item)
                }
            }
            // The same run brings the phone's contacts up to date; it cannot ask for permission here.
            PhoneContactRunner.syncNow(mayAsk: false) {
                finish(task, success: true)
            }
        }
    }

    private static func finish(_ task: BGTask, success: Bool) {
        guard running === task else { return }
        running = nil
        task.setTaskCompleted(success: success)
    }

    private static func items(of plan: [PlannedReminder]) -> [ReminderItem] {
        plan.map { reminder in
            ReminderItem(
                id: reminder.id,
                fireAt: Date(timeIntervalSince1970: Double(reminder.fireAt) / 1000),
                title: reminder.title,
                body: reminder.body,
                linkKind: reminder.link.kind,
                linkId: reminder.link.id
            )
        }
    }
}

/// What the app opens when a reminder is tapped.
struct ReminderLinkSheet: View {
    let link: PendingReminderLink
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common_close")) { dismiss() }
                    }
                }
                .navigationDestination(for: Route.self) { route in
                    destination(for: route)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let route = Route.from(link: AppLink(kind: link.kind, id: link.linkId)) {
            destination(for: route)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }
}

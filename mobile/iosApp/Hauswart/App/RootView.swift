import shared
import SwiftUI

struct RootView: View {
    @StateObject private var model = Observed(RootStore(app: AppEnv.app))
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.state.signedIn {
                MainTabs()
            } else {
                ConnectScreen()
            }
        }
        // Texts come from tr(), which reads the current language: a change rebuilds everything.
        .id(model.state.locale)
        .onAppear {
            ReminderRunner.start()
            PhoneContactRunner.start()
            if model.state.signedIn { syncNow() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, model.state.signedIn { syncNow() }
        }
        .onChange(of: model.state.signedIn) { _, signedIn in
            if signedIn { syncNow() } else { ReminderRunner.signedOut() }
        }
    }

    private func syncNow() {
        ReminderRunner.syncNow()
        PhoneContactRunner.syncNow()
    }
}

struct MainTabs: View {
    @ObservedObject private var reminders = ReminderInbox.shared

    var body: some View {
        TabView {
            RouteStack { DashboardScreen() }
                .tabItem { Label(tr("nav_dashboard"), systemImage: "house") }
            RouteStack { destination(for: .tasks) }
                .tabItem { Label(tr("nav_tasks"), systemImage: "checklist") }
            RouteStack { destination(for: .costs) }
                .tabItem { Label(tr("nav_costs"), systemImage: "banknote") }
            RouteStack { MoreScreen() }
                .tabItem { Label(tr("m_nav_more"), systemImage: "ellipsis.circle") }
        }
        .sheet(item: $reminders.pending) { link in
            ReminderLinkSheet(link: link)
        }
    }
}

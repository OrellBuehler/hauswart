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
    // The tab and the pushed screen a launch for the store screenshots asks for; else the first tab.
    @State private var tab = ScreenshotRun.tab

    var body: some View {
        TabView(selection: $tab) {
            RouteStack(initial: ScreenshotRun.routes(tab: 0)) { DashboardScreen() }
                .tabItem { Label(tr("nav_dashboard"), systemImage: "house") }
                .tag(0)
            RouteStack(initial: ScreenshotRun.routes(tab: 1)) { destination(for: .tasks) }
                .tabItem { Label(tr("nav_tasks"), systemImage: "checklist") }
                .tag(1)
            RouteStack(initial: ScreenshotRun.routes(tab: 2)) { destination(for: .costs) }
                .tabItem { Label(tr("nav_costs"), systemImage: "banknote") }
                .tag(2)
            RouteStack(initial: ScreenshotRun.routes(tab: 3)) { MoreScreen() }
                .tabItem { Label(tr("m_nav_more"), systemImage: "ellipsis.circle") }
                .tag(3)
        }
        .sheet(item: $reminders.pending) { link in
            ReminderLinkSheet(link: link)
        }
    }
}

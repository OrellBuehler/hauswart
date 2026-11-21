import shared
import SwiftUI

struct RootView: View {
    @StateObject private var model = Observed(RootStore(app: AppEnv.app))

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
    }
}

struct MainTabs: View {
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
    }
}

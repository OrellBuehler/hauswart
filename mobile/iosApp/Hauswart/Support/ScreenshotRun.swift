import Foundation
import shared

/// The store screenshots (`mobile/scripts/screenshots`): a debug build that is launched with
/// `-screenshot_server <address> -screenshot_username <name> -screenshot_password <password>
/// -screenshot_locale <de|en> -screenshot_link <address of the web app>` signs in to that server by
/// itself and starts on the screen the link stands for, so nothing has to be tapped. A release build
/// ignores all of it.
@MainActor
enum ScreenshotRun {
    private static func argument(_ name: String) -> String? {
        #if DEBUG
            return UserDefaults.standard.string(forKey: name)
        #else
            return nil
        #endif
    }

    static func start(app: HauswartApp) {
        guard let server = argument("screenshot_server") else { return }
        ScreenshotSessionKt.startScreenshotSession(
            app: app,
            serverUrl: server,
            username: argument("screenshot_username") ?? "",
            password: argument("screenshot_password") ?? "",
            locale: argument("screenshot_locale") ?? "en"
        )
    }

    private static let link: AppLink? = AppLinkKt.routeForUrl(url: argument("screenshot_link"))

    /// The tab the launch starts on: 0 home, 1 tasks, 2 costs, 3 everything else.
    static var tab: Int {
        guard let link else { return 0 }
        switch link.kind {
        case "home": return 0
        case "tasks", "task": return 1
        case "costs", "cost": return 2
        default: return 3
        }
    }

    /// What is pushed on the stack of `tab` at the start: the screen of the link, unless it is the tab itself.
    static func routes(tab: Int) -> [Route] {
        guard let link, tab == self.tab else { return [] }
        switch link.kind {
        case "home", "tasks", "costs": return []
        default:
            if let route = Route.from(link: link) { return [route] }
            return []
        }
    }
}

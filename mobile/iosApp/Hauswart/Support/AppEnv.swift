import shared
import UIKit

/// The one `HauswartApp` of the process. Stores take it as their first argument.
@MainActor
enum AppEnv {
    static let app: HauswartApp = {
        let app = HauswartApp(
            secure: SecureStorage(),
            settings: PlainStorage(),
            device: DeviceInfo(
                name: UIDevice.current.name,
                platform: "ios",
                language: Locale.current.language.languageCode?.identifier ?? "en"
            )
        )
        ScreenshotRun.start(app: app)
        return app
    }()
}

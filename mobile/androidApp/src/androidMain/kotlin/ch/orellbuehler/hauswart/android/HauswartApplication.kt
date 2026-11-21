package ch.orellbuehler.hauswart.android

import android.app.Application
import android.os.Build
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.android.reminders.RemindersController
import ch.orellbuehler.hauswart.android.ui.LocaleTracker
import ch.orellbuehler.hauswart.android.ui.StoreRegistry
import ch.orellbuehler.hauswart.android.ui.sections.deleteLeftoverFiles
import ch.orellbuehler.hauswart.platform.DeviceInfo
import ch.orellbuehler.hauswart.platform.PlainStorage
import ch.orellbuehler.hauswart.platform.SecureStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.Locale

class HauswartApplication : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    val app: HauswartApp by lazy {
        HauswartApp(
            secure = SecureStorage(this),
            settings = PlainStorage(this),
            device =
                DeviceInfo(
                    name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                    platform = "android",
                    language = Locale.getDefault().language,
                ),
        )
    }

    val reminders: RemindersController by lazy { RemindersController(this, app) }

    override fun onCreate() {
        super.onCreate()
        Thread { deleteLeftoverFiles() }.start()
        LocaleTracker.install(app)
        scope.launch {
            app.session.state
                .map { it.signedIn }
                .distinctUntilChanged()
                .collect { signedIn -> if (!signedIn) StoreRegistry.closeAll() }
        }
        reminders.start()
    }
}

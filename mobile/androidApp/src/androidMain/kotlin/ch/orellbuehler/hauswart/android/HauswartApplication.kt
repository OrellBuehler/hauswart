package ch.orellbuehler.hauswart.android

import android.app.Application
import android.os.Build
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.platform.DeviceInfo
import ch.orellbuehler.hauswart.platform.PlainStorage
import ch.orellbuehler.hauswart.platform.SecureStorage
import java.util.Locale

class HauswartApplication : Application() {
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
}

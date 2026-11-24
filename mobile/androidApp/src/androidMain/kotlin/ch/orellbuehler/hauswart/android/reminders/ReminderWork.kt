package ch.orellbuehler.hauswart.android.reminders

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.orellbuehler.hauswart.android.HauswartApplication
import java.util.concurrent.TimeUnit

/** Plans the reminders in the background: every six hours while there is a network. */
class ReminderWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as HauswartApplication).reminders.syncNow()
        return Result.success()
    }
}

object ReminderWork {
    private const val PERIODIC = "hauswart_reminders"
    private const val ONCE = "hauswart_reminders_once"

    private val needsNetwork = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensure(context: Context) {
        val request = PeriodicWorkRequestBuilder<ReminderWorker>(6, TimeUnit.HOURS).setConstraints(needsNetwork).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One run soon, e.g. after the time zone changed. */
    fun once(context: Context) {
        val request = OneTimeWorkRequestBuilder<ReminderWorker>().setConstraints(needsNetwork).build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(ONCE)
    }
}

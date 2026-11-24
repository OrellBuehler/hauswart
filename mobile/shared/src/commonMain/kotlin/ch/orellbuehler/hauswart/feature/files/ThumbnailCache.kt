package ch.orellbuehler.hauswart.feature.files

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/**
 * Small images kept in memory for the life of one screen, fetched lazily: a screen asks for the ones
 * it shows ([request]) and reads them with [get] once [changed] says that something arrived. At most
 * [parallel] fetches run at a time so a long list does not queue up behind its own thumbnails; a
 * thumbnail that failed is not asked for again (the screen shows its placeholder).
 */
class ThumbnailCache(
    private val scope: CoroutineScope,
    parallel: Int,
    private val fetch: suspend (key: String) -> ByteArray,
    private val changed: () -> Unit,
) {
    private val images = HashMap<String, ByteArray>()
    private val failed = HashSet<String>()
    private val requested = HashSet<String>()
    private val gate = Semaphore(parallel)

    fun get(key: String): ByteArray? = images[key]

    fun hasFailed(key: String): Boolean = key in failed

    fun request(key: String) {
        if (key in images || key in failed || !requested.add(key)) return
        scope.launch {
            try {
                val bytes = gate.withPermit { fetch(key) }
                images[key] = bytes
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                failed += key
            } finally {
                requested -= key
            }
            changed()
        }
    }
}

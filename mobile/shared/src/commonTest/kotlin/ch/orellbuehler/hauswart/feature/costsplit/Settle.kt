package ch.orellbuehler.hauswart.feature.costsplit

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Lets the requests a store started after a change (a reload) finish before the test closes it: a request that is
 * cancelled in flight would resume on the main dispatcher after the next test has reset it.
 */
internal suspend fun settle() = withContext(Dispatchers.Default) { delay(150) }

package ch.orellbuehler.hauswart.platform

import android.content.Context

actual class PlainStorage(
    context: Context,
) : KeyValueStore {
    private val prefs = context.getSharedPreferences("hauswart_prefs", Context.MODE_PRIVATE)

    actual override fun save(
        key: String,
        value: String,
    ) {
        prefs.edit().putString(key, value).apply()
    }

    actual override fun load(key: String): String? = prefs.getString(key, null)

    actual override fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }
}

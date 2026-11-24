package ch.orellbuehler.hauswart.platform

import platform.Foundation.NSUserDefaults

actual class PlainStorage : KeyValueStore {
    private val defaults = NSUserDefaults.standardUserDefaults

    actual override fun save(
        key: String,
        value: String,
    ) {
        defaults.setObject(value, forKey = key)
    }

    actual override fun load(key: String): String? = defaults.stringForKey(key)

    actual override fun delete(key: String) {
        defaults.removeObjectForKey(key)
    }
}

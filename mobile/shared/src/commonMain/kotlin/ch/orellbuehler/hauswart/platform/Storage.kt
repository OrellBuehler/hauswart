package ch.orellbuehler.hauswart.platform

interface KeyValueStore {
    fun save(
        key: String,
        value: String,
    )

    fun load(key: String): String?

    fun delete(key: String)
}

/** Keychain on iOS, encrypted preferences on Android. Holds the device token. */
expect class SecureStorage : KeyValueStore {
    override fun save(
        key: String,
        value: String,
    )

    override fun load(key: String): String?

    override fun delete(key: String)
}

/** Plain preferences for what is not secret (server address, settings, cached reminders). */
expect class PlainStorage : KeyValueStore {
    override fun save(
        key: String,
        value: String,
    )

    override fun load(key: String): String?

    override fun delete(key: String)
}

class MemoryStore : KeyValueStore {
    private val values = mutableMapOf<String, String>()

    override fun save(
        key: String,
        value: String,
    ) {
        values[key] = value
    }

    override fun load(key: String): String? = values[key]

    override fun delete(key: String) {
        values.remove(key)
    }
}

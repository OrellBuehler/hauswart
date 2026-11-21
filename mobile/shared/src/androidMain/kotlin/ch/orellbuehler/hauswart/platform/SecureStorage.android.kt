package ch.orellbuehler.hauswart.platform

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

actual class SecureStorage(
    context: Context,
) : KeyValueStore {
    private val masterKey =
        MasterKey
            .Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

    private val prefs =
        EncryptedSharedPreferences.create(
            context,
            "hauswart_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

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

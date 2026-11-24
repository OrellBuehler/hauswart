package ch.orellbuehler.hauswart.platform

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.IOException
import java.security.GeneralSecurityException

actual class SecureStorage(
    context: Context,
) : KeyValueStore {
    private val prefs: SharedPreferences = open(context)

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

    private companion object {
        const val FILE = "hauswart_secure"

        fun open(context: Context): SharedPreferences =
            try {
                create(context)
            } catch (e: GeneralSecurityException) {
                startOver(context, e)
            } catch (e: IOException) {
                startOver(context, e)
            } catch (e: RuntimeException) {
                startOver(context, e)
            }

        /**
         * The file cannot be read (restored without its Keystore key, or the key was lost): it is
         * useless, so delete it and start empty. The person is signed out and signs in again.
         */
        private fun startOver(
            context: Context,
            cause: Exception,
        ): SharedPreferences {
            Log.w("SecureStorage", "unreadable secure preferences, starting empty", cause)
            context.deleteSharedPreferences(FILE)
            return create(context)
        }

        fun create(context: Context): SharedPreferences {
            val masterKey =
                MasterKey
                    .Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
            return EncryptedSharedPreferences.create(
                context,
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}

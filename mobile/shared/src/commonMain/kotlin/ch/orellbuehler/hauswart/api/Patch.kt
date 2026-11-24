package ch.orellbuehler.hauswart.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A field of an update request that may be left as it is ([Keep], not sent), set, or cleared
 * (`Set(null)`, sent as JSON null).
 */
@Serializable(with = PatchSerializer::class)
sealed class Patch<out T : Any> {
    data object Keep : Patch<Nothing>()

    data class Set<T : Any>(
        val value: T?,
    ) : Patch<T>()

    companion object {
        fun <T : Any> of(value: T?): Patch<T> = Set(value)
    }
}

@OptIn(ExperimentalSerializationApi::class)
class PatchSerializer<T : Any>(
    inner: KSerializer<T>,
) : KSerializer<Patch<T>> {
    private val nullable = inner.nullable
    override val descriptor: SerialDescriptor = nullable.descriptor

    override fun serialize(
        encoder: Encoder,
        value: Patch<T>,
    ) {
        when (value) {
            is Patch.Set -> encoder.encodeSerializableValue(nullable, value.value)
            Patch.Keep -> encoder.encodeNull()
        }
    }

    override fun deserialize(decoder: Decoder): Patch<T> = Patch.Set(decoder.decodeSerializableValue(nullable))
}

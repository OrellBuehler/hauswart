package ch.orellbuehler.hauswart.api

import ch.orellbuehler.hauswart.api.generated.generatedSerializersModule
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.takeFrom
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class BinaryBody(
    val bytes: ByteArray,
    val contentType: String?,
)

class UploadFile(
    val fieldName: String,
    val fileName: String,
    val contentType: String,
    val bytes: ByteArray,
)

/**
 * The one place that talks HTTP. The generated API classes call [json], [empty] and [binary];
 * multipart uploads use [multipart]. Every failure is an [ApiException].
 */
class ApiHttp(
    private val client: HttpClient,
    private val baseUrl: () -> String?,
    private val token: () -> String?,
    private val onUnauthenticated: () -> Unit,
) {
    suspend fun <R> json(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
        response: KSerializer<R>,
    ): R = decode(send(method, path, query, null), response)

    suspend fun <B, R> json(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
        bodySerializer: KSerializer<B>,
        body: B,
        response: KSerializer<R>,
    ): R = decode(send(method, path, query, JSON.encodeToString(bodySerializer, body)), response)

    suspend fun empty(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
    ) {
        send(method, path, query, null)
    }

    suspend fun <B> empty(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
        bodySerializer: KSerializer<B>,
        body: B,
    ) {
        send(method, path, query, JSON.encodeToString(bodySerializer, body))
    }

    suspend fun binary(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
    ): BinaryBody {
        val response = send(method, path, query, null)
        return guarded {
            BinaryBody(response.readRawBytes(), response.contentType()?.toString())
        }
    }

    suspend fun <R> multipart(
        path: String,
        fields: List<Pair<String, String?>>,
        file: UploadFile,
        response: KSerializer<R>,
    ): R {
        val content =
            MultiPartFormDataContent(
                formData {
                    fields.forEach { (name, value) -> if (value != null) append(name, value) }
                    append(
                        file.fieldName,
                        file.bytes,
                        Headers.build {
                            append(HttpHeaders.ContentType, file.contentType)
                            append(HttpHeaders.ContentDisposition, "filename=\"${file.fileName.replace("\"", "")}\"")
                        },
                    )
                },
            )
        return decode(execute("POST", path, emptyList(), content), response)
    }

    internal fun clientForProbe(): HttpClient = client

    /** The absolute address of a path on the configured server, or null when none is configured. */
    fun absoluteUrl(path: String): String? = baseUrl()?.let { it.trimEnd('/') + path }

    private suspend fun send(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
        jsonBody: String?,
    ): HttpResponse = execute(method, path, query, jsonBody?.let { TextContent(it, ContentType.Application.Json) })

    private suspend fun execute(
        method: String,
        path: String,
        query: List<Pair<String, Any?>>,
        body: Any?,
    ): HttpResponse {
        val base = baseUrl() ?: throw ApiException(0, ApiException.NETWORK, "No server configured")
        val bearer = token()
        val response =
            guarded {
                client.request {
                    this.method = HttpMethod.parse(method)
                    url {
                        takeFrom(base.trimEnd('/') + path)
                        query.forEach { (name, value) -> if (value != null) parameters.append(name, value.toString()) }
                    }
                    header(HttpHeaders.Accept, "application/json")
                    if (bearer != null) header(HttpHeaders.Authorization, "Bearer $bearer")
                    if (body != null) setBody(body)
                }
            }
        if (response.status.value in 200..299) return response
        val failure = failureOf(response)
        if (failure.code == "unauthenticated" && bearer != null) onUnauthenticated()
        throw failure
    }

    private suspend fun failureOf(response: HttpResponse): ApiException {
        val status = response.status.value
        val text = runCatching { response.bodyAsText() }.getOrDefault("")
        val error =
            runCatching { (JSON.parseToJsonElement(text) as? JsonObject)?.get("error") as? JsonObject }.getOrNull()
        val code = (error?.get("code") as? JsonPrimitive)?.content ?: fallbackCode(status)
        val message = (error?.get("message") as? JsonPrimitive)?.content ?: "HTTP $status"
        val details: JsonElement? = error?.get("details")
        val retryAfter = response.headers[HttpHeaders.RetryAfter]?.toLongOrNull()
        return ApiException(status, code, message, details, retryAfter)
    }

    private fun fallbackCode(status: Int): String =
        when (status) {
            401 -> "unauthenticated"
            403 -> "forbidden"
            404 -> "not_found"
            409 -> "conflict"
            429 -> "rate_limited"
            in 500..599 -> "internal"
            else -> "invalid_request"
        }

    private suspend fun <R> decode(
        response: HttpResponse,
        serializer: KSerializer<R>,
    ): R {
        val text = guarded { response.bodyAsText() }
        return try {
            JSON.decodeFromString(serializer, text)
        } catch (e: SerializationException) {
            throw ApiException(response.status.value, ApiException.INVALID_RESPONSE, "Unexpected response", cause = e)
        } catch (e: IllegalArgumentException) {
            throw ApiException(response.status.value, ApiException.INVALID_RESPONSE, "Unexpected response", cause = e)
        }
    }

    private suspend fun <T> guarded(block: suspend () -> T): T =
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(0, ApiException.NETWORK, e.message ?: "Network error", cause = e)
        }

    companion object {
        val JSON: Json =
            Json {
                ignoreUnknownKeys = true
                encodeDefaults = false
                serializersModule = generatedSerializersModule
            }

        fun segment(value: String): String = value.encodeURLPathPart()
    }
}

package ch.orellbuehler.hauswart.feature.attachments

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.UploadFile
import ch.orellbuehler.hauswart.api.generated.Attachment

/**
 * `POST /attachments`: the generated client leaves multipart out, so the upload is written by hand
 * on top of [ch.orellbuehler.hauswart.api.ApiHttp.multipart]. [caption] and [guestVisible] are optional.
 */
suspend fun uploadAttachment(
    app: HauswartApp,
    ownerType: String,
    ownerId: String,
    fileName: String,
    mime: String,
    bytes: ByteArray,
    caption: String? = null,
    guestVisible: Boolean? = null,
): Attachment =
    app.http.multipart(
        path = "/api/v1/attachments",
        fields =
            listOf(
                "ownerType" to ownerType,
                "ownerId" to ownerId,
                "caption" to caption?.takeIf { it.isNotBlank() },
                "guestVisible" to guestVisible?.toString(),
            ),
        file = UploadFile("file", fileName, mime, bytes),
        response = Attachment.serializer(),
    )

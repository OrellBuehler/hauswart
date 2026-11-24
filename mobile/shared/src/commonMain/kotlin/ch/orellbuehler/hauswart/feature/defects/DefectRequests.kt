package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.Defect
import kotlinx.serialization.json.JsonObject

/*
 * The generated request classes cannot say "no deadline" on create (a null is left out) and send
 * `deadlineSource: "handover"` with every update (a constant that is optional on the server), which
 * would reset the deadline. The defect forms therefore send their bodies as JSON objects.
 */

internal suspend fun createDefectRaw(
    app: HauswartApp,
    body: JsonObject,
): Defect = app.http.json("POST", "/api/v1/defects", emptyList(), JsonObject.serializer(), body, Defect.serializer())

internal suspend fun patchDefectRaw(
    app: HauswartApp,
    id: String,
    body: JsonObject,
): Defect =
    app.http.json("PATCH", "/api/v1/defects/${ApiHttp.segment(id)}", emptyList(), JsonObject.serializer(), body, Defect.serializer())

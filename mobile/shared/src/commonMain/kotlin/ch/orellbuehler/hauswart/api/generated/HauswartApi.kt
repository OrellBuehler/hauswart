// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.ApiHttp
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.modules.SerializersModule

/** Every endpoint a bearer token may call, grouped by tag. Multipart uploads are in [ApiHttp]. */
class HauswartApi internal constructor(
    val http: ApiHttp,
) {
    val aiTasks: AiTasksApi = AiTasksApi(http)
    val appointments: AppointmentsApi = AppointmentsApi(http)
    val assetNotes: AssetNotesApi = AssetNotesApi(http)
    val assets: AssetsApi = AssetsApi(http)
    val attachments: AttachmentsApi = AttachmentsApi(http)
    val auth: AuthApi = AuthApi(http)
    val calendar: CalendarApi = CalendarApi(http)
    val comments: CommentsApi = CommentsApi(http)
    val contacts: ContactsApi = ContactsApi(http)
    val costs: CostsApi = CostsApi(http)
    val dashboard: DashboardApi = DashboardApi(http)
    val defects: DefectsApi = DefectsApi(http)
    val docs: DocsApi = DocsApi(http)
    val documents: DocumentsApi = DocumentsApi(http)
    val emergency: EmergencyApi = EmergencyApi(http)
    val finance: FinanceApi = FinanceApi(http)
    val hints: HintsApi = HintsApi(http)
    val household: HouseholdApi = HouseholdApi(http)
    val insurance: InsuranceApi = InsuranceApi(http)
    val integrations: IntegrationsApi = IntegrationsApi(http)
    val mcp: McpApi = McpApi(http)
    val notifications: NotificationsApi = NotificationsApi(http)
    val parts: PartsApi = PartsApi(http)
    val rooms: RoomsApi = RoomsApi(http)
    val search: SearchApi = SearchApi(http)
    val serviceLog: ServiceLogApi = ServiceLogApi(http)
    val setup: SetupApi = SetupApi(http)
    val system: SystemApi = SystemApi(http)
    val tasks: TasksApi = TasksApi(http)
    val users: UsersApi = UsersApi(http)
    val vehicles: VehiclesApi = VehiclesApi(http)
    val warranties: WarrantiesApi = WarrantiesApi(http)
}

/** Left out (multipart): attachmentsUpload, aiTasksCreate. */
internal val generatedSerializersModule: SerializersModule =
    SerializersModule {
        polymorphicDefaultDeserializer(DefectTimelineItem::class) { DefectTimelineItem.Unknown.serializer() }
        polymorphicDefaultDeserializer(FinanceSuggestion::class) { FinanceSuggestion.Unknown.serializer() }
        polymorphicDefaultDeserializer(Trigger::class) { Trigger.Unknown.serializer() }
        polymorphicDefaultDeserializer(TriggerIntervalAutoCompleteItem::class) { TriggerIntervalAutoCompleteItem.Unknown.serializer() }
    }

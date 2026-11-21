package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsSupportTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @Test
    fun timeOptionsKeepATimeOffTheGrid() {
        val options = timeOptions("22:15", "bad", null).map { it.value }
        assertEquals(49, options.size)
        assertTrue("22:15" in options)
        assertEquals("00:00", options.first())
        assertEquals(options.sorted(), options)
    }

    @Test
    fun browserUrlJoinsWithoutDoubleSlashes() {
        assertEquals("https://home.example.org/settings/tokens", browserUrl("https://home.example.org/", "/settings/tokens"))
    }

    @Test
    fun errorTextsAreWordedPerSystemWithAFallback() {
        assertEquals(tr("integration_paperless_error_version"), integrationErrorText("version", PAPERLESS))
        assertEquals(tr("integration_kept_error_rate_limited"), integrationErrorText("rate_limited", KEPT))
        assertEquals(tr("integration_error_tls"), integrationErrorText("tls", HOME_ASSISTANT))
        assertEquals(tr("integration_error_busy"), integrationErrorText("busy", KEPT))
        assertEquals(tr("integration_error_unknown"), integrationErrorText("nonsense", PAPERLESS))
        assertEquals(tr("integration_error_unknown"), integrationErrorText(null, HOME_ASSISTANT))
    }
}

class SettingsListTest {
    private val server = TestApp().also { it.signIn() }

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun theLandingScreenListsSubScreensAndBrowserRows() =
        runTest {
            server.on("GET", "/api/v1/health", """{"status":"ok","version":"1.2.3"}""")
            val state = SettingsStore(server.app).await { !it.loading }
            assertEquals(listOf("notifications", "reminders", "household", "integrations", "calendar"), state.entries.map { it.id })
            assertEquals(
                listOf("account", "tokens", "devices", "guest-links", "calendar-feeds"),
                state.browserLinks.map { it.id },
            )
            assertEquals("https://home.example.org/settings/tokens", state.browserLinks[1].url)
        }
}

class NotificationSettingsStoreTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
        server.household()
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun settings(
        push: Boolean = true,
        quiet: Boolean = false,
        stages: String = """"due","overdue"""",
        targets: String = """{"id":"x1","channel":"ha_notify","target":"mobile_app_old_phone","enabled":true}""",
    ) = """{"pushEnabled":$push,"quietStart":${if (quiet) "\"22:00\"" else "null"},"quietEnd":${if (quiet) "\"07:00\"" else "null"},
        "pushStages":[$stages],"targets":[$targets]}"""

    private fun connect(vararg services: String) {
        server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("homeassistant", level = "household")))
        server.on(
            "GET",
            "/api/v1/integrations/homeassistant/notify-services",
            """{"items":[${services.joinToString(",") { "\"$it\"" }}]}""",
        )
    }

    @Test
    fun loadsPreferencesAndListsServicesWithPhonesFirst() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings())
            connect("notify_all", "mobile_app_example_phone")
            val store = NotificationSettingsStore(server.app)
            val state = store.await { !it.loading && it.targets.isNotEmpty() }
            assertTrue(state.connected)
            assertTrue(state.pushEnabled)
            assertEquals(listOf("mobile_app_example_phone", "mobile_app_old_phone", "notify_all"), state.targets.map { it.target })
            assertEquals("Example Phone", state.targets.first().title)
            assertTrue(state.targets[1].missing)
            assertTrue(state.targets[1].enabled)
            assertEquals(listOf("due", "overdue"), state.stages.filter { it.enabled }.map { it.stage })
            assertFalse(state.dirty)
            store.close()
        }

    @Test
    fun editsMakeItDirtyAndSaveSendsEverything() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings())
            connect("mobile_app_example_phone")
            val store = NotificationSettingsStore(server.app)
            store.await { it.targets.isNotEmpty() }
            store.setTarget("mobile_app_example_phone", true)
            store.setStage("hint", true)
            store.setQuietOn(true)
            assertTrue(store.value.dirty)
            server.on(
                "PUT",
                "/api/v1/me/notification-settings",
                settings(
                    quiet = true,
                    stages = """"due","overdue","hint"""",
                    targets =
                        """{"id":"x1","channel":"ha_notify","target":"mobile_app_old_phone","enabled":true},""" +
                            """{"id":"x2","channel":"ha_notify","target":"mobile_app_example_phone","enabled":true}""",
                ),
            )
            store.save()
            val saved = store.await { it.justSaved }
            assertFalse(saved.dirty)
            val body = server.requestsTo("PUT", "/api/v1/me/notification-settings").single().json
            assertEquals("22:00", body["quietStart"].toString().trim('"'))
            assertEquals(2, (body["targets"] as kotlinx.serialization.json.JsonArray).size)
            assertEquals("""["due","overdue","hint"]""", body["pushStages"].toString())
            store.consumeSaved()
            assertFalse(store.value.justSaved)
            store.close()
        }

    @Test
    fun anUncheckedNewTargetDisappearsAndManualNamesAreChecked() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings())
            connect()
            val store = NotificationSettingsStore(server.app)
            store.await { it.targets.isNotEmpty() }
            store.addManual("Bad Name")
            assertEquals(tr("notify_manual_invalid"), store.value.manualError)
            store.addManual("kitchen_tablet")
            assertTrue(store.value.targets.any { it.target == "kitchen_tablet" && it.enabled })
            store.addManual("kitchen_tablet")
            assertEquals(tr("notify_manual_duplicate"), store.value.manualError)
            store.setTarget("kitchen_tablet", false)
            assertTrue(store.value.targets.none { it.target == "kitchen_tablet" })
            store.close()
        }

    @Test
    fun withoutAConnectionThePersonCanStillSetPreferences() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings(targets = ""))
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(integrationJson("homeassistant", level = "household", configured = false)),
            )
            val store = NotificationSettingsStore(server.app)
            val state = store.await { !it.loading }
            assertFalse(state.connected)
            assertTrue(state.noTarget)
            store.close()
        }

    @Test
    fun aFailedServiceListIsShownAndDoesNotBlockTheForm() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings())
            server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("homeassistant", level = "household")))
            server.onError("GET", "/api/v1/integrations/homeassistant/notify-services", HttpStatusCode.BadGateway, "upstream_error")
            val store = NotificationSettingsStore(server.app)
            val state = store.await { !it.loading }
            assertNull(state.error)
            assertNotNull(state.servicesError)
            assertTrue(state.targets.none { it.missing })
            store.close()
        }

    @Test
    fun incompleteQuietHoursAreRefusedBeforeTheRequest() =
        runTest {
            server.on("GET", "/api/v1/me/notification-settings", settings())
            connect()
            val store = NotificationSettingsStore(server.app)
            store.await { it.targets.isNotEmpty() }
            store.setQuietOn(true)
            store.setQuietEnd("")
            store.save()
            assertEquals(tr("notify_quiet_incomplete"), store.value.saveError)
            assertTrue(server.requestsTo("PUT", "/api/v1/me/notification-settings").isEmpty())
            store.close()
        }
}

class HouseholdSettingsStoreTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun showsTheHouseholdReadOnly() =
        runTest {
            server.household("Example Home")
            val store = HouseholdSettingsStore(server.app)
            val state = store.await { !it.loading }
            assertEquals("Example Home", state.rows.first().value)
            assertEquals("07:00", state.rows.first { it.label == tr("household_digest") }.value)
            assertEquals("Europe/Zurich", state.rows.first { it.label == tr("household_timezone") }.value)
            assertEquals("https://home.example.org/settings/household", state.browserUrl)
            assertTrue(server.requests.none { it.method != "GET" })
            store.close()
        }
}

class IntegrationsStoresTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
        server.household()
    }

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun listsEveryKindWithStatusAndWhoMayEditIt() =
        runTest {
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(
                    integrationJson("homeassistant", level = "household", baseUrl = null, status = "error", lastError = "tls"),
                    integrationJson("paperless"),
                    integrationJson("kept", configured = false, baseUrl = null, status = "unknown"),
                    integrationJson("mystery"),
                ),
            )
            val store = IntegrationsListStore(server.app)
            val rows = store.await { !it.loading }.rows
            assertEquals(listOf("homeassistant", "paperless", "kept"), rows.map { it.kind })
            assertEquals(tr("integration_status_error"), rows[0].statusText)
            assertEquals(tr("integration_error_tls"), rows[0].detail)
            assertFalse(rows[0].editable)
            assertTrue(rows[1].editable)
            assertEquals(tr("integration_status_not_connected"), rows[2].statusText)
            store.close()
        }

    @Test
    fun aHouseholdConnectionIsReadOnlyForADeviceToken() =
        runTest {
            server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("homeassistant", level = "household")))
            val store = IntegrationConnectionStore(server.app, "homeassistant")
            val state = store.await { !it.loading }
            assertFalse(state.canEdit)
            assertEquals(tr("integration_admin_only"), state.readOnlyNote)
            store.close()
        }

    @Test
    fun savingValidatesTheFormFirst() =
        runTest {
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(integrationJson("paperless", configured = false, baseUrl = null, status = "unknown")),
            )
            val store = IntegrationConnectionStore(server.app, "paperless")
            store.await { !it.loading }
            store.save(IntegrationForm(baseUrl = "docs.example.org", token = "", allowInsecureTls = false, enabled = true))
            val errors = store.value.fieldErrors
            assertEquals(tr("integration_ha_url_invalid"), errors["baseUrl"])
            assertEquals(tr("m_field_required"), errors["token"])
            assertTrue(server.requestsTo("PUT", "/api/v1/integrations/paperless").isEmpty())
            store.close()
        }

    @Test
    fun savingConnectsThenTestsAndReportsTheChange() =
        runTest {
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(integrationJson("paperless", configured = false, baseUrl = null, status = "unknown")),
            )
            val store = IntegrationConnectionStore(server.app, "paperless")
            store.await { !it.loading }
            val saved = integrationJson("paperless", status = "unknown")
            server.on("PUT", "/api/v1/integrations/paperless", saved)
            server.on(
                "POST",
                "/api/v1/integrations/paperless/test",
                """{"ok":true,"error":null,"info":{"version":"2.10","user":"anna"},"integration":${integrationJson("paperless")}}""",
            )
            store.save(IntegrationForm("https://docs.example.org", " secret ", false, true))
            val state = store.await { it.test != null }
            val body = server.requestsTo("PUT", "/api/v1/integrations/paperless").single().json
            assertEquals("secret", body["token"].toString().trim('"'))
            assertEquals(tr("integration_test_ok"), state.test?.title)
            assertEquals(listOf("Paperless-ngx 2.10", tr("integration_paperless_signed_in_as", "user" to "anna")), state.test?.lines)
            assertTrue(state.configured)
            assertEquals(tr("integration_status_ok"), state.statusText)
            store.close()
        }

    @Test
    fun aRejectedAddressShowsOnTheField() =
        runTest {
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(integrationJson("kept", configured = false, baseUrl = null, status = "unknown")),
            )
            val store = IntegrationConnectionStore(server.app, "kept")
            store.await { !it.loading }
            server.onError("PUT", "/api/v1/integrations/kept", HttpStatusCode.Forbidden, "forbidden")
            store.save(IntegrationForm("https://kept.example.org/x", "tok", false, true))
            val state = store.await { !it.saving && it.fieldErrors.isNotEmpty() }
            assertEquals(tr("integration_host_forbidden", "host" to "kept.example.org"), state.fieldErrors["baseUrl"])
            store.close()
        }

    @Test
    fun aFailedTestIsAnOutcomeNotACrash() =
        runTest {
            server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("paperless")))
            val store = IntegrationConnectionStore(server.app, "paperless")
            store.await { !it.loading }
            server.on(
                "POST",
                "/api/v1/integrations/paperless/test",
                """{"ok":false,"error":{"code":"unauthorized","message":"no"},"info":null,"integration":${integrationJson(
                    "paperless",
                    status = "error",
                    lastError = "unauthorized",
                )}}""",
            )
            store.test()
            val state = store.await { it.test != null }
            assertFalse(state.test!!.ok)
            assertEquals(listOf(tr("integration_paperless_error_unauthorized")), state.test?.lines)
            assertEquals(tr("integration_paperless_error_unauthorized"), state.errorText)
            store.close()
        }

    @Test
    fun disconnectingReloadsTheEmptyConnection() =
        runTest {
            server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("kept")))
            val store = IntegrationConnectionStore(server.app, "kept")
            store.await { !it.loading }
            server.on("DELETE", "/api/v1/integrations/kept", "", HttpStatusCode.NoContent)
            server.on(
                "GET",
                "/api/v1/integrations",
                listOfIntegrations(integrationJson("kept", configured = false, baseUrl = null, status = "unknown")),
            )
            store.disconnect()
            val state = store.await { it.notice != null }
            assertFalse(state.configured)
            assertEquals(tr("integration_kept_disconnected"), state.notice)
            store.close()
        }

    @Test
    fun theFinanceSyncListsWhatItDid() =
        runTest {
            server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("kept")))
            val store = IntegrationConnectionStore(server.app, "kept")
            assertTrue(store.await { !it.loading }.canSync)
            server.on("POST", "/api/v1/finance/sync", """{"ok":true,"error":null,"stats":{"suggestions":2,"skipped":0}}""")
            store.syncNow()
            val state = store.await { it.sync != null }
            assertEquals(listOf(tr("integration_kept_stat_suggestions", "count" to 2)), state.sync?.lines)
            store.close()
        }
}

class CalendarTargetsStoreTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
        server.household()
        server.on("GET", "/api/v1/integrations", listOfIntegrations(integrationJson("homeassistant", level = "household")))
    }

    @AfterTest
    fun tearDown() = server.close()

    private fun targets(vararg items: String) =
        server.on("GET", "/api/v1/calendar-targets", """{"items":[${items.joinToString(",")}],"nextCursor":null}""")

    @Test
    fun showsTheHouseholdTargetsReadOnly() =
        runTest {
            targets(calendarTargetJson())
            val store = CalendarTargetsStore(server.app)
            val row = store.await { it.rows.isNotEmpty() }.rows.single()
            assertEquals(tr("caltargets_status_ok"), row.stateText)
            assertFalse(row.canManage)
            assertEquals(listOf(tr("caltargets_kind_appointments"), tr("caltargets_kind_task_due")), row.kinds)
            assertEquals(tr("caltargets_stats_created", "count" to 2), row.lastRun)
            assertEquals("Home Assistant · House · calendar.house", row.where)
            store.close()
        }

    @Test
    fun anErroringTargetSaysWhy() =
        runTest {
            targets(calendarTargetJson(status = "error", lastError = "calendar_missing"))
            val store = CalendarTargetsStore(server.app)
            val row = store.await { it.rows.isNotEmpty() }.rows.single()
            assertEquals(tr("caltargets_status_error"), row.stateText)
            assertEquals(tr("integration_error_calendar_missing"), row.errorText)
            store.close()
        }

    @Test
    fun aManageableTargetCanBeSwitchedAndSynced() =
        runTest {
            targets(calendarTargetJson(canManage = true))
            val store = CalendarTargetsStore(server.app)
            store.await { it.rows.isNotEmpty() }
            server.on("PATCH", "/api/v1/calendar-targets/c1", calendarTargetJson(enabled = false, canManage = true))
            store.setEnabled("c1", false)
            val paused = store.await { it.rows.firstOrNull()?.enabled == false }
            assertEquals(tr("caltargets_status_paused"), paused.rows.single().stateText)

            server.on(
                "POST",
                "/api/v1/calendar-targets/c1/sync",
                """{"ok":true,"error":null,"counts":{"created":1,"updated":0,"replaced":0,"deleted":0,"adopted":0,"forgotten":0,"skipped":0,"failed":0,"unconfirmed":0,"remaining":0},"target":${calendarTargetJson(
                    canManage = true,
                )}}""",
            )
            store.syncNow("c1")
            val done = store.await { it.notice != null }
            assertEquals(tr("caltargets_sync_ok") + ": " + tr("caltargets_stats_created", "count" to 1), done.notice)
            assertFalse(done.rows.single().busy)
            store.close()
        }

    @Test
    fun aRefusedSyncShowsTheErrorAndFreesTheRow() =
        runTest {
            targets(calendarTargetJson(canManage = true))
            val store = CalendarTargetsStore(server.app)
            store.await { it.rows.isNotEmpty() }
            server.onError("POST", "/api/v1/calendar-targets/c1/sync", HttpStatusCode.Forbidden, "forbidden")
            store.syncNow("c1")
            val state = store.await { it.actionError != null }
            assertEquals(tr("m_error_forbidden"), state.actionError)
            assertFalse(state.rows.single().busy)
            store.close()
        }
}

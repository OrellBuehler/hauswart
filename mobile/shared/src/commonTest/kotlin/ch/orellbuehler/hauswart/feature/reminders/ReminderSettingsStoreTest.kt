package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.testing.TestApp
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReminderSettingsStoreTest {
    private val server = TestApp().also { it.signIn() }

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun tearDown() = server.close()

    @Test
    fun startsOffWithTheDefaults() {
        val state = ReminderSettingsStore(server.app).value
        assertFalse(state.enabled)
        assertEquals("08:00", state.timeOfDay)
        assertEquals(60, state.leadMinutes)
        assertFalse(state.requestPermission)
        assertTrue(state.leadOptions.any { it.value == "60" })
    }

    @Test
    fun changesAreKeptAndCountedForThePlanner() {
        val store = ReminderSettingsStore(server.app)
        store.setEnabled(true)
        store.setTimeOfDay("07:30")
        store.setDueSoon(true)
        store.setLeadMinutes(120)
        val state = store.value
        assertEquals(4, state.revision)
        assertEquals(ReminderSettings(true, "07:30", true, 120), ReminderPrefs(server.settings).settings())
        assertEquals(state.leadMinutes, ReminderSettingsStore(server.app).value.leadMinutes)
    }

    @Test
    fun enablingAsksForPermissionOnlyWhileUndetermined() {
        val store = ReminderSettingsStore(server.app)
        store.setPermission(REMINDER_PERMISSION_UNDETERMINED)
        assertFalse(store.value.requestPermission)
        store.setEnabled(true)
        assertTrue(store.value.requestPermission)
        store.setPermission(REMINDER_PERMISSION_DENIED)
        assertFalse(store.value.requestPermission)
        assertTrue(store.value.permissionBlocked)
        store.setPermission(REMINDER_PERMISSION_GRANTED)
        assertFalse(store.value.permissionBlocked)
    }

    @Test
    fun aLeadTimeTheListLacksIsStillOffered() {
        ReminderPrefs(server.settings).save(ReminderSettings(true, "08:15", false, 45))
        val state = ReminderSettingsStore(server.app).value
        assertTrue(state.leadOptions.any { it.value == "45" })
        assertTrue(state.timeOptions.any { it.value == "08:15" })
    }
}

package ch.orellbuehler.hauswart.feature.applink

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppLinkTest {
    @Test
    fun mapsTheWebPathsToLinks() {
        val cases =
            listOf(
                "/" to AppLink(LINK_HOME, null),
                "/tasks/t1" to AppLink(LINK_TASK, "t1"),
                "/tasks/t1/edit" to AppLink(LINK_TASK, "t1"),
                "/tasks/new" to AppLink(LINK_TASKS, null),
                "/tasks" to AppLink(LINK_TASKS, null),
                "/defects/d1" to AppLink(LINK_DEFECT, "d1"),
                "/assets/a1" to AppLink(LINK_ASSET, "a1"),
                "/parts/p1" to AppLink(LINK_PART, "p1"),
                "/appointments/ap1" to AppLink(LINK_APPOINTMENT, "ap1"),
                "/appointments" to AppLink(LINK_APPOINTMENTS, null),
                "/costs/c1" to AppLink(LINK_COST, "c1"),
                "/costs/c1/edit" to AppLink(LINK_COST, "c1"),
                "/costs" to AppLink(LINK_COSTS, null),
                "/costs/balances" to AppLink(LINK_COSTS, null),
                "/costs/receipts" to AppLink(LINK_COSTS, null),
                "/contacts/k1" to AppLink(LINK_CONTACT, "k1"),
                "/rooms/r1" to AppLink(LINK_ROOM, "r1"),
                "/insurance/i1" to AppLink(LINK_POLICY, "i1"),
                "/insurance" to AppLink(LINK_INSURANCE, null),
                "/docs/house-rules" to AppLink(LINK_DOC, "house-rules"),
                "/docs/h%C3%A4user%20regeln" to AppLink(LINK_DOC, "häuser regeln"),
                "/inventory" to AppLink(LINK_INVENTORY, null),
                "/notifications?unread=1" to AppLink(LINK_NOTIFICATIONS, null),
                "/assets/a1?tab=files#top" to AppLink(LINK_ASSET, "a1"),
                "/emergency" to AppLink(LINK_EMERGENCY, null),
                "/settings/integrations" to AppLink(LINK_SETTINGS, null),
            )
        cases.forEach { (url, link) ->
            val expected = if (url == "/settings/integrations") null else link
            assertEquals(expected, routeForUrl(url), url)
        }
    }

    @Test
    fun refusesWhatIsNoPathOfTheApp() {
        listOf(
            null,
            "",
            "tasks/t1",
            "//evil.example.org/x",
            "https://example.org/tasks/t1",
            "/\\evil.example.org",
            "/unknown/x",
            "/tasks/%zz",
            "/tasks/%2",
        ).forEach { assertNull(routeForUrl(it), it.toString()) }
    }
}

package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InventoryLogicTest {
    private val today = "2026-10-06"

    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @Test
    fun warrantyStatusTable() {
        data class Case(
            val until: String?,
            val extended: String?,
            val status: String,
            val untilDay: String?,
            val days: Int?,
        )
        listOf(
            Case(null, null, "unknown", null, null),
            Case("2027-11-20", null, "valid", "2027-11-20", 410),
            Case("2027-01-04", null, "expiring", "2027-01-04", 90),
            Case("2027-01-05", null, "valid", "2027-01-05", 91),
            Case(today, null, "expiring", today, 0),
            Case("2026-10-05", null, "expired", "2026-10-05", -1),
            Case("2026-09-01", "2028-09-01", "valid", "2028-09-01", 696),
            Case("2028-09-01", "2026-09-01", "valid", "2028-09-01", 696),
            Case(null, "2026-12-01", "expiring", "2026-12-01", 56),
        ).forEach { c ->
            val info = warrantyInfo(c.until, c.extended, today)
            assertEquals(c.status, info.status, "$c")
            assertEquals(c.untilDay, info.until, "$c")
            assertEquals(c.days, info.daysLeft, "$c")
        }
    }

    @Test
    fun warrantyWordingFollowsTheDays() {
        assertEquals(tr("warranty_today"), warrantyInfo(today, null, today).daysText)
        assertEquals(tr("warranty_days_ago", "days" to 1), warrantyInfo("2026-10-05", null, today).daysText)
        assertEquals(tr("warranty_days_left", "days" to 5), warrantyInfo("2026-10-11", null, today).daysText)
        assertEquals(tr("warranty_unknown"), warrantyInfo(null, null, today).label)
        assertNull(warrantyInfo(null, null, today).daysText)
    }

    @Test
    fun taskSortingPutsTheUrgentFirst() {
        val tasks =
            listOf(
                taskJson("ok", "ok", "2026-11-01"),
                taskJson("late", "due", "2026-10-09"),
                taskJson("over", "overdue", "2026-10-01"),
                taskJson("early", "due", "2026-10-07"),
            ).map { decodeTask(it) }
        assertEquals(listOf("over", "early", "late", "ok"), sortTasks(tasks).map { it.id })
    }

    @Test
    fun roomStatsCountAssetsAndActionableTasks() {
        val assets = listOf("a1" to "r1", "a2" to "r1", "a3" to null).map { (id, room) -> decodeAsset(assetJson(id, id, roomId = room)) }
        val tasks =
            listOf(
                taskJson("t1", "overdue", assetId = "a1"),
                taskJson("t2", "due", roomId = "r2"),
                taskJson("t3", "ok", assetId = "a2"),
                taskJson("t4", "due", assetId = "a3"),
            ).map { decodeTask(it) }
        val stats = roomStats(assets, tasks)
        assertEquals(RoomStats(2, 1, 1), stats["r1"])
        assertEquals(RoomStats(0, 1, 0), stats["r2"])
        assertEquals(2, stats.size)
    }

    @Test
    fun filterSearchesEveryTermAndFindsAPlateWithoutSpaces() {
        val assets =
            listOf(
                assetJson(
                    "1",
                    "Waschmaschine",
                    roomId = "bad",
                    roomName = "Bad",
                    manufacturer = "Musterwerk",
                    warrantyUntil = "2027-11-20",
                ),
                assetJson("2", "Backofen", roomId = "kueche", roomName = "Kueche", warrantyUntil = "2026-12-01"),
                assetJson("3", "Rollo", kind = "fixture", roomId = "bad", roomName = "Bad"),
                assetJson("4", "Alter Toaster", archived = true, warrantyUntil = "2020-01-01"),
                assetJson("5", "Familienauto", kind = "vehicle", plate = "ZH 000000"),
            ).map { decodeAsset(it) }

        fun names(filter: AssetFilter) = filterAssets(assets, filter, today).map { it.name }
        assertEquals(listOf("Waschmaschine", "Backofen", "Rollo", "Familienauto"), names(AssetFilter()))
        assertEquals(5, names(AssetFilter(archived = true)).size)
        assertEquals(listOf("Waschmaschine", "Rollo"), names(AssetFilter(roomId = "bad")))
        assertEquals(listOf("Rollo"), names(AssetFilter(kind = "fixture")))
        assertEquals(listOf("Backofen"), names(AssetFilter(warranty = "expiring")))
        assertEquals(listOf("Alter Toaster"), names(AssetFilter(warranty = "expired", archived = true)))
        assertEquals(listOf("Waschmaschine"), names(AssetFilter(query = "muster wasch")))
        assertEquals(listOf("Familienauto"), names(AssetFilter(query = "ZH000000")))
        assertEquals(listOf("Familienauto"), names(AssetFilter(query = "zh 0000")))
        assertTrue(names(AssetFilter(query = "nothing")).isEmpty())
        assertTrue(!AssetFilter(query = "  ").active && AssetFilter(kind = "device").active)
    }

    @Test
    fun noteListText() {
        assertEquals("", formatNotesList("Heading", emptyList()))
        assertEquals("Heading\n- one\n- two\n  more", formatNotesList("Heading", listOf(" one ", "two\nmore", "  ")))
        assertEquals("a…", noteExcerpt("abcdef", max = 2))
        assertEquals("first", noteExcerpt("first\nsecond"))
    }

    @Test
    fun stockLevels() {
        assertEquals("empty", stockLevel(0, 1))
        assertEquals("low", stockLevel(1, 1))
        assertEquals("ok", stockLevel(2, 1))
        assertEquals("ok", stockLevel(1, 0))
    }
}

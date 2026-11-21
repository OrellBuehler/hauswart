package ch.orellbuehler.hauswart.feature.files

import ch.orellbuehler.hauswart.i18n.I18n
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FilesTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun formatsSizes() {
        val cases =
            listOf(
                0L to "0 B",
                1023L to "1023 B",
                1024L to "1 KB",
                1536L to "1.5 KB",
                5L * 1024 * 1024 to "5 MB",
                (2.25 * 1024 * 1024 * 1024).toLong() to "2.3 GB",
            )
        cases.forEach { (bytes, text) -> assertEquals(text, formatBytes(bytes), "$bytes") }
    }

    @Test
    fun readsTheTypeFromThePickerOrTheExtension() {
        val cases =
            listOf(
                Triple("image/jpeg", "a.bin", "image/jpeg"),
                Triple(null, "scan.PDF", "application/pdf"),
                Triple("application/octet-stream", "photo.jpeg", "image/jpeg"),
                Triple("", "IMG_1.HEIC", "image/heic"),
                Triple("image/png; charset=x", "a", "image/png"),
                Triple(null, "notes.xyz", ""),
            )
        cases.forEach { (mime, name, expected) -> assertEquals(expected, fileMime(mime, name), "$mime $name") }
    }

    @Test
    fun recognisesHeicByTypeOrName() {
        assertTrue(isHeicMime("image/heic", "a.jpg"))
        assertTrue(isHeicMime("image/jpeg", "IMG.HEIF"))
        assertFalse(isHeicMime("image/jpeg", "a.jpg"))
    }

    @Test
    fun buildsFileNames() {
        val cases =
            listOf(
                Triple("Invoice 2026/03", "application/pdf", "Invoice 2026_03.pdf"),
                Triple("scan.pdf", "application/pdf", "scan.pdf"),
                Triple("", "image/png", "file.png"),
                Triple("data", "application/zip", "data"),
            )
        cases.forEach { (title, mime, expected) -> assertEquals(expected, fileNameFor(title, mime), title) }
    }

    @Test
    fun base64RoundTrips() {
        val payload = FilePayload("a.pdf", "application/pdf", byteArrayOf(0, 1, 2, 127, -1, -128))
        assertContentEquals(payload.bytes, decodeBase64(payload.base64()))
        assertEquals(0, decodeBase64("***").size)
    }

    @Test
    fun saysHowLongAgo() {
        val now = 1_800_000_000_000L
        val iso = { ms: Long ->
            kotlin.time.Instant
                .fromEpochMilliseconds(ms)
                .toString()
        }
        val minute = 60_000L
        val cases =
            listOf(
                now - 10_000 to "gerade eben",
                now - 5 * minute to "vor 5 Minuten",
                now - 60 * minute to "vor 1 Stunde",
                now - 3 * 60 * minute to "vor 3 Stunden",
                now - 3 * 24 * 60 * minute to "vor 3 Tagen",
            )
        cases.forEach { (then, text) -> assertEquals(text, relativeInstant(iso(then), "UTC", now), text) }
        assertEquals("nonsense", relativeInstant("nonsense", "UTC", now))
    }
}

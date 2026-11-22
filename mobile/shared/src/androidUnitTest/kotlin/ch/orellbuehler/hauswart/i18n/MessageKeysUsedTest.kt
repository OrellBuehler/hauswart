package ch.orellbuehler.hauswart.i18n

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MessageKeysUsedTest {
    private val call = Regex("""(?<![\w])(?:tr|I18n\.t|t|L)\(\s*"((?:[^"\\]|\\.)*)"(\s*\+)?""")

    private fun repoRoot(): File {
        var dir: File? = File(checkNotNull(System.getProperty("user.dir"))).absoluteFile
        while (dir != null) {
            if (File(dir, "mobile/settings.gradle.kts").isFile) return dir
            dir = dir.parentFile
        }
        error("repository root not found from ${System.getProperty("user.dir")}")
    }

    private fun filesOf(
        root: File,
        locale: String,
    ): List<File> =
        listOf(File(root, "messages/$locale.json")) +
            File(root, "mobile/messages/$locale").listFiles { f -> f.name.endsWith(".json") }.orEmpty().sortedBy { it.name }

    private fun keysOf(file: File): Set<String> = Json.parseToJsonElement(file.readText()).jsonObject.keys

    @Test
    fun everyLiteralKeyExists() {
        val root = repoRoot()
        val known =
            I18n.locales
                .flatMap { filesOf(root, it) }
                .flatMap { keysOf(it) }
                .toSet()
        val sources =
            listOf("mobile/shared/src", "mobile/androidApp/src", "mobile/iosApp")
                .map { File(root, it) }
                .filter { it.isDirectory }
                .flatMap { dir ->
                    dir
                        .walkTopDown()
                        .onEnter { it.name != "build" && it.name != "Pods" && it.name != "DerivedData" }
                        .filter { it.isFile && (it.extension == "kt" || it.extension == "swift") }
                        .toList()
                }
        val unknown = mutableListOf<String>()
        var checked = 0
        sources.forEach { file ->
            call.findAll(file.readText()).forEach { match ->
                val key = match.groupValues[1]
                if (match.groupValues[2].isNotEmpty() || key.contains('$') || key.contains("\\(")) return@forEach
                checked++
                if (key !in known) unknown += "${file.relativeTo(root).path}: $key"
            }
        }
        assertTrue(unknown.isEmpty(), "Unknown message keys (checked $checked calls):\n" + unknown.joinToString("\n"))
    }

    @Test
    fun generatedMessagesMatchTheFiles() {
        val root = repoRoot()
        I18n.locales.forEach { locale ->
            val expected =
                filesOf(root, locale)
                    .flatMap { file ->
                        Json
                            .parseToJsonElement(file.readText())
                            .jsonObject
                            .map { it.key to it.value.jsonPrimitive.content }
                    }.toMap()
            assertEquals(expected, GeneratedMessages.load(locale), locale)
        }
    }
}

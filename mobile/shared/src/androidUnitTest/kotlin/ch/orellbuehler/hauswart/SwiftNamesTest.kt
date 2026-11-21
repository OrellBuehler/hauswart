package ch.orellbuehler.hauswart

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Swift is compiled only by CI. Two mistakes are cheap to catch here: the same top-level type
 * declared in two Swift files, and a Swift type named like a class of the shared module (both are
 * visible in every Swift file, so the name becomes ambiguous).
 */
class SwiftNamesTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "mobile/settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repository root not found")
    }

    private val swiftType = Regex("""^(?:final )?(?:struct|class|enum|protocol|actor) ([A-Za-z0-9_]+)""")
    private val kotlinType = Regex("""^(?:data |sealed |abstract |open |enum )*(?:class|object|interface) ([A-Za-z0-9_]+)""")

    private fun declarations(
        dir: File,
        extension: String,
        pattern: Regex,
    ): List<Pair<String, String>> =
        dir
            .walkTopDown()
            .filter { it.isFile && it.extension == extension && !it.path.contains("/build/") }
            .flatMap { file -> file.readLines().mapNotNull { line -> pattern.find(line)?.let { it.groupValues[1] to file.name } } }
            .toList()

    @Test
    fun swiftTypeNamesAreUniqueAndDoNotShadowSharedClasses() {
        val root = repoRoot()
        val swift = declarations(File(root, "mobile/iosApp/Hauswart"), "swift", swiftType)
        val kotlin = declarations(File(root, "mobile/shared/src/commonMain"), "kt", kotlinType).map { it.first }.toSet()
        val problems =
            swift.groupBy({ it.first }, { it.second }).filter { it.value.size > 1 }.map { "${it.key} is declared in ${it.value}" } +
                swift.filter { it.first in kotlin }.map { "${it.first} (${it.second}) is also a class of the shared module" }
        assertTrue(problems.isEmpty(), problems.joinToString("\n"))
    }
}

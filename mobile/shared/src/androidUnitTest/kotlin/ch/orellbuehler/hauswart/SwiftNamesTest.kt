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

    private val facadeCall = Regex("""\b([A-Z][A-Za-z0-9]*)Kt\.([A-Za-z_][A-Za-z0-9_]*)""")

    /** `FooKt.bar` in Swift is the top-level `bar` of `Foo.kt`: it breaks silently when `bar` moves to another file. */
    @Test
    fun swiftCallsOfTopLevelKotlinDeclarationsResolve() {
        val root = repoRoot()
        val kotlinFiles =
            File(root, "mobile/shared/src")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" && (it.path.contains("/commonMain/") || it.path.contains("/iosMain/")) }
                .groupBy { it.nameWithoutExtension }
        val problems = mutableListOf<String>()
        File(root, "mobile/iosApp/Hauswart").walkTopDown().filter { it.isFile && it.extension == "swift" }.forEach { swift ->
            facadeCall.findAll(swift.readText()).forEach { match ->
                val (file, name) = match.destructured
                val sources = kotlinFiles[file]
                val declared =
                    sources?.any { source ->
                        source.readLines().any { line ->
                            Regex(
                                """^(?:internal |public )?(?:const |inline |suspend )*(?:fun|val|var) (?:<[^>]+> )?(?:[A-Za-z0-9_<>?., ]+\.)?$name\b""",
                            ).containsMatchIn(line)
                        }
                    } ?: false
                if (!declared) problems += "${swift.name}: ${file}Kt.$name" + if (sources == null) " ($file.kt does not exist)" else ""
            }
        }
        assertTrue(
            problems.isEmpty(),
            "Swift refers to top-level Kotlin declarations that are not there:\n" + problems.distinct().joinToString("\n"),
        )
    }

    /**
     * Objective-C treats methods named `new...`, `init...`, `alloc...` and `copy...` specially, and
     * Kotlin/Native exports such a function under another name: Swift does not find it.
     */
    @Test
    fun swiftCallsNoKotlinFunctionOfASpecialObjectiveCFamily() {
        val call = Regex("""\b(?:store|model\.store|sync)\.((?:new|init|alloc|copy|mutableCopy)[A-Z][A-Za-z0-9]*)\(""")
        val problems =
            File(repoRoot(), "mobile/iosApp/Hauswart")
                .walkTopDown()
                .filter { it.isFile && it.extension == "swift" }
                .flatMap { file -> call.findAll(file.readText()).map { "${file.name}: ${it.groupValues[1]}" } }
                .toList()
        assertTrue(
            problems.isEmpty(),
            "Rename these store functions (for example blankForm instead of newForm):\n" + problems.joinToString("\n"),
        )
    }
}

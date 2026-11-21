plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.skie)
    alias(libs.plugins.kover)
}

abstract class GenerateMessages : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val webDe: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val webEn: RegularFileProperty

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val mobileDe: DirectoryProperty

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val mobileEn: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @TaskAction
    fun generate() {
        val web = mapOf("de" to load(webDe.get().asFile), "en" to load(webEn.get().asFile))
        val mobile = mapOf("de" to loadAll(mobileDe.get().asFile), "en" to loadAll(mobileEn.get().asFile))
        val problems = mutableListOf<String>()
        mobile.forEach { (locale, messages) ->
            messages.keys.forEach { key ->
                if (!key.startsWith("m_")) problems += "mobile key '$key' ($locale) lacks the m_ prefix"
                if (key in web.getValue(locale) || key in web.getValue(if (locale == "de") "en" else "de")) {
                    problems += "mobile key '$key' ($locale) collides with a web key"
                }
            }
        }
        (mobile.getValue("de").keys - mobile.getValue("en").keys).forEach { problems += "mobile key '$it' exists only in de" }
        (mobile.getValue("en").keys - mobile.getValue("de").keys).forEach { problems += "mobile key '$it' exists only in en" }
        if (problems.isNotEmpty()) throw GradleException("Invalid message files:\n" + problems.joinToString("\n"))

        val file = File(output.get().asFile, "ch/orellbuehler/hauswart/i18n/GeneratedMessages.kt")
        file.parentFile.mkdirs()
        file.writeText(
            buildString {
                appendLine(
                    "// Generated from messages/*.json and mobile/messages/*/*.json by the generateMessages Gradle task. Do not edit.",
                )
                appendLine("package ch.orellbuehler.hauswart.i18n")
                appendLine()
                appendLine("internal object GeneratedMessages {")
                appendLine("    fun load(locale: String): Map<String, String> =")
                appendLine("        when (locale) {")
                appendLine("            \"de\" -> parse(DE)")
                appendLine("            \"en\" -> parse(EN)")
                appendLine("            else -> emptyMap()")
                appendLine("        }")
                appendLine()
                appendLine("    private fun parse(chunks: List<String>): Map<String, String> {")
                appendLine("        val result = HashMap<String, String>()")
                appendLine("        for (chunk in chunks) {")
                appendLine("            for (line in chunk.split('\\n')) {")
                appendLine("                if (line.isEmpty()) continue")
                appendLine("                val tab = line.indexOf('\\t')")
                appendLine("                result[line.substring(0, tab)] = unescape(line.substring(tab + 1))")
                appendLine("            }")
                appendLine("        }")
                appendLine("        return result")
                appendLine("    }")
                appendLine()
                appendLine("    private fun unescape(value: String): String {")
                appendLine("        if (value.indexOf('\\\\') < 0) return value")
                appendLine("        val out = StringBuilder(value.length)")
                appendLine("        var i = 0")
                appendLine("        while (i < value.length) {")
                appendLine("            val c = value[i]")
                appendLine("            if (c == '\\\\' && i + 1 < value.length) {")
                appendLine("                i++")
                appendLine("                when (value[i]) {")
                appendLine("                    'n' -> out.append('\\n')")
                appendLine("                    't' -> out.append('\\t')")
                appendLine("                    'r' -> out.append('\\r')")
                appendLine("                    else -> out.append(value[i])")
                appendLine("                }")
                appendLine("            } else {")
                appendLine("                out.append(c)")
                appendLine("            }")
                appendLine("            i++")
                appendLine("        }")
                appendLine("        return out.toString()")
                appendLine("    }")
                listOf("de", "en").forEach { locale ->
                    val merged = (web.getValue(locale) + mobile.getValue(locale)).toSortedMap()
                    val chunks = chunk(merged)
                    appendLine()
                    appendLine("    private val ${locale.uppercase()}: List<String> =")
                    appendLine("        listOf(")
                    chunks.forEach { lines ->
                        appendLine("            " + lines.joinToString(" +\n                ") { "\"$it\"" } + ",")
                    }
                    appendLine("        )")
                }
                appendLine("}")
            },
        )
    }

    // One file per feature (messages/de/<feature>.json), so features do not edit the same file.
    private fun loadAll(dir: File): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty().sortedBy { it.name }.forEach { file ->
            load(file).forEach { (key, value) ->
                if (result.put(key, value) != null) throw GradleException("${file.path}: '$key' is defined in two files")
            }
        }
        return result
    }

    private fun load(file: File): Map<String, String> {
        val parsed = groovy.json.JsonSlurper().parseText(file.readText(Charsets.UTF_8))
        if (parsed !is Map<*, *>) throw GradleException("${file.name} is not a JSON object")
        val result = LinkedHashMap<String, String>()
        parsed.forEach { (key, value) ->
            if (key == "\$schema") return@forEach
            if (key !is String || value !is String) throw GradleException("${file.path}: '$key' is not a string entry")
            result[key] = value
        }
        return result
    }

    // One literal stays far below the 65535-byte constant pool limit: a chunk is cut at 30000 bytes.
    private fun chunk(messages: Map<String, String>): List<List<String>> {
        val chunks = mutableListOf<MutableList<String>>()
        var size = 0
        messages.forEach { (key, value) ->
            val line = kotlinLiteral(key) + "\\t" + kotlinLiteral(escapeValue(value)) + "\\n"
            val bytes = line.toByteArray(Charsets.UTF_8).size
            if (chunks.isEmpty() || size + bytes > 30000) {
                chunks += mutableListOf<String>()
                size = 0
            }
            chunks.last() += line
            size += bytes
        }
        return chunks
    }

    private fun escapeValue(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace("\t", "\\t")
            .replace("\r", "\\r")

    private fun kotlinLiteral(text: String): String = text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\$", "\\\$")
}

val generateMessages =
    tasks.register<GenerateMessages>("generateMessages") {
        webDe.set(rootProject.layout.projectDirectory.file("../messages/de.json"))
        webEn.set(rootProject.layout.projectDirectory.file("../messages/en.json"))
        mobileDe.set(rootProject.layout.projectDirectory.dir("messages/de"))
        mobileEn.set(rootProject.layout.projectDirectory.dir("messages/en"))
        output.set(layout.buildDirectory.dir("generated/messages/commonMain/kotlin"))
    }

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach {
        it.binaries.framework {
            baseName = "shared"
            isStatic = true
        }
    }

    sourceSets {
        commonMain {
            kotlin.srcDir(generateMessages.flatMap { it.output })
        }
        commonMain.dependencies {
            implementation(libs.ktor.client.core)
            implementation(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
            implementation(libs.turbine)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            implementation(libs.kotlinx.coroutines.android)
            implementation(libs.security.crypto)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
    }
}

android {
    namespace = "ch.orellbuehler.hauswart.shared"
    compileSdk = 37
    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

skie {
    analytics {
        enabled.set(false)
    }
}

kover {
    reports {
        filters {
            excludes {
                packages("ch.orellbuehler.hauswart.api.generated")
            }
        }
    }
}

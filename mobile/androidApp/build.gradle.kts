plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.compose.compiler)
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    sourceSets {
        androidMain.dependencies {
            implementation(project(":shared"))
            implementation(libs.kotlinx.serialization.json)
        }
    }
}

val appVersion = (findProperty("APP_VERSION") as? String)?.trimStart('v') ?: "dev"
val buildNumber = (findProperty("BUILD_NUMBER") as? String)?.toIntOrNull() ?: 0

// versionCode must strictly increase across every Play upload, including re-runs for the same
// tag, so the workflow run number is folded in; both terms only ever grow.
val computedVersionCode =
    if (appVersion != "dev") {
        val parts = appVersion.split(".").map { it.toIntOrNull() ?: 0 }
        val semverCode = parts.getOrElse(0) { 0 } * 10000 + parts.getOrElse(1) { 0 } * 100 + parts.getOrElse(2) { 0 }
        (semverCode * 1000 + buildNumber).coerceAtLeast(1)
    } else {
        1
    }

android {
    namespace = "ch.orellbuehler.hauswart.android"
    compileSdk {
        version =
            release(37) {
                minorApiLevel = 1
            }
    }

    defaultConfig {
        applicationId = "ch.orellbuehler.hauswart"
        minSdk = 26
        targetSdk = 36
        versionCode = computedVersionCode
        versionName = appVersion
    }

    // Signed when the release workflow provides a keystore; without one the release build is
    // unsigned, which the workflow keeps as an artifact only.
    val keystoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        abortOnError = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }

    dependencies {
        implementation(platform(libs.compose.bom))
        implementation(libs.compose.ui)
        implementation(libs.compose.ui.tooling.preview)
        implementation(libs.compose.material3)
        implementation(libs.compose.material.icons)
        implementation(libs.compose.navigation)
        implementation(libs.activity.compose)
        implementation(libs.lifecycle.runtime.compose)
        implementation(libs.lifecycle.viewmodel.compose)
        implementation(libs.kotlinx.coroutines.android)
        implementation(libs.work.runtime)
        debugImplementation(libs.compose.ui.tooling)
        testImplementation(libs.kotlin.test)
        testImplementation(libs.kotlin.test.junit)
        testImplementation(libs.kotlinx.coroutines.test)
    }
}

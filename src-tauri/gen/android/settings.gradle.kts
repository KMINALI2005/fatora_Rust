pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "dashboard-calc"
include(":app")

// الكود الذكي لاستدعاء إعدادات توري (بصيغة Kotlin الصحيحة)
val tauriSettings = file("./tauri.settings.gradle")
if (tauriSettings.exists()) {
    apply(from = tauriSettings)
} else {
    println("Warning: tauri.settings.gradle not found in settings!")
}

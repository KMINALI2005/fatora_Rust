pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "fatora_app"
include(":app")

// الكود الذكي للتعامل مع ملف توري المولد
val tauriSettings = file("./tauri.settings.gradle")
if (tauriSettings.exists()) {
    apply(from = tauriSettings)
} else {
    println("Note: tauri.settings.gradle not found, skipping inclusion.")
}

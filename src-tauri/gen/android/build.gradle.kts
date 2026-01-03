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

// هذا السطر سيبحث عن ملف الإعدادات المولد بواسطة توري في بيئة الجيتهاب
val tauriSettings = file("./tauri.settings.gradle")
if (tauriSettings.exists()) {
    apply(from = tauriSettings)
}

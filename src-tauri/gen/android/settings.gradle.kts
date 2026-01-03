pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    // تم تغيير FAIL_ON_PROJECT_REPOS إلى PREFER_SETTINGS لضمان مرونة أكبر في العثور على مكتبات توري
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "fatora_app"
include(":app")

// التحقق من وجود الملف قبل محاولة تطبيقه لتجنب فشل البناء
val tauriSettings = file("./tauri.settings.gradle")
if (tauriSettings.exists()) {
    apply(from = tauriSettings)
} else {
    logger.warn("Warning: tauri.settings.gradle not found. This is normal during first sync.")
}

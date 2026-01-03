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

// 👇 هذا السطر هو الذي يجعل MainActivity يتعرف على Tauri
apply(from = "./tauri.settings.gradle")

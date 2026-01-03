buildscript {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.2.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.20")
        classpath("org.mozilla.rust-android-gradle:plugin:0.9.3")
    }
}

task<Delete>("clean") {
    delete(rootProject.buildDir)
}

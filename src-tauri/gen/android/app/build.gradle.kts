import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("../tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.abujafar.fatora"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.abujafar.fatora"
        minSdk = 24
        targetSdk = 34
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = file("final_key.keystore")
            storePassword = "123456"
            keyAlias = "fatora_alias"
            keyPassword = "123456"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
                "../proguard-tauri.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    // ربط المشاريع المولدة ديناميكياً
    implementation(project(":tauri-android"))
    
    // إضافات Tauri الضرورية (Plugins)
    implementation(project(":tauri-plugin-dialog"))
    implementation(project(":tauri-plugin-fs"))
    implementation(project(":tauri-plugin-share"))

    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.9.0")
    implementation("androidx.webkit:webkit:1.10.0")
}

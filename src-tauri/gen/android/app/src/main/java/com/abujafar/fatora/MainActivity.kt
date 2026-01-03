package com.abujafar.fatora

import android.os.Bundle
import app.tauri.android.TauriActivity

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // تم حذف enableEdgeToEdge() لضمان نجاح البناء
  }
}

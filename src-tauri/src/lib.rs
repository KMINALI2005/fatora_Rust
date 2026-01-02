#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // تفعيل الإضافات هنا
        .plugin(tauri_plugin_fs::init())    // للملفات
        .plugin(tauri_plugin_share::init()) // للمشاركة
        .plugin(tauri_plugin_os::init())    // للنظام
        .plugin(tauri_plugin_dialog::init()) // للنوافذ
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

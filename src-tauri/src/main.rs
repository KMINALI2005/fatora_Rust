// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

// هذه الدالة هي التي ستستقبل النص من الواجهة وتعيد النتيجة
#[command]
fn calculate(expression: String) -> String {
    // محاولة حل المعادلة الرياضية باستخدام مكتبة meval
    match meval::eval_str(&expression) {
        Ok(result) => result.to_string(),
        Err(_) => "Error".to_string(),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![calculate])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

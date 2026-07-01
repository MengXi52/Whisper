// 轻语 - AI写作助手 Tauri 入口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    whisper_lib::run()
}

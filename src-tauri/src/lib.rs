mod commands;
mod db;
mod llm;
mod models;

use db::DbState;
use llm::client::CancellationTokenState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据库
    let conn = db::init_db().expect("数据库初始化失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState(std::sync::Mutex::new(conn)))
        .manage(CancellationTokenState(std::sync::Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![
            // 聊天命令
            commands::chat::send_message,
            commands::chat::abort_generation,
            commands::chat::get_messages,
            commands::chat::create_conversation,
            commands::chat::delete_conversation,
            // 项目命令
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::create_chapter,
            commands::project::list_chapters,
            commands::project::update_chapter,
            commands::project::delete_chapter,
            commands::project::reorder_chapters,
            // 设定卡命令
            commands::settings::create_setting_card,
            commands::settings::list_setting_cards,
            commands::settings::update_setting_card,
            commands::settings::delete_setting_card,
            commands::settings::create_setting_card_version,
            commands::settings::list_setting_card_versions,
            commands::settings::rollback_setting_card,
            commands::settings::export_setting_cards,
            commands::settings::import_setting_cards,
            // 技能命令
            commands::skill::list_skills,
            commands::skill::activate_skill,
            commands::skill::deactivate_skill,
            // 导出命令
            commands::export::export_chapter_txt,
            commands::export::export_chapter_markdown,
            commands::export::export_project_docx,
            // API配置命令
            commands::config::save_api_config,
            commands::config::list_api_configs,
            commands::config::delete_api_config,
            commands::config::set_default_api_config,
        ])
        .run(tauri::generate_context!())
        .expect("启动Tauri应用失败");
}

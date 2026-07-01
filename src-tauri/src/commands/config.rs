use crate::db::DbState;
use crate::models::ApiConfig;
use tauri::State;

/// 保存 API 配置
#[tauri::command]
pub fn save_api_config(
    db: State<'_, DbState>,
    id: Option<String>,
    name: String,
    base_url: String,
    api_key: String,
    model_thinking: String,
    model_writing: String,
    is_default: bool,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 如果设为默认，先取消其他默认
    if is_default {
        conn.execute("UPDATE api_configs SET is_default = 0", [])
            .map_err(|e| format!("清除默认配置失败: {}", e))?;
    }

    match id {
        Some(config_id) => {
            // 更新已有配置
            conn.execute(
                "UPDATE api_configs SET name = ?1, base_url = ?2, api_key = ?3, model_thinking = ?4, model_writing = ?5, is_default = ?6 WHERE id = ?7",
                rusqlite::params![name, base_url, api_key, model_thinking, model_writing, is_default, config_id],
            ).map_err(|e| format!("更新API配置失败: {}", e))?;
            Ok(config_id)
        }
        None => {
            // 创建新配置
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO api_configs (id, name, base_url, api_key, model_thinking, model_writing, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![new_id, name, base_url, api_key, model_thinking, model_writing, is_default],
            ).map_err(|e| format!("创建API配置失败: {}", e))?;
            Ok(new_id)
        }
    }
}

/// 获取所有 API 配置
#[tauri::command]
pub fn list_api_configs(db: State<'_, DbState>) -> Result<Vec<ApiConfig>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, base_url, api_key, model_thinking, model_writing, is_default FROM api_configs ORDER BY name ASC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ApiConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                model_thinking: row.get(4)?,
                model_writing: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| format!("查询API配置失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取API配置失败: {}", e))
}

/// 删除 API 配置
#[tauri::command]
pub fn delete_api_config(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM api_configs WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除API配置失败: {}", e))?;
    Ok(())
}

/// 设置默认 API 配置
#[tauri::command]
pub fn set_default_api_config(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    // 先清除所有默认
    conn.execute("UPDATE api_configs SET is_default = 0", [])
        .map_err(|e| format!("清除默认配置失败: {}", e))?;
    // 设置指定配置为默认
    conn.execute(
        "UPDATE api_configs SET is_default = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("设置默认配置失败: {}", e))?;
    Ok(())
}

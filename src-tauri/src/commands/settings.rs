use crate::db::DbState;
use crate::models::{SettingCard, SettingCardVersion};
use tauri::State;

/// 创建设定卡
#[tauri::command]
pub fn create_setting_card(
    db: State<'_, DbState>,
    project_id: String,
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO setting_cards (id, project_id, card_type, name, fields, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, project_id, card_type, name, fields, now, now],
    ).map_err(|e| format!("创建设定卡失败: {}", e))?;

    // 创建初始版本快照
    let version_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![version_id, id, fields, now],
    ).map_err(|e| format!("创建设定卡版本失败: {}", e))?;

    Ok(id)
}

/// 获取项目的设定卡列表
#[tauri::command]
pub fn list_setting_cards(
    db: State<'_, DbState>,
    project_id: String,
    card_type: Option<String>,
) -> Result<Vec<SettingCard>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    let rows = if let Some(ct) = card_type {
        let mut stmt = conn
            .prepare("SELECT id, project_id, card_type, name, fields, created_at, updated_at FROM setting_cards WHERE project_id = ?1 AND card_type = ?2 ORDER BY updated_at DESC")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id, ct], |row| {
                Ok(SettingCard {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    card_type: row.get(2)?,
                    name: row.get(3)?,
                    fields: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询设定卡失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取设定卡失败: {}", e))?
    } else {
        let mut stmt = conn
            .prepare("SELECT id, project_id, card_type, name, fields, created_at, updated_at FROM setting_cards WHERE project_id = ?1 ORDER BY updated_at DESC")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |row| {
                Ok(SettingCard {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    card_type: row.get(2)?,
                    name: row.get(3)?,
                    fields: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询设定卡失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取设定卡失败: {}", e))?
    };

    Ok(rows)
}

/// 更新设定卡
#[tauri::command]
pub fn update_setting_card(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    fields: Option<String>,
    card_type: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前值
    let current: SettingCard = conn
        .query_row(
            "SELECT id, project_id, card_type, name, fields, created_at, updated_at FROM setting_cards WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(SettingCard {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    card_type: row.get(2)?,
                    name: row.get(3)?,
                    fields: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| format!("查询设定卡失败: {}", e))?;

    let new_name = name.unwrap_or(current.name);
    let new_fields = fields.unwrap_or(current.fields);
    let new_card_type = card_type.unwrap_or(current.card_type);

    conn.execute(
        "UPDATE setting_cards SET name = ?1, fields = ?2, card_type = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![new_name, new_fields, new_card_type, now, id],
    ).map_err(|e| format!("更新设定卡失败: {}", e))?;

    // 自动创建版本快照
    let version_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![version_id, id, new_fields, now],
    ).map_err(|e| format!("创建版本快照失败: {}", e))?;

    Ok(())
}

/// 删除设定卡
#[tauri::command]
pub fn delete_setting_card(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM setting_cards WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除设定卡失败: {}", e))?;
    Ok(())
}

/// 创建设定卡版本（手动）
#[tauri::command]
pub fn create_setting_card_version(
    db: State<'_, DbState>,
    card_id: String,
    fields: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, card_id, fields, now],
    ).map_err(|e| format!("创建设定卡版本失败: {}", e))?;

    Ok(id)
}

/// 获取设定卡版本历史
#[tauri::command]
pub fn list_setting_card_versions(
    db: State<'_, DbState>,
    card_id: String,
) -> Result<Vec<SettingCardVersion>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, card_id, fields, created_at FROM setting_card_versions WHERE card_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![card_id], |row| {
            Ok(SettingCardVersion {
                id: row.get(0)?,
                card_id: row.get(1)?,
                fields: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("查询版本历史失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取版本历史失败: {}", e))
}

/// 回滚设定卡到指定版本
#[tauri::command]
pub fn rollback_setting_card(
    db: State<'_, DbState>,
    card_id: String,
    version_id: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取目标版本的 fields
    let fields: String = conn
        .query_row(
            "SELECT fields FROM setting_card_versions WHERE id = ?1 AND card_id = ?2",
            rusqlite::params![version_id, card_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("获取版本内容失败: {}", e))?;

    // 更新设定卡
    conn.execute(
        "UPDATE setting_cards SET fields = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![fields, now, card_id],
    )
    .map_err(|e| format!("回滚设定卡失败: {}", e))?;

    // 创建回滚版本快照
    let new_version_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![new_version_id, card_id, fields, now],
    ).map_err(|e| format!("创建回滚版本快照失败: {}", e))?;

    Ok(())
}

/// 导出设定卡为 JSON 字符串
#[tauri::command]
pub fn export_setting_cards(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, card_type, name, fields, created_at, updated_at FROM setting_cards WHERE project_id = ?1")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(SettingCard {
                id: row.get(0)?,
                project_id: row.get(1)?,
                card_type: row.get(2)?,
                name: row.get(3)?,
                fields: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("查询设定卡失败: {}", e))?;
    let cards: Vec<SettingCard> =
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取设定卡失败: {}", e))?;

    serde_json::to_string_pretty(&cards).map_err(|e| format!("序列化设定卡失败: {}", e))
}

/// 从 JSON 字符串导入设定卡
#[tauri::command]
pub fn import_setting_cards(
    db: State<'_, DbState>,
    project_id: String,
    json_data: String,
) -> Result<usize, String> {
    let cards: Vec<serde_json::Value> =
        serde_json::from_str(&json_data).map_err(|e| format!("解析JSON失败: {}", e))?;

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut count = 0;

    for card_value in cards {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let card_type = card_value["card_type"]
            .as_str()
            .unwrap_or("character")
            .to_string();
        let name = card_value["name"].as_str().unwrap_or("").to_string();
        let fields = card_value["fields"].to_string();

        if name.is_empty() {
            continue;
        }

        conn.execute(
            "INSERT INTO setting_cards (id, project_id, card_type, name, fields, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, project_id, card_type, name, fields, now, now],
        ).map_err(|e| format!("导入设定卡失败: {}", e))?;

        // 创建初始版本快照
        let version_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![version_id, id, fields, now],
        ).map_err(|e| format!("创建版本快照失败: {}", e))?;

        count += 1;
    }

    Ok(count)
}

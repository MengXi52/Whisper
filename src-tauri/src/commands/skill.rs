use crate::db::DbState;
use crate::models::Skill;
use tauri::State;

/// 获取所有技能列表
#[tauri::command]
pub fn list_skills(db: State<'_, DbState>) -> Result<Vec<Skill>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, system_prompt, tools, trigger_scenarios, is_builtin, created_at FROM skills ORDER BY created_at ASC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                system_prompt: row.get(3)?,
                tools: row.get(4)?,
                trigger_scenarios: row.get(5)?,
                is_builtin: row.get::<_, i64>(6)? != 0,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("查询技能失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取技能失败: {}", e))
}

/// 激活技能（将技能ID添加到会话的 skill_ids 中）
#[tauri::command]
pub fn activate_skill(
    db: State<'_, DbState>,
    conversation_id: String,
    skill_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前 skill_ids
    let skill_ids_str: String = conn
        .query_row(
            "SELECT skill_ids FROM conversations WHERE id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询会话失败: {}", e))?;

    let mut skill_ids: Vec<String> = serde_json::from_str(&skill_ids_str)
        .map_err(|e| format!("解析技能ID列表失败: {}", e))?;

    if !skill_ids.contains(&skill_id) {
        skill_ids.push(skill_id);
    }

    let new_skill_ids_str = serde_json::to_string(&skill_ids)
        .map_err(|e| format!("序列化技能ID失败: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE conversations SET skill_ids = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_skill_ids_str, now, conversation_id],
    )
    .map_err(|e| format!("激活技能失败: {}", e))?;

    Ok(())
}

/// 停用技能（从会话的 skill_ids 中移除）
#[tauri::command]
pub fn deactivate_skill(
    db: State<'_, DbState>,
    conversation_id: String,
    skill_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前 skill_ids
    let skill_ids_str: String = conn
        .query_row(
            "SELECT skill_ids FROM conversations WHERE id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询会话失败: {}", e))?;

    let mut skill_ids: Vec<String> = serde_json::from_str(&skill_ids_str)
        .map_err(|e| format!("解析技能ID列表失败: {}", e))?;

    skill_ids.retain(|id| id != &skill_id);

    let new_skill_ids_str = serde_json::to_string(&skill_ids)
        .map_err(|e| format!("序列化技能ID失败: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE conversations SET skill_ids = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![new_skill_ids_str, now, conversation_id],
    )
    .map_err(|e| format!("停用技能失败: {}", e))?;

    Ok(())
}

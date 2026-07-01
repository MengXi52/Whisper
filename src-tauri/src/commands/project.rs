use crate::db::DbState;
use crate::models::{Chapter, Project};
use tauri::State;

/// 创建项目
#[tauri::command]
pub fn create_project(
    db: State<'_, DbState>,
    name: String,
    description: String,
    genre: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO projects (id, name, description, genre, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, description, genre, now, now],
    ).map_err(|e| format!("创建项目失败: {}", e))?;

    Ok(id)
}

/// 获取所有项目列表
#[tauri::command]
pub fn list_projects(db: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, genre, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                genre: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("查询项目失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取项目失败: {}", e))
}

/// 获取单个项目
#[tauri::command]
pub fn get_project(db: State<'_, DbState>, id: String) -> Result<Project, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.query_row(
        "SELECT id, name, description, genre, created_at, updated_at FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                genre: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    ).map_err(|e| format!("获取项目失败: {}", e))
}

/// 更新项目
#[tauri::command]
pub fn update_project(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    genre: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前值
    let current: Project = conn
        .query_row(
            "SELECT id, name, description, genre, created_at, updated_at FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    genre: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| format!("查询项目失败: {}", e))?;

    let new_name = name.unwrap_or(current.name);
    let new_desc = description.unwrap_or(current.description);
    let new_genre = genre.unwrap_or(current.genre);

    conn.execute(
        "UPDATE projects SET name = ?1, description = ?2, genre = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![new_name, new_desc, new_genre, now, id],
    ).map_err(|e| format!("更新项目失败: {}", e))?;

    Ok(())
}

/// 删除项目
#[tauri::command]
pub fn delete_project(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除项目失败: {}", e))?;
    Ok(())
}

/// 创建章节
#[tauri::command]
pub fn create_chapter(
    db: State<'_, DbState>,
    project_id: String,
    parent_id: Option<String>,
    title: String,
    sort_order: Option<i64>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // 获取当前最大排序号
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let max_order: i64 = if let Some(pid) = &parent_id {
        conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM chapters WHERE project_id = ?1 AND parent_id = ?2",
            rusqlite::params![project_id, pid],
            |row| row.get(0),
        ).unwrap_or(0)
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM chapters WHERE project_id = ?1 AND parent_id IS NULL",
            rusqlite::params![project_id],
            |row| row.get(0),
        ).unwrap_or(0)
    };

    let order = sort_order.unwrap_or(max_order + 1);

    conn.execute(
        "INSERT INTO chapters (id, project_id, parent_id, title, content, sort_order, status, word_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, project_id, parent_id, title, "", order, "draft", 0, now, now],
    ).map_err(|e| format!("创建章节失败: {}", e))?;

    Ok(id)
}

/// 获取项目的章节列表
#[tauri::command]
pub fn list_chapters(db: State<'_, DbState>, project_id: String) -> Result<Vec<Chapter>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, parent_id, title, content, sort_order, status, word_count, created_at, updated_at FROM chapters WHERE project_id = ?1 ORDER BY sort_order ASC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                parent_id: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                sort_order: row.get(5)?,
                status: row.get(6)?,
                word_count: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("查询章节失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取章节失败: {}", e))
}

/// 更新章节
#[tauri::command]
pub fn update_chapter(
    db: State<'_, DbState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    status: Option<String>,
    parent_id: Option<Option<String>>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前值
    let current: Chapter = conn
        .query_row(
            "SELECT id, project_id, parent_id, title, content, sort_order, status, word_count, created_at, updated_at FROM chapters WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Chapter {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    title: row.get(3)?,
                    content: row.get(4)?,
                    sort_order: row.get(5)?,
                    status: row.get(6)?,
                    word_count: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|e| format!("查询章节失败: {}", e))?;

    let new_title = title.unwrap_or(current.title);
    let new_content = content.unwrap_or(current.content);
    let new_status = status.unwrap_or(current.status);
    let new_parent_id = parent_id.unwrap_or(current.parent_id);

    // 计算字数（中文字符按1个字计算）
    let word_count = new_content.chars().count() as i64;

    conn.execute(
        "UPDATE chapters SET title = ?1, content = ?2, status = ?3, parent_id = ?4, word_count = ?5, updated_at = ?6 WHERE id = ?7",
        rusqlite::params![new_title, new_content, new_status, new_parent_id, word_count, now, id],
    ).map_err(|e| format!("更新章节失败: {}", e))?;

    Ok(())
}

/// 删除章节
#[tauri::command]
pub fn delete_chapter(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM chapters WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除章节失败: {}", e))?;
    Ok(())
}

/// 重新排序章节
#[tauri::command]
pub fn reorder_chapters(
    db: State<'_, DbState>,
    chapter_orders: Vec<(String, i64)>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    for (chapter_id, sort_order) in chapter_orders {
        conn.execute(
            "UPDATE chapters SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![sort_order, chapter_id],
        )
        .map_err(|e| format!("更新章节排序失败: {}", e))?;
    }
    Ok(())
}

use crate::db::{self, DbState};
use std::fs;
use std::path::PathBuf;
use tauri::State;

/// 导出章节为 TXT 文件
#[tauri::command]
pub fn export_chapter_txt(
    db: State<'_, DbState>,
    chapter_id: String,
    file_path: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    let (title, content): (String, String) = conn
        .query_row(
            "SELECT title, content FROM chapters WHERE id = ?1",
            rusqlite::params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("查询章节失败: {}", e))?;

    let output = format!("{}\n\n{}", title, content);

    let save_path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let dir = db::get_exports_dir()?;
            dir.join(format!("{}.txt", title))
        }
    };

    fs::write(&save_path, output.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

/// 导出章节为 Markdown 文件
#[tauri::command]
pub fn export_chapter_markdown(
    db: State<'_, DbState>,
    chapter_id: String,
    file_path: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    let (title, content): (String, String) = conn
        .query_row(
            "SELECT title, content FROM chapters WHERE id = ?1",
            rusqlite::params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("查询章节失败: {}", e))?;

    let output = format!("# {}\n\n{}", title, content);

    let save_path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let dir = db::get_exports_dir()?;
            dir.join(format!("{}.md", title))
        }
    };

    fs::write(&save_path, output.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

/// 导出整个项目为 DOCX 文件
#[tauri::command]
pub fn export_project_docx(
    db: State<'_, DbState>,
    project_id: String,
    file_path: Option<String>,
) -> Result<String, String> {
    use crate::models::Chapter;

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取项目信息
    let project_name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("查询项目失败: {}", e))?;

    // 获取所有章节
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
    let chapters: Vec<Chapter> =
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取章节失败: {}", e))?;

    // 构建 DOCX
    let mut doc = docx_rs::Docx::new();
    doc = doc.add_paragraph(
        docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text(&project_name).size(56).bold()),
    );

    for chapter in &chapters {
        doc = doc.add_paragraph(
            docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text(&chapter.title).size(36).bold()),
        );
        for paragraph_text in chapter.content.split('\n') {
            if !paragraph_text.is_empty() {
                doc = doc.add_paragraph(
                    docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text(paragraph_text)),
                );
            }
        }
    }

    let save_path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let dir = db::get_exports_dir()?;
            dir.join(format!("{}.docx", project_name))
        }
    };

    let file = std::fs::File::create(&save_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    doc.build().pack(file)
        .map_err(|e| format!("写入DOCX失败: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

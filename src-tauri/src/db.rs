use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// 数据库状态，通过 Tauri State 管理
pub struct DbState(pub Mutex<Connection>);

/// 获取数据库文件路径
fn get_db_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let whisper_dir = PathBuf::from(app_data).join("Whisper");
    std::fs::create_dir_all(&whisper_dir).ok();
    whisper_dir.join("whisper.db")
}

/// 初始化数据库连接并创建所有表
pub fn init_db() -> Result<Connection, String> {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("无法打开数据库 {:?}: {}", db_path, e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("设置数据库模式失败: {}", e))?;

    create_tables(&conn)?;
    init_builtin_skills(&conn)?;

    Ok(conn)
}

/// 创建所有数据表
fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            genre TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            parent_id TEXT,
            title TEXT NOT NULL,
            content TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            status TEXT DEFAULT 'draft',
            word_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS setting_cards (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            card_type TEXT NOT NULL,
            name TEXT NOT NULL,
            fields TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS setting_card_versions (
            id TEXT PRIMARY KEY,
            card_id TEXT NOT NULL REFERENCES setting_cards(id) ON DELETE CASCADE,
            fields TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            title TEXT NOT NULL DEFAULT '',
            phase TEXT DEFAULT 'ideation',
            skill_ids TEXT DEFAULT '[]',
            context_chapter_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            system_prompt TEXT DEFAULT '',
            tools TEXT DEFAULT '[]',
            trigger_scenarios TEXT DEFAULT '[]',
            is_builtin INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_configs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            model_thinking TEXT DEFAULT '',
            model_writing TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);
        CREATE INDEX IF NOT EXISTS idx_setting_cards_project ON setting_cards(project_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
        "
    ).map_err(|e| format!("创建数据表失败: {}", e))?;

    Ok(())
}

/// 初始化内置技能数据
fn init_builtin_skills(conn: &Connection) -> Result<(), String> {
    // 检查是否已有内置技能
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM skills WHERE is_builtin = 1", [], |row| row.get(0))
        .map_err(|e| format!("查询技能失败: {}", e))?;

    if count > 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();

    // 古风言情技能
    conn.execute(
        "INSERT INTO skills (id, name, description, system_prompt, tools, trigger_scenarios, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            "古风言情",
            "精通古风言情风格的写作技能，擅长文言与白话交织、诗词典故、意境营造",
            "你是一位精通古风言情的写作助手。在所有输出中，请遵循以下规则：1) 使用文言与白话交织的古风措辞；2) 善用诗词典故、对仗修辞；3) 场景描写注重意境营造；4) 人物对话符合古代身份与礼节；5) 情感表达含蓄委婉，以景抒情。",
            "[]",
            serde_json::to_string(&vec!["genre:古风言情", "genre:仙侠", "genre:宫斗"]).unwrap(),
            1,
            &now,
        ],
    ).map_err(|e| format!("插入古风言情技能失败: {}", e))?;

    // 悬疑推理技能
    conn.execute(
        "INSERT INTO skills (id, name, description, system_prompt, tools, trigger_scenarios, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            "悬疑推理",
            "精通悬疑推理风格的写作技能，擅长逻辑链维护、伏笔管理、线索布局",
            "你是一位精通悬疑推理的写作助手。在所有输出中，请遵循以下规则：1) 严格维护逻辑链，所有推理必须有据可依；2) 主动管理伏笔，确保前后呼应；3) 线索布局遵循'显隐结合'原则；4) 人物行为必须符合其动机和已知信息；5) 每次输出后列出当前未解之谜和已埋伏笔清单。",
            "[]",
            serde_json::to_string(&vec!["genre:悬疑推理", "genre:侦探", "genre:犯罪"]).unwrap(),
            1,
            &now,
        ],
    ).map_err(|e| format!("插入悬疑推理技能失败: {}", e))?;

    Ok(())
}

/// 获取导出目录路径，确保目录存在
pub fn get_exports_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let exports_dir = PathBuf::from(app_data).join("Whisper").join("exports");
    std::fs::create_dir_all(&exports_dir)
        .map_err(|e| format!("创建导出目录失败: {}", e))?;
    Ok(exports_dir)
}

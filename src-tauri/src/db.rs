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

    // 通用工具定义
    let tools = serde_json::to_string(&vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "query_outline",
                "description": "查询项目的章节大纲列表，获取章节层级结构和状态",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "项目ID"
                        }
                    },
                    "required": ["project_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "query_chapter",
                "description": "查询指定章节的完整内容",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "章节ID"
                        }
                    },
                    "required": ["chapter_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "create_chapter",
                "description": "创建新章节到项目大纲中",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "项目ID"
                        },
                        "title": {
                            "type": "string",
                            "description": "章节标题"
                        },
                        "parent_id": {
                            "type": "string",
                            "description": "父章节ID（可选，用于创建子章节）"
                        },
                        "content": {
                            "type": "string",
                            "description": "章节内容（可选，可为空）"
                        },
                        "sort_order": {
                            "type": "integer",
                            "description": "排序顺序"
                        }
                    },
                    "required": ["project_id", "title"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "update_chapter",
                "description": "更新指定章节的内容",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "章节ID"
                        },
                        "content": {
                            "type": "string",
                            "description": "新的章节内容"
                        }
                    },
                    "required": ["chapter_id", "content"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "delete_chapter",
                "description": "删除指定章节",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "章节ID"
                        }
                    },
                    "required": ["chapter_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "query_setting_cards",
                "description": "查询项目的设定卡（人物、世界观、势力等）",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "项目ID"
                        },
                        "card_type": {
                            "type": "string",
                            "description": "设定卡类型（可选）：人物、世界观、势力、物品等"
                        }
                    },
                    "required": ["project_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "create_setting_card",
                "description": "为项目创建新的设定卡（人物、世界观、势力等）",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {
                            "type": "string",
                            "description": "项目ID"
                        },
                        "name": {
                            "type": "string",
                            "description": "设定卡名称"
                        },
                        "card_type": {
                            "type": "string",
                            "description": "设定卡类型：人物、世界观、势力、物品、组织等"
                        },
                        "fields": {
                            "type": "string",
                            "description": "设定卡字段（JSON格式字符串，可选）"
                        }
                    },
                    "required": ["project_id", "name", "card_type"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "update_setting_card",
                "description": "更新指定设定卡的字段、名称或类型",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "card_id": {
                            "type": "string",
                            "description": "设定卡ID"
                        },
                        "name": {
                            "type": "string",
                            "description": "新的设定卡名称（可选）"
                        },
                        "card_type": {
                            "type": "string",
                            "description": "新的设定卡类型（可选）"
                        },
                        "fields": {
                            "type": "string",
                            "description": "新的设定卡字段（JSON格式字符串，可选）"
                        }
                    },
                    "required": ["card_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "delete_setting_card",
                "description": "删除指定设定卡",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "card_id": {
                            "type": "string",
                            "description": "设定卡ID"
                        }
                    },
                    "required": ["card_id"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "query_conversations",
                "description": "查询指定对话的历史消息记录",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "conversation_id": {
                            "type": "string",
                            "description": "对话ID"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "返回消息数量限制，默认20"
                        }
                    },
                    "required": ["conversation_id"]
                }
            }
        }),
    ]).map_err(|e| format!("序列化工具定义失败: {}", e))?;

    // 古风言情技能
    conn.execute(
        "INSERT INTO skills (id, name, description, system_prompt, tools, trigger_scenarios, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            "古风言情",
            "精通古风言情风格的写作技能，擅长文言与白话交织、诗词典故、意境营造",
            "你是一位精通古风言情的写作助手。在所有输出中，请遵循以下规则：1) 使用文言与白话交织的古风措辞；2) 善用诗词典故、对仗修辞；3) 场景描写注重意境营造；4) 人物对话符合古代身份与礼节；5) 情感表达含蓄委婉，以景抒情。",
            tools,
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
            tools,
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

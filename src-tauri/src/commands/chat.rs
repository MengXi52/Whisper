use crate::db::DbState;
use crate::llm::client::CancellationTokenState;
use crate::llm::prompt;
use crate::models::{ChunkEvent, Conversation, Message, SendMessageParams};
use serde_json;
use tauri::{AppHandle, Emitter, State};

/// 发送消息并流式返回AI响应
#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    db: State<'_, DbState>,
    cancel_token: State<'_, CancellationTokenState>,
    conversation_id: String,
    content: String,
    model: Option<String>,
    skill_ids: Option<Vec<String>>,
) -> Result<String, String> {

    // 保存用户消息到数据库
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![user_msg_id, conversation_id, "user", content, Option::<String>::None, now],
        ).map_err(|e| format!("保存用户消息失败: {}", e))?;

        // 更新会话时间
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, conversation_id],
        ).map_err(|e| format!("更新会话时间失败: {}", e))?;
    }

    // 获取会话信息
    let (project_id, phase, context_chapter_id): (Option<String>, String, Option<String>) = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.query_row(
            "SELECT project_id, phase, context_chapter_id FROM conversations WHERE id = ?1",
            rusqlite::params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| format!("查询会话失败: {}", e))?
    };

    // 获取历史消息
    let history: Vec<(String, String)> = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![conversation_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("查询历史消息失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取历史消息失败: {}", e))?
    };

    // 获取技能的 system prompt
    let skill_prompts = if let Some(ref sids) = skill_ids {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let mut prompts = Vec::new();
        for sid in sids {
            let sp: String = conn
                .query_row(
                    "SELECT system_prompt FROM skills WHERE id = ?1",
                    rusqlite::params![sid],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            if !sp.is_empty() {
                prompts.push(sp);
            }
        }
        prompts
    } else {
        Vec::new()
    };

    // 获取设定卡摘要（如果有项目）
    let setting_summary = if let Some(ref pid) = project_id {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT name, card_type, fields FROM setting_cards WHERE project_id = ?1")
            .map_err(|e| format!("准备查询设定卡失败: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params![pid], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("查询设定卡失败: {}", e))?;
        let cards: Vec<(String, String, String)> =
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取设定卡失败: {}", e))?;
        if cards.is_empty() {
            String::new()
        } else {
            let mut summary = String::from("【项目设定摘要】\n");
            for (name, card_type, fields) in cards {
                summary.push_str(&format!("- [{}] {}: {}\n", card_type, name, fields));
            }
            summary
        }
    } else {
        String::new()
    };

    // 获取章节内容上下文（写作阶段）
    let chapter_context = if phase == "writing" {
        if let Some(ref cid) = context_chapter_id {
            let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
            let chapter_content: String = conn
                .query_row(
                    "SELECT content FROM chapters WHERE id = ?1",
                    rusqlite::params![cid],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            if chapter_content.is_empty() {
                String::new()
            } else {
                format!("【当前章节内容】\n{}\n", chapter_content)
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // 组装 system prompt
    let system_prompt = prompt::build_system_prompt(&phase, &skill_prompts, &setting_summary, &chapter_context);

    // 获取 API 配置
    let (base_url, api_key, default_model) = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.query_row(
            "SELECT base_url, api_key, model_thinking FROM api_configs WHERE is_default = 1 LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        ).map_err(|e| format!("未找到默认API配置，请先在设置中配置API: {}", e))?
    };

    // 确定使用的模型
    let use_model = model.unwrap_or_else(|| default_model.clone());

    // 构建消息列表
    let mut messages = Vec::new();
    messages.push(crate::models::ChatMessage {
        role: "system".to_string(),
        content: system_prompt,
    });
    for (role, msg_content) in &history {
        messages.push(crate::models::ChatMessage {
            role: role.clone(),
            content: msg_content.clone(),
        });
    }

    // 生成助手消息ID
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();

    // 重置取消令牌
    {
        let mut token = cancel_token.0.lock().map_err(|e| format!("获取取消令牌锁失败: {}", e))?;
        *token = false;
    }

    // 调用 LLM 客户端
    let full_content = crate::llm::client::stream_chat(
        &app,
        &base_url,
        &api_key,
        &use_model,
        messages,
        &conversation_id,
        &assistant_msg_id,
        &cancel_token.0,
    )
    .await?;

    // 保存助手消息到数据库
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![assistant_msg_id, conversation_id, "assistant", full_content, use_model, now],
        ).map_err(|e| format!("保存助手消息失败: {}", e))?;

        // 更新会话标题（如果是第一条用户消息）
        conn.execute(
            "UPDATE conversations SET updated_at = ?1, title = CASE WHEN title = '' THEN SUBSTR(?2, 1, 20) ELSE title END WHERE id = ?3",
            rusqlite::params![now, content, conversation_id],
        ).map_err(|e| format!("更新会话失败: {}", e))?;
    }

    // 发送完成事件
    let done_event = ChunkEvent {
        conversation_id: conversation_id.clone(),
        message_id: assistant_msg_id.clone(),
        content: String::new(),
        done: true,
    };
    app.emit("chat:chunk", &done_event)
        .map_err(|e| format!("发送完成事件失败: {}", e))?;

    Ok(assistant_msg_id)
}

/// 中断当前生成
#[tauri::command]
pub fn abort_generation(cancel_token: State<'_, CancellationTokenState>) -> Result<(), String> {
    let mut token = cancel_token.0.lock().map_err(|e| format!("获取取消令牌锁失败: {}", e))?;
    *token = true;
    Ok(())
}

/// 获取会话的历史消息列表
#[tauri::command]
pub fn get_messages(
    db: State<'_, DbState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, conversation_id, role, content, model, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                model: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("查询消息失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取消息失败: {}", e))
}

/// 创建新会话
#[tauri::command]
pub fn create_conversation(
    db: State<'_, DbState>,
    project_id: Option<String>,
    title: Option<String>,
    phase: Option<String>,
    skill_ids: Option<Vec<String>>,
) -> Result<Conversation, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let phase = phase.unwrap_or_else(|| "ideation".to_string());
    let title = title.unwrap_or_default();
    let skill_ids_str = serde_json::to_string(skill_ids.as_ref().unwrap_or(&vec![]))
        .map_err(|e| format!("序列化技能ID失败: {}", e))?;

    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO conversations (id, project_id, title, phase, skill_ids, context_chapter_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, project_id, title, phase, skill_ids_str, Option::<String>::None, now, now],
    ).map_err(|e| format!("创建会话失败: {}", e))?;

    Ok(Conversation {
        id,
        project_id,
        title,
        phase,
        skill_ids: skill_ids.unwrap_or_default(),
        context_chapter_id: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 删除会话
#[tauri::command]
pub fn delete_conversation(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM conversations WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除会话失败: {}", e))?;
    Ok(())
}

/// 获取会话列表（按更新时间倒序）
#[tauri::command]
pub fn list_conversations(db: State<'_, DbState>) -> Result<Vec<Conversation>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, phase, skill_ids, context_chapter_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            let skill_ids_str: String = row.get(4)?;
            let skill_ids: Vec<String> = serde_json::from_str(&skill_ids_str)
                .unwrap_or_default();
            Ok(Conversation {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                phase: row.get(3)?,
                skill_ids,
                context_chapter_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("查询会话失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("读取会话失败: {}", e))
}

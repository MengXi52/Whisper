use crate::db::DbState;
use crate::llm::client::CancellationTokenState;
use crate::llm::prompt;
use crate::models::{ChunkEvent, Conversation, Message};
use crate::{log_debug, log_error, log_info, log_section, log_warn};
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

    log_section!("send_message");
    log_info!("STEP1", "收到用户消息 | 对话ID: {} | 内容(前50字): {}", conversation_id, &content.chars().take(50).collect::<String>());

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
    log_info!("STEP1", "用户消息已保存 | 消息ID: {}", user_msg_id);

    // 获取会话信息
    let (project_id, phase, context_chapter_id): (Option<String>, String, Option<String>) = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.query_row(
            "SELECT project_id, phase, context_chapter_id FROM conversations WHERE id = ?1",
            rusqlite::params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| format!("查询会话失败: {}", e))?
    };
    log_info!("STEP2", "会话信息 | project_id: {:?} | phase: {} | context_chapter: {:?}", project_id, phase, context_chapter_id);

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
    log_info!("STEP3", "历史消息 | 共 {} 条 (含刚保存的用户消息)", history.len());

    // 获取技能的 system prompt 和 tools 定义
    let (skill_prompts, tools): (Vec<String>, Option<Vec<serde_json::Value>>) = if let Some(ref sids) = skill_ids {
        log_info!("STEP4", "加载技能 | skill_ids: {:?}", sids);
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let mut prompts = Vec::new();
        let mut all_tools = Vec::new();
        for sid in sids {
            let (sp, tools_str): (String, String) = conn
                .query_row(
                    "SELECT system_prompt, tools FROM skills WHERE id = ?1",
                    rusqlite::params![sid],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap_or_default();
            if !sp.is_empty() {
                log_info!("STEP4", "  - 技能system_prompt: {} 字符", sp.len());
                prompts.push(sp);
            }
            // 解析工具的 JSON 定义
            if !tools_str.is_empty() && tools_str != "[]" {
                match serde_json::from_str::<Vec<serde_json::Value>>(&tools_str) {
                    Ok(tool_defs) => {
                        log_info!("STEP4", "  - 加载工具定义: {} 个", tool_defs.len());
                        all_tools.extend(tool_defs);
                    },
                    Err(e) => log_warn!("STEP4", "解析技能工具定义失败 (skill_id={}): {}", sid, e),
                }
            }
        }
        (prompts, if all_tools.is_empty() { None } else { Some(all_tools) })
    } else {
        log_info!("STEP4", "未加载技能 | skill_ids: None");
        (Vec::new(), None)
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
            log_info!("STEP5", "设定卡摘要 | 项目 {} 暂无设定卡", pid);
            String::new()
        } else {
            log_info!("STEP5", "设定卡摘要 | 共 {} 张设定卡", cards.len());
            let mut summary = String::from("【项目设定摘要】\n");
            for (name, card_type, fields) in cards {
                summary.push_str(&format!("- [{}] {}: {}\n", card_type, name, fields));
            }
            summary
        }
    } else {
        log_info!("STEP5", "设定卡摘要 | 无关联项目，跳过");
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
                log_info!("STEP6", "章节上下文 | 章节 {} 内容为空", cid);
                String::new()
            } else {
                log_info!("STEP6", "章节上下文 | 章节 {} 内容: {} 字符", cid, chapter_content.len());
                format!("【当前章节内容】\n{}\n", chapter_content)
            }
        } else {
            log_info!("STEP6", "章节上下文 | 写作阶段但无指定章节");
            String::new()
        }
    } else {
        log_info!("STEP6", "章节上下文 | 阶段为 {}，不注入", phase);
        String::new()
    };

    // 组装 system prompt
    let system_prompt = prompt::build_system_prompt(
        &phase,
        &skill_prompts,
        &setting_summary,
        &chapter_context,
        project_id.as_deref(),
        &conversation_id,
    );
    log_info!("STEP7", "System Prompt 已构建 | 共 {} 字符", system_prompt.len());
    log_debug!("SYSTEM_PROMPT", "\n{}", system_prompt);

    // 检测 /tool_name 命令，注入工具调用指令
    let (_effective_content, tool_hint) = parse_slash_command(&content);
    if tool_hint.is_some() {
        log_info!("STEP8", "检测到 / 命令: {:?}", tool_hint.as_ref().map(|h| &h[..80]));
    }

    // 确定最终的工具列表：
    let tools = if tool_hint.is_some() {
        let t = load_all_tools(&db.0)?;
        log_info!("STEP8", "工具列表 | /命令触发，加载 {} 个工具", t.len());
        Some(t)
    } else if tools.is_none() {
        let builtin = load_all_tools(&db.0)?;
        if builtin.is_empty() {
            log_info!("STEP8", "工具列表 | 无可用工具");
            None
        } else {
            let names: Vec<&str> = builtin.iter().filter_map(|t| t["function"]["name"].as_str()).collect();
            log_info!("STEP8", "工具列表 | 默认加载 {} 个工具: {:?}", builtin.len(), names);
            Some(builtin)
        }
    } else {
        let count = tools.as_ref().map(|t| t.len()).unwrap_or(0);
        log_info!("STEP8", "工具列表 | 使用技能提供的 {} 个工具", count);
        tools
    };

    // 获取 API 配置
    let (base_url, api_key, default_model) = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.query_row(
            "SELECT base_url, api_key, model_thinking FROM api_configs WHERE is_default = 1 LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        ).map_err(|e| format!("未找到默认API配置，请先在设置中配置API: {}", e))?
    };
    log_info!("STEP9", "API配置 | base_url: {} | model: {}", base_url, default_model);

    // 确定使用的模型
    let use_model = model.unwrap_or_else(|| default_model.clone());
    log_info!("STEP9", "最终模型: {}", use_model);

    // 构建消息列表
    let mut messages = Vec::new();

    let final_system_prompt = if let Some(ref hint) = tool_hint {
        format!("{}\n\n{}", system_prompt, hint)
    } else {
        system_prompt
    };

    messages.push(crate::models::ChatMessage {
        role: "system".to_string(),
        content: final_system_prompt,
        tool_calls: None,
        tool_call_id: None,
    });
    for (role, msg_content) in &history {
        messages.push(crate::models::ChatMessage {
            role: role.clone(),
            content: msg_content.clone(),
            tool_calls: None,
            tool_call_id: None,
        });
    }

    log_info!("STEP10", "消息列表构建完成 | 共 {} 条消息 (system + {} 条历史)", messages.len(), history.len());

    // 生成助手消息ID
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();

    // 重置取消令牌
    {
        let mut token = cancel_token.0.lock().map_err(|e| format!("获取取消令牌锁失败: {}", e))?;
        *token = false;
    }
    log_info!("STEP10", "取消令牌已重置");

    // 调用 LLM 客户端
    log_section!("stream_chat 开始");
    log_info!("STREAM", "调用 stream_chat | 模型: {} | 消息数: {} | 工具数: {}",
        use_model, messages.len(), tools.as_ref().map(|t| t.len()).unwrap_or(0));

    let full_content = crate::llm::client::stream_chat(
        &app,
        &db.0,
        &base_url,
        &api_key,
        &use_model,
        messages,
        tools,
        &conversation_id,
        &assistant_msg_id,
        &cancel_token.0,
    )
    .await?;

    log_info!("STREAM", "stream_chat 完成 | 返回内容: {} 字符", full_content.len());

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
    log_info!("STEP11", "助手消息已保存 | 消息ID: {}", assistant_msg_id);

    // 发送完成事件
    let done_event = ChunkEvent {
        conversation_id: conversation_id.clone(),
        message_id: assistant_msg_id.clone(),
        content: String::new(),
        done: true,
    };
    app.emit("chat:chunk", &done_event)
        .map_err(|e| format!("发送完成事件失败: {}", e))?;

    log_info!("STEP12", "完成事件已发送 | done: true");
    log_section!("send_message 结束");

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

/// 解析 /tool_name 命令
/// 返回 (实际发送给 LLM 的内容, 工具调用提示)
fn parse_slash_command(content: &str) -> (String, Option<String>) {
    let trimmed = content.trim();

    // 检测 /tool_name 格式（开头或行首）
    if let Some(rest) = trimmed.strip_prefix('/') {
        let parts: Vec<&str> = rest.splitn(2, ' ').collect();
        let tool_name = parts[0];
        let user_args = parts.get(1).unwrap_or(&"");

        // 验证工具名格式（只含字母、数字、下划线）
        if !tool_name.is_empty() && tool_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            let hint = format!(
                "【工具指令】用户通过 / 命令请求调用工具 `{}`。\n\
                 你必须立即调用工具 `{}`，不要生成任何文本回复，只调用工具并返回结果。\n\
                 用户补充说明：{}\n\
                 请根据工具定义自行构造参数。如果用户提供了具体参数信息，请提取并填入。如果缺少必要参数，请使用合理默认值。",
                tool_name, tool_name, user_args
            );
            return (trimmed.to_string(), Some(hint));
        }
    }

    (content.to_string(), None)
}

/// 加载所有内置技能的工具定义（按工具名称去重）
fn load_all_tools(db: &std::sync::Mutex<rusqlite::Connection>) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT tools FROM skills WHERE is_builtin = 1 AND tools != '[]' AND tools != ''")
        .map_err(|e| format!("查询工具定义失败: {}", e))?;

    let rows = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询工具定义失败: {}", e))?;

    let mut all_tools = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    for tools_str in rows {
        let tools_str = tools_str.map_err(|e| format!("读取工具定义失败: {}", e))?;
        if let Ok(tool_defs) = serde_json::from_str::<Vec<serde_json::Value>>(&tools_str) {
            for tool_def in tool_defs {
                let name = tool_def["function"]["name"].as_str().unwrap_or("").to_string();
                if !name.is_empty() && seen_names.insert(name) {
                    all_tools.push(tool_def);
                }
            }
        }
    }

    Ok(all_tools)
}

use crate::models::{ChatMessage, ChatRequest, ChunkEvent};
use crate::{log_debug, log_error, log_info, log_warn};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::Client;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 取消令牌状态，通过 Tauri State 管理
pub struct CancellationTokenState(pub Mutex<bool>);

/// 工具调用结果
#[derive(Debug, Clone)]
struct ToolCallResult {
    tool_call_id: String,
    name: String,
    arguments: String,
}

/// 流式调用 LLM API（支持工具调用）
///
/// 通过 SSE 接收响应，逐 chunk 通过 Tauri Event 推送到前端
/// 如果模型返回 tool_calls，会自动执行工具并重新请求，直到返回纯内容
pub async fn stream_chat(
    app: &AppHandle,
    db: &Mutex<Connection>,
    base_url: &str,
    api_key: &str,
    model: &str,
    mut messages: Vec<ChatMessage>,
    tools: Option<Vec<serde_json::Value>>,
    conversation_id: &str,
    message_id: &str,
    cancel_token: &Mutex<bool>,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = Client::new();

    // 最大工具调用轮次，防止无限循环
    let max_tool_rounds = 10;
    let mut tool_round = 0;

    loop {
        tool_round += 1;
        if tool_round > max_tool_rounds {
            log_error!("STREAM", "达到最大工具调用轮次限制 ({})", max_tool_rounds);
            return Err("工具调用次数超过最大限制".to_string());
        }

        log_info!("STREAM", "--- LLM 请求轮次 {} ---", tool_round);
        log_info!("STREAM", "消息数: {} | 工具数: {}", messages.len(), tools.as_ref().map(|t| t.len()).unwrap_or(0));
        let request_body = ChatRequest {
            model: model.to_string(),
            messages: messages.clone(),
            stream: true,
            temperature: Some(0.7),
            max_tokens: Some(4096),
            tools: tools.clone(),
        };

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("API请求失败: {}", e))?;

        log_info!("STREAM", "API响应状态: {}", response.status());

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            log_error!("STREAM", "API返回错误 ({}): {}", status, body);
            return Err(format!("API返回错误 ({}): {}", status, body));
        }

        let stream = response.bytes_stream().eventsource();
        let mut full_content = String::new();
        let mut tool_calls_accumulated: Vec<ToolCallResult> = Vec::new();
        let mut chunk_count = 0;
        let mut content_len = 0;

        tokio::pin!(stream);

        while let Some(event) = stream.next().await {
            chunk_count += 1;

            // 检查取消令牌
            {
                let cancelled = cancel_token.lock().map_err(|e| format!("获取取消令牌锁失败: {}", e))?;
                if *cancelled {
                    log_info!("STREAM", "用户取消生成 (收到 {} chunks)", chunk_count);
                    break;
                }
            }

            match event {
                Ok(event) => {
                    let data = event.data.trim();

                    if data == "[DONE]" {
                        log_debug!("STREAM", "收到 [DONE] 标记 (共 {} chunks)", chunk_count);
                        break;
                    }

                    match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(json) => {
                            if let Some(choices) = json.get("choices") {
                                if let Some(first_choice) = choices.get(0) {
                                    if let Some(delta) = first_choice.get("delta") {
                                        // 提取内容增量
                                        if let Some(content) = delta.get("content") {
                                            if let Some(text) = content.as_str() {
                                                full_content.push_str(text);
                                                content_len += text.len();

                                                let chunk_event = ChunkEvent {
                                                    conversation_id: conversation_id.to_string(),
                                                    message_id: message_id.to_string(),
                                                    content: text.to_string(),
                                                    done: false,
                                                };
                                                let _ = app.emit("chat:chunk", &chunk_event);
                                            }
                                        }

                                        // 提取工具调用
                                        if let Some(tc_array) = delta.get("tool_calls") {
                                            if let Some(tc_arr) = tc_array.as_array() {
                                                for tc in tc_arr {
                                                    let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                                                    let tc_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                                    let tc_type = tc.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                                    let func = tc.get("function");

                                                    while tool_calls_accumulated.len() <= index {
                                                        tool_calls_accumulated.push(ToolCallResult {
                                                            tool_call_id: String::new(),
                                                            name: String::new(),
                                                            arguments: String::new(),
                                                        });
                                                    }

                                                    let entry = &mut tool_calls_accumulated[index];
                                                    if !tc_id.is_empty() {
                                                        entry.tool_call_id = tc_id.to_string();
                                                    }
                                                    if tc_type == "function" && entry.name.is_empty() {
                                                        if let Some(func_val) = func {
                                                            if let Some(name) = func_val.get("name").and_then(|v| v.as_str()) {
                                                                entry.name = name.to_string();
                                                            }
                                                            if let Some(args) = func_val.get("arguments").and_then(|v| v.as_str()) {
                                                                entry.arguments.push_str(args);
                                                            }
                                                        }
                                                    } else if let Some(func_val) = func {
                                                        if let Some(args) = func_val.get("arguments").and_then(|v| v.as_str()) {
                                                            entry.arguments.push_str(args);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // 检查 finish_reason
                                    if let Some(finish_reason) = first_choice.get("finish_reason") {
                                        if let Some(reason) = finish_reason.as_str() {
                                            if reason == "tool_calls" {
                                                log_info!("STREAM", "LLM 返回 tool_calls，共 {} 个 (本轮已收内容: {} 字符, {} chunks)",
                                                    tool_calls_accumulated.len(), content_len, chunk_count);
                                                for (i, tc) in tool_calls_accumulated.iter().enumerate() {
                                                    log_info!("STREAM", "  tool_call[{}]: {} | 参数: {}", i, tc.name, tc.arguments);
                                                }

                                                // 执行工具调用
                                                let tool_results = execute_tools(db, &tool_calls_accumulated)?;

                                                log_info!("STREAM", "工具执行完成，共 {} 个结果", tool_results.len());
                                                for (i, r) in tool_results.iter().enumerate() {
                                                    let preview = if r.chars().count() > 100 {
                                                        let truncated: String = r.chars().take(100).collect();
                                                        format!("{}...", truncated)
                                                    } else {
                                                        r.clone()
                                                    };
                                                    log_info!("STREAM", "  结果[{}]: {}", i, preview);
                                                }

                                                // 重构 tool_calls JSON 数组
                                                let tool_calls_json: Vec<serde_json::Value> = tool_calls_accumulated.iter().map(|tc| {
                                                    serde_json::json!({
                                                        "id": tc.tool_call_id,
                                                        "type": "function",
                                                        "function": {
                                                            "name": tc.name,
                                                            "arguments": tc.arguments
                                                        }
                                                    })
                                                }).collect();

                                                // 将 tool_calls 序列化为字符串用于数据库存储
                                                let tool_calls_str = serde_json::to_string(&tool_calls_json).unwrap_or_default();

                                                // 保存助手消息（含 tool_calls）到数据库
                                                let assistant_tool_msg_id = uuid::Uuid::new_v4().to_string();
                                                let now_ts = chrono::Utc::now().to_rfc3339();
                                                {
                                                    if let Ok(conn) = db.lock() {
                                                        let _ = conn.execute(
                                                            "INSERT INTO messages (id, conversation_id, role, content, model, created_at, tool_calls, tool_call_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                                                            rusqlite::params![
                                                                assistant_tool_msg_id,
                                                                conversation_id,
                                                                "assistant",
                                                                full_content.clone(),
                                                                model,
                                                                now_ts,
                                                                tool_calls_str,
                                                            ],
                                                        );
                                                    }
                                                }
                                                log_info!("STREAM", "工具调用助手消息已入库 | id: {} | tool_calls: {} 个", assistant_tool_msg_id, tool_calls_accumulated.len());

                                                // 添加助手消息（包含 tool_calls）到内存消息列表
                                                messages.push(ChatMessage {
                                                    role: "assistant".to_string(),
                                                    content: full_content.clone(),
                                                    tool_calls: Some(tool_calls_json),
                                                    tool_call_id: None,
                                                });

                                                // 保存工具结果消息到数据库，并添加到内存消息列表
                                                for (tc, result) in tool_calls_accumulated.iter().zip(tool_results.iter()) {
                                                    let tool_msg_id = uuid::Uuid::new_v4().to_string();
                                                    let now_ts = chrono::Utc::now().to_rfc3339();
                                                    {
                                                        if let Ok(conn) = db.lock() {
                                                            let _ = conn.execute(
                                                                "INSERT INTO messages (id, conversation_id, role, content, model, created_at, tool_calls, tool_call_id) VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, ?6)",
                                                                rusqlite::params![
                                                                    tool_msg_id,
                                                                    conversation_id,
                                                                    "tool",
                                                                    result.clone(),
                                                                    now_ts,
                                                                    tc.tool_call_id,
                                                                ],
                                                            );
                                                        }
                                                    }

                                                    messages.push(ChatMessage {
                                                        role: "tool".to_string(),
                                                        content: result.clone(),
                                                        tool_calls: None,
                                                        tool_call_id: Some(tc.tool_call_id.clone()),
                                                    });
                                                }
                                                log_info!("STREAM", "工具结果消息已入库 | 共 {} 条", tool_calls_accumulated.len());

                                                full_content.clear();
                                                tool_calls_accumulated.clear();
                                                break;
                                            } else if reason == "stop" {
                                                log_debug!("STREAM", "收到 finish_reason=stop (本轮内容: {} 字符)", content_len);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(_) => {
                            log_debug!("STREAM", "SSE解析跳过非JSON数据: {}", &data.chars().take(80).collect::<String>());
                            continue;
                        }
                    }
                }
                Err(e) => {
                    log_warn!("STREAM", "SSE解析错误: {:?}", e);
                    continue;
                }
            }
        }

        // 如果没有工具调用，返回最终内容
        if !tool_calls_accumulated.is_empty() {
            log_info!("STREAM", "有 {} 个 tool_calls，进入第 {} 轮 (累积消息: {} 条)",
                tool_calls_accumulated.len(), tool_round + 1, messages.len());
            continue;
        }

        log_info!("STREAM", "LLM 返回最终内容 | 共 {} 字符 | 总轮次: {} | 总 chunks: {}", full_content.len(), tool_round, chunk_count);
        return Ok(full_content);
    }
}

/// 执行工具调用
fn execute_tools(db: &Mutex<Connection>, tool_calls: &[ToolCallResult]) -> Result<Vec<String>, String> {
    let mut results = Vec::new();
    for tc in tool_calls {
        log_info!("TOOL", "执行工具: {} | 参数: {}", tc.name, tc.arguments);
        let result = match tc.name.as_str() {
            "query_outline" => tool_query_outline(db, &tc.arguments),
            "query_chapter" => tool_query_chapter(db, &tc.arguments),
            "create_chapter" => tool_create_chapter(db, &tc.arguments),
            "update_chapter" => tool_update_chapter(db, &tc.arguments),
            "delete_chapter" => tool_delete_chapter(db, &tc.arguments),
            "query_setting_cards" => tool_query_setting_cards(db, &tc.arguments),
            "create_setting_card" => tool_create_setting_card(db, &tc.arguments),
            "update_setting_card" => tool_update_setting_card(db, &tc.arguments),
            "delete_setting_card" => tool_delete_setting_card(db, &tc.arguments),
            "query_conversations" => tool_query_conversations(db, &tc.arguments),
            "list_skills" => tool_list_skills(db, &tc.arguments),
            "use_skill" => tool_use_skill(db, &tc.arguments),
            _ => format!("工具 '{}' 未实现，参数: {}", tc.name, tc.arguments),
        };
        let preview = result.chars().take(200).collect::<String>();
        log_info!("TOOL", "工具 {} 执行结果(前200字): {}", tc.name, preview);
        results.push(result);
    }
    Ok(results)
}

// ========== 工具实现 ==========

/// 查询大纲
fn tool_query_outline(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        project_id: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, title, parent_id, sort_order, status FROM chapters WHERE project_id = ?1 ORDER BY sort_order ASC"
    ) {
        Ok(s) => s,
        Err(e) => return format!("查询大纲失败: {}", e),
    };

    let rows = match stmt.query_map(rusqlite::params![args.project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => return format!("查询大纲失败: {}", e),
    };

    let chapters: Vec<_> = match rows.collect() {
        Ok(c) => c,
        Err(e) => return format!("读取大纲失败: {}", e),
    };

    if chapters.is_empty() {
        return "该项目暂无大纲".to_string();
    }

    let mut output = String::from("【大纲列表】\n");
    for (id, title, parent_id, sort_order, status) in chapters {
        let indent = if parent_id.is_some() { "  " } else { "" };
        output.push_str(&format!("{}- [{}] {} (id: {}, 状态: {})\n", indent, sort_order, title, id, status));
    }
    output
}

/// 查询章节内容
fn tool_query_chapter(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        chapter_id: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let (title, content): (String, String) = match conn.query_row(
        "SELECT title, content FROM chapters WHERE id = ?1",
        rusqlite::params![args.chapter_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ) {
        Ok(r) => r,
        Err(e) => return format!("查询章节失败: {}", e),
    };

    format!("【章节: {}】\n\n{}", title, content)
}

/// 更新章节内容
fn tool_update_chapter(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        chapter_id: String,
        content: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let word_count = args.content.chars().count() as i64;
    let now = chrono::Utc::now().to_rfc3339();

    match conn.execute(
        "UPDATE chapters SET content = ?1, word_count = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![args.content, word_count, now, args.chapter_id],
    ) {
        Ok(_) => format!("章节 {} 已更新，字数: {}", args.chapter_id, word_count),
        Err(e) => format!("更新章节失败: {}", e),
    }
}

/// 删除章节
fn tool_delete_chapter(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        chapter_id: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    // 先查出标题用于返回信息
    let title: Option<String> = conn
        .query_row("SELECT title FROM chapters WHERE id = ?1", rusqlite::params![args.chapter_id], |row| row.get(0))
        .ok();

    match conn.execute("DELETE FROM chapters WHERE id = ?1", rusqlite::params![args.chapter_id]) {
        Ok(0) => format!("章节 {} 不存在", args.chapter_id),
        Ok(_) => format!("章节已删除: {} (id: {})", title.unwrap_or_default(), args.chapter_id),
        Err(e) => format!("删除章节失败: {}", e),
    }
}

/// 创建章节
fn tool_create_chapter(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        project_id: String,
        title: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        sort_order: Option<i64>,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let content = args.content.unwrap_or_default();
    let sort_order = args.sort_order.unwrap_or(0);
    let word_count = content.chars().count() as i64;

    // 确保项目存在（自动创建）
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, description, genre, created_at, updated_at) VALUES (?1, ?2, '', '', ?3, ?3)",
        rusqlite::params![args.project_id, args.title, now],
    ).ok();

    match conn.execute(
        "INSERT INTO chapters (id, project_id, parent_id, title, content, sort_order, status, word_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, args.project_id, args.parent_id, args.title, content, sort_order, "draft", word_count, now, now],
    ) {
        Ok(_) => format!("章节已创建: {} (id: {})", args.title, id),
        Err(e) => format!("创建章节失败: {}", e),
    }
}

/// 查询设定卡
fn tool_query_setting_cards(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        project_id: String,
        #[serde(default)]
        card_type: Option<String>,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let (query, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match &args.card_type {
        Some(ct) => (
            "SELECT id, name, card_type, fields FROM setting_cards WHERE project_id = ?1 AND card_type = ?2".to_string(),
            vec![Box::new(args.project_id.clone()) as Box<dyn rusqlite::types::ToSql>, Box::new(ct.clone()) as Box<dyn rusqlite::types::ToSql>],
        ),
        None => (
            "SELECT id, name, card_type, fields FROM setting_cards WHERE project_id = ?1".to_string(),
            vec![Box::new(args.project_id.clone()) as Box<dyn rusqlite::types::ToSql>],
        ),
    };

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(e) => return format!("查询设定卡失败: {}", e),
    };

    let rows = match stmt.query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => return format!("查询设定卡失败: {}", e),
    };

    let cards: Vec<_> = match rows.collect() {
        Ok(c) => c,
        Err(e) => return format!("读取设定卡失败: {}", e),
    };

    if cards.is_empty() {
        return "该项目暂无设定卡".to_string();
    }

    let mut output = String::from("【设定卡列表】\n");
    for (id, name, card_type, fields) in cards {
        output.push_str(&format!("- [{}] {} (id: {})\n  字段: {}\n", card_type, name, id, fields));
    }
    output
}

/// 创建设定卡
fn tool_create_setting_card(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        project_id: String,
        name: String,
        card_type: String,
        #[serde(default)]
        fields: Option<String>,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let fields = args.fields.unwrap_or_else(|| "{}".to_string());

    // 确保项目存在（自动创建）
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, description, genre, created_at, updated_at) VALUES (?1, ?2, '', '', ?3, ?3)",
        rusqlite::params![args.project_id, args.name, now],
    ).ok();

    match conn.execute(
        "INSERT INTO setting_cards (id, project_id, card_type, name, fields, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, args.project_id, args.card_type, args.name, fields, now, now],
    ) {
        Ok(_) => format!("设定卡已创建: [{}] {} (id: {})", args.card_type, args.name, id),
        Err(e) => format!("创建设定卡失败: {}", e),
    }
}

/// 更新设定卡
fn tool_update_setting_card(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        card_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        card_type: Option<String>,
        #[serde(default)]
        fields: Option<String>,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut updates: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    if let Some(name) = &args.name {
        updates.push("name = ?".to_string());
        params.push(Box::new(name.clone()));
    }
    if let Some(card_type) = &args.card_type {
        updates.push("card_type = ?".to_string());
        params.push(Box::new(card_type.clone()));
    }
    if let Some(fields) = &args.fields {
        updates.push("fields = ?".to_string());
        params.push(Box::new(fields.clone()));
    }

    if updates.is_empty() {
        return "没有需要更新的字段".to_string();
    }

    updates.push("updated_at = ?".to_string());
    params.push(Box::new(now));
    params.push(Box::new(args.card_id.clone()));

    let sql = format!("UPDATE setting_cards SET {} WHERE id = ?", updates.join(", "));

    match conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref()))) {
        Ok(0) => format!("设定卡 {} 不存在", args.card_id),
        Ok(_) => format!("设定卡 {} 已更新", args.card_id),
        Err(e) => format!("更新设定卡失败: {}", e),
    }
}

/// 删除设定卡
fn tool_delete_setting_card(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        card_id: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let name: Option<String> = conn
        .query_row("SELECT name FROM setting_cards WHERE id = ?1", rusqlite::params![args.card_id], |row| row.get(0))
        .ok();

    match conn.execute("DELETE FROM setting_cards WHERE id = ?1", rusqlite::params![args.card_id]) {
        Ok(0) => format!("设定卡 {} 不存在", args.card_id),
        Ok(_) => format!("设定卡已删除: {} (id: {})", name.unwrap_or_default(), args.card_id),
        Err(e) => format!("删除设定卡失败: {}", e),
    }
}

/// 查询对话历史
fn tool_query_conversations(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        conversation_id: String,
        #[serde(default)]
        limit: Option<i64>,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let limit = args.limit.unwrap_or(20);
    let mut stmt = match conn.prepare(
        &format!("SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC LIMIT ?2")
    ) {
        Ok(s) => s,
        Err(e) => return format!("查询对话失败: {}", e),
    };

    let rows = match stmt.query_map(rusqlite::params![args.conversation_id, limit], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok(r) => r,
        Err(e) => return format!("查询对话失败: {}", e),
    };

    let messages: Vec<_> = match rows.collect() {
        Ok(c) => c,
        Err(e) => return format!("读取对话失败: {}", e),
    };

    if messages.is_empty() {
        return "该对话暂无消息".to_string();
    }

    let mut output = String::from("【对话历史】\n");
    for (role, content) in messages {
        let role_label = if role == "user" { "用户" } else { "助手" };
        let preview = if content.chars().count() > 200 {
            let truncated: String = content.chars().take(200).collect();
            format!("{}...", truncated)
        } else {
            content
        };
        output.push_str(&format!("[{}]: {}\n", role_label, preview));
    }
    output
}

/// 列出可用技能
fn tool_list_skills(db: &Mutex<Connection>, _args: &str) -> String {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let mut stmt = match conn.prepare("SELECT id, name, description, is_builtin FROM skills ORDER BY is_builtin DESC, name ASC") {
        Ok(s) => s,
        Err(e) => return format!("查询技能失败: {}", e),
    };

    let rows = match stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => return format!("查询技能失败: {}", e),
    };

    let skills: Vec<_> = match rows.collect() {
        Ok(c) => c,
        Err(e) => return format!("读取技能失败: {}", e),
    };

    if skills.is_empty() {
        return "暂无可用技能".to_string();
    }

    let mut output = String::from("【技能列表】\n");
    for (id, name, description, is_builtin) in skills {
        let tag = if is_builtin == 1 { "内置" } else { "自定义" };
        output.push_str(&format!("- [{}] {} (id: {})\n  描述: {}\n", tag, name, id, description));
    }
    output.push_str("\n使用 use_skill 工具可以激活某个技能");
    output
}

/// 使用技能（返回技能的 system_prompt 供 LLM 切换风格）
fn tool_use_skill(db: &Mutex<Connection>, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_id: String,
    }
    let args: Args = match serde_json::from_str(args) {
        Ok(a) => a,
        Err(e) => return format!("参数解析失败: {}", e),
    };

    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => return format!("获取数据库锁失败: {}", e),
    };

    let (name, system_prompt, tools): (String, String, String) = match conn.query_row(
        "SELECT name, system_prompt, tools FROM skills WHERE id = ?1",
        rusqlite::params![args.skill_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ) {
        Ok(r) => r,
        Err(rusqlite::Error::QueryReturnedNoRows) => return format!("技能 {} 不存在", args.skill_id),
        Err(e) => return format!("查询技能失败: {}", e),
    };

    format!(
        "已激活技能: {}\n后续输出请遵循该技能的系统提示词：\n\n{}\n\n该技能可用工具: {}",
        name, system_prompt, tools
    )
}

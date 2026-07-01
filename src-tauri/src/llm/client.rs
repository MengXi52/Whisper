use crate::models::{ChatMessage, ChatRequest, ChunkEvent};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::Client;
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
            return Err("工具调用次数超过最大限制".to_string());
        }

        let request_body = ChatRequest {
            model: model.to_string(),
            messages: messages.clone(),
            stream: true,
            temperature: Some(0.7),
            max_tokens: Some(4096),
            tools: if tool_round == 1 { tools.clone() } else { None },
        };

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("API请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API返回错误 ({}): {}", status, body));
        }

        let stream = response.bytes_stream().eventsource();
        let mut full_content = String::new();
        let mut tool_calls_accumulated: Vec<ToolCallResult> = Vec::new();

        tokio::pin!(stream);

        while let Some(event) = stream.next().await {
            // 检查取消令牌
            {
                let cancelled = cancel_token.lock().map_err(|e| format!("获取取消令牌锁失败: {}", e))?;
                if *cancelled {
                    break;
                }
            }

            match event {
                Ok(event) => {
                    let data = event.data.trim();

                    // 流结束标记
                    if data == "[DONE]" {
                        break;
                    }

                    // 解析 SSE 数据
                    match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(json) => {
                            if let Some(choices) = json.get("choices") {
                                if let Some(first_choice) = choices.get(0) {
                                    if let Some(delta) = first_choice.get("delta") {
                                        // 提取内容增量
                                        if let Some(content) = delta.get("content") {
                                            if let Some(text) = content.as_str() {
                                                full_content.push_str(text);

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

                                                    // 确保数组足够大
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
                                                // 执行工具调用
                                                let tool_results = execute_tools(&tool_calls_accumulated)?;

                                                // 添加助手消息（包含 tool_calls）
                                                let mut tc_json = Vec::new();
                                                for tc in &tool_calls_accumulated {
                                                    tc_json.push(serde_json::json!({
                                                        "id": tc.tool_call_id,
                                                        "type": "function",
                                                        "function": {
                                                            "name": tc.name,
                                                            "arguments": tc.arguments
                                                        }
                                                    }));
                                                }

                                                messages.push(ChatMessage {
                                                    role: "assistant".to_string(),
                                                    content: full_content.clone(),
                                                });

                                                // 添加工具结果消息
                                                for result in tool_results.iter() {
                                                    messages.push(ChatMessage {
                                                        role: "tool".to_string(),
                                                        content: result.clone(),
                                                    });
                                                }

                                                // 继续下一轮请求
                                                full_content.clear();
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(_) => {
                            continue;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("SSE解析错误: {:?}", e);
                    continue;
                }
            }
        }

        // 如果没有工具调用，返回最终内容
        if !tool_calls_accumulated.is_empty() {
            // 有工具调用，继续循环
            continue;
        }

        return Ok(full_content);
    }
}

/// 执行工具调用
fn execute_tools(tool_calls: &[ToolCallResult]) -> Result<Vec<String>, String> {
    let mut results = Vec::new();
    for tc in tool_calls {
        // 根据工具名称执行对应逻辑
        let result = match tc.name.as_str() {
            // 这里可以根据实际工具扩展
            _ => format!("工具 '{}' 未实现，参数: {}", tc.name, tc.arguments),
        };
        results.push(result);
    }
    Ok(results)
}

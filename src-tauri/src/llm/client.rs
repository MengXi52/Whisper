use crate::models::{ChatMessage, ChatRequest, ChunkEvent};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::Client;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 取消令牌状态，通过 Tauri State 管理
pub struct CancellationTokenState(pub Mutex<bool>);

/// 流式调用 LLM API
///
/// 通过 SSE 接收响应，逐 chunk 通过 Tauri Event 推送到前端
pub async fn stream_chat(
    app: &AppHandle,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    conversation_id: &str,
    message_id: &str,
    cancel_token: &Mutex<bool>,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
        temperature: Some(0.7),
        max_tokens: Some(4096),
    };

    let client = Client::new();
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
                        // 提取内容增量
                        if let Some(choices) = json.get("choices") {
                            if let Some(first_choice) = choices.get(0) {
                                if let Some(delta) = first_choice.get("delta") {
                                    if let Some(content) = delta.get("content") {
                                        if let Some(text) = content.as_str() {
                                            full_content.push_str(text);

                                            // 推送 chunk 到前端
                                            let chunk_event = ChunkEvent {
                                                conversation_id: conversation_id.to_string(),
                                                message_id: message_id.to_string(),
                                                content: text.to_string(),
                                                done: false,
                                            };
                                            let _ = app.emit("chat:chunk", &chunk_event);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {
                        // 忽略无法解析的数据行
                        continue;
                    }
                }
            }
            Err(e) => {
                // SSE 解析错误，记录但继续
                eprintln!("SSE解析错误: {:?}", e);
                continue;
            }
        }
    }

    Ok(full_content)
}

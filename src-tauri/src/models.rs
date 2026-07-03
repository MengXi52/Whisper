use serde::{Deserialize, Serialize};

/// 项目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub genre: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 章节
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub content: String,
    pub sort_order: i64,
    pub status: String,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 设定卡
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingCard {
    pub id: String,
    pub project_id: String,
    pub card_type: String,
    pub name: String,
    pub fields: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 设定卡版本
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingCardVersion {
    pub id: String,
    pub card_id: String,
    pub fields: String,
    pub created_at: String,
}

/// 对话会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub phase: String,
    #[serde(with = "conv_serde")]
    pub skill_ids: Vec<String>,
    pub context_chapter_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/* 自定义序列化：skill_ids 在 DB 中存为 JSON TEXT，但对外序列化为 string[] */
mod conv_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(val: &Vec<String>, serializer: S) -> Result<S::Ok, S::Error> {
        val.serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
        let s = serde_json::Value::deserialize(deserializer)?;
        match s {
            serde_json::Value::Array(arr) => {
                arr.into_iter()
                    .map(|v| v.as_str().map(|s| s.to_string())
                        .ok_or_else(|| serde::de::Error::custom("expected string")))
                    .collect()
            }
            serde_json::Value::String(s) => {
                serde_json::from_str(&s).map_err(serde::de::Error::custom)
            }
            _ => Err(serde::de::Error::custom("expected array or string")),
        }
    }
}

/// 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub created_at: String,
    /// 助手消息携带的工具调用（JSON 字符串），仅 role=assistant 且触发了工具调用时有值
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<String>,
    /// 工具结果消息关联的工具调用 ID，仅 role=tool 时有值
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// 技能
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub tools: String,
    pub trigger_scenarios: String,
    pub is_builtin: bool,
    pub created_at: String,
}

/// API配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model_thinking: String,
    pub model_writing: String,
    pub is_default: bool,
}

/// 聊天请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageParams {
    pub conversation_id: String,
    pub content: String,
    pub model: Option<String>,
    pub skill_ids: Option<Vec<String>>,
}

/// LLM API 请求消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// LLM API 请求体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
}

/// SSE chunk 事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub content: String,
    pub done: bool,
}

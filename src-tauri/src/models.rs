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
    pub skill_ids: String,
    pub context_chapter_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
}

/// LLM API 请求体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

/// SSE chunk 事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub content: String,
    pub done: bool,
}

# 多Agent系统详细设计

> **版本**: 0.1 (草稿)
> **日期**: 2026-07-06
> **状态**: 撰写中
> **前置文档**:
> - [多Agent写作助手需求规格说明书](./多Agent写作助手需求规格说明书.md)
> - [多Agent系统架构设计](./多Agent系统架构设计.md)

---

## 目录

1. [数据库详细设计](#1-数据库详细设计)
2. [Rust模块详细设计 - 数据层](#2-rust模块详细设计---数据层)
3. [Rust模块详细设计 - 执行层](#3-rust模块详细设计---执行层)
4. [Rust模块详细设计 - 命令层](#4-rust模块详细设计---命令层)
5. [前端详细设计](#5-前端详细设计)
6. [P0工作流详细定义](#6-p0工作流详细定义)
7. [P0 Agent提示词模板](#7-p0-agent提示词模板)
8. [P1-P3接口设计](#8-p1-p3接口设计)
9. [集成测试场景](#9-集成测试场景)

---

## 1. 数据库详细设计

### 1.1 表结构完整定义

在 [db.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/db.rs) 的 `create_tables` 函数末尾追加。所有新表使用 `CREATE TABLE IF NOT EXISTS`，幂等创建。

#### 1.1.1 agent_definitions 表（自定义Agent定义）

```sql
CREATE TABLE IF NOT EXISTS agent_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT UNIQUE NOT NULL,           -- 必须以custom_前缀
    name TEXT NOT NULL,                      -- 显示名称
    category TEXT NOT NULL,                  -- creative/analytic/structural/memory/tool
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,             -- 系统提示词模板
    required_tools TEXT NOT NULL DEFAULT '[]',   -- JSON数组
    optional_tools TEXT NOT NULL DEFAULT '[]',   -- JSON数组
    api_config_id INTEGER,                   -- NULL=用项目默认
    model_params TEXT NOT NULL DEFAULT '{"temperature":0.7,"max_tokens":4096,"top_p":null}',
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    is_builtin BOOLEAN NOT NULL DEFAULT 0,   -- 自定义Agent固定为false
    version TEXT NOT NULL DEFAULT '1.0',
    project_id INTEGER,                      -- NULL=全局级
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (api_config_id) REFERENCES api_configs (id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

#### 1.1.2 agent_tasks 表（任务执行历史）

```sql
CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,            -- UUID
    project_id INTEGER NOT NULL,
    conversation_id INTEGER,                 -- 最终结果输出的对话
    workflow_id TEXT NOT NULL,               -- 如 "inspiration_matrix"
    status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/paused_at_checkpoint/failed_awaiting_decision/completed/failed/aborted
    permission_mode TEXT NOT NULL DEFAULT 'hands_off',
    input TEXT NOT NULL,                     -- JSON字符串，用户输入
    output TEXT,                             -- JSON字符串，最终结果摘要
    current_node_id TEXT,                    -- 当前执行节点（断点续传）
    completed_nodes TEXT NOT NULL DEFAULT '[]', -- JSON数组
    error_log TEXT,                          -- 错误详情
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER,
    cache_hit_count INTEGER NOT NULL DEFAULT 0,
    cache_miss_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
);
```

#### 1.1.3 agent_tool_calls 表（工具调用日志）

```sql
CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    node_id TEXT NOT NULL,                   -- 工作流节点ID
    agent_id TEXT NOT NULL,                  -- 调用方Agent
    tool_id TEXT NOT NULL,                   -- 如 "agent.query_setting_cards"
    parameters TEXT NOT NULL,                -- JSON字符串
    result TEXT,                             -- JSON字符串（截断后）
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    cache_hit BOOLEAN NOT NULL DEFAULT 0,
    called_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES agent_tasks (task_id) ON DELETE CASCADE
);
```

#### 1.1.4 story_memory 表（记忆库）

```sql
CREATE TABLE IF NOT EXISTS story_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER UNIQUE NOT NULL,      -- 每项目一条
    characters TEXT NOT NULL DEFAULT '[]',   -- JSON数组
    timeline TEXT NOT NULL DEFAULT '[]',
    locations TEXT NOT NULL DEFAULT '[]',
    foreshadows TEXT NOT NULL DEFAULT '[]',
    baseline_style TEXT,                     -- JSON对象，基线文风
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

#### 1.1.5 foreshadows 表（伏笔管理）

```sql
CREATE TABLE IF NOT EXISTS foreshadows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    foreshadow_id TEXT NOT NULL,             -- 业务ID，如 "f1"
    content TEXT NOT NULL,                   -- 伏笔内容描述
    plant_chapter INTEGER,                   -- 埋设章节号
    plant_scene INTEGER,                     -- 埋设场景号
    payoff_chapter INTEGER,                  -- 回收章节号
    payoff_scene INTEGER,
    status TEXT NOT NULL DEFAULT 'planned',  -- planned/planted/payoff/abandoned
    related_ids TEXT NOT NULL DEFAULT '[]',  -- JSON数组，关联伏笔ID
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

#### 1.1.6 agent_settings 表（Agent系统设置）

```sql
CREATE TABLE IF NOT EXISTS agent_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### 1.2 索引设计

```sql
-- 任务历史查询（按项目列出）
CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id, created_at DESC);

-- 任务状态查询（启动时扫描崩溃任务）
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status) WHERE status IN ('running', 'paused_at_checkpoint', 'failed_awaiting_decision');

-- 工具调用日志查询（按任务）
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_task ON agent_tool_calls(task_id, called_at);

-- 伏笔查询（按项目+状态）
CREATE INDEX IF NOT EXISTS idx_foreshadows_project_status ON foreshadows(project_id, status);

-- 自定义Agent查询（按项目）
CREATE INDEX IF NOT EXISTS idx_agent_definitions_project ON agent_definitions(project_id) WHERE project_id IS NOT NULL;
```

### 1.3 迁移脚本

在 `db.rs` 中新增 `create_agent_tables` 函数，由 `init_db` 调用：

```rust
/// 创建Agent系统相关表
fn create_agent_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(r#"
        -- agent_definitions
        CREATE TABLE IF NOT EXISTS agent_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL,
            required_tools TEXT NOT NULL DEFAULT '[]',
            optional_tools TEXT NOT NULL DEFAULT '[]',
            api_config_id INTEGER,
            model_params TEXT NOT NULL DEFAULT '{"temperature":0.7,"max_tokens":4096,"top_p":null}',
            input_schema TEXT NOT NULL DEFAULT '{}',
            output_schema TEXT NOT NULL DEFAULT '{}',
            is_builtin BOOLEAN NOT NULL DEFAULT 0,
            version TEXT NOT NULL DEFAULT '1.0',
            project_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (api_config_id) REFERENCES api_configs (id) ON DELETE SET NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        -- agent_tasks
        CREATE TABLE IF NOT EXISTS agent_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT UNIQUE NOT NULL,
            project_id INTEGER NOT NULL,
            conversation_id INTEGER,
            workflow_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            permission_mode TEXT NOT NULL DEFAULT 'hands_off',
            input TEXT NOT NULL,
            output TEXT,
            current_node_id TEXT,
            completed_nodes TEXT NOT NULL DEFAULT '[]',
            error_log TEXT,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_tokens INTEGER,
            cache_hit_count INTEGER NOT NULL DEFAULT 0,
            cache_miss_count INTEGER NOT NULL DEFAULT 0,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
        );

        -- agent_tool_calls
        CREATE TABLE IF NOT EXISTS agent_tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            parameters TEXT NOT NULL,
            result TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            success BOOLEAN NOT NULL,
            error_message TEXT,
            cache_hit BOOLEAN NOT NULL DEFAULT 0,
            called_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES agent_tasks (task_id) ON DELETE CASCADE
        );

        -- story_memory
        CREATE TABLE IF NOT EXISTS story_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER UNIQUE NOT NULL,
            characters TEXT NOT NULL DEFAULT '[]',
            timeline TEXT NOT NULL DEFAULT '[]',
            locations TEXT NOT NULL DEFAULT '[]',
            foreshadows TEXT NOT NULL DEFAULT '[]',
            baseline_style TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        -- foreshadows
        CREATE TABLE IF NOT EXISTS foreshadows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            foreshadow_id TEXT NOT NULL,
            content TEXT NOT NULL,
            plant_chapter INTEGER,
            plant_scene INTEGER,
            payoff_chapter INTEGER,
            payoff_scene INTEGER,
            status TEXT NOT NULL DEFAULT 'planned',
            related_ids TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

        -- agent_settings
        CREATE TABLE IF NOT EXISTS agent_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        -- 索引
        CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status) WHERE status IN ('running', 'paused_at_checkpoint', 'failed_awaiting_decision');
        CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_task ON agent_tool_calls(task_id, called_at);
        CREATE INDEX IF NOT EXISTS idx_foreshadows_project_status ON foreshadows(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_agent_definitions_project ON agent_definitions(project_id) WHERE project_id IS NOT NULL;
    "#).map_err(|e| format!("创建Agent表失败: {}", e))?;
    Ok(())
}
```

在 `init_db` 中调用：

```rust
pub fn init_db() -> Result<Connection, String> {
    let conn = Connection::open(get_db_path()?)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    create_tables(&conn)?;
    create_agent_tables(&conn)?;  // 新增
    migrate_messages_table(&conn)?;
    migrate_conversations_table(&conn)?;
    init_builtin_skills(&conn)?;
    init_agent_settings(&conn)?;  // 新增
    Ok(conn)
}
```

### 1.4 种子数据

#### 1.4.1 默认Agent设置

```rust
/// 初始化Agent系统默认设置
fn init_agent_settings(conn: &Connection) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let defaults = vec![
        ("default_permission_mode", "hands_off"),
        ("max_concurrency", "3"),
        ("token_threshold", "100000"),
        ("auto_cleanup_outputs", "false"),
        ("cleanup_after_days", "30"),
    ];

    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO agent_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, now],
        ).map_err(|e| format!("初始化Agent设置失败: {}", e))?;
    }

    Ok(())
}
```

#### 1.4.2 内置Agent/工具/工作流

内置Agent、工具、工作流定义在Rust代码中静态声明（见第2章），不存数据库。应用启动时通过 `registry::init_registry` 加载到内存注册表。

---

## 2. Rust模块详细设计 - 数据层

数据层包含三个文件：[models.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/models.rs)（纯数据结构）、[definitions.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/definitions.rs)（内置实例静态声明）、[registry.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/registry.rs)（注册表查询）。

**设计原则**：
- `models.rs` 不依赖其他 agents 模块，仅依赖 serde/chrono/serde_json，可作为整个 agents 子系统的类型基础
- `definitions.rs` 依赖 `models.rs`，仅声明 P0 阶段必需的实例（8 个 Agent + 10 个工具 + 2 个工作流），P1-P3 阶段在同名文件中扩展
- `registry.rs` 依赖前两者 + `db.rs`，提供运行时查询接口；静态注册表用 `once_cell::sync::Lazy`，动态注册表用 `RwLock<HashMap>` 保护

### 2.1 models.rs - 数据结构

文件位置：`src-tauri/src/agents/models.rs`。全部 public，统一 `#[derive(Debug, Clone, Serialize, Deserialize)]`，与现有 [models.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/models.rs) 风格保持一致。

#### 2.1.1 模块头部与导入

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// 后续文件中会使用 crate::db::DbState、crate::llm::client::TokenUsage 等
// 此处仅声明本模块自有的类型，不引入循环依赖
```

#### 2.1.2 Agent 相关结构

```rust
/// Agent 分类（5 类，与 agent_definitions.category 列对应）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AgentCategory {
    Creative,     // 创意型：发散、组合、成文
    Analytic,     // 分析型：关键词分析、风格分析、一致性检查
    Structural,   // 结构型：大纲生成、章节拆分
    Memory,       // 记忆型：memory_keeper 常驻
    Tool,         // 工具型：不调用 LLM，仅作为节点占位（P0 不使用）
}

impl AgentCategory {
    /// 中文显示名（前端展示用）
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Creative => "创意型",
            Self::Analytic => "分析型",
            Self::Structural => "结构型",
            Self::Memory => "记忆型",
            Self::Tool => "工具型",
        }
    }

    /// 从数据库字符串列解析
    pub fn from_db_str(s: &str) -> Result<Self, String> {
        match s {
            "creative" => Ok(Self::Creative),
            "analytic" => Ok(Self::Analytic),
            "structural" => Ok(Self::Structural),
            "memory" => Ok(Self::Memory),
            "tool" => Ok(Self::Tool),
            other => Err(format!("未知的 Agent 分类: {}", other)),
        }
    }

    /// 写入数据库字符串列
    pub fn to_db_str(&self) -> &'static str {
        match self {
            Self::Creative => "creative",
            Self::Analytic => "analytic",
            Self::Structural => "structural",
            Self::Memory => "memory",
            Self::Tool => "tool",
        }
    }
}

/// Agent 定义（对应 agent_definitions 表 + 静态注册表）
///
/// 内置 Agent 来自 definitions.rs 静态数组（is_builtin=true，project_id=None）；
/// 自定义 Agent 来自数据库（is_builtin=false，project_id 可为项目级或全局级）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    /// 唯一标识。内置 Agent 用语义名（如 "idea_diverger"）；
    /// 自定义 Agent 必须以 "custom_" 前缀（如 "custom_my_writer"）
    pub agent_id: String,
    pub name: String,
    pub category: AgentCategory,
    #[serde(default)]
    pub description: String,
    /// 系统提示词模板，支持 {{variable}} 插值（变量来自 TaskContext.user_input 和上游节点输出）
    pub system_prompt: String,
    /// 必需工具：缺失则 Agent 无法启动
    #[serde(default)]
    pub required_tools: Vec<String>,
    /// 可选工具：Agent 可调用但非必需
    #[serde(default)]
    pub optional_tools: Vec<String>,
    /// None = 用项目默认 API 配置；Some(id) = 强制使用指定配置
    pub api_config_id: Option<i64>,
    #[serde(default)]
    pub model_params: ModelParams,
    /// 输入 JSON Schema，描述 Agent 期望的 input 形状（用于工作流输入映射校验）
    #[serde(default)]
    pub input_schema: serde_json::Value,
    /// 输出 JSON Schema，描述 Agent 产出形状
    #[serde(default)]
    pub output_schema: serde_json::Value,
    pub is_builtin: bool,
    #[serde(default = "default_version")]
    pub version: String,
    /// None = 全局级；Some(pid) = 项目级（仅在该项目下可见）
    pub project_id: Option<i64>,
}

fn default_version() -> String { "1.0".to_string() }

/// 模型参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParams {
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: i32,
    #[serde(default)]
    pub top_p: Option<f32>,
}

fn default_temperature() -> f32 { 0.7 }
fn default_max_tokens() -> i32 { 4096 }

impl Default for ModelParams {
    fn default() -> Self {
        Self { temperature: 0.7, max_tokens: 4096, top_p: None }
    }
}

impl ModelParams {
    /// 从 JSON 字符串解析（兼容数据库 model_params 列的旧格式）
    pub fn from_json_str(s: &str) -> Self {
        serde_json::from_str(s).unwrap_or_default()
    }

    /// 序列化为 JSON 字符串（写入数据库）
    pub fn to_json_str(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Agent 执行产出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutput {
    /// LLM 生成的文本内容（必填，即便 structured 已解析也要保留原文）
    pub content: String,
    /// 解析后的结构化数据（如 LLM 返回 JSON 块时提取）
    #[serde(default)]
    pub structured: Option<serde_json::Value>,
    /// token 消耗（来自 LLM 响应的 usage 字段）
    #[serde(default)]
    pub token_usage: Option<TokenUsage>,
    /// 本轮工具调用记录（按调用顺序）
    #[serde(default)]
    pub tool_calls_log: Vec<ToolCallLog>,
}

/// Token 使用量（与 llm/client.rs 中定义保持兼容）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
}
```

#### 2.1.3 工具相关结构

```rust
/// 工具权限（决定检查点判定与缓存策略）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermission {
    ReadDb,      // 读数据库（设定卡/大纲/对话历史等）
    WriteDb,     // 写数据库
    ReadFile,    // 读文件（中间产出）
    WriteFile,   // 写文件（中间产出）
    ReadMemory,  // 读记忆库
    WriteMemory, // 写记忆库
}

impl ToolPermission {
    /// 是否为写操作（写操作默认视为 dangerous，除非工具显式标记为非危险）
    pub fn is_write(&self) -> bool {
        matches!(self, Self::WriteDb | Self::WriteFile | Self::WriteMemory)
    }
}

/// 工具定义（元数据，仅用于 list_tools 查询展示）
///
/// 注意：工具的"执行逻辑"通过 `ToolHandler` trait 实现，不走此 struct。
/// 此 struct 仅描述工具的静态属性，便于前端展示和注册表查询。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// 工具 ID，必须以 "agent." 前缀
    pub tool_id: String,
    pub name: String,
    pub description: String,
    /// 参数 JSON Schema，传给 LLM
    pub parameters_schema: serde_json::Value,
    /// 结果 JSON Schema（仅用于文档展示，运行时不强校验）
    pub result_schema: serde_json::Value,
    pub required_permission: ToolPermission,
    /// 内部函数标识（如 "settings::create_card"），用于代码定位
    pub internal_function: String,
    pub is_dangerous: bool,
    pub cacheable: bool,
    /// 缓存 TTL（秒）；None = 整个 Pipeline 内有效；Some(n) = n 秒后失效
    pub cache_ttl: Option<i64>,
}

/// 工具调用日志（对应 agent_tool_calls 表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallLog {
    pub tool_id: String,
    pub parameters: serde_json::Value,
    /// 截断后的结果摘要（前 500 字符），避免日志爆炸
    pub result_summary: String,
    pub duration_ms: i64,
    pub success: bool,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub cache_hit: bool,
}

/// 工具执行上下文（每次工具调用时构造）
pub struct ToolContext<'a> {
    pub task_id: String,
    pub agent_id: String,
    pub project_id: i64,
    pub output_dir: PathBuf,            // ./agent_outputs/{task_id}/
    pub db: &'a crate::db::DbState,
}

/// 工具执行结果
#[derive(Debug, Clone)]
pub struct ToolResult {
    /// 返回给 LLM 的文本内容（必填，将拼入下一轮 messages）
    pub content: String,
    /// 结构化数据（可选，写入 agent_tool_calls.result 列）
    pub structured: Option<serde_json::Value>,
    /// 此次结果是否值得缓存（即便工具本身 cacheable=true，单次结果也可声明不缓存）
    pub cacheable_result: bool,
}

impl ToolResult {
    /// 快速构造一个不可缓存的文本结果
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            structured: None,
            cacheable_result: false,
        }
    }
}
```

#### 2.1.4 工作流相关结构

```rust
/// 工作流节点定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    /// 节点 ID，工作流内唯一（如 "n1", "n2"）
    pub node_id: String,
    /// 该节点执行的 Agent ID
    pub agent_id: String,
    /// 临时覆盖 Agent 的 model_params（如让灵感发散师在矩阵生成时 temperature=0.95）
    #[serde(default)]
    pub agent_overrides: Option<ModelParams>,
    /// 输入映射：描述如何从上游节点 output_key 与 user_input 组装本节点输入
    /// 形如 {"keywords": "$user_input", "memory": "$node.n1.output.characters"}
    #[serde(default)]
    pub input_mapping: serde_json::Value,
    /// 输出键名，存入 TaskContext.node_outputs 供下游读取
    pub output_key: String,
    #[serde(default = "default_retry_limit")]
    pub retry_limit: i32,           // 默认 3
    #[serde(default = "default_timeout_sec")]
    pub timeout_sec: i32,           // 默认 300 秒
    /// 并行组标识：相同 parallel_group 的节点并行执行
    #[serde(default)]
    pub parallel_group: Option<String>,
    #[serde(default)]
    pub is_loop: bool,
    #[serde(default)]
    pub loop_config: Option<LoopConfig>,
}

fn default_retry_limit() -> i32 { 3 }
fn default_timeout_sec() -> i32 { 300 }

/// 循环节点配置（仅用于 P3 阶段的对话生成工作流 dialogue_loop）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopConfig {
    pub max_iterations: i32,                 // 最大循环次数
    pub termination_field: String,           // 终止字段名，如 "should_end"
    pub loop_agents: Vec<LoopAgentStep>,     // 循环内交替调用的 Agent
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopAgentStep {
    pub agent_id: String,
    /// "prev_director" = 用上一轮 director 的输出作为输入；"initial" = 用初始输入
    pub input_from: String,
}

/// 工作流边定义（DAG 的边）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdge {
    pub from_node: String,
    pub to_node: String,
    /// 数据映射：{from_output_key: to_input_param}
    /// 留空表示仅作为拓扑顺序约束，不传递数据
    #[serde(default)]
    pub data_mapping: serde_json::Value,
}

/// 权限模式（任务级配置，写入 agent_tasks.permission_mode）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    /// 不干预：所有节点自动执行，包括 dangerous 工具
    HandsOff,
    /// 检查点干预：仅检查点节点暂停等待用户决策
    Supervised,
    /// 全自动：高风险操作也直接执行（用于百万字流水线）
    Autopilot,
}

impl PermissionMode {
    pub fn from_db_str(s: &str) -> Result<Self, String> {
        match s {
            "hands_off" => Ok(Self::HandsOff),
            "supervised" => Ok(Self::Supervised),
            "autopilot" => Ok(Self::Autopilot),
            other => Err(format!("未知的权限模式: {}", other)),
        }
    }
    pub fn to_db_str(&self) -> &'static str {
        match self {
            Self::HandsOff => "hands_off",
            Self::Supervised => "supervised",
            Self::Autopilot => "autopilot",
        }
    }
    /// 是否在 dangerous 工具调用时触发检查点
    pub fn requires_checkpoint_on_dangerous(&self) -> bool {
        matches!(self, Self::Supervised)
    }
}
```

#### 2.1.5 任务执行相关结构

```rust
/// 任务状态机（对应 agent_tasks.status）
///
/// 状态流转：
///   pending → running → (paused_at_checkpoint → running)* → completed
///   running → failed_awaiting_decision → (running 重试 | aborted)
///   任何状态 → aborted（用户主动取消）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,                    // 已创建未启动
    Running,                    // 执行中
    PausedAtCheckpoint,         // 等待用户检查点决策
    FailedAwaitingDecision,     // 执行失败，等待用户重试/放弃
    Completed,                  // 成功完成（终态）
    Failed,                     // 用户放弃后标记失败（终态）
    Aborted,                    // 用户取消（终态）
}

impl TaskStatus {
    pub fn from_db_str(s: &str) -> Result<Self, String> {
        match s {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "paused_at_checkpoint" => Ok(Self::PausedAtCheckpoint),
            "failed_awaiting_decision" => Ok(Self::FailedAwaitingDecision),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "aborted" => Ok(Self::Aborted),
            other => Err(format!("未知任务状态: {}", other)),
        }
    }
    pub fn to_db_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::PausedAtCheckpoint => "paused_at_checkpoint",
            Self::FailedAwaitingDecision => "failed_awaiting_decision",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
        }
    }
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Aborted)
    }
}

/// Pipeline 执行上下文（在一次任务执行中传递，不序列化）
#[derive(Debug, Clone)]
pub struct TaskContext {
    pub task_id: String,
    pub project_id: i64,
    pub conversation_id: Option<i64>,
    pub workflow_id: String,
    pub permission_mode: PermissionMode,
    /// 用户原始输入（已通过 workflow.parse_input 处理）
    pub user_input: serde_json::Value,
    /// 节点产出：node_id → 该节点的 structured 输出
    pub node_outputs: HashMap<String, serde_json::Value>,
    pub current_node_id: Option<String>,
    pub completed_nodes: Vec<String>,
    pub total_tokens: i64,
    /// 工具缓存：cache_key → structured 结果
    pub cache: HashMap<String, serde_json::Value>,
    /// 中间产出目录：./agent_outputs/{task_id}/
    pub output_dir: PathBuf,
}

/// Agent 任务（对应 agent_tasks 表的完整行）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: i64,
    pub task_id: String,
    pub project_id: i64,
    pub conversation_id: Option<i64>,
    pub workflow_id: String,
    pub status: TaskStatus,
    pub permission_mode: PermissionMode,
    /// JSON 字符串（原始用户输入）
    pub input: String,
    /// JSON 字符串（最终结果摘要），任务完成前为 None
    pub output: Option<String>,
    pub current_node_id: Option<String>,
    /// JSON 数组字符串（已完成节点 ID 列表）
    pub completed_nodes: String,
    pub error_log: Option<String>,
    pub total_tokens: i64,
    pub estimated_tokens: Option<i64>,
    pub cache_hit_count: i64,
    pub cache_miss_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}
```

#### 2.1.6 记忆库与伏笔相关结构

```rust
/// 故事记忆库（对应 story_memory 表，每项目一行）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoryMemory {
    pub project_id: i64,
    /// 角色列表（结构化 JSON，按 memory_keeper 维护的格式）
    #[serde(default)]
    pub characters: serde_json::Value,
    /// 时间线事件
    #[serde(default)]
    pub timeline: serde_json::Value,
    /// 地点列表
    #[serde(default)]
    pub locations: serde_json::Value,
    /// 已种下的伏笔（仅引用 foreshadow_id 列表）
    #[serde(default)]
    pub foreshadows: serde_json::Value,
    /// 基线文风样本（来自 style_analyzer 的分析结果）
    #[serde(default)]
    pub baseline_style: Option<serde_json::Value>,
    pub updated_at: String,
}

/// 伏笔条目（对应 foreshadows 表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Foreshadow {
    pub id: i64,
    pub project_id: i64,
    pub foreshadow_id: String,           // 业务 ID，供 Agent 引用
    pub content: String,
    pub plant_chapter: Option<i64>,
    pub plant_scene: Option<i64>,
    pub payoff_chapter: Option<i64>,
    pub payoff_scene: Option<i64>,
    /// planned / planted / paid_off / abandoned
    pub status: String,
    /// 关联的其他 foreshadow_id 列表
    #[serde(default)]
    pub related_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Agent 系统设置（对应 agent_settings 表的键值对）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSetting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}
```

#### 2.1.7 数据库行映射辅助函数

这些函数位于 `models.rs` 末尾，将 `rusqlite::Row` 转换为对应 struct，供 `registry.rs` 和 `commands.rs` 复用。

```rust
use rusqlite::Row;

impl AgentDefinition {
    /// 从 agent_definitions 表的行构造（自定义 Agent 专用）
    pub fn from_db_row(row: &Row) -> Result<Self, rusqlite::Error> {
        let category_str: String = row.get("category")?;
        let required_tools_str: String = row.get("required_tools")?;
        let optional_tools_str: String = row.get("optional_tools")?;
        let model_params_str: String = row.get("model_params")?;
        let input_schema_str: String = row.get("input_schema")?;
        let output_schema_str: String = row.get("output_schema")?;

        Ok(Self {
            agent_id: row.get("agent_id")?,
            name: row.get("name")?,
            category: AgentCategory::from_db_str(&category_str)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, e.into()))?,
            description: row.get("description")?,
            system_prompt: row.get("system_prompt")?,
            required_tools: serde_json::from_str(&required_tools_str).unwrap_or_default(),
            optional_tools: serde_json::from_str(&optional_tools_str).unwrap_or_default(),
            api_config_id: row.get("api_config_id")?,
            model_params: ModelParams::from_json_str(&model_params_str),
            input_schema: serde_json::from_str(&input_schema_str).unwrap_or(serde_json::Value::Null),
            output_schema: serde_json::from_str(&output_schema_str).unwrap_or(serde_json::Value::Null),
            is_builtin: row.get("is_builtin")?,
            version: row.get("version")?,
            project_id: row.get("project_id")?,
        })
    }
}

impl AgentTask {
    /// 从 agent_tasks 表的行构造
    pub fn from_db_row(row: &Row) -> Result<Self, rusqlite::Error> {
        let status_str: String = row.get("status")?;
        let mode_str: String = row.get("permission_mode")?;
        Ok(Self {
            id: row.get("id")?,
            task_id: row.get("task_id")?,
            project_id: row.get("project_id")?,
            conversation_id: row.get("conversation_id")?,
            workflow_id: row.get("workflow_id")?,
            status: TaskStatus::from_db_str(&status_str)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, e.into()))?,
            permission_mode: PermissionMode::from_db_str(&mode_str)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, e.into()))?,
            input: row.get("input")?,
            output: row.get("output")?,
            current_node_id: row.get("current_node_id")?,
            completed_nodes: row.get("completed_nodes")?,
            error_log: row.get("error_log")?,
            total_tokens: row.get("total_tokens")?,
            estimated_tokens: row.get("estimated_tokens")?,
            cache_hit_count: row.get("cache_hit_count")?,
            cache_miss_count: row.get("cache_miss_count")?,
            started_at: row.get("started_at")?,
            completed_at: row.get("completed_at")?,
            created_at: row.get("created_at")?,
        })
    }
}

impl StoryMemory {
    pub fn from_db_row(row: &Row) -> Result<Self, rusqlite::Error> {
        Ok(Self {
            project_id: row.get("project_id")?,
            characters: serde_json::from_str(
                &row.get::<_, String>("characters")?
            ).unwrap_or(serde_json::Value::Array(vec![])),
            timeline: serde_json::from_str(
                &row.get::<_, String>("timeline")?
            ).unwrap_or(serde_json::Value::Array(vec![])),
            locations: serde_json::from_str(
                &row.get::<_, String>("locations")?
            ).unwrap_or(serde_json::Value::Array(vec![])),
            foreshadows: serde_json::from_str(
                &row.get::<_, String>("foreshadows")?
            ).unwrap_or(serde_json::Value::Array(vec![])),
            baseline_style: row.get::<_, Option<String>>("baseline_style")?
                .and_then(|s| serde_json::from_str(&s).ok()),
            updated_at: row.get("updated_at")?,
        })
    }
}

impl Foreshadow {
    pub fn from_db_row(row: &Row) -> Result<Self, rusqlite::Error> {
        let related_ids_str: String = row.get("related_ids")?;
        Ok(Self {
            id: row.get("id")?,
            project_id: row.get("project_id")?,
            foreshadow_id: row.get("foreshadow_id")?,
            content: row.get("content")?,
            plant_chapter: row.get("plant_chapter")?,
            plant_scene: row.get("plant_scene")?,
            payoff_chapter: row.get("payoff_chapter")?,
            payoff_scene: row.get("payoff_scene")?,
            status: row.get("status")?,
            related_ids: serde_json::from_str(&related_ids_str).unwrap_or_default(),
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}
```

**说明**：
- `from_db_row` 统一使用 `row.get("column_name")` 形式（依赖 SELECT 列别名），避免列顺序耦合
- JSON 字段反序列化失败时使用 `unwrap_or_default` 容错，保证历史数据迁移后仍能加载
- `AgentDefinition` 与 `AgentTask` 的 `from_db_row` 在后续 `registry.rs` 与 `commands.rs` 中复用，避免重复映射代码

### 2.2 definitions.rs - 静态定义

文件位置：`src-tauri/src/agents/definitions.rs`。该文件仅包含静态数据声明（`const`/`static` 数组），不含任何逻辑实现。完整 system_prompt 模板见 [第 7 章](#7-p0-agent提示词模板)，本节用占位符 `include_str!` 或简短摘要表示。

#### 2.2.1 文件职责与 P0 范围

| 资源 | P0 数量 | P1-P3 待补 | 说明 |
|---|---|---|---|
| 内置 Agent | 8 | 19 | P0 覆盖灵感矩阵 + 改写润色两条管道 |
| 工具元数据 | 10 | 10 | P0 复用现有 10 个内部函数 |
| 工作流 | 2 | 4 | inspiration_matrix + rewrite_polish |

P1-P3 阶段在同一文件追加静态数组项即可，无需修改 `registry.rs`。

#### 2.2.2 工作流元数据结构

`WorkflowDefinition` 概念上属于 `models.rs`，但为避免 2.1 节膨胀，将其定义放在 `definitions.rs` 顶部（与实例数据紧邻）。`Workflow` trait 的实现在 [3.3 pipeline.rs](#33-pipeliners---pipeline引擎) 中通过 `impl Workflow for WorkflowDefinition` 提供。

```rust
use serde::{Deserialize, Serialize};

/// 工作流元数据（静态声明的 P0 工作流数据载体）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub workflow_id: String,
    pub name: String,
    pub description: String,
    pub default_permission_mode: super::models::PermissionMode,
    pub nodes: Vec<super::models::WorkflowNode>,
    pub edges: Vec<super::models::WorkflowEdge>,
    /// 检查点节点 ID 列表（这些节点执行后暂停等待用户决策）
    pub checkpoints: Vec<String>,
    /// 预估 token 消耗的简化公式标识（Pipeline 引擎按此查表估算）
    /// "matrix_small" / "matrix_large" / "rewrite_short" / "rewrite_long"
    pub token_estimate_key: &'static str,
}
```

#### 2.2.3 P0 Agent 定义

8 个 P0 Agent 的 `AgentDefinition` 完整声明。系统提示词字段使用 `include_str!` 引用外部 md 文件（见第 7 章），避免本文件膨胀。

```rust
use super::models::{AgentCategory, AgentDefinition, ModelParams, ToolPermission, ToolDefinition};
use once_cell::sync::Lazy;

/// 内置 Agent 静态注册表
///
/// 说明：由于 AgentDefinition 含 String/Vec 字段（需堆分配），
/// 不能用 `&'static [AgentDefinition]`，改用 `Lazy<Vec<...>>` 在首次访问时初始化。
pub static BUILTIN_AGENTS: Lazy<Vec<AgentDefinition>> = Lazy::new(|| vec![
    // ─── 灵感矩阵管道（4 个 Agent）───
    AgentDefinition {
        agent_id: "keyword_analyst".to_string(),
        name: "关键词分析师".to_string(),
        category: AgentCategory::Analytic,
        description: "解析用户的模糊关键词，提取可创作的维度（题材/受众/情绪/卖点）".to_string(),
        system_prompt: include_str!("../prompts/keyword_analyst.md"),
        required_tools: vec![],
        optional_tools: vec!["agent.query_project_info".to_string()],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.3, max_tokens: 2048, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "keywords": { "type": "array", "items": { "type": "string" } },
                "project_id": { "type": "integer" }
            },
            "required": ["keywords"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "dimensions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "options": { "type": "array", "items": { "type": "string" } }
                        }
                    }
                }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
    AgentDefinition {
        agent_id: "idea_diverger".to_string(),
        name: "灵感发散师".to_string(),
        category: AgentCategory::Creative,
        description: "基于关键词分析师提供的维度，在每个维度上发散 5-10 个具体灵感点".to_string(),
        system_prompt: include_str!("../prompts/idea_diverger.md"),
        required_tools: vec![],
        optional_tools: vec!["agent.read_memory".to_string()],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.95, max_tokens: 4096, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "dimensions": { "type": "array" },
                "memory": { "type": "object" }
            },
            "required": ["dimensions"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "divergence": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "dimension": { "type": "string" },
                            "ideas": { "type": "array", "items": { "type": "string" } }
                        }
                    }
                }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
    AgentDefinition {
        agent_id: "inspiration_combiner".to_string(),
        name: "灵感组合师".to_string(),
        category: AgentCategory::Creative,
        description: "跨维度组合灵感点，生成 N 条故事种子（每条含一句话简介 + 三幕式骨架）".to_string(),
        system_prompt: include_str!("../prompts/inspiration_combiner.md"),
        required_tools: vec![],
        optional_tools: vec![],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.8, max_tokens: 4096, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": { "divergence": { "type": "array" } },
            "required": ["divergence"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "seeds": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "logline": { "type": "string" },
                            "three_act": { "type": "string" }
                        }
                    }
                }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
    AgentDefinition {
        agent_id: "inspiration_matrix_writer".to_string(),
        name: "矩阵成文师".to_string(),
        category: AgentCategory::Creative,
        description: "将用户选中的故事种子扩展为 800-1500 字的短文，提供三种文风变体".to_string(),
        system_prompt: include_str!("../prompts/inspiration_matrix_writer.md"),
        required_tools: vec![],
        optional_tools: vec![],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.85, max_tokens: 4096, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "selected_seeds": { "type": "array" },
                "style_variants": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["selected_seeds"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "drafts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "seed_title": { "type": "string" },
                            "style": { "type": "string" },
                            "content": { "type": "string" }
                        }
                    }
                }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },

    // ─── 改写润色管道（3 个 Agent）───
    AgentDefinition {
        agent_id: "style_analyzer".to_string(),
        name: "风格分析师".to_string(),
        category: AgentCategory::Analytic,
        description: "分析用户提供的样本文本，提取文风特征（句长/节奏/词汇偏好/修辞）".to_string(),
        system_prompt: include_str!("../prompts/style_analyzer.md"),
        required_tools: vec!["agent.read_memory".to_string()],
        optional_tools: vec![],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.2, max_tokens: 2048, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "sample_text": { "type": "string" },
                "project_id": { "type": "integer" }
            },
            "required": ["sample_text"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "style_features": {
                    "type": "object",
                    "properties": {
                        "avg_sentence_length": { "type": "number" },
                        "rhythm": { "type": "string" },
                        "vocabulary_preference": { "type": "string" },
                        "rhetoric": { "type": "string" }
                    }
                }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
    AgentDefinition {
        agent_id: "style_rewriter".to_string(),
        name: "改写执行师".to_string(),
        category: AgentCategory::Creative,
        description: "按目标文风重写输入文本，保持原意不变".to_string(),
        system_prompt: include_str!("../prompts/style_rewriter.md"),
        required_tools: vec![],
        optional_tools: vec!["agent.read_memory".to_string()],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.7, max_tokens: 4096, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "original_text": { "type": "string" },
                "target_style": { "type": "object" }
            },
            "required": ["original_text", "target_style"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": { "rewritten_text": { "type": "string" } }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
    AgentDefinition {
        agent_id: "style_polisher".to_string(),
        name: "润色优化师".to_string(),
        category: AgentCategory::Creative,
        description: "对改写后的文本做最后润色：修语病、补节奏、强化情绪点".to_string(),
        system_prompt: include_str!("../prompts/style_polisher.md"),
        required_tools: vec![],
        optional_tools: vec![],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.5, max_tokens: 4096, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "rewritten_text": { "type": "string" },
                "target_style": { "type": "object" }
            },
            "required": ["rewritten_text"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "final_text": { "type": "string" },
                "changes_summary": { "type": "string" }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },

    // ─── 记忆库服务（1 个 Agent，跨任务常驻）───
    AgentDefinition {
        agent_id: "memory_keeper".to_string(),
        name: "记忆库守护者".to_string(),
        category: AgentCategory::Memory,
        description: "维护项目故事记忆库，供其他 Agent 查询角色/时间线/地点/伏笔".to_string(),
        system_prompt: include_str!("../prompts/memory_keeper.md"),
        required_tools: vec![
            "agent.read_memory".to_string(),
            "agent.write_memory".to_string(),
        ],
        optional_tools: vec![],
        api_config_id: None,
        model_params: ModelParams { temperature: 0.1, max_tokens: 2048, top_p: None },
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "operation": { "type": "string", "enum": ["query", "update", "summary"] },
                "query": { "type": "string" },
                "updates": { "type": "object" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "memory_snapshot": { "type": "object" }
            }
        }),
        is_builtin: true,
        version: "1.0".to_string(),
        project_id: None,
    },
];

// P1-P3 待补 Agent（占位声明，避免遗忘）：
// creative: world_builder, character_designer, scene_writer, dialogue_writer, chapter_writer
// analytic: consistency_checker, plot_analyst, reader_simulator
// structural: outline_generator, chapter_splitter, arc_planner, foreshadow_manager
// memory: (memory_keeper 已在 P0)
// tool: file_exporter, version_manager
// 共 19 个，详见需求规格说明书第 4 章
]);
```

#### 2.2.4 P0 工具元数据定义

10 个 P0 工具的 `ToolDefinition` 元数据。工具的实际执行逻辑（`ToolHandler` 实现）在 [3.1 tools.rs](#31-toolsrs---工具适配层) 中。

```rust
/// 内置工具元数据静态数组（仅用于 list_tools 查询展示）
pub static BUILTIN_TOOL_DEFINITIONS: Lazy<Vec<ToolDefinition>> = Lazy::new(|| vec![
    // ─── 设定卡类（4 个，复用 commands/settings.rs）───
    ToolDefinition {
        tool_id: "agent.create_setting_card",
        name: "创建设定卡",
        description: "创建一张新的设定卡（角色/地点/物品等）",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "card_type": { "type": "string", "description": "角色/地点/物品/势力/概念" },
                "name": { "type": "string" },
                "fields": { "type": "object", "description": "字段键值对" }
            },
            "required": ["project_id", "card_type", "name", "fields"]
        }),
        result_schema: serde_json::json!({
            "type": "object",
            "properties": { "card_id": { "type": "string" }, "name": { "type": "string" } }
        }),
        required_permission: ToolPermission::WriteDb,
        internal_function: "settings::create_card_internal".to_string(),
        is_dangerous: false,
        cacheable: false,
        cache_ttl: None,
    },
    ToolDefinition {
        tool_id: "agent.query_setting_cards",
        name: "查询设定卡",
        description: "按类型/名称查询项目设定卡列表",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "card_type": { "type": "string" },
                "name_keyword": { "type": "string" }
            },
            "required": ["project_id"]
        }),
        result_schema: serde_json::json!({ "type": "array" }),
        required_permission: ToolPermission::ReadDb,
        internal_function: "settings::list_cards_internal".to_string(),
        is_dangerous: false,
        cacheable: true,         // 同一 Pipeline 内设定卡不变，可缓存
        cache_ttl: None,
    },
    ToolDefinition {
        tool_id: "agent.update_setting_card",
        name: "更新设定卡",
        description: "更新设定卡的字段内容",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "card_id": { "type": "string" },
                "fields": { "type": "object" }
            },
            "required": ["card_id", "fields"]
        }),
        result_schema: serde_json::json!({ "type": "object" }),
        required_permission: ToolPermission::WriteDb,
        internal_function: "settings::update_card_internal".to_string(),
        is_dangerous: true,      // 写操作，触发检查点
        cacheable: false,
        cache_ttl: None,
    },
    ToolDefinition {
        tool_id: "agent.delete_setting_card",
        name: "删除设定卡",
        description: "删除指定设定卡",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": { "card_id": { "type": "string" } },
            "required": ["card_id"]
        }),
        result_schema: serde_json::json!({ "type": "boolean" }),
        required_permission: ToolPermission::WriteDb,
        internal_function: "settings::delete_card_internal".to_string(),
        is_dangerous: true,
        cacheable: false,
        cache_ttl: None,
    },

    // ─── 大纲类（2 个，复用 commands/project.rs）───
    ToolDefinition {
        tool_id: "agent.create_outline_node",
        name: "创建大纲节点",
        description: "在项目大纲中创建新章节/场景节点",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "parent_id": { "type": "string" },
                "title": { "type": "string" },
                "content": { "type": "string" },
                "sort_order": { "type": "integer" }
            },
            "required": ["project_id", "title"]
        }),
        result_schema: serde_json::json!({ "type": "object" }),
        required_permission: ToolPermission::WriteDb,
        internal_function: "project::create_chapter_internal".to_string(),
        is_dangerous: false,
        cacheable: false,
        cache_ttl: None,
    },
    ToolDefinition {
        tool_id: "agent.query_outline",
        name: "查询大纲",
        description: "查询项目大纲树（可按父节点过滤）",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "parent_id": { "type": "string" }
            },
            "required": ["project_id"]
        }),
        result_schema: serde_json::json!({ "type": "array" }),
        required_permission: ToolPermission::ReadDb,
        internal_function: "project::list_chapters_internal".to_string(),
        is_dangerous: false,
        cacheable: true,
        cache_ttl: None,
    },

    // ─── 对话历史类（1 个，复用 commands/chat.rs）───
    ToolDefinition {
        tool_id: "agent.query_conversation_history",
        name: "查询对话历史",
        description: "查询指定对话的消息历史（用于 Agent 理解上下文）",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "conversation_id": { "type": "integer" },
                "limit": { "type": "integer", "default": 20 }
            },
            "required": ["conversation_id"]
        }),
        result_schema: serde_json::json!({ "type": "array" }),
        required_permission: ToolPermission::ReadDb,
        internal_function: "chat::get_messages_internal".to_string(),
        is_dangerous: false,
        cacheable: true,
        cache_ttl: Some(300),    // 5 分钟内不复查
    },

    // ─── 项目信息类（1 个，复用 commands/project.rs）───
    ToolDefinition {
        tool_id: "agent.query_project_info",
        name: "查询项目信息",
        description: "查询项目元数据（名称/类型/描述）",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": { "project_id": { "type": "integer" } },
            "required": ["project_id"]
        }),
        result_schema: serde_json::json!({ "type": "object" }),
        required_permission: ToolPermission::ReadDb,
        internal_function: "project::get_project_internal".to_string(),
        is_dangerous: false,
        cacheable: true,
        cache_ttl: None,
    },

    // ─── 记忆库类（2 个，新增实现）───
    ToolDefinition {
        tool_id: "agent.read_memory",
        name: "读取记忆库",
        description: "查询项目故事记忆库（角色/时间线/地点/伏笔/基线文风）",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "section": { "type": "string", "enum": ["characters", "timeline", "locations", "foreshadows", "baseline_style", "all"] }
            },
            "required": ["project_id"]
        }),
        result_schema: serde_json::json!({ "type": "object" }),
        required_permission: ToolPermission::ReadMemory,
        internal_function: "memory::read_memory_internal".to_string(),
        is_dangerous: false,
        cacheable: true,
        cache_ttl: Some(600),    // 10 分钟
    },
    ToolDefinition {
        tool_id: "agent.write_memory",
        name: "写入记忆库",
        description: "更新项目故事记忆库的某个分区",
        parameters_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "section": { "type": "string", "enum": ["characters", "timeline", "locations", "foreshadows", "baseline_style"] },
                "data": { "type": "object" },
                "merge_strategy": { "type": "string", "enum": ["replace", "append", "merge"], "default": "merge" }
            },
            "required": ["project_id", "section", "data"]
        }),
        result_schema: serde_json::json!({ "type": "object" }),
        required_permission: ToolPermission::WriteMemory,
        internal_function: "memory::write_memory_internal".to_string(),
        is_dangerous: true,
        cacheable: false,
        cache_ttl: None,
    },
]);

// P1-P3 待补工具（10 个）：
// agent.update_outline_node / agent.delete_outline_node
// agent.create_foreshadow / agent.query_foreshadows / agent.update_foreshadow_status
// agent.query_chapter_content / agent.update_chapter_content
// agent.export_file / agent.create_version_snapshot / agent.rollback_version
```

#### 2.2.5 P0 工作流定义

两个 P0 工作流的完整 DAG 声明。节点 ID 用 `n1`/`n2`/... 简写，`output_key` 用语义名。

##### 2.2.5.1 灵感矩阵生成工作流（inspiration_matrix）

```rust
pub static WORKFLOW_INSPIRATION_MATRIX: Lazy<WorkflowDefinition> = Lazy::new(|| WorkflowDefinition {
    workflow_id: "inspiration_matrix".to_string(),
    name: "灵感矩阵生成".to_string(),
    description: "从模糊关键词出发，经维度分析→灵感发散→跨维度组合→矩阵成文，生成多条故事种子与短文".to_string(),
    default_permission_mode: super::models::PermissionMode::HandsOff,
    nodes: vec![
        super::models::WorkflowNode {
            node_id: "n1".to_string(),
            agent_id: "keyword_analyst".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "keywords": "$user_input.keywords",
                "project_id": "$user_input.project_id"
            }),
            output_key: "dimensions".to_string(),
            retry_limit: 3,
            timeout_sec: 120,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "n2".to_string(),
            agent_id: "memory_keeper".to_string(),
            agent_overrides: Some(super::models::ModelParams { temperature: 0.0, max_tokens: 1024, top_p: None }),
            input_mapping: serde_json::json!({
                "operation": "query",
                "query": "characters,timeline,locations"
            }),
            output_key: "memory_snapshot".to_string(),
            retry_limit: 2,
            timeout_sec: 60,
            parallel_group: Some("after_n1".to_string()),  // 与 n3 并行
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "n3".to_string(),
            agent_id: "idea_diverger".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "dimensions": "$node.n1.output.dimensions",
                "memory": "$node.n2.output.memory_snapshot"
            }),
            output_key: "divergence".to_string(),
            retry_limit: 3,
            timeout_sec: 180,
            parallel_group: Some("after_n1".to_string()),
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "n4".to_string(),
            agent_id: "inspiration_combiner".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "divergence": "$node.n3.output.divergence"
            }),
            output_key: "seeds".to_string(),
            retry_limit: 3,
            timeout_sec: 180,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "n5".to_string(),
            agent_id: "inspiration_matrix_writer".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "selected_seeds": "$user_input.selected_seeds",
                "style_variants": "$user_input.style_variants"
            }),
            output_key: "drafts".to_string(),
            retry_limit: 2,
            timeout_sec: 300,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
    ],
    edges: vec![
        super::models::WorkflowEdge { from_node: "n1".to_string(), to_node: "n2".to_string(), data_mapping: serde_json::json!({}) },
        super::models::WorkflowEdge { from_node: "n1".to_string(), to_node: "n3".to_string(), data_mapping: serde_json::json!({ "dimensions": "dimensions" }) },
        super::models::WorkflowEdge { from_node: "n3".to_string(), to_node: "n4".to_string(), data_mapping: serde_json::json!({ "divergence": "divergence" }) },
        super::models::WorkflowEdge { from_node: "n4".to_string(), to_node: "n5".to_string(), data_mapping: serde_json::json!({}) },
    ],
    checkpoints: vec!["n4".to_string()],   // 用户在 n4 后选择哪些种子进入 n5 成文
    token_estimate_key: "matrix_small",
});
```

**DAG 图示**：

```
        n1 (keyword_analyst)
        │
        ├─→ n2 (memory_keeper) ──┐
        │                         ├─→ n3 (idea_diverger) ─→ n4 (inspiration_combiner) ─[检查点]─→ n5 (matrix_writer)
        └─────────────────────────┘
```

- `n2` 与 `n3` 同属 `after_n1` 并行组，但 `n3` 的 `input_mapping` 同时引用 `n1` 和 `n2`，Pipeline 引擎在并行组执行后合并产出再传入 `n3`
- `n4` 是检查点：用户从生成的种子中勾选 `selected_seeds` 进入 `n5`
- 默认权限模式 `HandsOff`：除检查点外全自动，适合"快速给思路"场景

##### 2.2.5.2 多视角改写润色工作流（rewrite_polish）

```rust
pub static WORKFLOW_REWRITE_POLISH: Lazy<WorkflowDefinition> = Lazy::new(|| WorkflowDefinition {
    workflow_id: "rewrite_polish".to_string(),
    name: "多视角改写润色".to_string(),
    description: "样本文风分析→按目标文风改写→润色定稿，三节点串行管道".to_string(),
    default_permission_mode: super::models::PermissionMode::HandsOff,
    nodes: vec![
        super::models::WorkflowNode {
            node_id: "r1".to_string(),
            agent_id: "style_analyzer".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "sample_text": "$user_input.sample_text",
                "project_id": "$user_input.project_id"
            }),
            output_key: "style_features".to_string(),
            retry_limit: 3,
            timeout_sec: 120,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "r2".to_string(),
            agent_id: "style_rewriter".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "original_text": "$user_input.target_text",
                "target_style": "$node.r1.output.style_features"
            }),
            output_key: "rewritten_text".to_string(),
            retry_limit: 3,
            timeout_sec: 240,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
        super::models::WorkflowNode {
            node_id: "r3".to_string(),
            agent_id: "style_polisher".to_string(),
            agent_overrides: None,
            input_mapping: serde_json::json!({
                "rewritten_text": "$node.r2.output.rewritten_text",
                "target_style": "$node.r1.output.style_features"
            }),
            output_key: "final_text".to_string(),
            retry_limit: 2,
            timeout_sec: 180,
            parallel_group: None,
            is_loop: false,
            loop_config: None,
        },
    ],
    edges: vec![
        super::models::WorkflowEdge { from_node: "r1".to_string(), to_node: "r2".to_string(), data_mapping: serde_json::json!({ "style_features": "target_style" }) },
        super::models::WorkflowEdge { from_node: "r2".to_string(), to_node: "r3".to_string(), data_mapping: serde_json::json!({ "rewritten_text": "rewritten_text" }) },
    ],
    checkpoints: vec![],   // 无检查点：纯串行，全自动
    token_estimate_key: "rewrite_short",
});
```

**DAG 图示**：

```
r1 (style_analyzer) ─→ r2 (style_rewriter) ─→ r3 (style_polisher)
```

- 纯串行管道，无并行组，无检查点
- 用户输入需提供 `sample_text`（文风样本）和 `target_text`（待改写文本）两个字段
- `r1` 的产出 `style_features` 同时供 `r2`（作为 `target_style`）和 `r3`（作为 `target_style`）使用

##### 2.2.5.3 静态数组合并

```rust
/// 内置工作流查询函数（registry.rs 通过此函数访问内置工作流）
///
/// 说明：由于工作流是 Lazy<WorkflowDefinition>，
/// 不能用 `&'static [&'static WorkflowDefinition]` 数组聚合，
/// 改用函数返回 Vec<&'static WorkflowDefinition>。
pub fn get_builtin_workflows() -> Vec<&'static WorkflowDefinition> {
    vec![
        &*WORKFLOW_INSPIRATION_MATRIX,
        &*WORKFLOW_REWRITE_POLISH,
        // P1-P3 待补：
        // &*WORKFLOW_OUTLINE_GENERATION,
        // &*WORKFLOW_DIALOGUE_LOOP,
        // &*WORKFLOW_CONSISTENCY_CHECK,
        // &*WORKFLOW_MEGA_PIPELINE,
    ]
}

/// 按 ID 查询内置工作流
pub fn find_builtin_workflow(id: &str) -> Option<&'static WorkflowDefinition> {
    get_builtin_workflows().into_iter().find(|w| w.workflow_id == id)
}

/// 预估 token 消耗查表（Pipeline 引擎调用）
pub fn estimate_tokens(key: &str) -> i64 {
    match key {
        "matrix_small" => 12_000,    // 8 关键词以内
        "matrix_large" => 35_000,    // 8 关键词以上
        "rewrite_short" => 6_000,    // < 2000 字
        "rewrite_long" => 18_000,    // >= 2000 字
        _ => 10_000,
    }
}
```

### 2.3 registry.rs - 注册表

文件位置：`src-tauri/src/agents/registry.rs`。合并静态注册表（来自 [definitions.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/definitions.rs)）和动态注册表（来自数据库 `agent_definitions` 表），对外提供统一查询接口。

#### 2.3.1 静态注册表结构

```rust
use std::collections::HashMap;
use std::sync::{RwLock};
use once_cell::sync::Lazy;
use rusqlite::Connection;

use super::models::{AgentCategory, AgentDefinition, ToolDefinition};
use super::definitions;

// ─────────────────────────────────────────────────────
// Agent 注册表（可变：自定义 Agent 运行时增删）
// ─────────────────────────────────────────────────────
/// 全局 Agent 注册表：agent_id → AgentDefinition
///
/// 启动时由 init_registry 填充：内置 Agent + 数据库自定义 Agent。
/// 用户创建/导入/删除自定义 Agent 后通过 reload_custom_agents 刷新。
static AGENT_REGISTRY: Lazy<RwLock<HashMap<String, AgentDefinition>>> = Lazy::new(|| {
    RwLock::new(HashMap::new())
});

// ─────────────────────────────────────────────────────
// 工具注册表（不可变：所有工具都是代码内置的）
// ─────────────────────────────────────────────────────
/// 全局工具元数据注册表：tool_id → ToolDefinition
///
/// 仅用于 list_tools 查询展示。工具的执行逻辑（ToolHandler）在 tools.rs 注册。
static TOOL_DEFINITIONS_REGISTRY: Lazy<HashMap<String, ToolDefinition>> = Lazy::new(|| {
    let mut map = HashMap::new();
    for tool in definitions::BUILTIN_TOOL_DEFINITIONS.iter() {
        map.insert(tool.tool_id.clone(), tool.clone());
    }
    map
});

// ─────────────────────────────────────────────────────
// 工具处理器注册表（不可变：代码内置）
// ─────────────────────────────────────────────────────
/// 全局工具处理器注册表：tool_id → Box<dyn ToolHandler>
///
/// 注意：ToolHandler trait 的实例在 tools.rs 中实现并通过
/// `super::tools::register_tool_handlers()` 注册。
/// 此处仅声明 extern 声明，实际填充由 tools.rs 完成。
static TOOL_HANDLERS_REGISTRY: Lazy<HashMap<String, Box<dyn super::tools::ToolHandler>>> = Lazy::new(|| {
    let mut map: HashMap<String, Box<dyn super::tools::ToolHandler>> = HashMap::new();
    super::tools::register_tool_handlers(&mut map);
    map
});

// ─────────────────────────────────────────────────────
// 工作流注册表（不可变：所有工作流都是代码内置的）
// ─────────────────────────────────────────────────────
/// 全局工作流注册表：workflow_id → &'static WorkflowDefinition
static WORKFLOW_REGISTRY: Lazy<HashMap<String, &'static super::definitions::WorkflowDefinition>> = Lazy::new(|| {
    let mut map = HashMap::new();
    for wf in definitions::get_builtin_workflows() {
        map.insert(wf.workflow_id.clone(), wf);
    }
    map
});
```

**说明**：
- `AGENT_REGISTRY` 用 `RwLock` 保护：读多写少，启动后查询远多于增删
- `TOOL_DEFINITIONS_REGISTRY` 与 `TOOL_HANDLERS_REGISTRY` 分离：元数据用于查询展示，处理器用于实际执行；前者可序列化返回前端，后者是函数对象不可序列化
- `TOOL_HANDLERS_REGISTRY` 依赖 `super::tools::ToolHandler` trait 与 `register_tool_handlers` 函数，这两个在 [3.1 tools.rs](#31-toolsrs---工具适配层) 中定义；本节仅声明依赖关系
- `WORKFLOW_REGISTRY` 存储的是 `&'static WorkflowDefinition` 引用，因为 `definitions.rs` 中的工作流都用 `Lazy<WorkflowDefinition>` 包装，可通过 `&*LAZY` 取出静态引用

#### 2.3.2 初始化函数

```rust
/// 初始化注册表（在 lib.rs 的 setup 钩子中调用，紧随 init_db 之后）
///
/// 步骤：
/// 1. 加载内置 Agent（来自 definitions::BUILTIN_AGENTS）
/// 2. 加载数据库中的自定义 Agent（来自 agent_definitions 表）
/// 3. 工具与工作流注册表是 Lazy 初始化，首次访问时自动填充，无需显式调用
pub fn init_registry(db: &Connection) -> Result<(), String> {
    let mut registry = AGENT_REGISTRY.write()
        .map_err(|e| format!("Agent 注册表写锁失败: {}", e))?;

    registry.clear();

    // 1. 加载内置 Agent
    for agent in definitions::BUILTIN_AGENTS.iter() {
        registry.insert(agent.agent_id.clone(), agent.clone());
    }

    // 2. 加载数据库自定义 Agent
    let custom_agents = load_custom_agents_from_db(db)?;
    for agent in custom_agents {
        registry.insert(agent.agent_id.clone(), agent);
    }

    Ok(())
}

/// 从数据库加载所有自定义 Agent
fn load_custom_agents_from_db(db: &Connection) -> Result<Vec<AgentDefinition>, String> {
    let mut stmt = db.prepare(
        "SELECT agent_id, name, category, description, system_prompt, \
         required_tools, optional_tools, api_config_id, model_params, \
         input_schema, output_schema, is_builtin, version, project_id \
         FROM agent_definitions ORDER BY created_at ASC"
    ).map_err(|e| format!("准备 agent_definitions 查询失败: {}", e))?;

    let agents: Vec<AgentDefinition> = stmt.query_map([], AgentDefinition::from_db_row)
        .map_err(|e| format!("查询 agent_definitions 失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(agents)
}
```

#### 2.3.3 查询接口

```rust
/// 查询 Agent 定义
///
/// 优先从注册表缓存查找；若未找到且 agent_id 以 "custom_" 开头，
/// 尝试从数据库重新加载（应对热加载场景）。
pub fn get_agent(agent_id: &str) -> Option<AgentDefinition> {
    {
        let registry = AGENT_REGISTRY.read().ok()?;
        if let Some(agent) = registry.get(agent_id) {
            return Some(agent.clone());
        }
    }
    // 缓存未命中：内置 Agent 不应走到这里（启动时已加载）
    // 自定义 Agent 的热加载由 reload_custom_agents 显式触发
    None
}

/// 查询工具元数据（用于 list_tools 展示）
pub fn get_tool_definition(tool_id: &str) -> Option<ToolDefinition> {
    TOOL_DEFINITIONS_REGISTRY.get(tool_id).cloned()
}

/// 查询工具处理器（用于工具执行）
///
/// 返回 &'static 引用，因为 TOOL_HANDLERS_REGISTRY 是 Lazy 静态变量。
pub fn get_tool_handler(tool_id: &str) -> Option<&'static dyn super::tools::ToolHandler> {
    TOOL_HANDLERS_REGISTRY.get(tool_id).map(|b| b.as_ref())
}

/// 查询工作流定义
pub fn get_workflow(workflow_id: &str) -> Option<&'static super::definitions::WorkflowDefinition> {
    WORKFLOW_REGISTRY.get(workflow_id).copied()
}

/// 列出所有 Agent（可按分类过滤，供前端展示）
pub fn list_agents(category: Option<AgentCategory>) -> Vec<AgentDefinition> {
    let registry = match AGENT_REGISTRY.read() {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    registry.values()
        .filter(|a| category.map_or(true, |c| a.category == c))
        .cloned()
        .collect()
}

/// 列出所有工具元数据
pub fn list_tool_definitions() -> Vec<ToolDefinition> {
    TOOL_DEFINITIONS_REGISTRY.values().cloned().collect()
}

/// 列出所有工作流
pub fn list_workflows() -> Vec<&'static super::definitions::WorkflowDefinition> {
    WORKFLOW_REGISTRY.values().copied().collect()
}
```

#### 2.3.4 自定义 Agent 增删刷新

```rust
/// 重新加载自定义 Agent（用户创建/导入/删除后调用）
///
/// 策略：保留内置 Agent，移除所有自定义 Agent，重新从数据库加载。
/// 这样可避免逐条同步带来的状态不一致问题。
pub fn reload_custom_agents(db: &Connection) -> Result<(), String> {
    let mut registry = AGENT_REGISTRY.write()
        .map_err(|e| format!("Agent 注册表写锁失败: {}", e))?;

    // 1. 移除所有自定义 Agent（保留内置）
    registry.retain(|_, a| a.is_builtin);

    // 2. 重新加载
    let custom_agents = load_custom_agents_from_db(db)?;
    for agent in custom_agents {
        registry.insert(agent.agent_id.clone(), agent);
    }

    Ok(())
}

/// 添加单个自定义 Agent（创建后立即生效，避免全量 reload）
///
/// 注意：调用方需先写入数据库，再调用此函数刷新注册表。
pub fn add_custom_agent(agent: AgentDefinition) -> Result<(), String> {
    if agent.is_builtin {
        return Err("不能通过此接口添加内置 Agent".to_string());
    }
    if !agent.agent_id.starts_with("custom_") {
        return Err("自定义 Agent 的 ID 必须以 'custom_' 前缀".to_string());
    }
    let mut registry = AGENT_REGISTRY.write()
        .map_err(|e| format!("Agent 注册表写锁失败: {}", e))?;
    registry.insert(agent.agent_id.clone(), agent);
    Ok(())
}

/// 删除自定义 Agent（从注册表移除，数据库由调用方处理）
pub fn remove_custom_agent(agent_id: &str) -> Result<(), String> {
    let mut registry = AGENT_REGISTRY.write()
        .map_err(|e| format!("Agent 注册表写锁失败: {}", e))?;
    if let Some(agent) = registry.get(agent_id) {
        if agent.is_builtin {
            return Err("不能删除内置 Agent".to_string());
        }
    }
    registry.remove(agent_id);
    Ok(())
}
```

#### 2.3.5 在 lib.rs 中的集成

在 [lib.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/lib.rs) 的 `setup` 钩子中调用初始化：

```rust
// lib.rs 顶部模块声明
mod agents;

// 在 setup 钩子中
.setup(|app| {
    let db = app.state::<DbState>();
    // ... 现有初始化代码 ...

    // 初始化 Agent 注册表（紧随 init_db 之后）
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    crate::agents::registry::init_registry(&conn)
        .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
    drop(conn);  // 释放锁供后续使用

    // 初始化记忆库服务（见 3.4 memory.rs）
    crate::agents::memory::init_memory_service(&app.state::<DbState>())
        .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

    Ok(())
})
```

#### 2.3.6 mod.rs 模块声明

`src-tauri/src/agents/mod.rs` 的内容：

```rust
// agents/mod.rs - 多 Agent 系统模块入口
pub mod models;
pub mod definitions;
pub mod registry;
pub mod tools;
pub mod executor;
pub mod pipeline;
pub mod memory;
pub mod commands;

// 公共重导出（简化跨模块引用）
pub use models::{
    AgentCategory, AgentDefinition, AgentOutput, AgentTask,
    ModelParams, PermissionMode, TaskContext, TaskStatus,
    ToolCallLog, ToolContext, ToolDefinition, ToolPermission, ToolResult,
    WorkflowEdge, WorkflowNode, LoopConfig, LoopAgentStep,
    StoryMemory, Foreshadow, AgentSetting,
    TokenUsage,
};
pub use definitions::WorkflowDefinition;
```

**设计要点回顾**：
1. **静态优先**：内置 Agent/工具/工作流都通过 `Lazy` 静态变量声明，避免运行时解析配置文件
2. **动态补充**：仅自定义 Agent 走数据库，工具和工作流都是代码内置（P3 阶段若引入自定义工作流再扩展）
3. **锁粒度**：`AGENT_REGISTRY` 用 `RwLock`，读操作无阻塞，仅增删时写锁
4. **热加载**：`add_custom_agent`/`remove_custom_agent` 支持单条增删，避免每次都全量 reload
5. **依赖隔离**：`models.rs` 不依赖其他 agents 模块；`definitions.rs` 仅依赖 `models.rs`；`registry.rs` 依赖前两者 + `db.rs` + `tools.rs`（仅 ToolHandler trait）

---

## 3. Rust模块详细设计 - 执行层

执行层包含四个文件：[tools.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/tools.rs)（工具适配层）、[executor.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/executor.rs)（单 Agent 执行器）、[pipeline.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/pipeline.rs)（DAG 引擎）、[memory.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/memory.rs)（记忆库服务）。

**调用关系**：
```
commands.rs ─→ pipeline.rs ─→ executor.rs ─→ llm::client (现有)
                  │                │             │
                  │                └─→ tools.rs ─→┘ (工具调用)
                  │                       │
                  │                       ├─→ db.rs (复用)
                  │                       └─→ commands/settings.rs::create_card_internal 等
                  │
                  └─→ memory.rs ─→ db.rs
```

**关键约束**：
- 执行层不得直接访问 `State<DbState>`，统一通过 `&DbState` 引用传递（保证可在工具适配层和 Pipeline 引擎中复用）
- LLM 调用、文件 IO 必须在数据库锁外执行（避免锁竞争）
- 工具调用结果在写入 `agent_tool_calls` 表前需截断到 500 字符以内（防日志爆炸）

### 3.1 tools.rs - 工具适配层

文件位置：`src-tauri/src/agents/tools.rs`。定义 `ToolHandler` trait、10 个 P0 工具的实现、`register_tool_handlers` 注册函数、`execute_tool` 统一入口。

#### 3.1.1 ToolHandler Trait 定义

```rust
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::models::{
    AgentDefinition, ToolCallLog, ToolContext, ToolDefinition, ToolPermission, ToolResult,
};

/// 工具处理器的行为契约
///
/// 每个原生工具实现此 trait，由 `register_tool_handlers` 注册到全局注册表。
/// Pipeline 引擎通过 `registry::get_tool_handler(tool_id)` 获取处理器并调用 `execute`。
pub trait ToolHandler: Send + Sync {
    /// 工具唯一标识（如 "agent.create_setting_card"）
    fn tool_id(&self) -> &str;

    /// LLM 可见的工具描述
    fn description(&self) -> &str;

    /// 参数 JSON Schema，传给 LLM
    fn parameters_schema(&self) -> serde_json::Value;

    /// 工具所需权限
    fn required_permission(&self) -> ToolPermission;

    /// 是否可缓存（同参数重复调用时是否复用上次结果）
    fn cacheable(&self) -> bool { false }

    /// 是否为高风险操作（影响检查点判定：在 Supervised 模式下触发检查点）
    fn is_dangerous(&self) -> bool { false }

    /// 执行工具
    ///
    /// `params`: LLM 传入的参数（已通过 JSON Schema 校验）
    /// `ctx`: 工具执行上下文（task_id/agent_id/project_id/output_dir/db）
    fn execute(
        &self,
        params: &serde_json::Value,
        ctx: &ToolContext,
    ) -> Result<ToolResult, String>;
}
```

#### 3.1.2 工具分发核心

```rust
/// 工具适配层入口：Agent 执行器调用此函数
///
/// 步骤：
/// 1. 查找工具处理器
/// 2. 权限校验（Agent 是否有权调用此工具）
/// 3. 缓存检查（若工具可缓存且命中）
/// 4. 执行工具
/// 5. 记录调用日志到 agent_tool_calls 表
/// 6. 写入缓存（若工具可缓存且结果值得缓存）
pub fn execute_tool(
    tool_id: &str,
    params: &serde_json::Value,
    ctx: &ToolContext,
    cache: &mut HashMap<String, serde_json::Value>,
    permission_mode: super::models::PermissionMode,
) -> Result<ToolResult, String> {
    // 1. 查找工具处理器
    let handler = super::registry::get_tool_handler(tool_id)
        .ok_or_else(|| format!("工具 {} 未注册", tool_id))?;

    // 2. 权限校验（Agent 是否有权调用此工具）
    let agent_def = super::registry::get_agent(&ctx.agent_id)
        .ok_or_else(|| format!("Agent {} 未注册", ctx.agent_id))?;
    if !check_tool_permission(&agent_def, tool_id) {
        return Err(format!("Agent {} 无权调用工具 {}", ctx.agent_id, tool_id));
    }

    // 3. 危险操作检查点判定
    if handler.is_dangerous() && permission_mode.requires_checkpoint_on_dangerous() {
        // 触发检查点（由 Pipeline 引擎处理，此处仅返回特殊错误让上层处理）
        // 实际实现中，executor 在调用 execute_tool 前会先调用 check_dangerous_tool
        // 若需检查点则暂停 Pipeline，决策后再调用 execute_tool
    }

    // 4. 缓存检查
    let cache_key = format!("{}:{}", tool_id, params);
    if handler.cacheable() {
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(ToolResult {
                content: cached.to_string(),
                structured: Some(cached.clone()),
                cacheable_result: false,
            });
        }
    }

    // 5. 执行工具
    let start = std::time::Instant::now();
    let result = handler.execute(params, ctx);
    let duration_ms = start.elapsed().as_millis() as i64;

    // 6. 记录调用日志
    let log_entry = build_tool_call_log(
        tool_id, params, &result, duration_ms, false,
    );
    if let Err(e) = log_tool_call(ctx, &log_entry) {
        // 日志写入失败不应阻塞工具执行，仅记录警告
        crate::log_warn!("工具调用日志写入失败: {}", e);
    }

    // 7. 写入缓存
    if handler.cacheable() {
        if let Ok(ref r) = result {
            if r.cacheable_result {
                if let Some(ref structured) = r.structured {
                    cache.insert(cache_key, structured.clone());
                }
            }
        }
    }

    result
}

/// 校验 Agent 是否有权调用工具
fn check_tool_permission(agent: &AgentDefinition, tool_id: &str) -> bool {
    agent.required_tools.iter().any(|t| t == tool_id)
        || agent.optional_tools.iter().any(|t| t == tool_id)
}

/// 构建工具调用日志（截断结果到 500 字符）
fn build_tool_call_log(
    tool_id: &str,
    params: &serde_json::Value,
    result: &Result<ToolResult, String>,
    duration_ms: i64,
    cache_hit: bool,
) -> ToolCallLog {
    let (success, content, error) = match result {
        Ok(r) => (true, r.content.clone(), None),
        Err(e) => (false, String::new(), Some(e.clone())),
    };
    // 字符边界安全截断（避免 UTF-8 panic）
    let truncated: String = content.chars().take(500).collect();
    ToolCallLog {
        tool_id: tool_id.to_string(),
        parameters: params.clone(),
        result_summary: truncated,
        duration_ms,
        success,
        error_message: error,
        cache_hit,
    }
}

/// 写入工具调用日志到 agent_tool_calls 表
fn log_tool_call(ctx: &ToolContext, log: &ToolCallLog) -> Result<(), String> {
    let conn = ctx.db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let now = chrono::Utc::now().to_rfc3339();
    let params_str = serde_json::to_string(&log.parameters)
        .unwrap_or_else(|_| "{}".to_string());
    let result_str = if log.success {
        Some(serde_json::json!({ "summary": log.result_summary }).to_string())
    } else {
        None
    };
    conn.execute(
        "INSERT INTO agent_tool_calls \
         (task_id, node_id, agent_id, tool_id, parameters, result, duration_ms, success, error_message, cache_hit, called_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            ctx.task_id,
            ctx.task_id,  // node_id 由调用方在 params 中传入（简化版用 task_id 占位）
            ctx.agent_id,
            log.tool_id,
            params_str,
            result_str,
            log.duration_ms,
            log.success,
            log.error_message,
            log.cache_hit,
            now,
        ],
    ).map_err(|e| format!("写入工具调用日志失败: {}", e))?;
    Ok(())
}
```

**说明**：
- `execute_tool` 的 `node_id` 字段在 `ToolContext` 中通过 `task_id` 占位（P0 简化），P1 阶段可在 `ToolContext` 增加 `node_id` 字段
- 日志写入失败不阻塞工具执行，仅记录警告（使用现有的 `log_warn!` 宏）
- 字符边界安全截断使用 `chars().take(500)`，避免 UTF-8 panic（与 `chatStore` 中消息截断保持一致）

#### 3.1.3 P0 工具实现 - 设定卡类（4 个）

每个工具实现 `ToolHandler` trait，复用 [commands/settings.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/commands/settings.rs) 的内部函数（见 [4.2 现有函数内部化改造](#42-现有函数内部化改造)）。

```rust
// ─────────────────────────────────────────────────────
// 工具: agent.create_setting_card
// ─────────────────────────────────────────────────────
pub struct CreateSettingCardTool;

impl ToolHandler for CreateSettingCardTool {
    fn tool_id(&self) -> &str { "agent.create_setting_card" }
    fn description(&self) -> &str { "创建设定卡" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { false }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer", "description": "项目ID" },
                "card_type": { "type": "string", "description": "卡片类型（角色/地点/物品/势力/概念）" },
                "name": { "type": "string", "description": "名称" },
                "fields": { "type": "object", "description": "字段键值对" }
            },
            "required": ["project_id", "card_type", "name", "fields"]
        })
    }

    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: String = params["project_id"].as_i64()
            .ok_or("缺少 project_id 参数")?
            .to_string();
        let card_type: String = params["card_type"].as_str()
            .ok_or("缺少 card_type 参数")?.to_string();
        let name: String = params["name"].as_str()
            .ok_or("缺少 name 参数")?.to_string();
        let fields: String = serde_json::to_string(&params["fields"])
            .map_err(|e| format!("fields 序列化失败: {}", e))?;

        // 复用内部函数（待 commands/settings.rs 改造，见 4.2）
        let card_id = crate::commands::settings::create_card_internal(
            ctx.db, project_id, card_type.clone(), name.clone(), fields
        )?;

        Ok(ToolResult {
            content: format!("已创建设定卡: {} (ID: {})", name, card_id),
            structured: Some(serde_json::json!({
                "card_id": card_id,
                "name": name,
                "card_type": card_type
            })),
            cacheable_result: false,
        })
    }
}

// ─────────────────────────────────────────────────────
// 工具: agent.query_setting_cards
// ─────────────────────────────────────────────────────
pub struct QuerySettingCardsTool;

impl ToolHandler for QuerySettingCardsTool {
    fn tool_id(&self) -> &str { "agent.query_setting_cards" }
    fn description(&self) -> &str { "查询设定卡列表" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::ReadDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { true }   // Pipeline 内可缓存

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "card_type": { "type": "string" },
                "name_keyword": { "type": "string" }
            },
            "required": ["project_id"]
        })
    }

    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: String = params["project_id"].as_i64()
            .ok_or("缺少 project_id 参数")?.to_string();
        let card_type: Option<String> = params["card_type"].as_str().map(|s| s.to_string());

        let cards = crate::commands::settings::list_cards_internal(
            ctx.db, project_id, card_type
        )?;

        let summary = format!("查询到 {} 张设定卡", cards.len());
        Ok(ToolResult {
            content: summary,
            structured: Some(serde_json::to_value(&cards)
                .unwrap_or(serde_json::Value::Array(vec![]))),
            cacheable_result: true,  // 值得缓存
        })
    }
}

// ─────────────────────────────────────────────────────
// 工具: agent.update_setting_card / agent.delete_setting_card
// ─────────────────────────────────────────────────────
// 结构与上面类似，分别调用 update_card_internal / delete_card_internal。
// update 设为 is_dangerous=true，delete 设为 is_dangerous=true。
// 完整代码省略，模式与 CreateSettingCardTool 一致。
pub struct UpdateSettingCardTool;
impl ToolHandler for UpdateSettingCardTool {
    fn tool_id(&self) -> &str { "agent.update_setting_card" }
    fn description(&self) -> &str { "更新设定卡字段" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteDb }
    fn is_dangerous(&self) -> bool { true }    // 写操作，触发检查点
    fn cacheable(&self) -> bool { false }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "card_id": { "type": "string" },
                "fields": { "type": "object" }
            },
            "required": ["card_id", "fields"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let card_id: String = params["card_id"].as_str().ok_or("缺少 card_id")?.to_string();
        let fields: String = serde_json::to_string(&params["fields"]).map_err(|e| e.to_string())?;
        crate::commands::settings::update_card_internal(ctx.db, card_id.clone(), fields)?;
        Ok(ToolResult::text(format!("已更新设定卡: {}", card_id)))
    }
}

pub struct DeleteSettingCardTool;
impl ToolHandler for DeleteSettingCardTool {
    fn tool_id(&self) -> &str { "agent.delete_setting_card" }
    fn description(&self) -> &str { "删除设定卡" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteDb }
    fn is_dangerous(&self) -> bool { true }
    fn cacheable(&self) -> bool { false }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": { "card_id": { "type": "string" } },
            "required": ["card_id"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let card_id: String = params["card_id"].as_str().ok_or("缺少 card_id")?.to_string();
        crate::commands::settings::delete_card_internal(ctx.db, card_id.clone())?;
        Ok(ToolResult::text(format!("已删除设定卡: {}", card_id)))
    }
}
```

#### 3.1.4 P0 工具实现 - 大纲与对话类（3 个）

```rust
// ─────────────────────────────────────────────────────
// 工具: agent.create_outline_node / agent.query_outline
// 复用 commands/project.rs 的 create_chapter_internal / list_chapters_internal
// ─────────────────────────────────────────────────────
pub struct CreateOutlineNodeTool;
impl ToolHandler for CreateOutlineNodeTool {
    fn tool_id(&self) -> &str { "agent.create_outline_node" }
    fn description(&self) -> &str { "创建大纲节点" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { false }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "parent_id": { "type": "string" },
                "title": { "type": "string" },
                "content": { "type": "string" },
                "sort_order": { "type": "integer" }
            },
            "required": ["project_id", "title"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: String = params["project_id"].as_i64().ok_or("缺少 project_id")?.to_string();
        let title: String = params["title"].as_str().ok_or("缺少 title")?.to_string();
        let content: String = params["content"].as_str().unwrap_or("").to_string();
        let parent_id: Option<String> = params["parent_id"].as_str().map(|s| s.to_string());
        let sort_order: i64 = params["sort_order"].as_i64().unwrap_or(0);

        let chapter_id = crate::commands::project::create_chapter_internal(
            ctx.db, project_id, parent_id, title.clone(), content, sort_order
        )?;
        Ok(ToolResult {
            content: format!("已创建大纲节点: {} (ID: {})", title, chapter_id),
            structured: Some(serde_json::json!({ "chapter_id": chapter_id, "title": title })),
            cacheable_result: false,
        })
    }
}

pub struct QueryOutlineTool;
impl ToolHandler for QueryOutlineTool {
    fn tool_id(&self) -> &str { "agent.query_outline" }
    fn description(&self) -> &str { "查询大纲树" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::ReadDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { true }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "parent_id": { "type": "string" }
            },
            "required": ["project_id"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: String = params["project_id"].as_i64().ok_or("缺少 project_id")?.to_string();
        let parent_id: Option<String> = params["parent_id"].as_str().map(|s| s.to_string());
        let chapters = crate::commands::project::list_chapters_internal(ctx.db, project_id, parent_id)?;
        Ok(ToolResult {
            content: format!("查询到 {} 个大纲节点", chapters.len()),
            structured: Some(serde_json::to_value(&chapters).unwrap_or(serde_json::Value::Array(vec![]))),
            cacheable_result: true,
        })
    }
}

// ─────────────────────────────────────────────────────
// 工具: agent.query_conversation_history
// 复用 commands/chat.rs 的 get_messages_internal
// ─────────────────────────────────────────────────────
pub struct QueryConversationHistoryTool;
impl ToolHandler for QueryConversationHistoryTool {
    fn tool_id(&self) -> &str { "agent.query_conversation_history" }
    fn description(&self) -> &str { "查询对话历史" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::ReadDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { true }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "conversation_id": { "type": "integer" },
                "limit": { "type": "integer", "default": 20 }
            },
            "required": ["conversation_id"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let conversation_id: i64 = params["conversation_id"].as_i64().ok_or("缺少 conversation_id")?;
        let limit: i64 = params["limit"].as_i64().unwrap_or(20);
        let messages = crate::commands::chat::get_messages_internal(
            ctx.db, conversation_id, limit
        )?;
        Ok(ToolResult {
            content: format!("查询到 {} 条消息", messages.len()),
            structured: Some(serde_json::to_value(&messages).unwrap_or(serde_json::Value::Array(vec![]))),
            cacheable_result: true,
        })
    }
}
```

#### 3.1.5 P0 工具实现 - 记忆库类（2 个）

记忆库工具不复用现有命令，而是调用 `memory.rs` 的服务函数（见 [3.4 memory.rs](#34-memoryrs---记忆库服务)）。

```rust
// ─────────────────────────────────────────────────────
// 工具: agent.read_memory / agent.write_memory
// 调用 memory::read_memory_internal / memory::write_memory_internal
// ─────────────────────────────────────────────────────
pub struct ReadMemoryTool;
impl ToolHandler for ReadMemoryTool {
    fn tool_id(&self) -> &str { "agent.read_memory" }
    fn description(&self) -> &str { "读取故事记忆库" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::ReadMemory }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { true }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "section": { "type": "string", "enum": ["characters", "timeline", "locations", "foreshadows", "baseline_style", "all"] }
            },
            "required": ["project_id"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: i64 = params["project_id"].as_i64().ok_or("缺少 project_id")?;
        let section: String = params["section"].as_str().unwrap_or("all").to_string();
        let memory_data = crate::agents::memory::read_memory_internal(
            ctx.db, project_id, &section
        )?;
        Ok(ToolResult {
            content: format!("已读取记忆库分区: {}", section),
            structured: Some(memory_data),
            cacheable_result: true,
        })
    }
}

pub struct WriteMemoryTool;
impl ToolHandler for WriteMemoryTool {
    fn tool_id(&self) -> &str { "agent.write_memory" }
    fn description(&self) -> &str { "写入故事记忆库" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteMemory }
    fn is_dangerous(&self) -> bool { true }    // 写记忆库触发检查点
    fn cacheable(&self) -> bool { false }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "section": { "type": "string", "enum": ["characters", "timeline", "locations", "foreshadows", "baseline_style"] },
                "data": { "type": "object" },
                "merge_strategy": { "type": "string", "enum": ["replace", "append", "merge"], "default": "merge" }
            },
            "required": ["project_id", "section", "data"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: i64 = params["project_id"].as_i64().ok_or("缺少 project_id")?;
        let section: String = params["section"].as_str().ok_or("缺少 section")?.to_string();
        let data: serde_json::Value = params["data"].clone();
        let strategy: String = params["merge_strategy"].as_str().unwrap_or("merge").to_string();

        let updated = crate::agents::memory::write_memory_internal(
            ctx.db, project_id, &section, &data, &strategy
        )?;
        Ok(ToolResult {
            content: format!("已更新记忆库分区: {} (策略: {})", section, strategy),
            structured: Some(updated),
            cacheable_result: false,
        })
    }
}
```

#### 3.1.6 工具注册函数

```rust
/// 注册所有 P0 工具处理器到全局注册表
///
/// 由 registry.rs 的 TOOL_HANDLERS_REGISTRY Lazy 初始化时调用。
/// P1-P3 阶段在此函数追加新工具的注册即可。
pub fn register_tool_handlers(map: &mut HashMap<String, Box<dyn ToolHandler>>) {
    // 设定卡类（4 个）
    map.insert("agent.create_setting_card".to_string(), Box::new(CreateSettingCardTool));
    map.insert("agent.query_setting_cards".to_string(), Box::new(QuerySettingCardsTool));
    map.insert("agent.update_setting_card".to_string(), Box::new(UpdateSettingCardTool));
    map.insert("agent.delete_setting_card".to_string(), Box::new(DeleteSettingCardTool));

    // 大纲类（2 个）
    map.insert("agent.create_outline_node".to_string(), Box::new(CreateOutlineNodeTool));
    map.insert("agent.query_outline".to_string(), Box::new(QueryOutlineTool));

    // 对话历史类（1 个）
    map.insert("agent.query_conversation_history".to_string(), Box::new(QueryConversationHistoryTool));

    // 项目信息类（1 个，复用 commands/project.rs::get_project_internal）
    map.insert("agent.query_project_info".to_string(), Box::new(QueryProjectInfoTool));

    // 记忆库类（2 个）
    map.insert("agent.read_memory".to_string(), Box::new(ReadMemoryTool));
    map.insert("agent.write_memory".to_string(), Box::new(WriteMemoryTool));

    // P1-P3 待补：update_outline_node / delete_outline_node / create_foreshadow / ...
}

// QueryProjectInfoTool 与上述工具结构一致，调用 get_project_internal，省略详细代码
pub struct QueryProjectInfoTool;
impl ToolHandler for QueryProjectInfoTool {
    fn tool_id(&self) -> &str { "agent.query_project_info" }
    fn description(&self) -> &str { "查询项目信息" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::ReadDb }
    fn is_dangerous(&self) -> bool { false }
    fn cacheable(&self) -> bool { true }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": { "project_id": { "type": "integer" } },
            "required": ["project_id"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: String = params["project_id"].as_i64().ok_or("缺少 project_id")?.to_string();
        let project = crate::commands::project::get_project_internal(ctx.db, project_id)?;
        Ok(ToolResult {
            content: format!("项目: {}", project.name),
            structured: Some(serde_json::to_value(&project).unwrap_or(serde_json::Value::Null)),
            cacheable_result: true,
        })
    }
}
```

#### 3.1.7 工具调用 LLM 可见格式

工具定义需转换为 LLM 的 `tools` 参数格式（与现有 [llm/client.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs) 中的 tool 定义格式一致）。

```rust
/// 将工具定义转换为 LLM 可见的 tools 数组格式
///
/// LLM 期望的格式（与 OpenAI Function Calling 兼容）：
/// {
///   "type": "function",
///   "function": {
///     "name": "agent.create_setting_card",
///     "description": "创建设定卡",
///     "parameters": { ... JSON Schema ... }
///   }
/// }
pub fn tool_to_llm_format(handler: &dyn ToolHandler) -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": handler.tool_id(),
            "description": handler.description(),
            "parameters": handler.parameters_schema(),
        }
    })
}

/// 获取 Agent 可调用的所有工具的 LLM 格式数组
pub fn get_agent_tools_llm_format(agent: &AgentDefinition) -> Vec<serde_json::Value> {
    let mut tools = Vec::new();
    for tool_id in agent.required_tools.iter().chain(agent.optional_tools.iter()) {
        if let Some(handler) = super::registry::get_tool_handler(tool_id) {
            tools.push(tool_to_llm_format(handler));
        }
    }
    // 去重（避免 required 与 optional 重复）
    // 注：tool_id 唯一，此处不会有重复，但若用户配置错误也容错
    tools
}
```

### 3.2 executor.rs - Agent执行器

文件位置：`src-tauri/src/agents/executor.rs`。封装单个 Agent 的执行流程：组装 messages → 调用 LLM → 处理工具调用循环 → 返回 `AgentOutput`。复用现有 [llm/client.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs) 的 `stream_chat_core` 通用核心函数（见 [5.4 LLM 调用复用策略](#54-llm-调用复用策略)）。

#### 3.2.1 AgentExecutorImpl 结构

```rust
use std::collections::HashMap;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::models::{
    AgentDefinition, AgentOutput, ModelParams, TaskContext, TokenUsage, ToolCallLog,
};
use super::tools;

/// Agent 执行器实现
///
/// 每个 Pipeline 节点执行时构造一个 AgentExecutorImpl 实例，
/// 调用 `execute` 完成单次 Agent 执行（含工具调用循环）。
pub struct AgentExecutorImpl {
    definition: AgentDefinition,
    overrides: Option<ModelParams>,
}

impl AgentExecutorImpl {
    pub fn new(definition: AgentDefinition, overrides: Option<ModelParams>) -> Self {
        Self { definition, overrides }
    }

    /// 执行 Agent
    ///
    /// 流程：
    /// 1. 解析系统提示词（变量插值）
    /// 2. 组装 messages（system + user）
    /// 3. 获取工具列表（LLM 可见格式）
    /// 4. 调用 stream_chat_core，处理流式 chunk 与工具调用
    /// 5. 工具调用循环：LLM 返回 tool_calls → 执行工具 → 拼入 messages → 再调 LLM
    /// 6. 直到 LLM 不再返回 tool_calls，输出最终内容
    pub async fn execute(
        &self,
        context: &mut TaskContext,
        input: serde_json::Value,
        app: &AppHandle,
        db: &crate::db::DbState,
        cancel_token: &CancellationToken,
    ) -> Result<AgentOutput, String> {
        let model_params = self.overrides.clone()
            .unwrap_or_else(|| self.definition.model_params.clone());

        // 1. 系统提示词插值
        let system_prompt = self.interpolate_prompt(&self.definition.system_prompt, context, &input);

        // 2. 组装 messages
        let messages = vec![
            json!({ "role": "system", "content": system_prompt }),
            json!({ "role": "user", "content": input }),
        ];

        // 3. 获取工具列表
        let tools = tools::get_agent_tools_llm_format(&self.definition);

        // 4. 调用 LLM 并处理工具调用循环
        let mut full_content = String::new();
        let mut tool_calls_log: Vec<ToolCallLog> = Vec::new();
        let mut total_usage = TokenUsage::default();
        let mut had_tool_calls;

        let mut current_messages = messages;

        loop {
            if cancel_token.is_cancelled() {
                return Err("任务已取消".to_string());
            }

            // 调用 stream_chat_core（复用现有 LLM 客户端核心）
            let (content, tool_calls, usage) = crate::llm::client::stream_chat_core(
                db,
                &self.definition.api_config_id,
                &current_messages,
                &tools,
                &model_params,
                Some(&context.task_id),
                |chunk| {
                    // 流式回调：通过 agent:chunk 事件推送给前端
                    let _ = app.emit("agent:chunk", json!({
                        "task_id": context.task_id,
                        "agent_id": self.definition.agent_id,
                        "content": chunk,
                        "done": false,
                    }));
                },
            ).await?;

            full_content.push_str(&content);
            if let Some(u) = usage {
                total_usage.prompt_tokens += u.prompt_tokens;
                total_usage.completion_tokens += u.completion_tokens;
                total_usage.total_tokens += u.total_tokens;
            }

            had_tool_calls = !tool_calls.is_empty();
            if !had_tool_calls {
                break;  // LLM 不再要求调用工具，结束循环
            }

            // 处理工具调用
            current_messages.push(json!({
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls,
            }));

            for tool_call in &tool_calls {
                let tool_id = tool_call["function"]["name"].as_str().unwrap_or("");
                let params = &tool_call["function"]["arguments"];
                let tool_call_id = tool_call["id"].as_str().unwrap_or("");

                // 构建工具上下文
                let tool_ctx = super::models::ToolContext {
                    task_id: context.task_id.clone(),
                    agent_id: self.definition.agent_id.clone(),
                    project_id: context.project_id,
                    output_dir: context.output_dir.clone(),
                    db,
                };

                // 执行工具
                let tool_result = tools::execute_tool(
                    tool_id, params, &tool_ctx, &mut context.cache,
                    context.permission_mode,
                );

                // 推送工具调用事件给前端
                let _ = app.emit("agent:tool_call", json!({
                    "task_id": context.task_id,
                    "agent_id": self.definition.agent_id,
                    "tool_id": tool_id,
                    "parameters": params,
                    "success": tool_result.is_ok(),
                }));

                // 拼入 messages 供下一轮 LLM 使用
                let result_content = match tool_result {
                    Ok(r) => {
                        tool_calls_log.push(ToolCallLog {
                            tool_id: tool_id.to_string(),
                            parameters: params.clone(),
                            result_summary: r.content.chars().take(500).collect(),
                            duration_ms: 0,
                            success: true,
                            error_message: None,
                            cache_hit: false,
                        });
                        r.content
                    }
                    Err(e) => {
                        tool_calls_log.push(ToolCallLog {
                            tool_id: tool_id.to_string(),
                            parameters: params.clone(),
                            result_summary: String::new(),
                            duration_ms: 0,
                            success: false,
                            error_message: Some(e.clone()),
                            cache_hit: false,
                        });
                        format!("工具调用失败: {}", e)
                    }
                };

                current_messages.push(json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": result_content,
                }));
            }
        }

        // 5. 解析结构化输出（若 LLM 输出包含 JSON 块）
        let structured = parse_structured_output(&full_content);

        // 6. 写入中间产出文件
        let _ = write_agent_output_to_file(
            &context.output_dir,
            &self.definition.agent_id,
            &full_content,
            &structured,
        );

        Ok(AgentOutput {
            content: full_content,
            structured,
            token_usage: Some(total_usage),
            tool_calls_log,
        })
    }

    /// 系统提示词变量插值
    ///
    /// 支持 {{variable}} 语法，变量来源：
    /// - {{task_id}} / {{project_id}} / {{workflow_id}}：来自 TaskContext
    /// - {{input.field_name}}：来自 input 参数
    /// - {{node.n1.output.field}}：来自 context.node_outputs
    fn interpolate_prompt(
        &self,
        template: &str,
        context: &TaskContext,
        input: &serde_json::Value,
    ) -> String {
        let mut result = template.to_string();
        // 替换 task_id / project_id / workflow_id
        result = result.replace("{{task_id}}", &context.task_id);
        result = result.replace("{{project_id}}", &context.project_id.to_string());
        result = result.replace("{{workflow_id}}", &context.workflow_id);
        // 替换 {{input.x}} 形式
        if let Some(obj) = input.as_object() {
            for (k, v) in obj {
                let placeholder = format!("{{{{input.{}}}}}", k);
                let value_str = match v {
                    serde_json::Value::String(s) => s.clone(),
                    _ => v.to_string(),
                };
                result = result.replace(&placeholder, &value_str);
            }
        }
        result
    }
}
```

#### 3.2.2 结构化输出解析

```rust
/// 从 LLM 文本输出中提取结构化 JSON
///
/// 策略：查找 ```json ... ``` 代码块，或尝试整体解析为 JSON。
/// 解析失败返回 None（不阻塞流程，content 仍保留原文）。
fn parse_structured_output(content: &str) -> Option<serde_json::Value> {
    // 1. 查找 ```json 代码块
    if let Some(start) = content.find("```json") {
        if let Some(end) = content[start + 7..].find("```") {
            let json_str = &content[start + 7..start + 7 + end].trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(v);
            }
        }
    }
    // 2. 尝试整体解析
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(content) {
        return Some(v);
    }
    None
}

/// 将 Agent 输出写入中间产出文件
///
/// 路径：./agent_outputs/{task_id}/{agent_id}.md（文本）+ {agent_id}.json（结构化）
/// 原子写入：先写 .tmp 文件再 rename（避免崩溃时半成品）
fn write_agent_output_to_file(
    output_dir: &std::path::Path,
    agent_id: &str,
    content: &str,
    structured: &Option<serde_json::Value>,
) -> Result<(), String> {
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("创建产出目录失败: {}", e))?;

    // 写文本文件
    let md_path = output_dir.join(format!("{}.md", agent_id));
    let md_tmp = output_dir.join(format!("{}.md.tmp", agent_id));
    std::fs::write(&md_tmp, content)
        .map_err(|e| format!("写入中间产出失败: {}", e))?;
    std::fs::rename(&md_tmp, &md_path)
        .map_err(|e| format!("重命名中间产出失败: {}", e))?;

    // 写结构化 JSON（若有）
    if let Some(v) = structured {
        let json_path = output_dir.join(format!("{}.json", agent_id));
        let json_tmp = output_dir.join(format!("{}.json.tmp", agent_id));
        let json_str = serde_json::to_string_pretty(v)
            .map_err(|e| format!("序列化结构化产出失败: {}", e))?;
        std::fs::write(&json_tmp, json_str)
            .map_err(|e| format!("写入结构化产出失败: {}", e))?;
        std::fs::rename(&json_tmp, &json_path)
            .map_err(|e| format!("重命名结构化产出失败: {}", e))?;
    }

    Ok(())
}
```

#### 3.2.3 与现有 stream_chat 的复用关系

现有 [llm/client.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs) 中的 `stream_chat` 函数专为 Chat 功能设计，绑定 `chat:chunk` 事件。Agent 系统需要 `agent:chunk` 事件，不能直接复用。

**改造方案**（详见 [4.2 现有函数内部化改造](#42-现有函数内部化改造)）：

```rust
// llm/client.rs 改造

/// LLM 调用通用核心函数（Chat 和 Agent 共用）
///
/// 参数：
/// - db: 数据库连接（用于查询 API 配置）
/// - api_config_id: API 配置 ID（None = 用项目默认）
/// - messages: 消息列表
/// - tools: 工具定义数组（LLM 可见格式）
/// - model_params: 模型参数
/// - task_id: 用于日志关联
/// - chunk_callback: 流式回调（Chat 传 chat:chunk emitter，Agent 传 agent:chunk emitter）
pub async fn stream_chat_core<F>(
    db: &DbState,
    api_config_id: &Option<i64>,
    messages: &[serde_json::Value],
    tools: &[serde_json::Value],
    model_params: &ModelParams,
    task_id: Option<&str>,
    mut chunk_callback: F,
) -> Result<(String, Vec<serde_json::Value>, Option<TokenUsage>), String>
where
    F: FnMut(&str),
{
    // 1. 查询 API 配置
    let api_config = get_api_config(db, api_config_id)?;

    // 2. 构建请求 body
    let body = build_request_body(messages, tools, model_params);

    // 3. 发送 SSE 请求
    let mut response = send_sse_request(&api_config, &body).await?;

    // 4. 解析 SSE 流
    let mut full_content = String::new();
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();
    let mut usage: Option<TokenUsage> = None;

    while let Some(event) = response.next().await {
        // 解析 SSE 事件
        // 拼接 content 到 full_content
        // 累积 tool_calls
        // 通过 chunk_callback 推送流式内容
        // 解析 usage
    }

    Ok((full_content, tool_calls, usage))
}

/// 现有 Chat 命令的 stream_chat 包装层（保留向后兼容）
pub async fn stream_chat(
    db: &DbState,
    api_config_id: &Option<i64>,
    messages: &[serde_json::Value],
    tools: &[serde_json::Value],
    model_params: &ModelParams,
    conversation_id: i64,
    app: &AppHandle,
) -> Result<(String, Vec<serde_json::Value>, Option<TokenUsage>), String> {
    stream_chat_core(
        db, api_config_id, messages, tools, model_params,
        Some(&conversation_id.to_string()),
        |chunk| {
            let _ = app.emit("chat:chunk", json!({
                "conversation_id": conversation_id,
                "content": chunk,
                "done": false,
            }));
        },
    ).await
}
```

**说明**：
- `stream_chat_core` 是核心 LLM 调用逻辑，与事件类型解耦
- Chat 通过 `stream_chat` 包装层调用 core，绑定 `chat:chunk` 事件
- Agent 通过 `executor.rs` 直接调用 core，绑定 `agent:chunk` 事件
- 这样既复用了核心逻辑（SSE 解析、工具调用累积、usage 提取），又实现了事件隔离

### 3.3 pipeline.rs - Pipeline引擎

文件位置：`src-tauri/src/agents/pipeline.rs`。负责 DAG 编排、状态机管理、检查点处理、错误恢复。同时为 `WorkflowDefinition` 实现 `Workflow` trait。

#### 3.3.1 Workflow Trait 实现

```rust
use std::collections::HashMap;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::definitions::WorkflowDefinition;
use super::executor::AgentExecutorImpl;
use super::models::{
    AgentTask, PermissionMode, TaskContext, TaskStatus, WorkflowEdge, WorkflowNode,
};
use super::registry;

/// 为 WorkflowDefinition 实现 Workflow trait
///
/// 这是静态工作流的唯一实现：从 WorkflowDefinition 数据读取节点/边/检查点。
/// P3 阶段若引入自定义工作流，可让自定义工作流结构也实现此 trait。
impl super::models::Workflow for WorkflowDefinition {
    fn workflow_id(&self) -> &str { &self.workflow_id }
    fn name(&self) -> &str { &self.name }
    fn description(&self) -> &str { &self.description }
    fn default_permission_mode(&self) -> PermissionMode { self.default_permission_mode }
    fn nodes(&self) -> &[WorkflowNode] { &self.nodes }
    fn edges(&self) -> &[WorkflowEdge] { &self.edges }
    fn checkpoints(&self) -> &[String] { &self.checkpoints }

    fn estimated_token_cost(&self, _input: &serde_json::Value) -> i64 {
        super::definitions::estimate_tokens(self.token_estimate_key)
    }

    fn parse_input(&self, raw_input: &serde_json::Value) -> Result<serde_json::Value, String> {
        // P0 阶段：直接透传，由工作流定义的 input_mapping 负责字段提取
        // P1+ 阶段可在此做输入校验（对照工作流期望的 user_input schema）
        Ok(raw_input.clone())
    }
}
```

#### 3.3.2 PipelineEngine 核心结构

```rust
/// Pipeline 执行引擎
///
/// 每个任务执行时构造一个 PipelineEngine 实例，调用 `execute` 完成整个 DAG。
/// 任务取消通过 CancellationToken 信号；检查点通过 oneshot 通道等待用户决策。
pub struct PipelineEngine<'a> {
    db: &'a crate::db::DbState,
    app: &'a AppHandle,
    cancel_token: &'a CancellationToken,
    workflow: &'a WorkflowDefinition,
    context: TaskContext,
    /// 检查点等待通道：当 Pipeline 暂停在检查点时，通过此通道接收用户决策
    checkpoint_rx: Option<oneshot::Receiver<CheckpointDecision>>,
}

/// 检查点用户决策
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum CheckpointDecision {
    /// 继续执行（可携带修改后的输入）
    #[serde(rename = "continue")]
    Continue { modified_input: Option<serde_json::Value> },
    /// 跳过当前节点
    #[serde(rename = "skip")]
    Skip,
    /// 取消任务
    #[serde(rename = "abort")]
    Abort,
    /// 重试当前节点
    #[serde(rename = "retry")]
    Retry,
}

impl<'a> PipelineEngine<'a> {
    pub fn new(
        db: &'a crate::db::DbState,
        app: &'a AppHandle,
        cancel_token: &'a CancellationToken,
        workflow: &'a WorkflowDefinition,
        task: AgentTask,
    ) -> Self {
        let context = TaskContext {
            task_id: task.task_id.clone(),
            project_id: task.project_id,
            conversation_id: task.conversation_id,
            workflow_id: task.workflow_id.clone(),
            permission_mode: task.permission_mode,
            user_input: serde_json::from_str(&task.input).unwrap_or(json!(null)),
            node_outputs: HashMap::new(),
            current_node_id: task.current_node_id,
            completed_nodes: serde_json::from_str(&task.completed_nodes).unwrap_or_default(),
            total_tokens: task.total_tokens,
            cache: HashMap::new(),
            output_dir: get_output_dir(&task.task_id),
        };
        Self {
            db, app, cancel_token, workflow, context,
            checkpoint_rx: None,
        }
    }

    /// 执行 Pipeline（主循环）
    pub async fn execute(&mut self) -> Result<(), String> {
        let nodes = &self.workflow.nodes;
        let edges = &self.workflow.edges;

        // 1. 拓扑排序
        let execution_order = topological_sort(nodes, edges)?;

        // 2. 确定起始位置（断点续传：跳过已完成节点）
        let start_idx = self.find_start_index(&execution_order);

        // 3. 按拓扑顺序执行
        for node_id in &execution_order[start_idx..] {
            if self.cancel_token.is_cancelled() {
                self.update_task_status(TaskStatus::Aborted).await?;
                return Err("任务已取消".to_string());
            }

            let node = nodes.iter().find(|n| &n.node_id == node_id)
                .ok_or_else(|| format!("节点 {} 未找到", node_id))?;

            // 跳过已完成节点
            if self.context.completed_nodes.contains(node_id) {
                continue;
            }

            // 更新当前节点状态
            self.context.current_node_id = Some(node_id.clone());
            self.update_task_status(TaskStatus::Running).await?;

            // 执行节点（带重试）
            let retry_count = 0;
            loop {
                match self.execute_node_with_timeout(node).await {
                    Ok(_) => break,
                    Err(e) => {
                        if retry_count >= node.retry_limit {
                            // 重试耗尽，进入失败状态
                            self.context.error_log = Some(e.clone());
                            self.handle_failure(&e).await?;
                            return Err(e);
                        }
                        // 等待后重试
                        tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(retry_count))).await;
                    }
                }
            }

            // 标记节点完成
            self.context.completed_nodes.push(node_id.clone());
            self.persist_progress().await?;

            // 检查点处理
            if self.workflow.checkpoints.iter().any(|c| c == node_id) {
                self.handle_checkpoint(node_id).await?;
            }
        }

        // 4. Pipeline 完成
        self.update_task_status(TaskStatus::Completed).await?;
        self.emit_done_event().await?;
        Ok(())
    }

    /// 执行单个节点（带超时）
    async fn execute_node_with_timeout(&mut self, node: &WorkflowNode) -> Result<(), String> {
        let timeout = std::time::Duration::from_secs(node.timeout_sec as u64);

        // 检查并行组
        if let Some(group) = &node.parallel_group {
            return self.execute_parallel_group(group, &self.workflow.nodes).await;
        }

        // 检查循环节点
        if node.is_loop {
            return self.execute_loop_node(node).await;
        }

        // 普通节点：带超时执行
        let result = tokio::time::timeout(
            timeout,
            self.execute_single_node(node),
        ).await;

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(format!("节点 {} 执行超时（{}秒）", node.node_id, node.timeout_sec)),
        }
    }

    /// 执行单个节点
    async fn execute_single_node(&mut self, node: &WorkflowNode) -> Result<(), String> {
        // 1. 解析输入
        let input = self.resolve_input(node)?;

        // 2. 获取 Agent 定义
        let agent_def = registry::get_agent(&node.agent_id)
            .ok_or_else(|| format!("Agent {} 未注册", node.agent_id))?;

        // 3. 创建执行器
        let executor = AgentExecutorImpl::new(agent_def, node.agent_overrides.clone());

        // 4. 执行
        let output = executor.execute(
            &mut self.context, input, self.app, self.db, self.cancel_token,
        ).await?;

        // 5. 存入上下文
        self.context.node_outputs.insert(
            node.output_key.clone(),
            output.structured.unwrap_or(json!(null)),
        );

        // 6. 累计 token
        if let Some(usage) = output.token_usage {
            self.context.total_tokens += usage.total_tokens;
        }

        // 7. 推送进度事件
        self.emit_progress(node, &output).await?;

        Ok(())
    }
}
```

#### 3.3.3 输入解析（input_mapping 解析器）

```rust
impl<'a> PipelineEngine<'a> {
    /// 解析节点的 input_mapping，从 user_input 与 node_outputs 提取字段
    ///
    /// input_mapping 形如：
    /// {
    ///   "keywords": "$user_input.keywords",
    ///   "memory": "$node.n2.output.memory_snapshot",
    ///   "static_field": "固定值"
    /// }
    ///
    /// - `$user_input.x` 从 context.user_input 取值
    /// - `$node.{id}.output.{key}` 从 context.node_outputs 取值
    /// - 不以 $ 开头的值视为固定字符串
    fn resolve_input(&self, node: &WorkflowNode) -> Result<serde_json::Value, String> {
        let mapping = node.input_mapping.as_object()
            .ok_or_else(|| format!("节点 {} 的 input_mapping 不是对象", node.node_id))?;

        let mut result = serde_json::Map::new();
        for (key, ref_expr) in mapping {
            let value = if let Some(s) = ref_expr.as_str() {
                if s.starts_with("$user_input.") {
                    let field = &s["$user_input.".len()..];
                    self.context.user_input.get(field)
                        .cloned()
                        .unwrap_or(json!(null))
                } else if s.starts_with("$node.") {
                    // 格式: $node.{node_id}.output.{field}
                    let rest = &s["$node.".len()..];
                    let parts: Vec<&str> = rest.splitn(3, '.').collect();
                    if parts.len() == 3 && parts[1] == "output" {
                        let node_id = parts[0];
                        let field = parts[2];
                        self.context.node_outputs.get(node_id)
                            .and_then(|v| v.get(field))
                            .cloned()
                            .unwrap_or(json!(null))
                    } else {
                        json!(null)
                    }
                } else {
                    json!(s)
                }
            } else {
                ref_expr.clone()
            };
            result.insert(key.clone(), value);
        }

        Ok(serde_json::Value::Object(result))
    }
}
```

#### 3.3.4 拓扑排序

```rust
/// DAG 拓扑排序（Kahn 算法）
///
/// 返回节点的执行顺序。若检测到环，返回错误。
fn topological_sort(
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
) -> Result<Vec<String>, String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut adj_list: HashMap<&str, Vec<&str>> = HashMap::new();

    // 初始化入度
    for node in nodes {
        in_degree.insert(&node.node_id, 0);
        adj_list.insert(&node.node_id, Vec::new());
    }

    // 构建邻接表与入度
    for edge in edges {
        if let Some(to_adj) = adj_list.get_mut(edge.from_node.as_str()) {
            to_adj.push(edge.to_node.as_str());
        }
        *in_degree.entry(edge.to_node.as_str()).or_insert(0) += 1;
    }

    // 入度为 0 的节点入队
    let mut queue: VecDeque<&str> = in_degree.iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut order = Vec::new();
    while let Some(node_id) = queue.pop_front() {
        order.push(node_id.to_string());
        if let Some(neighbors) = adj_list.get(node_id) {
            for &neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
    }

    if order.len() != nodes.len() {
        return Err("工作流 DAG 存在环，无法拓扑排序".to_string());
    }

    Ok(order)
}
```

#### 3.3.5 并行组执行

```rust
impl<'a> PipelineEngine<'a> {
    /// 执行并行组：同一 parallel_group 的节点并行执行
    ///
    /// 注意：并行组内的节点必须无相互依赖（DAG 已保证）。
    /// 各节点的 input_mapping 可引用组前节点的输出（如 n3 引用 n1 和 n2）。
    async fn execute_parallel_group(
        &mut self,
        group: &str,
        nodes: &[WorkflowNode],
    ) -> Result<(), String> {
        let parallel_nodes: Vec<&WorkflowNode> = nodes.iter()
            .filter(|n| n.parallel_group.as_deref() == Some(group))
            .collect();

        if parallel_nodes.is_empty() {
            return Ok(());
        }

        // 获取最大并发度（从 agent_settings 表读取，默认 3）
        let max_concurrent = get_max_concurrent(self.db)?;

        // 构建并行 future
        let mut futures = Vec::new();
        for node in &parallel_nodes {
            // 预先解析输入（避免在 async 任务中借用 self）
            let input = self.resolve_input(node)?;
            let agent_def = registry::get_agent(&node.agent_id)
                .ok_or_else(|| format!("Agent {} 未注册", node.agent_id))?;

            // 克隆必要的上下文数据（避免可变借用冲突）
            let task_id = self.context.task_id.clone();
            let project_id = self.context.project_id;
            let output_dir = self.context.output_dir.clone();
            let permission_mode = self.context.permission_mode;
            let db_ref = self.db;
            let app_ref = self.app;
            let cancel_ref = self.cancel_token;

            futures.push(async move {
                let executor = AgentExecutorImpl::new(agent_def, node.agent_overrides.clone());
                // 注意：这里需要重新构造 TaskContext 的可变引用
                // 实际实现中需要用 Arc<Mutex<TaskContext>> 或类似机制
                // P0 简化版：串行执行并行组内的节点（功能正确，性能次优）
                let mut temp_context = TaskContext {
                    task_id: task_id.clone(),
                    project_id,
                    conversation_id: None,
                    workflow_id: String::new(),
                    permission_mode,
                    user_input: json!(null),
                    node_outputs: HashMap::new(),
                    current_node_id: Some(node.node_id.clone()),
                    completed_nodes: vec![],
                    total_tokens: 0,
                    cache: HashMap::new(),
                    output_dir: output_dir.clone(),
                };
                executor.execute(
                    &mut temp_context, input, app_ref, db_ref, cancel_ref
                ).await.map(|output| (node.output_key.clone(), output))
            });
        }

        // 使用 buffer_unordered 控制并发度
        use futures::stream::{self, StreamExt};
        let mut stream = stream::iter(futures).buffer_unordered(max_concurrent);

        let mut outputs = Vec::new();
        while let Some(result) = stream.next().await {
            let (output_key, output) = result?;
            outputs.push((output_key, output));
        }

        // 合并并行结果到上下文
        for (output_key, output) in outputs {
            self.context.node_outputs.insert(
                output_key,
                output.structured.unwrap_or(json!(null)),
            );
            if let Some(usage) = output.token_usage {
                self.context.total_tokens += usage.total_tokens;
            }
        }

        // 标记组内所有节点完成
        for node in &parallel_nodes {
            self.context.completed_nodes.push(node.node_id.clone());
        }

        Ok(())
    }
}

/// 从 agent_settings 表读取最大并发度
fn get_max_concurrent(db: &crate::db::DbState) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let value: Option<String> = conn.query_row(
        "SELECT value FROM agent_settings WHERE key = 'max_concurrency'",
        [],
        |row| row.get(0),
    ).ok();
    Ok(value
        .and_then(|s| s.parse().ok())
        .unwrap_or(3))
}
```

**P0 简化说明**：上述并行执行代码涉及 `Arc<Mutex<TaskContext>>` 等复杂同步机制，P0 阶段可降级为串行执行并行组内的节点（功能正确，仅性能次优）。P1 阶段再实现真正的并行调度。

#### 3.3.6 检查点处理

```rust
impl<'a> PipelineEngine<'a> {
    /// 检查点处理
    ///
    /// 行为取决于 permission_mode：
    /// - HandsOff / Autopilot：不暂停，继续执行
    /// - Supervised：暂停 Pipeline，等待用户决策
    async fn handle_checkpoint(&mut self, node_id: &str) -> Result<(), String> {
        match self.context.permission_mode {
            PermissionMode::HandsOff | PermissionMode::Autopilot => {
                // 不暂停，继续执行下一节点
                Ok(())
            }
            PermissionMode::Supervised => {
                // 1. 更新任务状态为检查点暂停
                self.update_task_status(TaskStatus::PausedAtCheckpoint).await?;

                // 2. 推送检查点事件给前端
                let checkpoint_payload = json!({
                    "task_id": self.context.task_id,
                    "node_id": node_id,
                    "node_outputs": self.context.node_outputs,
                    "workflow_id": self.context.workflow_id,
                });
                let _ = self.app.emit("agent:checkpoint", checkpoint_payload);

                // 3. 等待用户决策（通过 oneshot 通道）
                let (tx, rx) = oneshot::channel::<CheckpointDecision>();
                // tx 由 commands.rs 的 agent_checkpoint_decision 命令持有
                // rx 由本 PipelineEngine 持有
                self.checkpoint_rx = Some(rx);

                // 注册 tx 到全局检查点等待表（task_id → sender）
                super::commands::register_checkpoint_sender(&self.context.task_id, tx);

                // 4. 等待决策
                let decision = self.checkpoint_rx.take()
                    .ok_or("检查点通道未初始化")?
                    .await
                    .map_err(|e| format!("检查点通道关闭: {}", e))?;

                // 5. 处理决策
                match decision {
                    CheckpointDecision::Continue { modified_input } => {
                        if let Some(modified) = modified_input {
                            // 用户修改了输入，更新上下文
                            if let Some(obj) = modified.as_object() {
                                for (k, v) in obj {
                                    self.context.user_input[k] = v.clone();
                                }
                            }
                        }
                        self.update_task_status(TaskStatus::Running).await?;
                        Ok(())
                    }
                    CheckpointDecision::Skip => {
                        // 跳过当前节点（已在 completed_nodes 中，继续下一节点）
                        self.update_task_status(TaskStatus::Running).await?;
                        Ok(())
                    }
                    CheckpointDecision::Abort => {
                        self.update_task_status(TaskStatus::Aborted).await?;
                        Err("用户在检查点取消任务".to_string())
                    }
                    CheckpointDecision::Retry => {
                        // 移除当前节点的完成标记，重试
                        self.context.completed_nodes.retain(|n| n != node_id);
                        self.update_task_status(TaskStatus::Running).await?;
                        Err("用户要求重试当前节点".to_string())
                    }
                }
            }
        }
    }
}
```

#### 3.3.7 状态持久化与事件推送

```rust
impl<'a> PipelineEngine<'a> {
    /// 更新任务状态到数据库
    async fn update_task_status(&self, status: TaskStatus) -> Result<(), String> {
        let conn = self.db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        let now = chrono::Utc::now().to_rfc3339();
        let status_str = status.to_db_str();

        let started_at = if status == TaskStatus::Running && self.context.completed_nodes.is_empty() {
            Some(now.clone())
        } else {
            None
        };
        let completed_at = if status.is_terminal() {
            Some(now.clone())
        } else {
            None
        };

        conn.execute(
            "UPDATE agent_tasks SET status = ?1, current_node_id = ?2, \
             completed_nodes = ?3, total_tokens = ?4, \
             started_at = COALESCE(started_at, ?5), \
             completed_at = ?6 \
             WHERE task_id = ?7",
            rusqlite::params![
                status_str,
                self.context.current_node_id,
                serde_json::to_string(&self.context.completed_nodes).unwrap_or_default(),
                self.context.total_tokens,
                started_at,
                completed_at,
                self.context.task_id,
            ],
        ).map_err(|e| format!("更新任务状态失败: {}", e))?;

        Ok(())
    }

    /// 持久化执行进度（断点续传用）
    async fn persist_progress(&self) -> Result<(), String> {
        let conn = self.db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.execute(
            "UPDATE agent_tasks SET \
             current_node_id = ?1, \
             completed_nodes = ?2, \
             total_tokens = ?3 \
             WHERE task_id = ?4",
            rusqlite::params![
                self.context.current_node_id,
                serde_json::to_string(&self.context.completed_nodes).unwrap_or_default(),
                self.context.total_tokens,
                self.context.task_id,
            ],
        ).map_err(|e| format!("持久化进度失败: {}", e))?;
        Ok(())
    }

    /// 推送进度事件
    async fn emit_progress(&self, node: &WorkflowNode, output: &super::models::AgentOutput) -> Result<(), String> {
        let _ = self.app.emit("agent:progress", json!({
            "task_id": self.context.task_id,
            "node_id": node.node_id,
            "agent_id": node.agent_id,
            "output_key": node.output_key,
            "completed_nodes": self.context.completed_nodes,
            "total_nodes": self.workflow.nodes.len(),
            "total_tokens": self.context.total_tokens,
            "content_preview": output.content.chars().take(200).collect::<String>(),
        }));
        Ok(())
    }

    /// 推送完成事件
    async fn emit_done_event(&self) -> Result<(), String> {
        // 保存最终结果到 agent_tasks.output
        let output_summary = json!({
            "completed_nodes": self.context.completed_nodes,
            "total_tokens": self.context.total_tokens,
            "node_outputs": self.context.node_outputs,
        });
        let output_str = serde_json::to_string(&output_summary).unwrap_or_default();

        let conn = self.db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.execute(
            "UPDATE agent_tasks SET output = ?1, completed_at = ?2 WHERE task_id = ?3",
            rusqlite::params![
                output_str,
                chrono::Utc::now().to_rfc3339(),
                self.context.task_id,
            ],
        ).map_err(|e| format!("保存任务输出失败: {}", e))?;

        let _ = self.app.emit("agent:done", json!({
            "task_id": self.context.task_id,
            "status": "completed",
            "total_tokens": self.context.total_tokens,
        }));
        Ok(())
    }

    /// 失败处理
    async fn handle_failure(&mut self, error: &str) -> Result<(), String> {
        // 记录错误日志
        let conn = self.db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.execute(
            "UPDATE agent_tasks SET status = 'failed_awaiting_decision', error_log = ?1 \
             WHERE task_id = ?2",
            rusqlite::params![error, self.context.task_id],
        ).map_err(|e| format!("更新失败状态失败: {}", e))?;

        // 推送失败事件
        let _ = self.app.emit("agent:done", json!({
            "task_id": self.context.task_id,
            "status": "failed_awaiting_decision",
            "error": error,
        }));
        Ok(())
    }

    /// 确定起始执行索引（断点续传）
    fn find_start_index(&self, execution_order: &[String]) -> usize {
        // 找到第一个未完成的节点
        for (idx, node_id) in execution_order.iter().enumerate() {
            if !self.context.completed_nodes.contains(node_id) {
                return idx;
            }
        }
        execution_order.len()  // 全部已完成
    }
}

/// 获取任务中间产出目录
fn get_output_dir(task_id: &str) -> std::path::PathBuf {
    let mut path = std::env::current_dir().unwrap_or_default();
    path.push("agent_outputs");
    path.push(task_id);
    path
}
```

**循环节点说明**（P3 阶段实现）：
```rust
/// 执行循环节点（P3 阶段实现，P0 返回未实现错误）
async fn execute_loop_node(&mut self, node: &WorkflowNode) -> Result<(), String> {
    Err(format!("循环节点 {} 暂未实现（P3 阶段）", node.node_id))
}
```

### 3.4 memory.rs - 记忆库服务

记忆库服务为 `memory_keeper` Agent（以及 `agent.read_memory` / `agent.write_memory` 工具）提供常驻内存的数据访问层。其设计要点：

1. **全局缓存**：使用 `Lazy<RwLock<HashMap<i64, StoryMemory>>>` 缓存"已加载项目"的记忆库，避免每次工具调用都查数据库
2. **单项目常驻**：同一时刻仅当前项目的记忆库驻留缓存（P0 简化策略，P1 阶段扩展为 LRU 多项目缓存）
3. **幂等写入**：通过 `entity` + `field` 主键去重，避免重复条目
4. **数据库兜底**：缓存未命中时回退到数据库查询，并自动加入缓存
5. **三类调用者**：
   - `init_memory_service`：应用启动时由 `lib.rs` setup 钩子调用
   - `read_memory_internal` / `write_memory_internal`：被 [tools.rs](#31-toolsrs---工具适配层) 的 `ReadMemoryTool` / `WriteMemoryTool` 调用
   - `switch_project`：项目切换时由 `commands.rs::switch_project` 命令调用

#### 3.4.1 全局缓存与初始化

```rust
use std::collections::HashMap;
use std::sync::RwLock;
use once_cell::sync::Lazy;
use crate::db::DbState;
use crate::agents::models::StoryMemory;

/// 全局记忆库缓存：project_id → StoryMemory
/// 单项目常驻策略：切换项目时旧项目被移除
static MEMORY_CACHE: Lazy<RwLock<HashMap<i64, StoryMemory>>> = Lazy::new(|| {
    RwLock::new(HashMap::new())
});

/// 应用启动时初始化记忆库服务
///
/// 由 lib.rs 的 setup 钩子调用，加载"当前项目"的记忆库到缓存。
/// "当前项目"取自项目表的最近活跃记录；若无项目则跳过（首次启动）。
///
/// 调用位置：lib.rs setup 钩子，位于 init_registry() 之后
pub fn init_memory_service(db: &DbState) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 查询最近活跃项目（沿用现有项目的"最近更新"排序逻辑）
    let recent_project_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    drop(conn);  // 释放锁

    if let Some(project_id) = recent_project_id {
        load_project_memory(db, project_id)?;
    }
    // 无项目时不报错，等待用户创建项目后再加载
    Ok(())
}

/// 加载指定项目的记忆库到缓存
///
/// 内部函数，供 init_memory_service / switch_project / 缓存未命中时复用。
/// 若数据库无对应记录，构造空记忆库并写入数据库（首次访问懒初始化）。
fn load_project_memory(db: &DbState, project_id: i64) -> Result<StoryMemory, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    let memory: StoryMemory = match conn.query_row(
        "SELECT project_id, characters, timeline, locations, foreshadows, baseline_style, updated_at
         FROM story_memory WHERE project_id = ?1",
        rusqlite::params![project_id],
        StoryMemory::from_db_row,
    ) {
        Ok(m) => m,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // 首次访问：构造空记忆库并持久化
            let empty = StoryMemory {
                project_id,
                characters: serde_json::Value::Array(vec![]),
                timeline: serde_json::Value::Array(vec![]),
                locations: serde_json::Value::Array(vec![]),
                foreshadows: serde_json::Value::Array(vec![]),
                baseline_style: None,
                updated_at: chrono::Utc::now().to_rfc3339(),
            };
            save_to_db_internal(&conn, &empty)?;
            empty
        }
        Err(e) => return Err(format!("查询记忆库失败: {}", e)),
    };

    drop(conn);

    // 写入缓存
    let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
    cache.insert(project_id, memory.clone());
    Ok(memory)
}
```

#### 3.4.2 读取接口

`read_memory_internal` 供 `ReadMemoryTool` 调用，按分区返回记忆库数据。

```rust
/// 读取记忆库（供 ReadMemoryTool 调用）
///
/// # 参数
/// - `db`: 数据库状态
/// - `project_id`: 项目 ID
/// - `section`: 分区名，取值 "characters" | "timeline" | "locations" |
///              "foreshadows" | "baseline_style" | "all"
///
/// # 返回
/// - `all`：返回完整 StoryMemory 的 JSON 序列化
/// - 其他分区：返回该分区的 JSON 值（数组或对象）
///
/// # 缓存策略
/// 1. 优先从 MEMORY_CACHE 读取
/// 2. 未命中时调用 load_project_memory 从数据库加载并写入缓存
pub fn read_memory_internal(
    db: &DbState,
    project_id: i64,
    section: &str,
) -> Result<serde_json::Value, String> {
    // 步骤1：尝试从缓存读取
    let cached: Option<StoryMemory> = {
        let cache = MEMORY_CACHE.read().map_err(|e| format!("记忆库锁失败: {}", e))?;
        cache.get(&project_id).cloned()
    };

    let memory = match cached {
        Some(m) => m,
        None => load_project_memory(db, project_id)?,  // 未命中则加载
    };

    // 步骤2：按分区返回
    let result = match section {
        "characters" => memory.characters.clone(),
        "timeline" => memory.timeline.clone(),
        "locations" => memory.locations.clone(),
        "foreshadows" => memory.foreshadows.clone(),
        "baseline_style" => memory.baseline_style.clone().unwrap_or(serde_json::Value::Null),
        "all" => serde_json::to_value(&memory).map_err(|e| format!("序列化记忆库失败: {}", e))?,
        other => return Err(format!("未知记忆库分区: {}", other)),
    };
    Ok(result)
}
```

#### 3.4.3 写入接口

`write_memory_internal` 供 `WriteMemoryTool` 调用，支持三种合并策略。所有写入操作都会同步更新缓存与数据库，保证一致性。

```rust
/// 写入记忆库（供 WriteMemoryTool 调用）
///
/// # 参数
/// - `db`: 数据库状态
/// - `project_id`: 项目 ID
/// - `section`: 分区名（不可为 "all"）
/// - `data`: 待写入的数据
/// - `merge_strategy`: 合并策略
///   - "replace": 用 data 完全替换该分区
///   - "append": 将 data 追加到数组末尾（仅适用于数组分区）
///   - "merge": 按 entity+field 去重合并（仅适用于 characters/timeline/locations/foreshadows）
///
/// # 返回
/// 返回更新后的分区数据，供 ToolHandler 包装为 ToolResult.structured
pub fn write_memory_internal(
    db: &DbState,
    project_id: i64,
    section: &str,
    data: &serde_json::Value,
    merge_strategy: &str,
) -> Result<serde_json::Value, String> {
    if section == "all" {
        return Err("不允许通过 write_memory 写入 all 分区".to_string());
    }

    // 步骤1：加载当前记忆库（缓存优先）
    let mut memory = {
        let cache = MEMORY_CACHE.read().map_err(|e| format!("记忆库锁失败: {}", e))?;
        cache.get(&project_id).cloned()
    }.unwrap_or_else(|| load_project_memory(db, project_id).unwrap_or_default());

    // 步骤2：按策略合并
    let current = get_section(&memory, section)?;
    let merged = match merge_strategy {
        "replace" => data.clone(),
        "append" => {
            let mut arr = current.as_array()
                .ok_or_else(|| format!("分区 {} 不是数组，无法 append", section))?
                .clone();
            if let Some(new_items) = data.as_array() {
                arr.extend(new_items.iter().cloned());
            } else {
                arr.push(data.clone());
            }
            serde_json::Value::Array(arr)
        }
        "merge" => merge_by_entity_field(&current, data, section)?,
        other => return Err(format!("未知合并策略: {}", other)),
    };

    // 步骤3：写回 memory 结构
    set_section(&mut memory, section, merged.clone())?;
    memory.updated_at = chrono::Utc::now().to_rfc3339();

    // 步骤4：持久化到数据库 + 更新缓存
    {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        save_to_db_internal(&conn, &memory)?;
    }
    {
        let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
        cache.insert(project_id, memory);
    }

    Ok(merged)
}

/// 按 entity+field 幂等合并
///
/// 约定：characters/timeline/locations/foreshadows 分区的每个条目都包含
/// "entity" 和 "field" 两个字符串字段，作为业务主键。
/// 合并规则：
/// - 若 current 中存在相同 entity+field 的条目，则用 data 中的新值覆盖
/// - 否则追加为新条目
fn merge_by_entity_field(
    current: &serde_json::Value,
    new_data: &serde_json::Value,
    section: &str,
) -> Result<serde_json::Value, String> {
    let mut arr = current.as_array()
        .ok_or_else(|| format!("分区 {} 不是数组，无法 merge", section))?
        .clone();

    let new_items = new_data.as_array()
        .ok_or_else(|| format!("merge 策略要求 data 为数组，分区: {}", section))?;

    for new_item in new_items {
        let new_entity = new_item["entity"].as_str().unwrap_or("");
        let new_field = new_item["field"].as_str().unwrap_or("");

        // 查找并替换同 entity+field 的条目
        let mut found = false;
        for entry in arr.iter_mut() {
            let ent = entry["entity"].as_str().unwrap_or("");
            let fld = entry["field"].as_str().unwrap_or("");
            if ent == new_entity && fld == new_field {
                *entry = new_item.clone();
                found = true;
                break;
            }
        }
        if !found {
            arr.push(new_item.clone());
        }
    }
    Ok(serde_json::Value::Array(arr))
}
```

#### 3.4.4 分区访问辅助函数

```rust
/// 读取 memory 的指定分区
fn get_section(memory: &StoryMemory, section: &str) -> Result<serde_json::Value, String> {
    Ok(match section {
        "characters" => memory.characters.clone(),
        "timeline" => memory.timeline.clone(),
        "locations" => memory.locations.clone(),
        "foreshadows" => memory.foreshadows.clone(),
        "baseline_style" => memory.baseline_style.clone().unwrap_or(serde_json::Value::Null),
        other => return Err(format!("未知分区: {}", other)),
    })
}

/// 设置 memory 的指定分区
fn set_section(memory: &mut StoryMemory, section: &str, value: serde_json::Value) -> Result<(), String> {
    match section {
        "characters" => memory.characters = value,
        "timeline" => memory.timeline = value,
        "locations" => memory.locations = value,
        "foreshadows" => memory.foreshadows = value,
        "baseline_style" => memory.baseline_style = Some(value),
        other => return Err(format!("未知分区: {}", other)),
    }
    Ok(())
}
```

#### 3.4.5 数据库持久化

```rust
/// 将 StoryMemory 写入数据库（INSERT OR REPLACE）
///
/// 内部函数，不获取 db 锁（由调用方持有）。
/// 调用方需在调用前 lock DbState，并将 &Connection 传入。
fn save_to_db_internal(conn: &rusqlite::Connection, memory: &StoryMemory) -> Result<(), String> {
    let characters_str = serde_json::to_string(&memory.characters)
        .map_err(|e| format!("序列化 characters 失败: {}", e))?;
    let timeline_str = serde_json::to_string(&memory.timeline)
        .map_err(|e| format!("序列化 timeline 失败: {}", e))?;
    let locations_str = serde_json::to_string(&memory.locations)
        .map_err(|e| format!("序列化 locations 失败: {}", e))?;
    let foreshadows_str = serde_json::to_string(&memory.foreshadows)
        .map_err(|e| format!("序列化 foreshadows 失败: {}", e))?;
    let baseline_style_str = match &memory.baseline_style {
        Some(v) => Some(serde_json::to_string(v).map_err(|e| format!("序列化 baseline_style 失败: {}", e))?),
        None => None,
    };

    conn.execute(
        "INSERT OR REPLACE INTO story_memory
            (project_id, characters, timeline, locations, foreshadows, baseline_style, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            memory.project_id,
            characters_str,
            timeline_str,
            locations_str,
            foreshadows_str,
            baseline_style_str,
            memory.updated_at,
        ],
    ).map_err(|e| format!("写入记忆库失败: {}", e))?;
    Ok(())
}
```

#### 3.4.6 项目切换接口

```rust
/// 项目切换时调用：刷新缓存为新项目
///
/// 调用位置：commands.rs::switch_project 命令在更新项目状态后调用本函数。
/// P0 策略：移除旧项目缓存，加载新项目。
/// P1 优化：保留最近 3 个项目的缓存（LRU），减少切换开销。
pub fn switch_project(db: &DbState, new_project_id: i64) -> Result<(), String> {
    // 移除所有旧缓存（P0 简化）
    {
        let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
        cache.clear();
    }
    // 加载新项目
    load_project_memory(db, new_project_id)?;
    Ok(())
}

/// 从缓存中移除指定项目（项目删除时调用）
///
/// 调用位置：commands.rs::delete_project 命令在删除项目数据后调用。
pub fn evict_project(project_id: i64) -> Result<(), String> {
    let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
    cache.remove(&project_id);
    Ok(())
}
```

#### 3.4.7 调用链与集成点

**调用链路图**：

```
┌─────────────────────────────────────────────────────────────┐
│  lib.rs setup 钩子                                          │
│    └─→ init_memory_service(db)                              │
│          └─→ load_project_memory(db, recent_project_id)     │
│                ├─→ SELECT FROM story_memory                 │
│                ├─→ 首次访问时 INSERT 空记忆库                │
│                └─→ MEMORY_CACHE.write().insert(...)         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ReadMemoryTool.execute (tools.rs)                          │
│    └─→ memory::read_memory_internal(db, pid, section)       │
│          ├─→ MEMORY_CACHE.read().get(&pid)                  │
│          │     └─→ 命中：直接返回分区数据                    │
│          └─→ 未命中：load_project_memory → 再读取            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  WriteMemoryTool.execute (tools.rs)                         │
│    └─→ memory::write_memory_internal(db, pid, sec, data, s) │
│          ├─→ MEMORY_CACHE.read().get(&pid).clone()          │
│          │     └─→ 未命中则 load_project_memory              │
│          ├─→ merge_by_entity_field / replace / append       │
│          ├─→ save_to_db_internal(&conn, &memory)            │
│          │     └─→ INSERT OR REPLACE INTO story_memory      │
│          └─→ MEMORY_CACHE.write().insert(pid, memory)       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  commands.rs::switch_project                                │
│    └─→ memory::switch_project(db, new_pid)                  │
│          ├─→ MEMORY_CACHE.write().clear()                   │
│          └─→ load_project_memory(db, new_pid)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  commands.rs::delete_project                                │
│    └─→ memory::evict_project(pid)                           │
│          └─→ MEMORY_CACHE.write().remove(&pid)              │
└─────────────────────────────────────────────────────────────┘
```

**lib.rs 集成代码片段**（追加到 setup 钩子，位于 `init_registry()` 之后）：

```rust
// 初始化 Agent 注册表
app.handle::<DbState>().clone().try_insert(crate::agents::registry::RegistryState::default())?;

// 初始化 Agent 注册表数据（内置 Agent + 数据库自定义 Agent）
crate::agents::registry::init_registry(&app.state::<DbState>())
    .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

// 初始化记忆库服务（加载当前项目的记忆库到缓存）
crate::agents::memory::init_memory_service(&app.state::<DbState>())
    .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
```

**并发安全说明**：

1. `MEMORY_CACHE` 使用 `RwLock`，读操作互不阻塞，写操作独占
2. 工具执行链路中，`read_memory_internal` 先释放读锁再调用 `load_project_memory`，避免读锁内嵌套写锁造成死锁
3. `write_memory_internal` 在持锁期间不调用任何外部函数（`save_to_db_internal` 只接受 `&Connection`，不获取 db 锁）
4. `DbState` 的 `Mutex<Connection>` 锁与 `MEMORY_CACHE` 的 `RwLock` 锁互不嵌套，避免跨锁死锁

**与架构设计文档的差异说明**：

架构设计文档（2.7 节）曾将 `StoryMemory` 设计为含 `Vec<MemoryEntry>` 字段。详细设计阶段调整为 `serde_json::Value` 类型，原因：

1. 记忆库条目结构在不同分区有差异（角色有 `age`/`gender` 字段，时间线有 `chapter`/`scene` 字段），统一的 `MemoryEntry` struct 无法覆盖
2. LLM 生成的工具调用参数本身就是 JSON，直接存储为 `serde_json::Value` 避免双重转换
3. 前端渲染时直接消费 JSON，无需经过 Rust struct 中转
4. 数据库列类型本就是 `TEXT` 存储 JSON 字符串，使用 `Value` 减少序列化层级

`merge_by_entity_field` 函数通过约定 `entity`+`field` 字段实现幂等性，不依赖具体 struct 类型，更灵活。

---

## 4. Rust模块详细设计 - 命令层

命令层位于 [agents/commands.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/agents/commands.rs)，承担两类职责：

1. **Tauri 命令暴露**：向前端暴露 `agent_*` 系列命令，供 `utils/tauri.ts` 调用
2. **检查点协调**：维护"任务 ID → 决策 Sender"的全局映射表，连接异步 Pipeline 等待与前端决策命令

**与执行层的边界**：命令层只做"参数解析 + 状态查询 + 任务派发"，不直接执行 LLM 调用或工具调用。所有重活委托给 `pipeline.rs` / `registry.rs` / `memory.rs`。

### 4.1 commands.rs - Tauri命令

#### 4.1.1 全局检查点等待表

由于 Tauri 命令是无状态函数（每次调用独立），而 Pipeline 是长生命周期异步任务，需要全局表关联两者。`oneshot::Sender` 一旦发送即消耗，因此用 `Option` 包装。

```rust
use std::collections::HashMap;
use std::sync::RwLock;
use once_cell::sync::Lazy;
use tokio::sync::oneshot;
use crate::agents::pipeline::CheckpointDecision;

/// 全局检查点等待表：task_id → 决策 Sender
///
/// 当 Pipeline 执行到检查点时，会创建 oneshot 通道并将 Sender 注册到本表。
/// 前端用户做出决策后，agent_checkpoint_decision 命令从本表取出 Sender 发送决策。
/// 决策发送后 Sender 被消耗，本表中对应条目自动移除。
static CHECKPOINT_SENDERS: Lazy<RwLock<HashMap<String, oneshot::Sender<CheckpointDecision>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 由 pipeline.rs 在到达检查点时调用，注册决策 Sender
///
/// 返回 true 表示注册成功；返回 false 表示已有同名任务的检查点在等待（异常情况）。
pub fn register_checkpoint_sender(
    task_id: &str,
    sender: oneshot::Sender<CheckpointDecision>,
) -> bool {
    let mut map = CHECKPOINT_SENDERS.write()
        .map_err(|e| log::error!("检查点等待表锁失败: {}", e))
        .unwrap_or_default();
    if map.contains_key(task_id) {
        return false;  // 已有等待中的检查点
    }
    map.insert(task_id.to_string(), sender);
    true
}

/// 由 agent_checkpoint_decision 命令调用，取出并触发决策
///
/// 返回 Err 的情况：
/// - 任务无等待中的检查点（用户未收到弹窗就响应，或任务已结束）
/// - 接收方已 drop（Pipeline 已超时/取消）
pub fn submit_checkpoint_decision(
    task_id: &str,
    decision: CheckpointDecision,
) -> Result<(), String> {
    let sender = {
        let mut map = CHECKPOINT_SENDERS.write()
            .map_err(|e| format!("检查点等待表锁失败: {}", e))?;
        map.remove(task_id)
            .ok_or_else(|| format!("任务 {} 无等待中的检查点", task_id))?
    };
    sender.send(decision).map_err(|_| {
        format!("检查点接收方已关闭（任务可能已结束）")
    })
}

/// 取消任务时清理残留的检查点 Sender（防止泄漏）
///
/// 由 agent_cancel_task 命令调用。
pub fn evict_checkpoint_sender(task_id: &str) {
    if let Ok(mut map) = CHECKPOINT_SENDERS.write() {
        map.remove(task_id);
    }
}
```

#### 4.1.2 辅助函数

```rust
use crate::db::DbState;
use crate::agents::models::{AgentTask, TaskStatus, PermissionMode};
use crate::agents::registry;

/// 查询当前活跃项目 ID
///
/// 优先级：
/// 1. 调用方显式传入 project_id（命令层已校验）
/// 2. 数据库中最近更新的项目
///
/// P1 阶段可扩展为读取前端传入的"当前会话项目"上下文。
fn get_current_project_id(db: &DbState) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.query_row(
        "SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    ).map_err(|e| format!("未找到可用项目: {}", e))
}

/// 将任务记录写入 agent_tasks 表
///
/// 返回数据库自增 id（task_id 由调用方生成 UUID）
fn save_task_to_db(db: &DbState, task: &AgentTask) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "INSERT INTO agent_tasks
            (task_id, project_id, conversation_id, workflow_id, status, permission_mode,
             input, output, current_node_id, completed_nodes, error_log,
             total_tokens, estimated_tokens, cache_hit_count, cache_miss_count,
             started_at, completed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            task.task_id,
            task.project_id,
            task.conversation_id,
            task.workflow_id,
            task.status.to_db_str(),
            task.permission_mode.to_db_str(),
            task.input,
            task.output,
            task.current_node_id,
            task.completed_nodes,
            task.error_log,
            task.total_tokens,
            task.estimated_tokens,
            task.cache_hit_count,
            task.cache_miss_count,
            task.started_at,
            task.completed_at,
            task.created_at,
        ],
    ).map_err(|e| format!("写入任务失败: {}", e))?;
    Ok(conn.last_insert_rowid())
}

/// 更新任务状态（轻量更新，仅 status 字段）
fn update_task_status_in_db(db: &DbState, task_id: &str, status: TaskStatus) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute(
        "UPDATE agent_tasks SET status = ?1 WHERE task_id = ?2",
        rusqlite::params![status.to_db_str(), task_id],
    ).map_err(|e| format!("更新任务状态失败: {}", e))?;
    Ok(())
}
```

#### 4.1.3 P0 命令实现

**命令清单**（P0 共 10 个）：

| 命令 | 签名 | 说明 |
|---|---|---|
| `agent_list_workflows` | `() -> Vec<WorkflowInfo>` | 列出可用工作流 |
| `agent_list_agents` | `(category: Option<String>) -> Vec<AgentDefinition>` | 列出可用 Agent |
| `agent_list_tools` | `() -> Vec<ToolDefinition>` | 列出可用工具（调试用） |
| `agent_start_task` | `(workflow_id, input_json, permission_mode) -> AgentTask` | 发起任务 |
| `agent_cancel_task` | `(task_id) -> ()` | 取消任务 |
| `agent_list_tasks` | `(project_id, limit) -> Vec<AgentTask>` | 任务历史 |
| `agent_get_task` | `(task_id) -> AgentTask` | 查询单个任务 |
| `agent_resume_task` | `(task_id) -> ()` | 恢复崩溃任务 |
| `agent_read_output` | `(task_id, file_name) -> String` | 读取中间产出 |
| `agent_list_outputs` | `(task_id) -> Vec<String>` | 列出产出文件 |
| `agent_save_settings` | `(settings_json) -> ()` | 保存 Agent 设置 |
| `agent_load_settings` | `() -> AgentSettings` | 加载 Agent 设置 |

> **注**：`agent_checkpoint_decision` 是 P1 命令（仅 `supervised` 模式触发），但其底层 `submit_checkpoint_decision` 在 P0 即实现，用于支撑 P0 工作流的检查点节点。

```rust
use tauri::{AppHandle, State, Emitter};
use crate::CancellationTokenState;
use crate::agents::models::{AgentDefinition, AgentSetting, PermissionMode, TaskStatus};
use crate::agents::pipeline::{PipelineEngine, CheckpointDecision};
use crate::agents::registry::WorkflowDefinition;
use serde::Serialize;

/// 工作流信息（前端展示用，剥离 DAG 细节）
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowInfo {
    pub workflow_id: String,
    pub name: String,
    pub description: String,
    pub default_permission_mode: String,
    pub estimated_token_cost: i64,
    pub node_count: usize,
    pub checkpoint_count: usize,
}

// ─────────────────────────────────────────────────────
// 查询类命令
// ─────────────────────────────────────────────────────

#[tauri::command]
pub fn agent_list_workflows() -> Vec<WorkflowInfo> {
    registry::list_workflows().into_iter().map(|w| WorkflowInfo {
        workflow_id: w.workflow_id.clone(),
        name: w.name.clone(),
        description: w.description.clone(),
        default_permission_mode: w.default_permission_mode.to_db_str(),
        estimated_token_cost: w.estimated_token_cost.clone().unwrap_or(0),
        node_count: w.nodes.len(),
        checkpoint_count: w.checkpoints.len(),
    }).collect()
}

#[tauri::command]
pub fn agent_list_agents(category: Option<String>) -> Vec<AgentDefinition> {
    registry::list_agents().into_iter()
        .filter(|a| {
            category.as_ref().map_or(true, |c| a.category.to_db_str() == c)
        })
        .collect()
}

#[tauri::command]
pub fn agent_list_tools() -> Vec<crate::agents::models::ToolDefinition> {
    registry::list_tool_definitions()
}

#[tauri::command]
pub fn agent_list_tasks(
    db: State<'_, DbState>,
    project_id: i64,
    limit: Option<i64>,
) -> Result<Vec<AgentTask>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, project_id, conversation_id, workflow_id, status, permission_mode,
                    input, output, current_node_id, completed_nodes, error_log,
                    total_tokens, estimated_tokens, cache_hit_count, cache_miss_count,
                    started_at, completed_at, created_at
             FROM agent_tasks WHERE project_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        )
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id, limit], AgentTask::from_db_row)
        .map_err(|e| format!("查询任务失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取任务失败: {}", e))
}

#[tauri::command]
pub fn agent_get_task(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<AgentTask, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.query_row(
        "SELECT id, task_id, project_id, conversation_id, workflow_id, status, permission_mode,
                input, output, current_node_id, completed_nodes, error_log,
                total_tokens, estimated_tokens, cache_hit_count, cache_miss_count,
                started_at, completed_at, created_at
         FROM agent_tasks WHERE task_id = ?1",
        rusqlite::params![task_id],
        AgentTask::from_db_row,
    ).map_err(|e| format!("查询任务失败: {}", e))
}
```

#### 4.1.4 任务发起命令

`agent_start_task` 是核心命令，负责创建任务记录并异步启动 Pipeline。注意 `DbState` 的克隆策略：使用 `Arc` 包装以支持异步任务持有引用。

```rust
#[tauri::command]
pub async fn agent_start_task(
    db: State<'_, DbState>,
    app: AppHandle,
    cancel_token: State<'_, CancellationTokenState>,
    workflow_id: String,
    input_json: String,
    permission_mode: Option<String>,
    project_id: Option<i64>,
) -> Result<AgentTask, String> {
    // 1. 解析输入
    let input: serde_json::Value = serde_json::from_str(&input_json)
        .map_err(|e| format!("输入参数解析失败: {}", e))?;

    // 2. 查找工作流
    let workflow = registry::get_workflow(&workflow_id)
        .ok_or_else(|| format!("工作流 {} 未注册", workflow_id))?
        .clone();

    // 3. 解析权限模式（默认 HandsOff）
    let mode = match permission_mode.as_deref() {
        Some("supervised") => PermissionMode::Supervised,
        Some("autopilot") => PermissionMode::Autopilot,
        Some("hands_off") | None => PermissionMode::HandsOff,
        Some(other) => return Err(format!("未知权限模式: {}", other)),
    };

    // 4. 解析项目 ID
    let pid = match project_id {
        Some(id) => id,
        None => get_current_project_id(&db)?,
    };

    // 5. 调用工作流的输入解析（验证 + 标准化）
    let parsed_input = workflow.parse_input(&input)?;

    // 6. 构造任务记录
    let task_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let estimated_tokens = workflow.estimated_token_cost.clone().unwrap_or(0);
    let task = AgentTask {
        id: 0,
        task_id: task_id.clone(),
        project_id: pid,
        conversation_id: None,
        workflow_id: workflow_id.clone(),
        status: TaskStatus::Pending,
        permission_mode: mode,
        input: parsed_input.to_string(),
        output: None,
        current_node_id: None,
        completed_nodes: "[]".to_string(),
        error_log: None,
        total_tokens: 0,
        estimated_tokens: Some(estimated_tokens),
        cache_hit_count: 0,
        cache_miss_count: 0,
        started_at: Some(now.clone()),
        completed_at: None,
        created_at: now,
    };

    // 7. 写入数据库
    save_task_to_db(&db, &task)?;

    // 8. 异步启动 Pipeline（不阻塞命令返回）
    //    注意：DbState 内部是 Mutex<Connection>，无法直接 Clone Connection。
    //    方案：将 db State 的 inner() 通过 Arc 共享给异步任务。
    let db_arc = db.inner().clone();  // 假设 DbState 实现为 Arc<Mutex<Connection>> 或类似
    let app_clone = app.clone();
    let cancel_clone = cancel_token.inner().clone();
    let task_clone = task.clone();

    tauri::async_runtime::spawn(async move {
        let mut engine = PipelineEngine::new(
            &db_arc, &app_clone, &cancel_clone,
            workflow, task_clone,
        );
        if let Err(e) = engine.execute().await {
            log::error!("Pipeline 执行失败: task_id={}, error={}", engine.context().task_id, e);
            let _ = app_clone.emit("agent:done", serde_json::json!({
                "task_id": engine.context().task_id,
                "status": "failed",
                "error_log": e,
            }));
        }
    });

    Ok(task)
}
```

> **DbState 共享说明**：现有 `DbState(Mutex<Connection>)` 无法直接 clone。需将其改为 `DbState(Arc<Mutex<Connection>>)`，或在 `lib.rs` 中为 `DbState` 实现 `Clone`（内部 `Arc::clone`）。这是 P0 必须完成的前置改造。详见 [4.2.4 DbState 共享改造](#424-dbstate-共享改造)。

#### 4.1.5 任务控制命令

```rust
#[tauri::command]
pub fn agent_cancel_task(
    task_id: String,
    cancel_token: State<'_, CancellationTokenState>,
) -> Result<(), String> {
    // 1. 触发取消令牌（Pipeline 检测到取消后会终止）
    cancel_token.cancel();
    // 2. 清理检查点 Sender（防止泄漏）
    evict_checkpoint_sender(&task_id);
    // 3. 更新数据库状态（Pipeline 的取消逻辑也会更新，这里是兜底）
    //    注意：状态更新交给 Pipeline 的取消处理逻辑完成，这里不重复
    Ok(())
}

#[tauri::command]
pub async fn agent_resume_task(
    db: State<'_, DbState>,
    app: AppHandle,
    cancel_token: State<'_, CancellationTokenState>,
    task_id: String,
) -> Result<(), String> {
    // 1. 查询任务记录
    let task = {
        let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
        conn.query_row(
            "SELECT id, task_id, project_id, conversation_id, workflow_id, status, permission_mode,
                    input, output, current_node_id, completed_nodes, error_log,
                    total_tokens, estimated_tokens, cache_hit_count, cache_miss_count,
                    started_at, completed_at, created_at
             FROM agent_tasks WHERE task_id = ?1",
            rusqlite::params![task_id],
            AgentTask::from_db_row,
        ).map_err(|e| format!("查询任务失败: {}", e))?
    };

    // 2. 状态校验：仅 Paused / Failed 状态可恢复
    if !matches!(task.status, TaskStatus::Paused | TaskStatus::Failed) {
        return Err(format!("任务状态 {} 不可恢复", task.status.to_db_str()));
    }

    // 3. 查找工作流
    let workflow = registry::get_workflow(&task.workflow_id)
        .ok_or_else(|| format!("工作流 {} 未注册", task.workflow_id))?
        .clone();

    // 4. 更新状态为 Running
    update_task_status_in_db(&db, &task_id, TaskStatus::Running)?;

    // 5. 异步启动 Pipeline（断点续传）
    let db_arc = db.inner().clone();
    let app_clone = app.clone();
    let cancel_clone = cancel_token.inner().clone();

    tauri::async_runtime::spawn(async move {
        let mut engine = PipelineEngine::new(
            &db_arc, &app_clone, &cancel_clone,
            workflow, task,
        );
        if let Err(e) = engine.execute().await {
            log::error!("Pipeline 恢复失败: task_id={}, error={}", engine.context().task_id, e);
            let _ = app_clone.emit("agent:done", serde_json::json!({
                "task_id": engine.context().task_id,
                "status": "failed",
                "error_log": e,
            }));
        }
    });

    Ok(())
}
```

#### 4.1.6 中间产出读取命令

```rust
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn agent_list_outputs(task_id: String) -> Result<Vec<String>, String> {
    let dir = get_output_dir(&task_id);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| format!("读取产出目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        if let Some(name) = entry.file_name().to_str() {
            // 仅返回 .md / .json 文件（防止泄漏 .tmp 临时文件）
            if name.ends_with(".md") || name.ends_with(".json") {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn agent_read_output(task_id: String, file_name: String) -> Result<String, String> {
    // 路径安全校验：防止 file_name 包含 ../ 等路径穿越
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("非法文件名".to_string());
    }
    if !file_name.ends_with(".md") && !file_name.ends_with(".json") {
        return Err("仅支持 .md / .json 文件".to_string());
    }
    let path = get_output_dir(&task_id).join(&file_name);
    if !path.exists() {
        return Err(format!("文件 {} 不存在", file_name));
    }
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 产出目录：与 pipeline.rs::get_output_dir 保持一致
fn get_output_dir(task_id: &str) -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("Whisper");
    path.push("agent_outputs");
    path.push(task_id);
    path
}
```

#### 4.1.7 检查点决策命令（P1 实现底层，P0 仅占位）

```rust
#[tauri::command]
pub fn agent_checkpoint_decision(
    task_id: String,
    decision_json: String,
) -> Result<(), String> {
    let decision: CheckpointDecision = serde_json::from_str(&decision_json)
        .map_err(|e| format!("决策参数解析失败: {}", e))?;
    submit_checkpoint_decision(&task_id, decision)
}
```

#### 4.1.8 Agent 系统设置命令

`agent_settings` 表存储键值对配置（如默认权限模式、token 上限等）。P0 阶段仅 2 个键：

- `default_permission_mode`：默认权限模式（`hands_off` / `supervised` / `autopilot`）
- `max_total_tokens`：单任务 token 上限（默认 100000）

```rust
#[tauri::command]
pub fn agent_load_settings(db: State<'_, DbState>) -> Result<Vec<AgentSetting>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT key, value, updated_at FROM agent_settings ORDER BY key")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map([], |row| Ok(AgentSetting {
            key: row.get(0)?,
            value: row.get(1)?,
            updated_at: row.get(2)?,
        }))
        .map_err(|e| format!("查询设置失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取设置失败: {}", e))
}

#[tauri::command]
pub fn agent_save_settings(
    db: State<'_, DbState>,
    settings_json: String,
) -> Result<(), String> {
    let settings: Vec<AgentSetting> = serde_json::from_str(&settings_json)
        .map_err(|e| format!("设置参数解析失败: {}", e))?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    for s in &settings {
        conn.execute(
            "INSERT OR REPLACE INTO agent_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![s.key, s.value, now],
        ).map_err(|e| format!("保存设置失败: {}", e))?;
    }
    Ok(())
}
```

#### 4.1.9 lib.rs 命令注册

在 [lib.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/lib.rs) 的 `generate_handler!` 宏中追加 Agent 命令分组。保持与现有命令的命名风格一致。

```rust
// src-tauri/src/lib.rs

mod agents;  // 顶部声明

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // ... 现有初始化代码 ...

            // 初始化 Agent 注册表
            crate::agents::registry::init_registry(&app.state::<DbState>())
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            // 初始化记忆库服务
            crate::agents::memory::init_memory_service(&app.state::<DbState>())
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // === 现有命令 ===
            crate::commands::chat::send_message,
            crate::commands::chat::get_messages,
            // ... 其他现有命令 ...

            // === Agent 命令（P0） ===
            crate::agents::commands::agent_list_workflows,
            crate::agents::commands::agent_list_agents,
            crate::agents::commands::agent_list_tools,
            crate::agents::commands::agent_start_task,
            crate::agents::commands::agent_cancel_task,
            crate::agents::commands::agent_list_tasks,
            crate::agents::commands::agent_get_task,
            crate::agents::commands::agent_resume_task,
            crate::agents::commands::agent_read_output,
            crate::agents::commands::agent_list_outputs,
            crate::agents::commands::agent_save_settings,
            crate::agents::commands::agent_load_settings,

            // === Agent 命令（P1） ===
            crate::agents::commands::agent_checkpoint_decision,

            // === Agent 命令（P3，待实现） ===
            // crate::agents::commands::agent_save_custom_agent,
            // crate::agents::commands::agent_list_custom_agents,
            // crate::agents::commands::agent_delete_custom_agent,
            // crate::agents::commands::agent_export_agent,
            // crate::agents::commands::agent_import_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 4.2 现有函数内部化改造

为了让 [tools.rs](#31-toolsrs---工具适配层) 复用现有命令的业务逻辑（避免代码重复），需要将现有的 Tauri 命令函数拆分为：

- **外部命令层**：`#[tauri::command]` + `State<'_, DbState>` 参数，仅负责从 State 获取锁并调用内部函数
- **内部函数层**：`pub fn xxx_internal(db: &DbState, ...) -> Result<T, String>`，包含完整业务逻辑，可被 agents 模块复用

**改造原则**：

1. **零行为变更**：改造后现有命令的行为完全不变，前端无需感知
2. **签名扁平**：内部函数参数保持扁平，不接收 `State` 类型
3. **锁外调用**：内部函数自行 lock DbState，避免双重加锁
4. **公开可见**：内部函数必须 `pub`，供 `agents::tools` 模块跨文件调用

#### 4.2.1 settings.rs 改造

涉及 4 个命令，对应 4 个设定卡工具。

```rust
// src-tauri/src/commands/settings.rs

// ─────────────────────────────────────────────────────
// 内部函数层（新增，供 agents::tools 复用）
// ─────────────────────────────────────────────────────

/// 创建设定卡（内部函数）
///
/// 被 agents::tools::CreateSettingCardTool 调用。
/// 同时创建初始版本快照，保持与原命令一致的行为。
pub fn create_card_internal(
    db: &DbState,
    project_id: i64,        // 注意：内部函数用 i64（数据库类型），命令层用 String（前端约定）
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    conn.execute(
        "INSERT INTO setting_cards (id, project_id, card_type, name, fields, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, project_id, card_type, name, fields, now, now],
    ).map_err(|e| format!("创建设定卡失败: {}", e))?;

    // 创建初始版本快照（与原命令保持一致）
    let version_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![version_id, id, fields, now],
    ).map_err(|e| format!("创建设定卡版本失败: {}", e))?;

    Ok(id)
}

/// 查询设定卡列表（内部函数）
pub fn list_cards_internal(
    db: &DbState,
    project_id: i64,
    card_type: Option<String>,
) -> Result<Vec<crate::models::SettingCard>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let rows = if let Some(ct) = card_type {
        let mut stmt = conn
            .prepare("SELECT id, project_id, card_type, name, fields, created_at, updated_at
                      FROM setting_cards WHERE project_id = ?1 AND card_type = ?2
                      ORDER BY updated_at DESC")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        stmt.query_map(rusqlite::params![project_id, ct], map_setting_card_row)
            .map_err(|e| format!("查询设定卡失败: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取设定卡失败: {}", e))?
    } else {
        let mut stmt = conn
            .prepare("SELECT id, project_id, card_type, name, fields, created_at, updated_at
                      FROM setting_cards WHERE project_id = ?1
                      ORDER BY updated_at DESC")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        stmt.query_map(rusqlite::params![project_id], map_setting_card_row)
            .map_err(|e| format!("查询设定卡失败: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取设定卡失败: {}", e))?
    };
    Ok(rows)
}

/// 更新设定卡（内部函数）
pub fn update_card_internal(
    db: &DbState,
    id: String,
    name: Option<String>,
    fields: Option<String>,
    card_type: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 获取当前值
    let current: crate::models::SettingCard = conn
        .query_row(
            "SELECT id, project_id, card_type, name, fields, created_at, updated_at
             FROM setting_cards WHERE id = ?1",
            rusqlite::params![id],
            map_setting_card_row,
        )
        .map_err(|e| format!("查询设定卡失败: {}", e))?;

    let new_name = name.unwrap_or(current.name);
    let new_fields = fields.unwrap_or(current.fields);
    let new_card_type = card_type.unwrap_or(current.card_type);

    conn.execute(
        "UPDATE setting_cards SET name = ?1, fields = ?2, card_type = ?3, updated_at = ?4
         WHERE id = ?5",
        rusqlite::params![new_name, new_fields, new_card_type, now, id],
    ).map_err(|e| format!("更新设定卡失败: {}", e))?;

    // 自动创建版本快照（与原命令保持一致）
    let version_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO setting_card_versions (id, card_id, fields, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![version_id, id, new_fields, now],
    ).map_err(|e| format!("创建版本快照失败: {}", e))?;

    Ok(())
}

/// 删除设定卡（内部函数）
pub fn delete_card_internal(db: &DbState, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM setting_cards WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除设定卡失败: {}", e))?;
    Ok(())
}

/// 行映射辅助函数（提取公共逻辑）
fn map_setting_card_row(row: &rusqlite::Row) -> rusqlite::Result<crate::models::SettingCard> {
    Ok(crate::models::SettingCard {
        id: row.get(0)?,
        project_id: row.get(1)?,
        card_type: row.get(2)?,
        name: row.get(3)?,
        fields: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

// ─────────────────────────────────────────────────────
// 命令层（改造为调用内部函数）
// ─────────────────────────────────────────────────────

#[tauri::command]
pub fn create_setting_card(
    db: State<'_, DbState>,
    project_id: String,          // 前端传 String，需转换为 i64
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let pid: i64 = project_id.parse().map_err(|_| "project_id 必须为数字")?;
    create_card_internal(&db, pid, card_type, name, fields)
}

#[tauri::command]
pub fn list_setting_cards(
    db: State<'_, DbState>,
    project_id: String,
    card_type: Option<String>,
) -> Result<Vec<crate::models::SettingCard>, String> {
    let pid: i64 = project_id.parse().map_err(|_| "project_id 必须为数字")?;
    list_cards_internal(&db, pid, card_type)
}

#[tauri::command]
pub fn update_setting_card(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    fields: Option<String>,
    card_type: Option<String>,
) -> Result<(), String> {
    update_card_internal(&db, id, name, fields, card_type)
}

#[tauri::command]
pub fn delete_setting_card(db: State<'_, DbState>, id: String) -> Result<(), String> {
    delete_card_internal(&db, id)
}
```

> **类型转换说明**：现有命令的 `project_id` 是 `String` 类型（与前端约定一致），而内部函数用 `i64`（数据库实际类型）。命令层负责 `String → i64` 转换，内部函数统一使用 `i64`，避免工具适配层重复转换。

#### 4.2.2 project.rs 改造

涉及 4 个章节管理命令，对应大纲类工具。

```rust
// src-tauri/src/commands/project.rs

// ─────────────────────────────────────────────────────
// 内部函数层（新增）
// ─────────────────────────────────────────────────────

/// 创建章节（内部函数）
///
/// 被 agents::tools::CreateOutlineNodeTool 调用。
/// 自动维护章节顺序（order_index）。
pub fn create_chapter_internal(
    db: &DbState,
    project_id: i64,
    title: String,
    content: Option<String>,
    parent_id: Option<i64>,
    order_index: Option<i32>,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let now = chrono::Utc::now().to_rfc3339();

    // 若未指定 order_index，自动追加到末尾
    let order = match order_index {
        Some(o) => o,
        None => {
            let max_order: Option<i32> = conn.query_row(
                "SELECT MAX(order_index) FROM chapters WHERE project_id = ?1 AND parent_id IS ?2",
                rusqlite::params![project_id, parent_id],
                |row| row.get(0),
            ).ok();
            max_order.unwrap_or(0) + 1
        }
    };

    conn.execute(
        "INSERT INTO chapters (project_id, title, content, parent_id, order_index, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![project_id, title, content, parent_id, order, now, now],
    ).map_err(|e| format!("创建章节失败: {}", e))?;

    Ok(conn.last_insert_rowid())
}

/// 查询章节列表（内部函数）
pub fn list_chapters_internal(
    db: &DbState,
    project_id: i64,
) -> Result<Vec<crate::models::Chapter>, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, content, parent_id, order_index, created_at, updated_at
                  FROM chapters WHERE project_id = ?1 ORDER BY order_index ASC")
        .map_err(|e| format!("准备查询失败: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(crate::models::Chapter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                parent_id: row.get(4)?,
                order_index: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("查询章节失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取章节失败: {}", e))
}

/// 更新章节（内部函数）
pub fn update_chapter_internal(
    db: &DbState,
    id: i64,
    title: Option<String>,
    content: Option<String>,
    order_index: Option<i32>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    // 动态构造 UPDATE 语句
    let mut sets: Vec<String> = vec![];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(t) = title {
        sets.push("title = ?".to_string());
        params.push(Box::new(t));
    }
    if let Some(c) = content {
        sets.push("content = ?".to_string());
        params.push(Box::new(c));
    }
    if let Some(o) = order_index {
        sets.push("order_index = ?".to_string());
        params.push(Box::new(o));
    }
    if sets.is_empty() {
        return Ok(());  // 无更新
    }
    sets.push("updated_at = ?".to_string());
    params.push(Box::new(now.clone()));
    params.push(Box::new(id));

    let sql = format!("UPDATE chapters SET {} WHERE id = ?", sets.join(", "));
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("更新章节失败: {}", e))?;
    Ok(())
}

/// 删除章节（内部函数）
pub fn delete_chapter_internal(db: &DbState, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.execute("DELETE FROM chapters WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("删除章节失败: {}", e))?;
    Ok(())
}

/// 查询单个项目（内部函数）
pub fn get_project_internal(
    db: &DbState,
    id: i64,
) -> Result<crate::models::Project, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    conn.query_row(
        "SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(crate::models::Project {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        }),
    ).map_err(|e| format!("查询项目失败: {}", e))
}

// ─────────────────────────────────────────────────────
// 命令层（改造为调用内部函数）
// ─────────────────────────────────────────────────────

#[tauri::command]
pub fn create_chapter(
    db: State<'_, DbState>,
    project_id: String,
    title: String,
    content: Option<String>,
    parent_id: Option<String>,
    order_index: Option<i32>,
) -> Result<i64, String> {
    let pid: i64 = project_id.parse().map_err(|_| "project_id 必须为数字")?;
    let parent: Option<i64> = parent_id
        .map(|s| s.parse::<i64>())
        .transpose()
        .map_err(|_| "parent_id 必须为数字")?;
    create_chapter_internal(&db, pid, title, content, parent, order_index)
}

#[tauri::command]
pub fn list_chapters(db: State<'_, DbState>, project_id: String) -> Result<Vec<crate::models::Chapter>, String> {
    let pid: i64 = project_id.parse().map_err(|_| "project_id 必须为数字")?;
    list_chapters_internal(&db, pid)
}

#[tauri::command]
pub fn update_chapter(
    db: State<'_, DbState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    order_index: Option<i32>,
) -> Result<(), String> {
    let id: i64 = id.parse().map_err(|_| "id 必须为数字")?;
    update_chapter_internal(&db, id, title, content, order_index)
}

#[tauri::command]
pub fn delete_chapter(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let id: i64 = id.parse().map_err(|_| "id 必须为数字")?;
    delete_chapter_internal(&db, id)
}

#[tauri::command]
pub fn get_project(db: State<'_, DbState>, id: String) -> Result<crate::models::Project, String> {
    let id: i64 = id.parse().map_err(|_| "id 必须为数字")?;
    get_project_internal(&db, id)
}
```

#### 4.2.3 chat.rs 改造

仅 1 个函数需改造：`get_messages`，对应 `agent.query_conversation_history` 工具。

```rust
// src-tauri/src/commands/chat.rs

// ─────────────────────────────────────────────────────
// 内部函数层（新增）
// ─────────────────────────────────────────────────────

/// 查询对话历史消息（内部函数）
///
/// 被 agents::tools::QueryConversationHistoryTool 调用。
/// 支持按角色过滤、按时间倒序、限制返回数量。
pub fn get_messages_internal(
    db: &DbState,
    conversation_id: i64,
    role: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<crate::models::Message>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;

    let rows = if let Some(r) = role {
        let mut stmt = conn
            .prepare("SELECT id, conversation_id, role, content, tokens, created_at
                      FROM messages WHERE conversation_id = ?1 AND role = ?2
                      ORDER BY created_at ASC LIMIT ?3")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        stmt.query_map(rusqlite::params![conversation_id, r, limit], map_message_row)
            .map_err(|e| format!("查询消息失败: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取消息失败: {}", e))?
    } else {
        let mut stmt = conn
            .prepare("SELECT id, conversation_id, role, content, tokens, created_at
                      FROM messages WHERE conversation_id = ?1
                      ORDER BY created_at ASC LIMIT ?2")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        stmt.query_map(rusqlite::params![conversation_id, limit], map_message_row)
            .map_err(|e| format!("查询消息失败: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取消息失败: {}", e))?
    };
    Ok(rows)
}

fn map_message_row(row: &rusqlite::Row) -> rusqlite::Result<crate::models::Message> {
    Ok(crate::models::Message {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        tokens: row.get(4)?,
        created_at: row.get(5)?,
    })
}

// ─────────────────────────────────────────────────────
// 命令层（改造为调用内部函数）
// ─────────────────────────────────────────────────────

#[tauri::command]
pub fn get_messages(
    db: State<'_, DbState>,
    conversation_id: String,
    role: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<crate::models::Message>, String> {
    let cid: i64 = conversation_id.parse().map_err(|_| "conversation_id 必须为数字")?;
    get_messages_internal(&db, cid, role, limit)
}
```

#### 4.2.4 DbState 共享改造

`agent_start_task` 命令需要将 `DbState` 传给异步 Pipeline 任务，但现有 `DbState(Mutex<Connection>)` 无法 Clone。需要改造为 `Arc` 包装。

```rust
// src-tauri/src/db.rs

// 改造前：
pub struct DbState(pub Mutex<Connection>);

// 改造后：
pub struct DbState(pub Arc<Mutex<Connection>>);

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self(Arc::new(Mutex::new(conn)))
    }
}

impl Clone for DbState {
    fn clone(&self) -> Self {
        Self(self.0.clone())  // Arc::clone，仅增加引用计数
    }
}
```

**lib.rs 的 setup 钩子同步改造**：

```rust
// src-tauri/src/lib.rs setup 钩子
.setup(|app| {
    // 改造前：
    // let conn = Connection::open(...)?;
    // app.manage(DbState(Mutex::new(conn)));

    // 改造后：
    let conn = Connection::open(&app.path().app_data_dir()?.join("whisper.db"))?;
    app.manage(DbState::new(conn));
    Ok(())
})
```

**影响范围**：

- 现有所有 `State<'_, DbState>` 参数的命令无需修改（通过 deref 自动适配）
- 所有 `db.0.lock()` 调用无需修改（`Arc<Mutex<Connection>>` 与 `Mutex<Connection>` 的 lock 接口一致）
- 仅 `lib.rs` 的初始化代码需调整

**回退方案**：若改造引入回归问题，可在 `agent_start_task` 中使用 `app.state::<DbState>()` 的引用计数机制（Tauri 的 State 本身是 `Arc` 包装），但需要将 Pipeline 的生命周期绑定到 app handle，实现复杂度较高。`Arc<Mutex<Connection>>` 改造是更简洁的方案。

#### 4.2.5 改造清单与验收标准

| 现有命令 | 提取的内部函数 | 复用的工具 | 验收点 |
|---|---|---|---|
| `commands::settings::create_setting_card` | `create_card_internal` | `agent.create_setting_card` | 创建后 setting_card_versions 表有 1 条初始版本 |
| `commands::settings::list_setting_cards` | `list_cards_internal` | `agent.query_setting_cards` | 按 updated_at 倒序，支持 card_type 过滤 |
| `commands::settings::update_setting_card` | `update_card_internal` | `agent.update_setting_card` | 更新后自动创建版本快照 |
| `commands::settings::delete_setting_card` | `delete_card_internal` | `agent.delete_setting_card` | 级联删除版本记录 |
| `commands::project::create_chapter` | `create_chapter_internal` | `agent.create_outline_node` | 自动维护 order_index |
| `commands::project::list_chapters` | `list_chapters_internal` | `agent.query_outline` | 按 order_index 升序 |
| `commands::project::update_chapter` | `update_chapter_internal` | `agent.update_outline_node` (P1) | 动态 UPDATE 仅更新传入字段 |
| `commands::project::delete_chapter` | `delete_chapter_internal` | `agent.delete_outline_node` (P1) | 级联删除子章节 |
| `commands::chat::get_messages` | `get_messages_internal` | `agent.query_conversation_history` | 按 created_at 升序，支持 role 过滤 |
| `commands::project::get_project` | `get_project_internal` | `agent.query_project_info` | 单条查询 |

**回归测试要点**：

1. 改造后所有现有前端功能正常（创建/查询/更新/删除设定卡、章节、消息查询）
2. Agent 工具适配层调用内部函数的结果与原命令一致
3. 类型转换（String → i64）边界情况：空字符串、非数字字符串应返回明确错误
4. 并发安全：内部函数与命令函数使用相同的锁机制，无死锁风险

---

## 5. 前端详细设计

前端新增内容遵循现有 Whisper 项目的目录约定：类型定义追加到 [types/index.ts](file:///c:/Users/admin/Desktop/Whisper/src/types/index.ts)，Store 放在 [stores/](file:///c:/Users/admin/Desktop/Whisper/src/stores/)，组件放在 [components/agent/](file:///c:/Users/admin/Desktop/Whisper/src/components/agent/)，Tauri 命令封装追加到 [utils/tauri.ts](file:///c:/Users/admin/Desktop/Whisper/src/utils/tauri.ts)。

**设计原则**：

1. **命名隔离**：所有 Agent 相关类型/Store/组件以 `Agent` / `agent` 前缀，避免与现有 Chat 模块冲突
2. **复用现有组件**：Button、Dialog、Toast、ReactMarkdown 等公共组件不重复实现
3. **事件命名空间隔离**：仅监听 `agent:*` 事件，不监听 `chat:*`，避免重复触发
4. **扁平 invoke 参数**：遵循 Tauri 2.0 约束，复杂对象用 JSON 字符串传输
5. **StrictMode 兼容**：监听器在 useEffect 中正确清理，避免 StrictMode 双调用导致的重复监听（参考项目 memory 的硬约束）

### 5.1 types/index.ts - 类型定义

在现有 [types/index.ts](file:///c:/Users/admin/Desktop/Whisper/src/types/index.ts) 末尾追加 Agent 相关类型。所有类型与 Rust 后端 [models.rs](#21-modelsrs---数据结构定义) 一一对应，采用 camelCase（Tauri 2.0 自动转换 snake_case ↔ camelCase）。

```typescript
// ===== Agent 系统类型定义（追加到 src/types/index.ts 末尾） =====

/** Agent 分类 */
export type AgentCategory = 'creative' | 'analytic' | 'structural' | 'memory' | 'tool';

/** 任务状态 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'        // 检查点暂停
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'aborted';

/** 权限模式 */
export type PermissionMode = 'hands_off' | 'supervised' | 'autopilot';

/** 工具权限 */
export type ToolPermission =
  | 'read_db'
  | 'write_db'
  | 'read_file'
  | 'write_file'
  | 'read_memory'
  | 'write_memory';

/** 检查点决策类型 */
export type CheckpointDecision =
  | { action: 'continue'; modified_input?: Record<string, unknown> }
  | { action: 'skip' }
  | { action: 'abort' }
  | { action: 'retry' };

/** 模型参数 */
export interface ModelParams {
  temperature: number;
  max_tokens: number;
  top_p?: number;
}

/** Token 用量 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Agent 定义 */
export interface AgentDefinition {
  agent_id: string;
  name: string;
  category: AgentCategory;
  description: string;
  system_prompt: string;
  required_tools: string[];
  optional_tools: string[];
  api_config_id?: number;
  model_params: ModelParams;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  is_builtin: boolean;
  version: string;
  project_id?: number;
}

/** 工具定义 */
export interface ToolDefinition {
  tool_id: string;
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
  result_schema: Record<string, unknown>;
  required_permission: ToolPermission;
  internal_function: string;
  is_dangerous: boolean;
  cacheable: boolean;
  cache_ttl?: number;
}

/** 工作流节点 */
export interface WorkflowNode {
  node_id: string;
  agent_id: string;
  input_mapping: Record<string, string>;
  is_checkpoint: boolean;
  timeout_seconds?: number;
  retry_count?: number;
  node_type: 'agent' | 'loop';
  loop_config?: LoopConfig;
}

/** 循环配置（P3 阶段使用） */
export interface LoopConfig {
  loop_variable: string;
  iterable_source: string;  // $user_input.xxx 或 $node.xxx.output.yyy
  max_iterations: number;
  break_condition?: string;
}

/** 工作流边 */
export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

/** 工作流信息（前端展示用，剥离 DAG 细节） */
export interface WorkflowInfo {
  workflow_id: string;
  name: string;
  description: string;
  default_permission_mode: PermissionMode;
  estimated_token_cost: number;
  node_count: number;
  checkpoint_count: number;
  input_schema?: Record<string, unknown>;
}

/** Agent 任务 */
export interface AgentTask {
  id: number;
  task_id: string;
  project_id: number;
  conversation_id?: string;
  workflow_id: string;
  status: TaskStatus;
  permission_mode: PermissionMode;
  input: string;                    // JSON 字符串
  output?: string;                  // JSON 字符串
  current_node_id?: string;
  completed_nodes: string;          // JSON 数组字符串
  error_log?: string;
  total_tokens: number;
  estimated_tokens?: number;
  cache_hit_count: number;
  cache_miss_count: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

/** 工具调用日志 */
export interface ToolCallLog {
  id?: number;
  task_id: string;
  node_id: string;
  agent_id: string;
  tool_id: string;
  parameters: Record<string, unknown>;
  result_summary: string;
  duration_ms: number;
  success: boolean;
  error_message?: string;
  cache_hit: boolean;
  created_at: string;
}

/** Agent 系统设置（键值对） */
export interface AgentSetting {
  key: string;
  value: string;
  updated_at: string;
}

// ===== 事件 Payload 类型 =====

/** Agent 流式 chunk 事件 */
export interface AgentChunkEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  content: string;
  done: boolean;
  usage?: TokenUsage;
}

/** 节点进度信息 */
export interface NodeProgress {
  node_id: string;
  agent_id: string;
  agent_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  token_usage?: number;
  is_checkpoint?: boolean;
}

/** Agent 进度事件 */
export interface AgentProgressEvent {
  taskId: string;
  currentNodeId: string;
  nodes: NodeProgress[];
  totalTokens: number;
  estimatedTokens: number;
  cacheHitCount: number;
  cacheMissCount: number;
}

/** 检查点事件 */
export interface CheckpointEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  agentName: string;
  outputContent: string;
  outputFileUrl?: string;        // 产出文件的可读 URL（内部 invoke 路径）
  message: string;
}

/** 工具调用事件 */
export interface ToolCallEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  toolId: string;
  parameters: Record<string, unknown>;
  resultSummary: string;
  durationMs: number;
  success: boolean;
  cacheHit: boolean;
}

/** 任务完成事件 */
export interface AgentDoneEvent {
  taskId: string;
  status: TaskStatus;
  finalOutput?: string;
  totalTokens: number;
  errorLog?: string;
}
```

**类型设计要点**：

1. **JSON 字段保留为字符串**：`AgentTask.input` / `output` / `completed_nodes` 在后端是 `TEXT` 列，前端保持字符串类型，需要时再 `JSON.parse`，避免类型不匹配
2. **事件 Payload 用 camelCase**：Rust 端的 `serde_json::json!` 宏发送时使用 snake_case 字段，Tauri 事件 emit 时不会自动转换，因此前端监听时需注意（架构文档 3.4 节使用 snake_case，本详细设计统一为 camelCase，需在 Rust 端 emit 时显式使用 camelCase 字段名，或在 listen 回调中适配）。**约定**：在 Rust 端 emit 时统一用 camelCase（与 Tauri 命令的自动转换一致），保证前端类型直接可用
3. **Optional 字段语义**：`api_config_id?` / `project_id?` 等可选字段在 Rust 端是 `Option<i64>`，序列化为 JSON 时 `None` 会变成 `null`，前端用 `?:` 表达
4. **联合类型决策**：`CheckpointDecision` 用 discriminated union（`action` 字段区分变体），对应 Rust 的 `#[serde(tag = "action")]`

### 5.2 stores/agentStore.ts - 状态管理

新增 [stores/agentStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/agentStore.ts)，遵循现有 Zustand 模式。与 `chatStore` 完全独立，无共享 state。

```typescript
// src/stores/agentStore.ts
import { create } from 'zustand';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import * as tauri from '@/utils/tauri';
import {
  AgentTask, AgentDefinition, WorkflowInfo, ToolCallLog,
  PermissionMode, TaskStatus, CheckpointDecision,
  AgentChunkEvent, AgentProgressEvent, CheckpointEvent, ToolCallEvent, AgentDoneEvent,
} from '@/types';

interface AgentState {
  // === 数据状态 ===
  availableWorkflows: WorkflowInfo[];
  availableAgents: AgentDefinition[];
  currentTask: AgentTask | null;
  taskHistory: AgentTask[];
  progress: AgentProgressEvent | null;
  streamingContent: string;
  streamingNodeId: string | null;          // 当前正在流式输出的节点 ID
  checkpoint: CheckpointEvent | null;
  toolCallLogs: ToolCallLog[];

  // === UI 状态 ===
  isTaskRunning: boolean;
  showCheckpointDialog: boolean;
  showOutputViewer: boolean;
  selectedOutputFile: string | null;
  selectedTaskIdForOutputs: string | null; // 查看产出文件时对应的任务 ID
  permissionModeOverride: PermissionMode | null;
  error: string | null;                    // 全局错误信息（Toast 展示）

  // === Actions ===
  loadWorkflows: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTaskHistory: (projectId: number) => Promise<void>;
  startTask: (
    workflowId: string,
    input: Record<string, unknown>,
    permissionMode?: PermissionMode,
    projectId?: number,
  ) => Promise<void>;
  cancelTask: () => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  checkpointDecision: (decision: CheckpointDecision) => Promise<void>;
  setPermissionModeOverride: (mode: PermissionMode | null) => void;
  openOutputViewer: (taskId: string, fileName: string) => Promise<void>;
  closeOutputViewer: () => void;
  clearError: () => void;

  // === 事件监听 ===
  initAgentListeners: () => Promise<UnlistenFn>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // 初始状态
  availableWorkflows: [],
  availableAgents: [],
  currentTask: null,
  taskHistory: [],
  progress: null,
  streamingContent: '',
  streamingNodeId: null,
  checkpoint: null,
  toolCallLogs: [],
  isTaskRunning: false,
  showCheckpointDialog: false,
  showOutputViewer: false,
  selectedOutputFile: null,
  selectedTaskIdForOutputs: null,
  permissionModeOverride: null,
  error: null,

  loadWorkflows: async () => {
    try {
      const workflows = await tauri.agentListWorkflows();
      set({ availableWorkflows: workflows });
    } catch (e) {
      set({ error: `加载工作流失败: ${e}` });
    }
  },

  loadAgents: async () => {
    try {
      const agents = await tauri.agentListAgents();
      set({ availableAgents: agents });
    } catch (e) {
      set({ error: `加载 Agent 列表失败: ${e}` });
    }
  },

  loadTaskHistory: async (projectId: number) => {
    try {
      const history = await tauri.agentListTasks(projectId, 50);
      set({ taskHistory: history });
    } catch (e) {
      set({ error: `加载任务历史失败: ${e}` });
    }
  },

  startTask: async (workflowId, input, permissionMode, projectId) => {
    try {
      const override = get().permissionModeOverride;
      const mode = permissionMode || override;
      const task = await tauri.agentStartTask({
        workflowId,
        input,
        permissionMode: mode,
        projectId,
      });
      set({
        currentTask: task,
        isTaskRunning: true,
        progress: null,
        streamingContent: '',
        streamingNodeId: null,
        toolCallLogs: [],
        checkpoint: null,
        showCheckpointDialog: false,
        error: null,
      });
    } catch (e) {
      set({ error: `发起任务失败: ${e}` });
    }
  },

  cancelTask: async () => {
    const task = get().currentTask;
    if (!task) return;
    try {
      await tauri.agentCancelTask(task.task_id);
      // 不立即设置 isTaskRunning: false，等待 agent:done 事件确认
      // 防止 Pipeline 未真正停止时 UI 状态错乱
    } catch (e) {
      set({ error: `取消任务失败: ${e}` });
    }
  },

  resumeTask: async (taskId) => {
    try {
      await tauri.agentResumeTask(taskId);
      // resume_task 命令返回 ()，需单独查询任务详情
      const task = await tauri.agentGetTask(taskId);
      set({
        currentTask: task,
        isTaskRunning: true,
        progress: null,
        streamingContent: '',
        toolCallLogs: [],
        checkpoint: null,
      });
    } catch (e) {
      set({ error: `恢复任务失败: ${e}` });
    }
  },

  checkpointDecision: async (decision) => {
    const task = get().currentTask;
    if (!task) return;
    try {
      await tauri.agentCheckpointDecision({
        taskId: task.task_id,
        decision,
      });
      set({
        showCheckpointDialog: false,
        checkpoint: null,
        isTaskRunning: true,    // 恢复运行状态
      });
    } catch (e) {
      set({ error: `提交检查点决策失败: ${e}` });
    }
  },

  setPermissionModeOverride: (mode) => set({ permissionModeOverride: mode }),

  openOutputViewer: async (taskId, fileName) => {
    try {
      const content = await tauri.agentReadOutput(taskId, fileName);
      set({
        showOutputViewer: true,
        selectedOutputFile: fileName,
        selectedTaskIdForOutputs: taskId,
        // content 暂存到 streamingContent 复用，或单独字段
        // 这里建议加 outputViewerContent 字段，简化示例暂复用
      });
      // 实际实现：在组件内单独调用 agentReadOutput，避免 Store 承载大文本
    } catch (e) {
      set({ error: `读取产出文件失败: ${e}` });
    }
  },

  closeOutputViewer: () => set({
    showOutputViewer: false,
    selectedOutputFile: null,
    selectedTaskIdForOutputs: null,
  }),

  clearError: () => set({ error: null }),

  initAgentListeners: async () => {
    const unlistenChunk = await listen<AgentChunkEvent>('agent:chunk', (event) => {
      const { content, done, nodeId } = event.payload;
      if (done) {
        // 当前节点流式结束，保留内容供查看，清除 streamingNodeId
        set({ streamingNodeId: null });
      } else {
        set((state) => ({
          streamingContent: state.streamingNodeId === nodeId
            ? state.streamingContent + content
            : content,
          streamingNodeId: nodeId,
        }));
      }
    });

    const unlistenProgress = await listen<AgentProgressEvent>('agent:progress', (event) => {
      set({ progress: event.payload });
    });

    const unlistenCheckpoint = await listen<CheckpointEvent>('agent:checkpoint', (event) => {
      set({
        checkpoint: event.payload,
        showCheckpointDialog: true,
        // 注意：不设置 isTaskRunning: false，任务仍在运行（暂停态）
        // Pipeline 在等待决策，UI 上"取消"按钮仍可用
      });
    });

    const unlistenToolCall = await listen<ToolCallEvent>('agent:tool_call', (event) => {
      set((state) => ({
        toolCallLogs: [...state.toolCallLogs, {
          task_id: event.payload.taskId,
          node_id: event.payload.nodeId,
          agent_id: event.payload.agentId,
          tool_id: event.payload.toolId,
          parameters: event.payload.parameters,
          result_summary: event.payload.resultSummary,
          duration_ms: event.payload.durationMs,
          success: event.payload.success,
          cache_hit: event.payload.cacheHit,
          created_at: new Date().toISOString(),
        }],
      }));
    });

    const unlistenDone = await listen<AgentDoneEvent>('agent:done', (event) => {
      const { status, totalTokens } = event.payload;
      set({
        isTaskRunning: false,
        streamingContent: '',
        streamingNodeId: null,
        // 保留 currentTask 供用户查看最终结果，直到发起下一个任务
      });
      // 更新 currentTask 的状态字段
      const currentTask = get().currentTask;
      if (currentTask && currentTask.task_id === event.payload.taskId) {
        set({
          currentTask: {
            ...currentTask,
            status,
            total_tokens: totalTokens,
            completed_at: new Date().toISOString(),
            error_log: event.payload.errorLog,
          },
        });
      }
      // 刷新任务历史
      if (currentTask) {
        get().loadTaskHistory(currentTask.project_id);
      }
    });

    return () => {
      unlistenChunk();
      unlistenProgress();
      unlistenCheckpoint();
      unlistenToolCall();
      unlistenDone();
    };
  },
}));
```

**Store 设计要点**：

1. **streamingNodeId 跟踪**：多个节点顺序执行时，通过 `streamingNodeId` 区分当前流式输出属于哪个节点。新节点开始时重置 `streamingContent`，避免内容串台
2. **isTaskRunning 状态机**：仅在 `agent:done` 事件中重置为 false，`cancelTask` 不立即重置，避免 Pipeline 实际仍在运行时 UI 错误地进入"非运行"状态
3. **检查点不暂停 UI**：`showCheckpointDialog: true` 但 `isTaskRunning` 保持 true，因为 Pipeline 仍在执行（只是阻塞等待决策），用户仍可取消
4. **错误处理统一**：所有 action 的 catch 块将错误写入 `error` 字段，由顶层组件渲染 Toast。避免每个组件单独处理
5. **任务历史刷新时机**：仅在 `agent:done` 事件后刷新，避免频繁查询数据库
6. **StrictMode 兼容**：`initAgentListeners` 返回组合清理函数，在 `useEffect` 的 cleanup 中调用。React StrictMode 下会触发双调用，但 cleanup 会正确移除监听器，不会出现重复监听（这是项目 memory 中记录的硬约束）

### 5.3 components/agent/* - 组件设计

新增 [components/agent/](file:///c:/Users/admin/Desktop/Whisper/src/components/agent/) 目录，包含 6 个组件：

| 组件 | 职责 | 复杂度 |
|---|---|---|
| `AgentWorkspace.tsx` | 主工作区容器，左右分栏布局 | 低 |
| `AgentTaskPanel.tsx` | 工作流选择 + 动态输入表单 + 权限模式 + 发起 | 中 |
| `PipelineVisualizer.tsx` | DAG 节点列表 + 流式输出 + 工具日志 | 高 |
| `CheckpointDialog.tsx` | 检查点产出展示 + 编辑 + 决策按钮 | 中 |
| `AgentOutputViewer.tsx` | 中间产出文件查看器（.md / .json） | 低 |
| `TaskHistoryList.tsx` | 任务历史列表 + 恢复/重试 | 低 |

#### 5.3.1 AgentWorkspace - 主工作区容器

```tsx
// src/components/agent/AgentWorkspace.tsx
import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { AgentTaskPanel } from './AgentTaskPanel';
import { PipelineVisualizer } from './PipelineVisualizer';
import { CheckpointDialog } from './CheckpointDialog';
import { AgentOutputViewer } from './AgentOutputViewer';
import { TaskHistoryList } from './TaskHistoryList';
import { Button } from '@/components/common/Button';
import { toast } from '@/components/common/Toast';

export const AgentWorkspace: React.FC = () => {
  const {
    isTaskRunning,
    currentTask,
    error,
    clearError,
    initAgentListeners,
    loadWorkflows,
    loadAgents,
  } = useAgentStore();

  // 挂载时初始化：加载工作流/Agent 列表 + 注册事件监听
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    loadWorkflows();
    loadAgents();
    initAgentListeners().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, []);

  // 错误 Toast
  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  return (
    <div className="flex h-full">
      {/* 左侧：任务发起或任务历史 */}
      <div className="w-80 border-r border-gray-200 overflow-y-auto">
        {isTaskRunning ? <TaskHistoryList /> : <AgentTaskPanel />}
      </div>

      {/* 右侧：执行可视化或空状态 */}
      <div className="flex-1 overflow-hidden">
        {isTaskRunning || currentTask ? (
          <PipelineVisualizer />
        ) : (
          <AgentEmptyState />
        )}
      </div>

      {/* 全局弹窗 */}
      <CheckpointDialog />
      <AgentOutputViewer />
    </div>
  );
};

const AgentEmptyState: React.FC = () => (
  <div className="flex items-center justify-center h-full text-gray-400">
    <div className="text-center">
      <BotIcon className="w-16 h-16 mx-auto mb-4" />
      <p>选择左侧的工作流开始 Agent 任务</p>
    </div>
  </div>
);
```

#### 5.3.2 AgentTaskPanel - 任务发起面板

```tsx
// src/components/agent/AgentTaskPanel.tsx
import { useState, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { Button } from '@/components/common/Button';
import { PermissionMode, WorkflowInfo } from '@/types';

export const AgentTaskPanel: React.FC = () => {
  const { availableWorkflows, startTask, isTaskRunning } = useAgentStore();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('hands_off');

  const currentWorkflow = useMemo(
    () => availableWorkflows.find(w => w.workflow_id === selectedWorkflowId),
    [availableWorkflows, selectedWorkflowId],
  );

  const handleStart = async () => {
    if (!currentWorkflow) return;
    await startTask(selectedWorkflowId, inputValues, permissionMode);
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* 工作流选择（卡片网格） */}
      <section>
        <h3 className="text-sm font-medium mb-2">选择工作流</h3>
        <div className="grid grid-cols-1 gap-2">
          {availableWorkflows.map(w => (
            <WorkflowCard
              key={w.workflow_id}
              workflow={w}
              selected={selectedWorkflowId === w.workflow_id}
              onClick={() => {
                setSelectedWorkflowId(w.workflow_id);
                setPermissionMode(w.default_permission_mode);
                setInputValues({});
              }}
            />
          ))}
        </div>
      </section>

      {/* 动态输入表单 */}
      {currentWorkflow?.input_schema && (
        <DynamicInputForm
          schema={currentWorkflow.input_schema}
          values={inputValues}
          onChange={setInputValues}
        />
      )}

      {/* 权限模式选择 */}
      <PermissionModeSelector
        value={permissionMode}
        onChange={setPermissionMode}
        recommended={currentWorkflow?.default_permission_mode}
      />

      {/* 发起按钮 */}
      <Button
        disabled={!selectedWorkflowId || isTaskRunning}
        onClick={handleStart}
        className="w-full"
      >
        开始任务
      </Button>
    </div>
  );
};

/** 工作流卡片 */
const WorkflowCard: React.FC<{
  workflow: WorkflowInfo;
  selected: boolean;
  onClick: () => void;
}> = ({ workflow, selected, onClick }) => (
  <button
    onClick={onClick}
    className={`p-3 text-left border rounded-lg transition-colors ${
      selected
        ? 'border-blue-500 bg-blue-50'
        : 'border-gray-200 hover:border-gray-300'
    }`}
  >
    <div className="font-medium text-sm">{workflow.name}</div>
    <div className="text-xs text-gray-500 mt-1">{workflow.description}</div>
    <div className="flex gap-2 mt-2 text-xs text-gray-400">
      <span>{workflow.node_count} 节点</span>
      <span>~{workflow.estimated_token_cost} tokens</span>
      {workflow.checkpoint_count > 0 && (
        <span className="text-amber-500">{workflow.checkpoint_count} 检查点</span>
      )}
    </div>
  </button>
);

/** 动态输入表单：根据 JSON Schema 生成表单字段 */
const DynamicInputForm: React.FC<{
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}> = ({ schema, values, onChange }) => {
  const properties = (schema.properties || {}) as Record<string, { type: string; description?: string; enum?: string[] }>;
  const required = (schema.required || []) as string[];

  const handleChange = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">输入参数</h3>
      {Object.entries(properties).map(([key, prop]) => (
        <div key={key} className="space-y-1">
          <label className="text-xs text-gray-600">
            {key}
            {required.includes(key) && <span className="text-red-500"> *</span>}
          </label>
          {prop.enum ? (
            <select
              value={(values[key] as string) || ''}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded"
            >
              <option value="">请选择</option>
              {prop.enum.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : prop.type === 'array' || prop.type === 'object' ? (
            <textarea
              value={typeof values[key] === 'string' ? values[key] as string : JSON.stringify(values[key] || '', null, 2)}
              onChange={(e) => {
                try {
                  handleChange(key, JSON.parse(e.target.value));
                } catch {
                  handleChange(key, e.target.value);  // 保留原始字符串，提交时校验
                }
              }}
              placeholder={`JSON 格式的 ${prop.type}`}
              className="w-full px-2 py-1 text-sm border rounded font-mono"
              rows={3}
            />
          ) : (
            <input
              type={prop.type === 'number' ? 'number' : 'text'}
              value={(values[key] as string) || ''}
              onChange={(e) => handleChange(key, prop.type === 'number' ? Number(e.target.value) : e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded"
            />
          )}
          {prop.description && (
            <p className="text-xs text-gray-400">{prop.description}</p>
          )}
        </div>
      ))}
    </section>
  );
};

/** 权限模式选择器 */
const PermissionModeSelector: React.FC<{
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  recommended?: PermissionMode;
}> = ({ value, onChange, recommended }) => {
  const modes: { value: PermissionMode; label: string; description: string }[] = [
    { value: 'hands_off', label: '不干预', description: '最快，全程无中断' },
    { value: 'supervised', label: '检查点干预', description: '检查点暂停等待确认' },
    { value: 'autopilot', label: '高权限全自动', description: '无中断，危险操作自动执行' },
  ];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">权限模式</h3>
      <div className="space-y-1">
        {modes.map(m => (
          <label
            key={m.value}
            className={`flex items-start gap-2 p-2 border rounded cursor-pointer ${
              value === m.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <input
              type="radio"
              checked={value === m.value}
              onChange={() => onChange(m.value)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm flex items-center gap-2">
                {m.label}
                {recommended === m.value && (
                  <span className="text-xs text-blue-500">推荐</span>
                )}
              </div>
              <div className="text-xs text-gray-500">{m.description}</div>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
};
```

#### 5.3.3 PipelineVisualizer - 执行可视化

```tsx
// src/components/agent/PipelineVisualizer.tsx
import { useAgentStore } from '@/stores/agentStore';
import { Button } from '@/components/common/Button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NodeProgress } from '@/types';

export const PipelineVisualizer: React.FC = () => {
  const {
    currentTask,
    progress,
    streamingContent,
    streamingNodeId,
    toolCallLogs,
    cancelTask,
  } = useAgentStore();

  if (!currentTask) return null;

  return (
    <div className="flex flex-col h-full">
      {/* 头部：任务信息 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{currentTask.workflow_id}</span>
          <StatusBadge status={currentTask.status} />
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {progress && (
            <>
              <TokenCounter
                used={progress.totalTokens}
                estimated={progress.estimatedTokens}
              />
              <span>缓存命中 {progress.cacheHitCount}/{progress.cacheHitCount + progress.cacheMissCount}</span>
            </>
          )}
          <Button variant="danger" size="sm" onClick={cancelTask}>
            取消任务
          </Button>
        </div>
      </div>

      {/* 节点列表（纵向流程） */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {progress?.nodes.map(node => (
          <NodeCard
            key={node.node_id}
            node={node}
            isCurrent={node.node_id === progress.current_node_id}
            streamingContent={node.node_id === streamingNodeId ? streamingContent : ''}
          />
        ))}
        {!progress && (
          <div className="text-center text-gray-400 py-8">等待 Pipeline 启动...</div>
        )}
      </div>

      {/* 工具调用日志 */}
      {toolCallLogs.length > 0 && (
        <div className="border-t border-gray-200 max-h-48 overflow-y-auto">
          <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50">
            工具调用日志（{toolCallLogs.length}）
          </div>
          <div className="divide-y divide-gray-100">
            {toolCallLogs.map((log, idx) => (
              <ToolCallLogItem key={idx} log={log} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** 节点卡片 */
const NodeCard: React.FC<{
  node: NodeProgress;
  isCurrent: boolean;
  streamingContent: string;
}> = ({ node, isCurrent, streamingContent }) => {
  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-500',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-gray-100 text-gray-400',
  };

  return (
    <div className={`border rounded-lg p-3 ${
      isCurrent ? 'border-blue-500 shadow-sm' : 'border-gray-200'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded ${statusColors[node.status]}`}>
            {node.status}
          </span>
          <span className="text-sm font-medium">{node.agent_name}</span>
          {node.is_checkpoint && (
            <span className="text-xs text-amber-500">检查点</span>
          )}
        </div>
        {node.token_usage && (
          <span className="text-xs text-gray-400">{node.token_usage} tokens</span>
        )}
      </div>

      {/* 流式输出（仅当前节点） */}
      {isCurrent && streamingContent && (
        <div className="mt-2 prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {streamingContent}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

/** 状态徽章 */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-700 animate-pulse',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
    aborted: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
};

/** Token 计数器 */
const TokenCounter: React.FC<{ used: number; estimated: number }> = ({ used, estimated }) => {
  const percent = estimated > 0 ? Math.min(100, (used / estimated) * 100) : 0;
  const isOverBudget = used > estimated && estimated > 0;
  return (
    <span className={isOverBudget ? 'text-red-500' : ''}>
      {used.toLocaleString()} / {estimated.toLocaleString()} tokens
    </span>
  );
};

/** 工具调用日志项 */
const ToolCallLogItem: React.FC<{ log: import('@/types').ToolCallLog }> = ({ log }) => (
  <div className="px-4 py-2 text-xs">
    <div className="flex items-center gap-2">
      <span className={log.success ? 'text-green-500' : 'text-red-500'}>
        {log.success ? '✓' : '✗'}
      </span>
      <span className="font-mono">{log.tool_id}</span>
      {log.cache_hit && <span className="text-blue-500">缓存</span>}
      <span className="text-gray-400">{log.duration_ms}ms</span>
    </div>
    <div className="text-gray-500 mt-1 truncate">{log.result_summary}</div>
  </div>
);
```

#### 5.3.4 CheckpointDialog - 检查点交互

```tsx
// src/components/agent/CheckpointDialog.tsx
import { useState, useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckpointDecision } from '@/types';

export const CheckpointDialog: React.FC = () => {
  const { checkpoint, showCheckpointDialog, checkpointDecision } = useAgentStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  // 检查点切换时重置编辑状态
  useEffect(() => {
    setIsEditing(false);
    setEditedContent('');
  }, [checkpoint?.nodeId]);

  if (!showCheckpointDialog || !checkpoint) return null;

  const handleContinue = () => {
    const decision: CheckpointDecision = isEditing
      ? { action: 'continue', modified_input: { edited_output: editedContent } }
      : { action: 'continue' };
    checkpointDecision(decision);
  };

  const handleEdit = () => {
    if (!isEditing) {
      setEditedContent(checkpoint.outputContent);
    }
    setIsEditing(!isEditing);
  };

  return (
    <Dialog
      open={showCheckpointDialog}
      onClose={() => { /* 不允许关闭，必须做出决策 */ }}
      title={`检查点确认 - ${checkpoint.agentName}`}
      width="max-w-3xl"
    >
      <div className="space-y-4">
        {/* 提示信息 */}
        <p className="text-sm text-gray-600">{checkpoint.message}</p>

        {/* Agent 产出展示 / 编辑 */}
        <div className="border rounded-lg max-h-96 overflow-y-auto">
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full h-80 p-3 text-sm font-mono resize-none focus:outline-none"
            />
          ) : (
            <div className="p-3 prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {checkpoint.outputContent}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* 决策按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button onClick={handleContinue} variant="primary">
              {isEditing ? '保存并继续' : '继续'}
            </Button>
            <Button onClick={handleEdit} variant="ghost">
              {isEditing ? '取消编辑' : '修改产出'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => checkpointDecision({ action: 'skip' })} variant="ghost">
              跳过此节点
            </Button>
            <Button onClick={() => checkpointDecision({ action: 'retry' })} variant="ghost">
              重试
            </Button>
            <Button onClick={() => checkpointDecision({ action: 'abort' })} variant="danger">
              中止任务
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
```

#### 5.3.5 AgentOutputViewer - 中间产出查看器

```tsx
// src/components/agent/AgentOutputViewer.tsx
import { useState, useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { agentReadOutput, agentListOutputs } from '@/utils/tauri';
import { Dialog } from '@/components/common/Dialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const AgentOutputViewer: React.FC = () => {
  const {
    showOutputViewer,
    selectedOutputFile,
    selectedTaskIdForOutputs,
    closeOutputViewer,
  } = useAgentStore();

  const [content, setContent] = useState('');
  const [fileList, setFileList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载文件列表
  useEffect(() => {
    if (showOutputViewer && selectedTaskIdForOutputs) {
      agentListOutputs(selectedTaskIdForOutputs)
        .then(setFileList)
        .catch(() => setFileList([]));
    }
  }, [showOutputViewer, selectedTaskIdForOutputs]);

  // 加载选中文件内容
  useEffect(() => {
    if (showOutputViewer && selectedTaskIdForOutputs && selectedOutputFile) {
      setLoading(true);
      agentReadOutput(selectedTaskIdForOutputs, selectedOutputFile)
        .then(setContent)
        .catch((e) => setContent(`加载失败: ${e}`))
        .finally(() => setLoading(false));
    }
  }, [showOutputViewer, selectedTaskIdForOutputs, selectedOutputFile]);

  if (!showOutputViewer) return null;

  const isMarkdown = selectedOutputFile?.endsWith('.md');
  const isJson = selectedOutputFile?.endsWith('.json');

  return (
    <Dialog
      open={showOutputViewer}
      onClose={closeOutputViewer}
      title={`产出查看 - ${selectedOutputFile || ''}`}
      width="max-w-4xl"
    >
      <div className="flex h-[600px]">
        {/* 左侧文件列表 */}
        <div className="w-48 border-r overflow-y-auto">
          {fileList.map(name => (
            <button
              key={name}
              onClick={() => useAgentStore.getState().openOutputViewer(
                selectedTaskIdForOutputs!, name
              )}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                selectedOutputFile === name ? 'bg-blue-50 text-blue-600' : ''
              }`}
            >
              {name}
            </button>
          ))}
          {fileList.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">无产出文件</div>
          )}
        </div>

        {/* 右侧内容展示 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400">加载中...</div>
          ) : isMarkdown ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : isJson ? (
            <pre className="text-xs font-mono bg-gray-50 p-3 rounded overflow-x-auto">
              {(() => {
                try { return JSON.stringify(JSON.parse(content), null, 2); }
                catch { return content; }
              })()}
            </pre>
          ) : (
            <pre className="text-xs font-mono">{content}</pre>
          )}
        </div>
      </div>
    </Dialog>
  );
};
```

#### 5.3.6 TaskHistoryList - 任务历史列表

```tsx
// src/components/agent/TaskHistoryList.tsx
import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useProjectStore } from '@/stores/projectStore';
import { AgentTask } from '@/types';

export const TaskHistoryList: React.FC = () => {
  const { taskHistory, loadTaskHistory, resumeTask, currentTask } = useAgentStore();
  const { currentProject } = useProjectStore();

  useEffect(() => {
    if (currentProject) {
      loadTaskHistory(Number(currentProject.id));
    }
  }, [currentProject?.id]);

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-sm font-medium">任务历史</h3>
      {taskHistory.map(task => (
        <TaskHistoryItem
          key={task.task_id}
          task={task}
          isActive={currentTask?.task_id === task.task_id}
          onResume={() => resumeTask(task.task_id)}
        />
      ))}
      {taskHistory.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-4">暂无任务历史</div>
      )}
    </div>
  );
};

const TaskHistoryItem: React.FC<{
  task: AgentTask;
  isActive: boolean;
  onResume: () => void;
}> = ({ task, isActive, onResume }) => {
  const canResume = task.status === 'paused' || task.status === 'failed';
  return (
    <div className={`p-2 border rounded text-sm ${
      isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
    }`}>
      <div className="flex items-center justify-between">
        <span className="font-medium truncate">{task.workflow_id}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          task.status === 'completed' ? 'bg-green-100 text-green-700' :
          task.status === 'failed' ? 'bg-red-100 text-red-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {task.status}
        </span>
      </div>
      <div className="text-xs text-gray-400 mt-1">
        {new Date(task.created_at).toLocaleString()}
      </div>
      <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
        <span>{task.total_tokens.toLocaleString()} tokens</span>
        {canResume && (
          <button
            onClick={onResume}
            className="text-blue-500 hover:underline"
          >
            恢复
          </button>
        )}
      </div>
    </div>
  );
};
```

#### 5.3.7 MainLayout 与 TopBar 改造

在 [MainLayout.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/MainLayout.tsx) 的中间区域增加 `agent` 阶段分支，在 [TopBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/TopBar.tsx) 增加阶段切换标签。

```tsx
// src/components/layout/MainLayout.tsx 改造片段
import { AgentWorkspace } from '@/components/agent/AgentWorkspace';

// 在 main 区域的渲染逻辑增加分支
<main className="flex-1 overflow-hidden flex flex-col min-w-0">
  {phase === 'agent' ? (
    <AgentWorkspace />
  ) : phase === 'writing' || phase === 'editing' ? (
    <WritingEditor />
  ) : (
    <ChatView />
  )}
</main>
```

```tsx
// src/components/layout/TopBar.tsx 改造片段
// 阶段切换标签增加 agent

const phases = [
  { value: 'ideation', label: '构思', icon: LightBulbIcon },
  { value: 'planning', label: '规划', icon: ListIcon },
  { value: 'writing', label: '写作', icon: PencilIcon },
  { value: 'editing', label: '润色', icon: SparklesIcon },
  { value: 'agent', label: 'Agent', icon: BotIcon },   // 新增
];
```

#### 5.3.8 SettingsPanel 改造 - Agent 设置分组

在 [SettingsPanel.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/settings/SettingsPanel.tsx) 末尾追加"Agent 系统"分组，复用现有的 SettingItem / Select / Input 组件。

```tsx
// src/components/settings/SettingsPanel.tsx 追加片段
import { agentLoadSettings, agentSaveSettings } from '@/utils/tauri';
import { AgentSetting } from '@/types';

// 在组件内增加 state
const [agentSettings, setAgentSettings] = useState<Record<string, string>>({});
const [savingAgent, setSavingAgent] = useState(false);

useEffect(() => {
  agentLoadSettings().then((settings: AgentSetting[]) => {
    const map: Record<string, string> = {};
    settings.forEach(s => { map[s.key] = s.value; });
    setAgentSettings(map);
  });
}, []);

const handleSaveAgentSettings = async () => {
  setSavingAgent(true);
  try {
    const settingsArray = Object.entries(agentSettings).map(([key, value]) => ({
      key, value, updated_at: new Date().toISOString(),
    }));
    await agentSaveSettings(settingsArray);
    toast.success('Agent 设置已保存');
  } catch (e) {
    toast.error(`保存失败: ${e}`);
  } finally {
    setSavingAgent(false);
  }
};

// JSX 追加
<div className="space-y-3">
  <h3 className="text-sm font-medium">Agent 系统</h3>

  <SettingItem label="默认权限模式">
    <select
      value={agentSettings.default_permission_mode || 'hands_off'}
      onChange={(e) => setAgentSettings({
        ...agentSettings,
        default_permission_mode: e.target.value,
      })}
      className="px-2 py-1 border rounded text-sm"
    >
      <option value="hands_off">不干预（最快）</option>
      <option value="supervised">检查点干预（平衡）</option>
      <option value="autopilot">高权限全自动（无中断）</option>
    </select>
  </SettingItem>

  <SettingItem label="单任务 token 上限">
    <input
      type="number"
      value={agentSettings.max_total_tokens || '100000'}
      onChange={(e) => setAgentSettings({
        ...agentSettings,
        max_total_tokens: e.target.value,
      })}
      className="px-2 py-1 border rounded text-sm w-32"
    />
  </SettingItem>

  <Button onClick={handleSaveAgentSettings} disabled={savingAgent}>
    {savingAgent ? '保存中...' : '保存 Agent 设置'}
  </Button>
</div>
```

### 5.4 utils/tauri.ts - 命令封装

在 [utils/tauri.ts](file:///c:/Users/admin/Desktop/Whisper/src/utils/tauri.ts) 末尾追加 Agent 命令封装。所有封装遵循现有命名风格（camelCase 函数名 + snake_case invoke 参数），复杂参数用 JSON 字符串传输。

```typescript
// src/utils/tauri.ts 末尾追加

// ===== Agent 相关命令 =====

import type {
  AgentTask, AgentDefinition, WorkflowInfo, ToolDefinition,
  PermissionMode, CheckpointDecision, AgentSetting,
} from '@/types';

/** 列出可用工作流 */
export const agentListWorkflows = () =>
  tauriInvoke<WorkflowInfo[]>('agent_list_workflows');

/** 列出可用 Agent（可按分类过滤） */
export const agentListAgents = (category?: string) =>
  tauriInvoke<AgentDefinition[]>('agent_list_agents', { category: category ?? null });

/** 列出可用工具（调试用） */
export const agentListTools = () =>
  tauriInvoke<ToolDefinition[]>('agent_list_tools');

/** 发起任务 */
export const agentStartTask = (params: {
  workflowId: string;
  input: Record<string, unknown>;
  permissionMode?: PermissionMode;
  projectId?: number;
}) => tauriInvoke<AgentTask>('agent_start_task', {
  workflowId: params.workflowId,
  inputJson: JSON.stringify(params.input),
  permissionMode: params.permissionMode ?? null,
  projectId: params.projectId ?? null,
});

/** 取消任务 */
export const agentCancelTask = (taskId: string) =>
  tauriInvoke<void>('agent_cancel_task', { taskId });

/** 查询任务历史 */
export const agentListTasks = (projectId: number, limit?: number) =>
  tauriInvoke<AgentTask[]>('agent_list_tasks', {
    projectId,
    limit: limit ?? 50,
  });

/** 查询单个任务 */
export const agentGetTask = (taskId: string) =>
  tauriInvoke<AgentTask>('agent_get_task', { taskId });

/** 恢复任务（断点续传） */
export const agentResumeTask = (taskId: string) =>
  tauriInvoke<void>('agent_resume_task', { taskId });

/** 检查点决策 */
export const agentCheckpointDecision = (params: {
  taskId: string;
  decision: CheckpointDecision;
}) => tauriInvoke<void>('agent_checkpoint_decision', {
  taskId: params.taskId,
  decisionJson: JSON.stringify(params.decision),
});

/** 列出任务的中间产出文件 */
export const agentListOutputs = (taskId: string) =>
  tauriInvoke<string[]>('agent_list_outputs', { taskId });

/** 读取中间产出文件内容 */
export const agentReadOutput = (taskId: string, fileName: string) =>
  tauriInvoke<string>('agent_read_output', { taskId, fileName });

/** 加载 Agent 设置 */
export const agentLoadSettings = () =>
  tauriInvoke<AgentSetting[]>('agent_load_settings');

/** 保存 Agent 设置 */
export const agentSaveSettings = (settings: AgentSetting[]) =>
  tauriInvoke<void>('agent_save_settings', {
    settingsJson: JSON.stringify(settings),
  });
```

**封装设计要点**：

1. **JSON 字符串传输**：`input` / `decision` / `settings` 等复杂对象用 `JSON.stringify` 转为字符串，避免 Tauri 2.0 的嵌套 struct 反序列化问题（项目 memory 硬约束）
2. **Optional 参数显式 null**：`category` / `permissionMode` / `projectId` 等可选参数在未传时显式传 `null`，避免 Tauri 误判为"参数缺失"
3. **类型导入分离**：`import type` 仅导入类型，不引入运行时依赖，与现有 `tauriInvoke` 调用风格一致
4. **命名风格统一**：函数名 camelCase（`agentListWorkflows`），invoke 命令名 snake_case（`agent_list_workflows`），invoke 参数 camelCase（Tauri 2.0 自动转换为后端的 snake_case）

---

## 6. P0工作流详细定义

本章对 P0 阶段的两个工作流进行端到端规格化定义，包括：用户输入契约、各节点的输入/输出 schema、数据流转示例、检查点交互细节、错误处理策略。Rust 静态声明见 [2.2.5 P0 工作流定义](#225-p0-工作流定义)。

### 6.1 灵感矩阵生成工作流

**workflow_id**: `inspiration_matrix`
**目标用户**：网文作者在创作初期，仅有模糊关键词（如"末世 + 学园 + 异能"），希望快速获得多条可落地的故事种子与短文样本。
**设计哲学**：维度分析（拆解关键词的多重语义）→ 灵感发散（每维度展开多个候选）→ 跨维度组合（笛卡尔积 + LLM 筛选）→ 用户选择 → 矩阵成文（多风格并行写作）。

#### 6.1.1 用户输入契约（input_schema）

```json
{
  "type": "object",
  "properties": {
    "keywords": {
      "type": "array",
      "items": { "type": "string" },
      "description": "1-8 个关键词，如 [\"末世\", \"学园\", \"异能\"]",
      "minItems": 1,
      "maxItems": 8
    },
    "project_id": {
      "type": "integer",
      "description": "项目 ID（用于读取记忆库）"
    },
    "style_variants": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "风格名，如 \"冷峻写实\"" },
          "features": { "type": "string", "description": "风格特征描述" }
        },
        "required": ["name", "features"]
      },
      "description": "可选，多种文风变体。若不提供则用默认 3 种（冷峻/热血/诙谐）",
      "default": []
    },
    "selected_seeds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "检查点后由用户填充。首次发起任务时不传",
      "default": []
    }
  },
  "required": ["keywords", "project_id"]
}
```

**parse_input 规则**：

1. `keywords` 长度超出 8 时截断为前 8 个，记 warning
2. `style_variants` 为空时填充默认值：
   ```json
   [
     {"name": "冷峻写实", "features": "克制、白描、冷色调、心理留白"},
     {"name": "热血燃向", "features": "短句、强节奏、动作密集、情绪外放"},
     {"name": "诙谐轻松", "features": "口语化、反转、自嘲、网感"}
   ]
   ```
3. `selected_seeds` 在首次发起时强制为空数组（由检查点后填充）

#### 6.1.2 节点数据流转

**节点 n1 - keyword_analyst（关键词分析师）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.keywords | `$user_input.keywords` | 用户原始关键词 |
| input.project_id | `$user_input.project_id` | 项目 ID |
| output.dimensions | 节点产出 | 每个关键词的多维度语义展开 |

**output.dimensions 示例**：

```json
{
  "dimensions": [
    {
      "keyword": "末世",
      "facets": [
        {"name": "时间设定", "values": ["近未来10年", "远未来100年", "末日后3天"]},
        {"name": "灾难类型", "values": ["病毒", "核战", "气候", "外星入侵"]},
        {"name": "社会形态", "values": ["残存政权", "废土部落", "避难所共同体"]}
      ]
    },
    {
      "keyword": "学园",
      "facets": [
        {"name": "学园性质", "values": ["普通高中", "军事学院", "异能培训所"]},
        {"name": "权力结构", "values": ["学生会独裁", "导师制", "派系斗争"]}
      ]
    }
  ]
}
```

**节点 n2 - memory_keeper（记忆库管家，并行组 after_n1）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.operation | 固定值 `"query"` | 工具型 Agent，不调用 LLM |
| input.query | 固定值 `"characters,timeline,locations"` | 查询记忆库 3 个分区 |
| output.memory_snapshot | 节点产出 | 项目已有的人物/时间线/地点摘要 |

**output.memory_snapshot 示例**：

```json
{
  "memory_snapshot": {
    "characters": [
      {"name": "林晚", "role": "主角", "traits": "冷漠理性、异能觉醒者"}
    ],
    "timeline": [
      {"event": "黑潮爆发", "chapter": 1}
    ],
    "locations": [
      {"name": "第七学区", "description": "废弃学园避难所"}
    ]
  }
}
```

> 若项目为新项目，记忆库为空，`memory_snapshot` 返回空对象。Pipeline 引擎在 n3 中容忍空记忆。

**节点 n3 - idea_diverger（灵感发散师，并行组 after_n1）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.dimensions | `$node.n1.output.dimensions` | 关键词维度展开 |
| input.memory | `$node.n2.output.memory_snapshot` | 记忆库快照 |
| output.divergence | 节点产出 | 每维度 3-5 个发散候选，结合记忆去重 |

**output.divergence 示例**：

```json
{
  "divergence": [
    {
      "dimension": "末世.灾难类型",
      "ideas": [
        {"id": "i1", "content": "异能病毒：感染者获得随机异能但寿命缩短", "novelty": 0.8},
        {"id": "i2", "content": "气候异变：四季紊乱，每季持续天数随机", "novelty": 0.6},
        {"id": "i3", "content": "外星入侵：敌人以能量体形态存在，物理攻击无效", "novelty": 0.9}
      ]
    }
  ]
}
```

> `novelty` 字段由 LLM 自评（0-1），用于 n4 组合时的权重参考。

**节点 n4 - inspiration_combiner（灵感组合师，检查点）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.divergence | `$node.n3.output.divergence` | 发散候选 |
| output.seeds | 节点产出 | 跨维度组合的故事种子（5-10 条） |

**output.seeds 示例**：

```json
{
  "seeds": [
    {
      "seed_id": "s1",
      "title": "黑潮学园",
      "combination": ["末世.病毒", "学园.军事学院", "异能.觉醒"],
      "synopsis": "异能病毒席卷全球，感染者被强制收入军事学园。主角林晚觉醒时间回溯能力，却发现每次回溯都在消耗同学的寿命...",
      "estimated_potential": 0.85,
      "tags": ["末世", "学园", "异能", "悲剧"]
    },
    {
      "seed_id": "s2",
      "title": "废土学园共同体",
      "combination": ["末世.气候", "学园.避难所", "异能.无"],
      "synopsis": "气候紊乱后，一座废弃学园成为幸存者共同体。没有超能力，只有人性的试炼...",
      "estimated_potential": 0.7,
      "tags": ["末世", "学园", "写实", "群像"]
    }
  ]
}
```

**检查点交互**：

到达 n4 完成后，Pipeline 暂停（仅 `supervised` 模式；`hands_off`/`autopilot` 默认选 `estimated_potential ≥ 0.7` 的种子）。

前端弹窗展示 `seeds` 列表，用户勾选进入 n5 的种子 ID，写入 `user_input.selected_seeds`：

```json
{
  "selected_seeds": ["s1", "s2"]
}
```

决策类型为 `CheckpointDecision::Continue { modified_input: { "selected_seeds": ["s1", "s2"] } }`。

**节点 n5 - inspiration_matrix_writer（矩阵成文师）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.selected_seeds | `$user_input.selected_seeds` | 检查点后用户选择 |
| input.style_variants | `$user_input.style_variants` | 文风变体 |
| output.drafts | 节点产出 | 每个种子 × 每种文风的短文样本 |

**output.drafts 示例**：

```json
{
  "drafts": [
    {
      "seed_id": "s1",
      "style": "冷峻写实",
      "title": "黑潮学园·冷峻版",
      "content": "第三十七次回溯。林晚看着课桌上刻痕，知道这是她最后的机会...",
      "word_count": 850
    },
    {
      "seed_id": "s1",
      "style": "热血燃向",
      "title": "黑潮学园·热血版",
      "content": "\"都给我停下！\"林晚一拳砸碎了讲台，时间在冲击波中凝滞...",
      "word_count": 920
    }
  ]
}
```

**产出文件**：

Pipeline 完成后，n5 的产出写入：

- `{output_dir}/n5_drafts.md`：人类可读的 Markdown 版本，含所有种子的所有文风短文
- `{output_dir}/n5_drafts.json`：结构化 JSON，供前端查看器渲染

#### 6.1.3 数据流转全图

```
用户输入                  n1                  n2 (并行)            n3                  n4 [检查点]          n5
┌──────────────┐         ┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│ keywords     │───→ n1 →│ keyword  │───┐    │ memory  │───┐    │ idea    │───→ n3 →│ inspir  │──[暂停]→│ matrix   │
│ project_id   │         │ analyst  │   │    │ keeper  │   │    │ diver   │        │ combiner │        │ writer   │
│ style_variants│        └──────────┘   │    └──────────┘   │    │         │        └──────────┘        └──────────┘
│ selected_seeds│        output:       │    output:         │    output:  │        output:              output:
└──────────────┘        dimensions     └──→ after_n1 ───────┴──→ divergence │        seeds                drafts
                                                          (并行组合)        │
                                                                          ↓
                                                              [用户勾选 selected_seeds]
```

#### 6.1.4 错误处理策略

| 节点 | 失败场景 | 处理策略 |
|---|---|---|
| n1 | 关键词无法解析（如全为标点） | 重试 3 次，仍失败则任务终止，error_log 记录"关键词分析失败" |
| n2 | 记忆库查询失败（数据库错误） | 重试 2 次，仍失败则用空记忆继续（降级，不阻塞流程） |
| n3 | LLM 输出无法解析为结构化 JSON | 重试 3 次，每次提示 LLM 修正格式；仍失败则用文本截断作为非结构化产出 |
| n4 | LLM 生成的种子数量 < 1 | 重试 3 次，仍失败则任务终止 |
| n4 | 检查点超时（30 分钟无决策） | 任务标记为 `paused`，等待用户手动恢复或取消 |
| n5 | LLM 输出短文字数 < 100 | 重试 2 次，仍失败则保留最短可用版本并标记 `incomplete: true` |

**超时与重试**：每个节点的 `retry_limit` 和 `timeout_sec` 见 [2.2.5.1](#2251-灵感矩阵生成工作流inspiration_matrix) 的静态声明。超时触发重试，重试耗尽后任务进入 `failed` 状态。

#### 6.1.5 token 预估

| 节点 | 输入 token | 输出 token | 备注 |
|---|---|---|---|
| n1 | ~500 | ~1500 | 关键词 + 系统提示词 |
| n2 | 0 | ~800 | 工具型 Agent，不调 LLM（仅记忆库查询） |
| n3 | ~2500 | ~3000 | dimensions + memory_snapshot 作为上下文 |
| n4 | ~3500 | ~2500 | divergence 作为输入，生成 5-10 条种子 |
| n5 | ~2000 | ~6000 | selected_seeds × style_variants，输出多条短文 |
| **合计** | **~8500** | **~13800** | **预估 12000-35000 tokens（视关键词数量）** |

`token_estimate_key` 为 `"matrix_small"`（≤8 关键词，预估 12000）或 `"matrix_large"`（>8 关键词，预估 35000，P0 不支持）。

### 6.2 多视角改写润色工作流

**workflow_id**: `rewrite_polish`
**目标用户**：作者已有文风样本（喜欢的大佬作品）和待改写文本（自己的草稿），希望按目标文风改写并润色定稿。
**设计哲学**：样本文风分析（提取特征向量）→ 按目标文风改写（保留语义、迁移文风）→ 润色定稿（修正连贯性、节奏、错别字）。

#### 6.2.1 用户输入契约（input_schema）

```json
{
  "type": "object",
  "properties": {
    "sample_text": {
      "type": "string",
      "description": "目标文风的样本文本（500-5000 字），如喜欢的大佬作品片段",
      "minLength": 100,
      "maxLength": 10000
    },
    "target_text": {
      "type": "string",
      "description": "待改写的文本（自己的草稿）",
      "minLength": 100,
      "maxLength": 20000
    },
    "project_id": {
      "type": "integer",
      "description": "项目 ID（可选，用于读取基线文风 memory）"
    }
  },
  "required": ["sample_text", "target_text"]
}
```

**parse_input 规则**：

1. `sample_text` 超过 10000 字时截取前 10000 字（避免 token 爆炸），记 warning
2. `target_text` 超过 20000 字时分为多个 chunk（P1 阶段实现分块管道），P0 阶段直接截断并 warning
3. `project_id` 可选，若提供则 r1 会查询记忆库的 `baseline_style` 作为辅助参考

#### 6.2.2 节点数据流转

**节点 r1 - style_analyzer（文风分析师）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.sample_text | `$user_input.sample_text` | 文风样本 |
| input.project_id | `$user_input.project_id` | 项目 ID（查询 baseline_style） |
| output.style_features | 节点产出 | 结构化文风特征 |

**output.style_features 示例**：

```json
{
  "style_features": {
    "sentence_length": {
      "avg": 18.5,
      "variance": 12.3,
      "distribution": {"short": 0.3, "medium": 0.5, "long": 0.2}
    },
    "vocabulary": {
      "formality": 0.7,
      "rare_word_ratio": 0.05,
      "domain_terms": ["灵能", "共鸣", "界域"]
    },
    "rhetoric": {
      "metaphor_frequency": 0.15,
      "parallelism_frequency": 0.08,
      "rhetorical_questions": 0.03
    },
    "tone": {
      "primary": "冷峻克制",
      "emotion_intensity": 0.4,
      "irony_level": 0.2
    },
    "pacing": {
      "description_to_dialogue_ratio": 2.5,
      "action_density": 0.6
    },
    "summary": "短句为主、冷色调、心理描写克制、动作节奏明快"
  }
}
```

**节点 r2 - style_rewriter（文风改写师）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.original_text | `$user_input.target_text` | 待改写文本 |
| input.target_style | `$node.r1.output.style_features` | 目标文风特征 |
| output.rewritten_text | 节点产出 | 改写后的文本（保留语义，迁移文风） |

**output.rewritten_text 示例**：

```json
{
  "rewritten_text": {
    "content": "第三十七次。林晚看着课桌上的刻痕，知道这是最后的机会。窗外黑潮翻涌...",
    "word_count": 1850,
    "changes_summary": {
      "sentence_split": 12,
      "vocabulary_replacements": 35,
      "tone_adjustments": 8,
      "preserved_semantics": 0.95
    }
  }
}
```

**节点 r3 - style_polisher（文风润色师）**

| 字段 | 来源 | 说明 |
|---|---|---|
| input.rewritten_text | `$node.r2.output.rewritten_text` | 改写后文本 |
| input.target_style | `$node.r1.output.style_features` | 目标文风（用于一致性检查） |
| output.final_text | 节点产出 | 润色定稿文本 |

**output.final_text 示例**：

```json
{
  "final_text": {
    "content": "第三十七次回溯。林晚盯着课桌上的刻痕——三十七道，深浅不一。最后一道刻在昨天，那是她最后的机会。窗外黑潮翻涌，像某种古老生物的呼吸...",
    "word_count": 1920,
    "polish_log": [
      {"type": "coherence", "before": "...", "after": "...", "reason": "补充因果衔接"},
      {"type": "rhythm", "before": "...", "after": "...", "reason": "调整短长句节奏"},
      {"type": "typo", "before": "回塑", "after": "回溯", "reason": "错别字修正"}
    ],
    "style_consistency_score": 0.88
  }
}
```

**产出文件**：

Pipeline 完成后，r3 的产出写入：

- `{output_dir}/r3_final_text.md`：润色定稿的纯文本（可直接复制使用）
- `{output_dir}/r3_final_text.json`：含 polish_log 的结构化版本，供前端展示修改对比
- `{output_dir}/r1_style_features.json`：r1 的文风分析结果（可供后续任务复用）

#### 6.2.3 数据流转全图

```
用户输入                  r1                  r2                  r3
┌──────────────┐         ┌──────────┐        ┌──────────┐        ┌──────────┐
│ sample_text  │───→ r1 →│ style    │───→ r2 →│ style   │───→ r3 →│ style    │
│ target_text  │         │ analyzer │        │ rewriter│        │ polisher │
│ project_id   │         └──────────┘        └──────────┘        └──────────┘
└──────────────┘         output:             output:             output:
                         style_features      rewritten_text      final_text
                              │
                              └──→ 同时供 r3 使用（一致性参考）
```

#### 6.2.4 错误处理策略

| 节点 | 失败场景 | 处理策略 |
|---|---|---|
| r1 | 样本文本过短（< 100 字）无法提取文风特征 | 重试 3 次，仍失败则用默认文风特征（中性风格）继续 |
| r1 | LLM 输出无法解析为结构化 JSON | 重试 3 次，降级为非结构化文本描述 |
| r2 | 改写后文本与原文相似度 < 0.3（语义丢失） | 重试 3 次，提示 LLM 保留更多原文语义；仍失败则保留 r2 输出并标记 `low_semantic_preservation: true` |
| r2 | 改写后字数与原文差异 > 50% | 重试 2 次，提示 LLM 控制字数；仍失败则保留输出并 warning |
| r3 | 润色后文风一致性分数 < 0.6 | 重试 2 次，仍失败则保留 r2 的 `rewritten_text` 作为最终输出（跳过润色） |

**无检查点**：本工作流默认 `HandsOff` 模式，纯串行全自动。用户若需介入，可主动改为 `supervised` 模式，但 P0 阶段未设置检查点节点，supervised 模式下也不会暂停。

#### 6.2.5 token 预估

| 节点 | 输入 token | 输出 token | 备注 |
|---|---|---|---|
| r1 | ~3000 | ~1500 | sample_text + 系统提示词 |
| r2 | ~5000 | ~3000 | original_text + target_style 作为上下文 |
| r3 | ~5500 | ~3500 | rewritten_text + target_style + 润色指令 |
| **合计** | **~13500** | **~8000** | **预估 6000-20000 tokens（视文本长度）** |

`token_estimate_key` 为 `"rewrite_short"`（< 2000 字，预估 6000）。长文本（> 2000 字）走 `"rewrite_long"`（预估 20000），P0 阶段未实现分块管道，长文本会被截断。

#### 6.2.6 与记忆库的联动（可选）

若用户在输入中提供 `project_id`，r1 会额外查询记忆库的 `baseline_style` 字段：

- 若 `baseline_style` 存在（用户之前用 style_analyzer 分析过该项目），r1 将其作为**辅助参考**，与 `sample_text` 的分析结果加权融合（sample_text 权重 0.7，baseline_style 权重 0.3）
- 若 `baseline_style` 不存在，仅使用 `sample_text` 的分析结果
- r1 完成后，若 `project_id` 存在，将本次分析结果写入记忆库的 `baseline_style` 字段（通过 `agent.write_memory` 工具，merge_strategy 为 `replace`）

**联动价值**：用户多次改写同一项目时，文风特征会逐步沉淀，避免每次重新分析样本。这是 memory_keeper Agent 的典型应用场景。

---

## 7. P0 Agent提示词模板

本章为 P0 阶段的 7 个 LLM 驱动 Agent 提供完整的系统提示词（system_prompt）模板。这些模板在实现阶段将以独立 `.md` 文件形式存放于 `src-tauri/prompts/` 目录，由 [2.2.4 P0 Agent 定义](#224-p0-agent-定义静态声明) 中的 `include_str!` 宏在编译期嵌入二进制。

**通用约定**：

1. **变量插值语法**：所有模板支持 `{{variable}}` 插值，由 `executor.rs::interpolate_prompt` 在运行期替换（见 [3.2.1 AgentExecutorImpl](#321-agentexecutorimpl)）。变量来源：
   - `{{task_id}}` / `{{project_id}}` / `{{workflow_id}}`：来自 `TaskContext`
   - `{{input.field_name}}`：来自节点 input 参数（JSON 字符串化为文本）
   - `{{node.{id}.output.{field}}}`：来自上游节点产出（仅在 system_prompt 显式引用上游数据时使用，一般通过 input_mapping 注入到 user 消息即可）
2. **消息组装**：system_prompt 经插值后作为 `role=system` 消息；节点 input 序列化为 JSON 后作为 `role=user` 消息。LLM 的最终回复需符合 output_schema。
3. **输出格式强制**：所有 Agent 的输出必须为可解析的 JSON。system_prompt 中以 `## 输出格式` 章节显式约定 JSON Schema，并要求 LLM 仅输出 ```` ```json ... ``` ```` 代码块。`parse_structured_output`（[3.2.2](#32-结构化输出解析)）会优先提取代码块，失败则尝试整体解析，仍失败则 content 保留原文并标记 `structured=None`，由 Pipeline 错误处理策略决定重试或降级。
4. **温度参数**：与 [2.2.4](#224-p0-agent-定义静态声明) 中 `model_params.temperature` 保持一致，analytic 类 Agent 用低温度（0.2-0.3）保证稳定，creative 类用高温度（0.7-0.95）保证多样性。
5. **工具调用约束**：system_prompt 中显式声明可用工具及调用时机；LLM 在回复中触发 `tool_calls` 时，executor 进入工具循环（见 [3.2.3 工具调用循环](#323-工具调用循环)），工具结果以 `role=tool` 消息追加后再次调用 LLM，直到 LLM 输出不含 tool_calls 的最终 JSON。
6. **语言**：所有提示词使用中文，输出亦为中文（除非用户输入为外文）。

---

### 7.1 灵感矩阵Agent提示词

灵感矩阵工作流（`inspiration_matrix`）的 4 个 LLM Agent 提示词。工作流定义见 [6.1 灵感矩阵生成工作流](#61-灵感矩阵生成工作流)。

#### 7.1.1 keyword_analyst（关键词分析师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `keyword_analyst` |
| category | analytic |
| temperature | 0.3 |
| max_tokens | 2048 |
| required_tools | （无） |
| optional_tools | `agent.query_project_info` |
| 节点位置 | n1（灵感矩阵管道起点） |

**输入契约**（经 input_mapping 注入到 user 消息）：

```json
{
  "keywords": ["末世", "学园", "异能"],
  "project_id": 12
}
```

**输出契约**（system_prompt 强制 LLM 输出此结构）：

```json
{
  "dimensions": [
    {
      "keyword": "末世",
      "facets": [
        {"name": "时间设定", "values": ["近未来10年", "远未来100年", "末日后3天"]},
        {"name": "灾难类型", "values": ["病毒", "核战", "气候", "外星入侵"]}
      ]
    }
  ]
}
```

**提示词模板原文**（存为 `src-tauri/prompts/keyword_analyst.md`）：

```markdown
# 角色定义

你是一名资深网文策划与关键词分析师，擅长将用户提供的模糊关键词（如"末世 + 学园 + 异能"）拆解为可创作的多维语义空间。你的输出将作为灵感发散师（idea_diverger）的输入，因此必须结构化、可枚举、可组合。

# 任务说明

接收用户提供的 1-8 个关键词，对每个关键词执行以下操作：

1. **语义展开**：识别该关键词在网文创作中的常见维度（如"末世"可展开为"时间设定 / 灾难类型 / 社会形态 / 生存资源"等维度）。
2. **取值枚举**：每个维度下给出 3-5 个具体可选项，选项应为名词或名词短语，避免完整句子。
3. **网文语境校准**：维度与取值需贴合中文网络文学创作语境，避免学术化或冷门表述。

# 工具使用指导

- 你可调用 `agent.query_project_info` 查询当前项目（project_id={{input.project_id}}）的元数据（名称/类型/描述），用于对齐关键词维度与项目已有设定。
- 仅在需要确认项目类型时调用一次，不要重复调用。
- 若项目信息与关键词无明显冲突，可跳过工具调用直接输出。

# 约束与注意事项

1. **维度数量**：每个关键词展开 2-4 个维度，不要过多导致后续组合爆炸，也不要过少限制发散空间。
2. **取值数量**：每个维度给出 3-5 个取值，取值之间应具有明显差异（避免"病毒 / 病菌 / 病原体"这类近义重复）。
3. **取值风格**：取值应为 2-8 字的名词短语，便于后续 idea_diverger 引用与组合。
4. **避免预设结论**：不要在维度中直接给出"最佳组合"或"推荐方向"，你的职责是展开可能性，筛选由下游 Agent 与用户完成。
5. **语言**：所有输出使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "dimensions": [
    {
      "keyword": "关键词原文",
      "facets": [
        {
          "name": "维度名称（如：时间设定）",
          "values": ["取值1", "取值2", "取值3"]
        }
      ]
    }
  ]
}
```

不要输出任何解释性文字、前后缀说明或 Markdown 标题，仅输出 JSON 代码块。
```

---

#### 7.1.2 idea_diverger（灵感发散师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `idea_diverger` |
| category | creative |
| temperature | 0.95 |
| max_tokens | 4096 |
| required_tools | （无） |
| optional_tools | `agent.read_memory` |
| 节点位置 | n3（与 n2:memory_keeper 并行，依赖 n1） |

**输入契约**：

```json
{
  "dimensions": "$node.n1.output.dimensions",
  "memory": "$node.n2.output.memory_snapshot"
}
```

> `memory` 字段在新项目中可能为空对象 `{}`，需容忍。

**输出契约**：

```json
{
  "divergence": [
    {
      "dimension": "末世.灾难类型",
      "ideas": [
        {"id": "i1", "content": "异能病毒：感染者获得随机异能但寿命缩短", "novelty": 0.8},
        {"id": "i2", "content": "气候异变：四季紊乱，每季持续天数随机", "novelty": 0.6}
      ]
    }
  ]
}
```

**提示词模板原文**（存为 `src-tauri/prompts/idea_diverger.md`）：

```markdown
# 角色定义

你是一名灵感发散师，专长于在限定的语义维度内爆发式产出具体、可落地、有网文感的故事灵感点。你追求"数量与多样性"，不追求"完美方案"——筛选与组合由下游的 inspiration_combiner 完成。

# 任务说明

接收上游 keyword_analyst 提供的维度矩阵（dimensions），对每个维度下的每个取值执行以下操作：

1. **灵感生成**：针对该维度取值，生成 3-5 个具体灵感点。灵感点应为一句话描述（20-60 字），包含"设定 + 冲突钩子"或"设定 + 反转点"。
2. **新颖度自评**：为每个灵感点标注 `novelty` 字段（0-1 浮点数），评估其在当前网文市场的稀缺程度。0.9+ 表示罕见且有潜力，0.5 以下表示常见套路。
3. **记忆库去重**：若 `memory` 字段非空，检查已有的人物/设定/事件，避免与记忆库中已存在的灵感重复（可在 content 中明确标注"区别于已有设定 X"）。

# 工具使用指导

- 你可调用 `agent.read_memory` 主动查询记忆库的特定分区（如 `section="characters"` 查询已有角色），用于精准去重。
- 推荐在生成灵感前调用一次查询角色与地点分区，避免与已有设定冲突。
- 若 `memory` 字段已通过输入提供完整快照，可跳过工具调用。

# 约束与注意事项

1. **灵感数量**：每个维度取值下生成 3-5 个灵感点，整个 divergence 数组通常包含 15-40 个灵感点。
2. **灵感长度**：每个灵感点的 `content` 控制在 20-60 字，过短无法传达设定，过长会限制下游组合空间。
3. **多样性**：同一维度取值下的多个灵感点应覆盖不同视角（如主角视角/反派视角/世界规则视角），避免雷同。
4. **novelty 客观性**：novelty 评分基于网文市场常见度，而非个人偏好。常见套路（如"系统流签到"）应给低分，罕见组合（如"异能病毒 + 寿命代价"）应给高分。
5. **记忆库容忍**：若 `memory` 为空对象 `{}`，表示新项目无历史设定，直接发散即可，不要因缺失记忆而拒绝输出。
6. **语言**：所有输出使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "divergence": [
    {
      "dimension": "关键词.维度名（如：末世.灾难类型）",
      "ideas": [
        {
          "id": "i1",
          "content": "灵感点描述（20-60字）",
          "novelty": 0.8
        }
      ]
    }
  ]
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

#### 7.1.3 inspiration_combiner（灵感组合师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `inspiration_combiner` |
| category | creative |
| temperature | 0.8 |
| max_tokens | 4096 |
| required_tools | （无） |
| optional_tools | （无） |
| 节点位置 | n4（检查点节点，supervised 模式下暂停等待用户选择） |

**输入契约**：

```json
{
  "divergence": "$node.n3.output.divergence"
}
```

**输出契约**：

```json
{
  "seeds": [
    {
      "seed_id": "s1",
      "title": "黑潮学园",
      "combination": ["末世.病毒", "学园.军事学院", "异能.觉醒"],
      "synopsis": "异能病毒席卷全球，感染者被强制收入军事学园。主角林晚觉醒时间回溯能力，却发现每次回溯都在消耗同学的寿命...",
      "estimated_potential": 0.85,
      "tags": ["末世", "学园", "异能", "悲剧"]
    }
  ]
}
```

**检查点行为**：

本节点为检查点节点。完成后 Pipeline 暂停（仅 supervised 模式），前端弹出 `CheckpointDialog` 展示 `seeds` 列表，用户勾选进入 n5 的种子 ID（写入 `user_input.selected_seeds`）。在 hands_off/autopilot 模式下，Pipeline 自动选择 `estimated_potential >= 0.7` 的种子。

**提示词模板原文**（存为 `src-tauri/prompts/inspiration_combiner.md`）：

```markdown
# 角色定义

你是一名故事种子架构师，擅长跨维度组合离散的灵感点，生成具有完整骨架的故事种子。每个种子应包含可写性评估，便于用户筛选。

# 任务说明

接收上游 idea_diverger 提供的灵感发散矩阵（divergence），执行以下操作：

1. **跨维度组合**：从不同维度的灵感点中选取 2-4 个进行组合，生成 5-10 个故事种子。组合应跨越至少 2 个不同的关键词维度（如"末世.灾难类型" + "学园.权力结构"）。
2. **种子构建**：每个种子包含：
   - `title`：4-12 字的标题，需有辨识度与画面感
   - `combination`：引用的灵感点 ID 或维度取值（如 `["末世.病毒", "学园.军事学院"]`）
   - `synopsis`：50-150 字的故事梗概，包含主角设定、核心冲突、钩子悬念
   - `estimated_potential`：0-1 浮点数，评估该种子的可写性（考虑冲突张力、扩展空间、市场接受度）
   - `tags`：3-6 个标签，便于分类与检索
3. **去重与多样性**：种子之间应具有明显差异（不同的主角设定/冲突类型/情感基调），避免雷同。

# 约束与注意事项

1. **种子数量**：生成 5-10 个种子，过少限制用户选择，过多增加筛选成本。
2. **synopsis 结构**：梗概应包含"主角是谁 + 面临什么冲突 + 有什么钩子"三要素，避免纯设定描述。
3. **estimated_potential 客观性**：评分基于冲突张力与扩展空间，而非个人偏好。冲突清晰、可延展多卷的种子给高分；设定单薄、冲突模糊的种子给低分。
4. **组合合理性**：组合的灵感点之间应具有内在张力或互补性，避免强行拼接（如"末世.病毒" + "学园.普通高中"张力不足，应改为"学园.军事学院"或"学园.避难所"）。
5. **避免预设结局**：种子应开放可发展，不要在 synopsis 中写死结局，保留作者创作空间。
6. **语言**：所有输出使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "seeds": [
    {
      "seed_id": "s1",
      "title": "种子标题（4-12字）",
      "combination": ["维度1.取值1", "维度2.取值2"],
      "synopsis": "故事梗概（50-150字，含主角/冲突/钩子）",
      "estimated_potential": 0.85,
      "tags": ["标签1", "标签2", "标签3"]
    }
  ]
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

#### 7.1.4 inspiration_matrix_writer（矩阵成文师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `inspiration_matrix_writer` |
| category | creative |
| temperature | 0.85 |
| max_tokens | 4096 |
| required_tools | （无） |
| optional_tools | （无） |
| 节点位置 | n5（管道终点，产出最终短文样本） |

**输入契约**：

```json
{
  "selected_seeds": "$user_input.selected_seeds",
  "style_variants": "$user_input.style_variants"
}
```

> `selected_seeds` 为检查点后用户选择的种子 ID 数组（如 `["s1", "s2"]`），但 Pipeline 会将完整的 `seeds` 数据（n4 产出）一并传入 user 消息，本 Agent 根据 ID 筛选。

**实际 user 消息示例**（Pipeline 组装）：

```json
{
  "selected_seeds": ["s1", "s2"],
  "seeds_pool": [
    {"seed_id": "s1", "title": "黑潮学园", "synopsis": "...", "tags": [...]},
    {"seed_id": "s2", "title": "废土学园共同体", "synopsis": "...", "tags": [...]}
  ],
  "style_variants": [
    {"name": "冷峻写实", "features": "短句、克制、冷色调"},
    {"name": "热血燃向", "features": "爆发、动作密集、情绪外放"}
  ]
}
```

**输出契约**：

```json
{
  "drafts": [
    {
      "seed_id": "s1",
      "style": "冷峻写实",
      "title": "黑潮学园·冷峻版",
      "content": "第三十七次回溯。林晚看着课桌上刻痕，知道这是她最后的机会...",
      "word_count": 850
    }
  ]
}
```

**提示词模板原文**（存为 `src-tauri/prompts/inspiration_matrix_writer.md`）：

```markdown
# 角色定义

你是一名多风格网文写手，擅长根据故事种子快速产出 800-1500 字的开篇短文样本，并能精准切换不同文风。你的产出将直接展示给作者作为灵感参考。

# 任务说明

接收用户选中的故事种子（selected_seeds 对应 seeds_pool 中的条目）与文风变体列表（style_variants），执行以下操作：

1. **种子筛选**：从 seeds_pool 中取出 selected_seeds 列出的种子。
2. **文风应用**：对每个选中的种子，按每种文风变体各产出一篇短文。例如 2 个种子 × 2 种文风 = 4 篇短文。
3. **短文要求**：
   - 字数 800-1500 字
   - 包含开篇场景、主角登场、核心冲突点暗示
   - 体现该文风变体的特征（如"冷峻写实"需短句克制，"热血燃向"需动作密集情绪外放）
   - 不要写完整故事，止于第一个钩子悬念处

# 约束与注意事项

1. **文风差异化**：同一 seed 的不同文风短文应具有明显风格差异，避免只是替换几个词汇。句式、节奏、视角、情绪强度都应调整。
2. **种子一致性**：不同文风短文必须基于同一个 seed 的 synopsis 与 tags，核心设定不可偏移（主角名/世界观/核心冲突保持一致）。
3. **字数控制**：每篇短文 800-1500 字，过短无法体现文风，过长占用 token 与阅读成本。word_count 字段为实际中文字符数（不含标点）。
4. **止于钩子**：短文止于第一个核心钩子悬念处，不要强行收尾或解决冲突，保留作者继续创作的空间。
5. **避免元叙述**：不要在短文中出现"本文风格为 XX"之类的元描述，文风应自然体现在文本中。
6. **title 命名规则**：`{seed.title}·{文风名}版`，如"黑潮学园·冷峻版"。
7. **语言**：所有短文使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "drafts": [
    {
      "seed_id": "s1",
      "style": "冷峻写实",
      "title": "黑潮学园·冷峻版",
      "content": "短文正文（800-1500字）",
      "word_count": 850
    },
    {
      "seed_id": "s1",
      "style": "热血燃向",
      "title": "黑潮学园·热血版",
      "content": "短文正文（800-1500字）",
      "word_count": 920
    }
  ]
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

### 7.2 改写润色Agent提示词

改写润色工作流（`rewrite_polish`）的 3 个 LLM Agent 提示词。工作流定义见 [6.2 多视角改写润色工作流](#62-多视角改写润色工作流)。

#### 7.2.1 style_analyzer（风格分析师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `style_analyzer` |
| category | analytic |
| temperature | 0.2 |
| max_tokens | 2048 |
| required_tools | `agent.read_memory` |
| optional_tools | （无） |
| 节点位置 | r1（改写润色管道起点） |

**输入契约**：

```json
{
  "sample_text": "用户提供的文风样本（500-5000字）",
  "project_id": 12
}
```

**输出契约**：

```json
{
  "style_features": {
    "sentence_length": {
      "avg": 18.5,
      "variance": 12.3,
      "distribution": {"short": 0.3, "medium": 0.5, "long": 0.2}
    },
    "vocabulary": {
      "formality": 0.7,
      "rare_word_ratio": 0.05,
      "domain_terms": ["灵能", "共鸣", "界域"]
    },
    "rhetoric": {
      "metaphor_frequency": 0.15,
      "parallelism_frequency": 0.08,
      "rhetorical_questions": 0.03
    },
    "tone": {
      "primary": "冷峻克制",
      "emotion_intensity": 0.4,
      "irony_level": 0.2
    },
    "pacing": {
      "description_to_dialogue_ratio": 2.5,
      "action_density": 0.6
    },
    "summary": "短句为主、冷色调、心理描写克制、动作节奏明快"
  }
}
```

**提示词模板原文**（存为 `src-tauri/prompts/style_analyzer.md`）：

```markdown
# 角色定义

你是一名文学风格分析师，擅长对中文小说文本进行量化与定性相结合的文风特征提取。你的输出将作为 style_rewriter 的目标文风参照，必须精确、可操作、可复现。

# 任务说明

接收用户提供的文风样本（sample_text），从以下五个维度提取结构化特征：

1. **sentence_length（句长分布）**：
   - `avg`：平均句长（按句号/问号/感叹号切分，中文字符数）
   - `variance`：句长方差
   - `distribution`：短句（<10字）、中句（10-25字）、长句（>25字）的占比，三者之和为 1
2. **vocabulary（词汇偏好）**：
   - `formality`：正式度 0-1，0 为口语化，1 为书面化
   - `rare_word_ratio`：生僻词占比（非常用3000词以外的词汇比例）
   - `domain_terms`：领域术语列表（如玄幻小说中的"灵能/共鸣/界域"），最多 10 个
3. **rhetoric（修辞特征）**：每千字中各修辞手法的出现频率
   - `metaphor_frequency`：比喻/暗喻频率
   - `parallelism_frequency`：排比/对偶频率
   - `rhetorical_questions`：反问频率
4. **tone（语调情绪）**：
   - `primary`：主基调（如"冷峻克制"/"热血外放"/"诙谐调侃"）
   - `emotion_intensity`：情绪强度 0-1
   - `irony_level`：反讽程度 0-1
5. **pacing（节奏密度）**：
   - `description_to_dialogue_ratio`：描写与对话的篇幅比
   - `action_density`：动作描写密度 0-1
6. **summary**：一句话总结整体文风特征（30-60 字）

# 工具使用指导

- 你必须调用 `agent.read_memory`（project_id={{input.project_id}}）查询 `baseline_style` 分区，获取该项目的历史文风基线。
- 若 baseline_style 存在，将其作为参考一并纳入分析（输出中可体现"与基线的一致性/差异"），但本次分析的权威数据来源是 sample_text。
- 若 baseline_style 不存在（新项目），仅基于 sample_text 分析，不影响输出格式。

# 约束与注意事项

1. **量化优先**：所有可量化的字段（avg/variance/frequency/ratio/intensity/density）必须为浮点数，不要用"高/中/低"等模糊描述。
2. **客观性**：特征提取基于文本本身，不要主观评价优劣。冷峻克制不优于热血外放，仅是差异。
3. **domain_terms 上限**：最多 10 个术语，按出现频率排序。
4. **summary 简洁**：30-60 字一句话总结，用于下游 Agent 快速理解文风。
5. **样本长度容忍**：若 sample_text 短于 100 字，特征提取可能不稳定，但仍需输出完整结构（可基于少量样本做最佳估计，不要拒绝输出）。
6. **语言**：所有输出使用中文（domain_terms 为中文术语）。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "style_features": {
    "sentence_length": {
      "avg": 18.5,
      "variance": 12.3,
      "distribution": {"short": 0.3, "medium": 0.5, "long": 0.2}
    },
    "vocabulary": {
      "formality": 0.7,
      "rare_word_ratio": 0.05,
      "domain_terms": ["术语1", "术语2"]
    },
    "rhetoric": {
      "metaphor_frequency": 0.15,
      "parallelism_frequency": 0.08,
      "rhetorical_questions": 0.03
    },
    "tone": {
      "primary": "主基调描述",
      "emotion_intensity": 0.4,
      "irony_level": 0.2
    },
    "pacing": {
      "description_to_dialogue_ratio": 2.5,
      "action_density": 0.6
    },
    "summary": "一句话文风总结（30-60字）"
  }
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

#### 7.2.2 style_rewriter（改写执行师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `style_rewriter` |
| category | creative |
| temperature | 0.7 |
| max_tokens | 4096 |
| required_tools | （无） |
| optional_tools | `agent.read_memory` |
| 节点位置 | r2（依赖 r1 的 style_features） |

**输入契约**：

```json
{
  "original_text": "$user_input.target_text",
  "target_style": "$node.r1.output.style_features"
}
```

**输出契约**：

```json
{
  "rewritten_text": {
    "content": "改写后的完整文本...",
    "word_count": 1850,
    "changes_summary": {
      "sentence_split": 12,
      "vocabulary_replacements": 35,
      "tone_adjustments": 8,
      "preserved_semantics": 0.95
    }
  }
}
```

**提示词模板原文**（存为 `src-tauri/prompts/style_rewriter.md`）：

```markdown
# 角色定义

你是一名文风迁移改写师，擅长在保持原文语义与情节不变的前提下，将文本的文风迁移到目标风格。你的核心挑战是"风格可变，语义不动"。

# 任务说明

接收待改写文本（original_text）与目标文风特征（target_style），执行以下操作：

1. **文风迁移**：按 target_style 的五个维度（句长/词汇/修辞/语调/节奏）改写原文：
   - 调整句长分布以匹配 target_style.sentence_length
   - 替换词汇以匹配 target_style.vocabulary（formality/domain_terms）
   - 增删修辞以匹配 target_style.rhetoric 的频率
   - 调整语调与情绪强度以匹配 target_style.tone
   - 调整描写/对话比例与动作密度以匹配 target_style.pacing
2. **语义保持**：原文的情节、人物、设定、对话内容不可改变，仅改变表达方式。
3. **变更统计**：输出 changes_summary，量化本次改写的操作：
   - `sentence_split`：拆分的长句数量
   - `vocabulary_replacements`：词汇替换次数
   - `tone_adjustments`：语调调整次数
   - `preserved_semantics`：语义保持度 0-1（自评，0.9+ 为优秀）

# 工具使用指导

- 你可调用 `agent.read_memory`（project_id={{project_id}}）查询 `baseline_style` 分区，获取该项目的历史文风基线，作为辅助参考。
- 若 target_style 已通过输入提供完整特征，可跳过工具调用。
- 不要调用 `agent.write_memory`，记忆库写入由 style_polisher 在润色完成后统一执行。

# 约束与注意事项

1. **语义保持优先**：宁可文风迁移不彻底，也不能改变情节/人物/设定。preserved_semantics 必须 >= 0.9。
2. **字数控制**：改写后字数与原文差异不超过 30%。过短会丢失细节，过长会注水。
3. **不要新增情节**：不可添加原文没有的情节、人物、对话。仅可调整表达方式。
4. **不要删减情节**：不可删除原文的关键情节或对话，仅可压缩冗余描写（且压缩幅度不超过 20%）。
5. **保留专有名词**：原文的人物名、地名、术语必须原样保留，不可替换。
6. **changes_summary 客观**：统计字段基于实际改写操作，不要虚报。
7. **语言**：改写后文本使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "rewritten_text": {
    "content": "改写后的完整文本",
    "word_count": 1850,
    "changes_summary": {
      "sentence_split": 12,
      "vocabulary_replacements": 35,
      "tone_adjustments": 8,
      "preserved_semantics": 0.95
    }
  }
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

#### 7.2.3 style_polisher（润色优化师）

**Agent 元数据**：

| 字段 | 值 |
|---|---|
| agent_id | `style_polisher` |
| category | creative |
| temperature | 0.5 |
| max_tokens | 4096 |
| required_tools | （无） |
| optional_tools | （无） |
| 节点位置 | r3（管道终点，产出最终定稿） |

**输入契约**：

```json
{
  "rewritten_text": "$node.r2.output.rewritten_text",
  "target_style": "$node.r1.output.style_features"
}
```

**输出契约**：

```json
{
  "final_text": {
    "content": "润色定稿的完整文本...",
    "word_count": 1920,
    "polish_log": [
      {"type": "coherence", "before": "...", "after": "...", "reason": "补充因果衔接"},
      {"type": "rhythm", "before": "...", "after": "...", "reason": "调整短长句节奏"},
      {"type": "typo", "before": "回塑", "after": "回溯", "reason": "错别字修正"}
    ],
    "style_consistency_score": 0.88
  }
}
```

**提示词模板原文**（存为 `src-tauri/prompts/style_polisher.md`）：

```markdown
# 角色定义

你是一名文本润色优化师，擅长对改写后的文本做最后的精修：修补语病、强化节奏、提升文风一致性。你的产出是改写润色管道的最终输出，将直接展示给作者。

# 任务说明

接收改写后的文本（rewritten_text）与目标文风特征（target_style），执行以下操作：

1. **错误修正**：检查并修正 rewritten_text 中的：
   - 错别字、用词不当
   - 语病、长句结构混乱
   - 标点符号错误
   - 段落衔接断裂
2. **节奏优化**：根据 target_style.pacing 与 target_style.sentence_length，微调句式节奏（如长短句交替、关键处断句强化）。
3. **文风一致性检查**：对照 target_style 五维特征，检查 rewritten_text 是否有偏离目标文风的段落，必要时微调。
4. **polish_log 记录**：记录每次修改的：
   - `type`：修改类型（coherence 衔接 / rhythm 节奏 / typo 错字 / vocabulary 用词 / tone 语调）
   - `before`：修改前原文（片段即可，不超过 50 字）
   - `after`：修改后文本（片段即可，不超过 50 字）
   - `reason`：修改理由（10-30 字）
5. **style_consistency_score**：0-1 浮点数，评估最终文本与 target_style 的一致性。

# 约束与注意事项

1. **微调而非重写**：润色是精修，不是再次改写。不要大段重写 rewritten_text，仅做局部优化。若 rewritten_text 已足够好，polish_log 可以为空数组。
2. **保持语义**：润色不可改变情节、人物、设定，仅优化表达。
3. **polish_log 上限**：最多记录 20 条修改，按重要性排序（错字 > 语病 > 衔接 > 节奏 > 用词）。
4. **style_consistency_score 客观**：基于 final_text 与 target_style 的五维对比，0.9+ 为高度一致，0.6 以下为偏离严重。
5. **字数控制**：润色后字数与 rewritten_text 差异不超过 10%。
6. **保留专有名词**：人物名、地名、术语原样保留。
7. **降级策略**：若 rewritten_text 质量极差无法润色（style_consistency_score < 0.3），直接保留 rewritten_text 作为 final_text，polish_log 记录降级原因。
8. **语言**：润色后文本使用中文。

# 输出格式

必须且仅输出一个 ```json 代码块，结构如下：

```json
{
  "final_text": {
    "content": "润色定稿的完整文本",
    "word_count": 1920,
    "polish_log": [
      {
        "type": "coherence",
        "before": "修改前片段",
        "after": "修改后片段",
        "reason": "修改理由"
      }
    ],
    "style_consistency_score": 0.88
  }
}
```

不要输出任何解释性文字，仅输出 JSON 代码块。
```

---

### 7.3 工具型Agent说明（memory_keeper）

`memory_keeper`（记忆库守护者）为**工具型 Agent**，category 为 `Memory`，**不调用 LLM**，因此无需系统提示词模板。

**工作机制**：

- `memory_keeper` 的"执行"由 `memory.rs` 中的 Rust 函数直接完成，不经过 `executor.rs::AgentExecutorImpl` 的 LLM 调用流程。
- 在工作流 DAG 中，`memory_keeper` 节点的 `agent_id` 为 `memory_keeper`，但 Pipeline 引擎识别其 `category == Memory`，跳过 LLM 调用，直接调用 `memory::handle_memory_operation` 函数。
- 输入 `operation` 字段决定操作类型：
  - `query`：查询记忆库分区，返回 `memory_snapshot`
  - `update`：更新记忆库分区（由其他 Agent 通过 `agent.write_memory` 工具触发，不由 memory_keeper 主动执行）
  - `summary`：生成记忆库摘要（P0 阶段未实现，预留接口）

**P0 阶段调用场景**：

- 灵感矩阵工作流 n2 节点：`operation="query"`, `query="characters,timeline,locations"`，返回项目已有的人物/时间线/地点快照，供 idea_diverger 去重参考。
- 改写润色工作流不显式调用 memory_keeper，但 style_analyzer 通过 `agent.read_memory` 工具直接读取 `baseline_style` 分区。

**实现细节**：见 [3.4 记忆库服务](#34-记忆库服务-memoryrs) 与 [3.3.5 memory_keeper 节点处理](#335-memory_keeper-节点处理)。

**include_str! 占位**：

虽然 `memory_keeper` 不调用 LLM，但 [2.2.4 P0 Agent 定义](#224-p0-agent-定义静态声明) 中的 `AgentDefinition` 仍引用了 `include_str!("../prompts/memory_keeper.md")`。该文件在实现阶段创建为空文件或包含简短说明（"此 Agent 为工具型，不调用 LLM"），仅为满足 struct 字段非空约束，不参与运行时逻辑。

---

### 7.4 提示词工程注意事项

本节汇总 P0 阶段提示词工程的通用注意事项，供后续 P1-P3 Agent 设计参考。

#### 7.4.1 输出格式稳定性

**问题**：LLM 偶尔会忽略"仅输出 JSON 代码块"的指令，附带解释性文字（如"好的，以下是结果："）。

**缓解措施**：

1. system_prompt 末尾强化提示："不要输出任何解释性文字，仅输出 JSON 代码块。"
2. `parse_structured_output`（[3.2.2](#32-结构化输出解析)）实现两级容错：优先提取 ```` ```json ``` ```` 代码块，失败则尝试整体解析。
3. 解析仍失败时，Pipeline 错误处理策略（[6.1.4](#614-错误处理策略) / [6.2.4](#624-错误处理策略)）触发重试，最多 3 次。
4. 重试时 executor 在 user 消息中追加："上一次输出无法解析为 JSON，请严格按格式输出，仅输出 JSON 代码块。"

#### 7.4.2 温度参数与输出质量

| Agent 类型 | temperature | 设计依据 |
|---|---|---|
| analytic（分析型） | 0.2-0.3 | 需要稳定、可复现的结构化输出，低温度减少随机性 |
| creative（创意型，发散） | 0.85-0.95 | 需要多样性，高温度激发创意，但避免 1.0+ 导致不可控 |
| creative（创意型，收敛） | 0.5-0.8 | 需要在创意与可控之间平衡，如改写/润色需保留语义 |
| memory（工具型） | N/A | 不调用 LLM |

#### 7.4.3 工具调用频率控制

**问题**：LLM 可能在单次任务中过度调用工具，导致 token 消耗激增与延迟上升。

**缓解措施**：

1. system_prompt 中显式声明"仅在需要时调用，不要重复调用"。
2. executor 的工具调用循环（[3.2.3](#323-工具调用循环)）设置最大循环次数（默认 5 次），超过则强制返回当前结果。
3. 工具结果缓存（[3.3.6 工具结果缓存](#336-工具结果缓存)）：同一 task_id 内相同 tool_id + 参数组合的结果缓存，避免重复调用。

#### 7.4.4 多语言与编码

- 所有提示词与输出使用中文（UTF-8 编码）。
- LLM 输出的 JSON 中文字符不转义为 `\uXXXX`，直接使用中文字符（`serde_json` 默认不转义）。
- 工具结果的字符串截断使用 `chars().take(500)` 而非字节切片，避免 UTF-8 边界 panic（项目硬约束）。

#### 7.4.5 提示词版本管理

- 每个提示词文件对应一个 Agent，文件名 = `agent_id.md`。
- AgentDefinition 的 `version` 字段标记提示词版本（P0 均为 `"1.0"`）。
- 提示词修改后需递增 version，并在 `agent_definitions` 表中更新（自定义 Agent 通过数据库覆盖静态定义，见 [2.4 注册表设计](#24-注册表设计)）。
- P3 阶段支持用户自定义 Agent 提示词（通过 `agent_save_settings` 命令持久化到 `agent_settings` 表）。

---

## 8. P1-P3接口设计

本章对 P1-P3 阶段的功能进行**接口级设计**，定义新增的 Tauri 命令、工具处理器、工作流节点、数据库表与前端类型的签名，但不展开完整实现细节（实现细节在后续迭代中按需补充）。P0 阶段的完整详细设计见 [Chapter 1-7](#1-数据库详细设计)。

**设计原则**：

1. **接口先行**：先定义稳定的接口契约，再实现内部逻辑，便于并行开发与 Mock 测试。
2. **复用 P0 基础设施**：P1-P3 全部复用 P0 的 Pipeline 引擎、executor、工具适配层、事件协议、检查点机制，仅扩展工作流定义与工具处理器。
3. **向后兼容**：P1-P3 的新增命令/工具/表不破坏 P0 的接口与数据，仅追加。
4. **渐进式扩展**：每个阶段的接口可独立编译运行，不依赖后续阶段。

---

### 8.1 P1接口（大纲生成+角色对话）

**目标**：引入结构型 Agent（structural category）与循环节点，验证检查点机制在多轮交互场景下的稳定性。

**交付范围**：
- 结构化大纲生成工作流（`outline_generation`，4 个 Agent + 2 个检查点）
- 角色驱动对话工作流（`character_dialogue`，含循环节点）
- 伏笔管理工具（3 个）+ 大纲管理工具（4 个）
- `outline_nodes` 表 + `foreshadows` 表
- 检查点 UI 完整化（P0 已实现基础交互，P1 补充多检查点串联）

#### 8.1.1 新增数据库表

**outline_nodes 表**（大纲节点，三级树形结构）：

```sql
CREATE TABLE IF NOT EXISTS outline_nodes (
    id TEXT PRIMARY KEY,                  -- UUID
    project_id INTEGER NOT NULL,
    parent_id TEXT,                       -- 父节点ID（NULL为根节点）
    node_type TEXT NOT NULL,              -- 'volume' / 'chapter' / 'scene'
    title TEXT NOT NULL,
    summary TEXT,                         -- 场景/章节摘要
    sort_order INTEGER NOT NULL DEFAULT 0,
    word_target INTEGER,                  -- 目标字数（仅chapter节点）
    status TEXT NOT NULL DEFAULT 'planned', -- 'planned' / 'writing' / 'done'
    metadata TEXT,                        -- JSON：额外元数据（如pace_reviewer的suggestion）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES outline_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outline_project ON outline_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_outline_parent ON outline_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_outline_sort ON outline_nodes(project_id, sort_order);
```

**foreshadows 表**（伏笔管理）：

```sql
CREATE TABLE IF NOT EXISTS foreshadows (
    id TEXT PRIMARY KEY,                  -- UUID
    project_id INTEGER NOT NULL,
    content TEXT NOT NULL,                -- 伏笔内容描述
    plant_chapter_id TEXT,                -- 埋设章节ID（关联outline_nodes）
    plant_scene_id TEXT,                  -- 埋设场景ID
    payoff_chapter_id TEXT,               -- 兑现章节ID
    payoff_scene_id TEXT,                 -- 兑现场景ID
    status TEXT NOT NULL DEFAULT 'planned', -- 'planned' / 'planted' / 'paid_off' / 'abandoned'
    related_foreshadows TEXT,             -- JSON数组：关联伏笔ID列表
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_foreshadow_project ON foreshadows(project_id);
CREATE INDEX IF NOT EXISTS idx_foreshadow_status ON foreshadows(project_id, status);
```

#### 8.1.2 新增工具处理器（7 个）

在 [3.3 工具适配层](#33-工具适配层-toolsrs) 的 `register_tool_handlers` 中追加：

| tool_id | 签名 | 权限 | 复用函数 |
|---|---|---|---|
| `agent.create_outline_node` | `(project_id, parent_id?, node_type, title, summary?, word_target?) -> node_id` | WriteDb | 新增 `commands/project.rs::create_outline_node_internal` |
| `agent.query_outline` | `(project_id, node_type?) -> Vec<OutlineNode>` | ReadDb | 新增 `list_outline_nodes_internal` |
| `agent.update_outline_node` | `(node_id, title?, summary?, word_target?, status?, metadata?) -> ()` | WriteDb | 新增 `update_outline_node_internal` |
| `agent.delete_outline_node` | `(node_id) -> ()` | WriteDb | 新增 `delete_outline_node_internal` |
| `agent.create_foreshadow` | `(project_id, content, plant_chapter_id?, plant_scene_id?, payoff_chapter_id?, payoff_scene_id?) -> foreshadow_id` | WriteDb | 新增 `commands/foreshadow.rs::create_foreshadow_internal` |
| `agent.query_foreshadows` | `(project_id, status?) -> Vec<Foreshadow>` | ReadDb | 新增 `list_foreshadows_internal` |
| `agent.update_foreshadow_status` | `(foreshadow_id, status, payoff_chapter_id?) -> ()` | WriteDb | 新增 `update_foreshadow_status_internal` |

**工具处理器签名示例**：

```rust
// agent.create_outline_node
pub struct CreateOutlineNodeTool;
impl ToolHandler for CreateOutlineNodeTool {
    fn tool_id(&self) -> &str { "agent.create_outline_node" }
    fn description(&self) -> &str { "创建大纲节点（卷/章/场景）" }
    fn required_permission(&self) -> ToolPermission { ToolPermission::WriteDb }
    fn is_dangerous(&self) -> bool { false }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "project_id": {"type": "integer"},
                "parent_id": {"type": "string", "description": "父节点ID，根节点传null"},
                "node_type": {"type": "string", "enum": ["volume", "chapter", "scene"]},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "word_target": {"type": "integer", "description": "目标字数，仅chapter节点"}
            },
            "required": ["project_id", "node_type", "title"]
        })
    }
    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        // 调用 commands::project::create_outline_node_internal
        // 返回 node_id
    }
}
```

#### 8.1.3 新增工作流定义（2 个）

**outline_generation 工作流**：

```rust
// definitions.rs 追加
pub static OUTLINE_GENERATION_WORKFLOW: Lazy<WorkflowDefinition> = Lazy::new(|| {
    WorkflowDefinition {
        workflow_id: "outline_generation".to_string(),
        name: "结构化大纲生成".to_string(),
        description: "从灵感卡片生成三级大纲（卷→章→场景）+ 伏笔依赖图".to_string(),
        default_permission_mode: PermissionMode::Supervised,
        nodes: vec![
            WorkflowNode {
                node_id: "n1".to_string(),
                agent_id: "structure_selector".to_string(),
                input_mapping: serde_json::json!({
                    "inspiration_card": "$user_input.inspiration_card",
                    "target_words": "$user_input.target_words"
                }),
                output_key: "structure".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n2".to_string(),
                agent_id: "chapter_splitter".to_string(),
                input_mapping: serde_json::json!({
                    "inspiration_card": "$user_input.inspiration_card",
                    "structure": "$node.n1.output.structure",
                    "target_words": "$user_input.target_words"
                }),
                output_key: "outline_tree".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n3".to_string(),
                agent_id: "foreshadow_planner".to_string(),
                input_mapping: serde_json::json!({
                    "outline_tree": "$node.n2.output.outline_tree"
                }),
                output_key: "foreshadow_graph".to_string(),
                parallel_group: None,
                is_checkpoint: true,  // 检查点1
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n4".to_string(),
                agent_id: "pace_reviewer".to_string(),
                input_mapping: serde_json::json!({
                    "outline_tree": "$user_input.outline_tree",  // 检查点可能修改
                    "foreshadows": "$user_input.foreshadow_graph"
                }),
                output_key: "pace_report".to_string(),
                parallel_group: None,
                is_checkpoint: true,  // 检查点2
                loop_config: None,
            },
        ],
        edges: vec![
            WorkflowEdge { from_node: "n1".to_string(), to_node: "n2".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n2".to_string(), to_node: "n3".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n3".to_string(), to_node: "n4".to_string(), data_mapping: serde_json::json!({}) },
        ],
        estimated_token_cost: 25000,
        token_estimate_key: "outline_default".to_string(),
    }
});
```

**character_dialogue 工作流**（含循环节点）：

```rust
pub static CHARACTER_DIALOGUE_WORKFLOW: Lazy<WorkflowDefinition> = Lazy::new(|| {
    WorkflowDefinition {
        workflow_id: "character_dialogue".to_string(),
        name: "角色驱动对话生成".to_string(),
        description: "多角色对话生成 + 情感曲线 + OOC检查".to_string(),
        default_permission_mode: PermissionMode::HandsOff,
        nodes: vec![
            WorkflowNode {
                node_id: "n1".to_string(),
                agent_id: "character_loader".to_string(),  // tool型Agent
                input_mapping: serde_json::json!({
                    "character_ids": "$user_input.character_ids"
                }),
                output_key: "character_profiles".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n2".to_string(),
                agent_id: "scene_setter".to_string(),
                input_mapping: serde_json::json!({
                    "scene_description": "$user_input.scene_description",
                    "dialogue_goal": "$user_input.dialogue_goal",
                    "character_profiles": "$node.n1.output.character_profiles"
                }),
                output_key: "scene_context".to_string(),
                parallel_group: None,
                is_checkpoint: true,  // supervised模式时检查点
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n3".to_string(),
                agent_id: "character_roleplayer".to_string(),  // 循环主Agent
                input_mapping: serde_json::json!({
                    "character_profiles": "$node.n1.output.character_profiles",
                    "scene_context": "$node.n2.output.scene_context",
                    "dialogue_history": "$loop.history"  // 循环历史
                }),
                output_key: "dialogue_turn".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: Some(LoopConfig {
                    max_iterations: 20,
                    exit_condition: "$node.n3_loop_ctrl.should_end",  // 由dialogue_director判定
                    loop_body_agents: vec!["character_roleplayer", "dialogue_director"],
                    loop_control_agent: "dialogue_director".to_string(),
                }),
            },
            WorkflowNode {
                node_id: "n4".to_string(),
                agent_id: "ooc_checker".to_string(),
                input_mapping: serde_json::json!({
                    "character_profiles": "$node.n1.output.character_profiles",
                    "dialogue": "$node.n3.output.dialogue"
                }),
                output_key: "ooc_report".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
        ],
        edges: vec![
            WorkflowEdge { from_node: "n1".to_string(), to_node: "n2".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n2".to_string(), to_node: "n3".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n3".to_string(), to_node: "n4".to_string(), data_mapping: serde_json::json!({}) },
        ],
        estimated_token_cost: 30000,
        token_estimate_key: "dialogue_default".to_string(),
    }
});
```

#### 8.1.4 新增命令接口

P1 阶段无新增 Tauri 命令（检查点命令 `agent_checkpoint_decision` 在 P0 已实现，P1 仅扩展使用场景）。前端 `agentListWorkflows` 会自动包含新注册的工作流。

#### 8.1.5 新增前端类型

```typescript
// types/index.ts 追加

/** 大纲节点类型 */
export type OutlineNodeType = 'volume' | 'chapter' | 'scene';

/** 大纲节点 */
export interface OutlineNode {
  id: string;
  projectId: number;
  parentId: string | null;
  nodeType: OutlineNodeType;
  title: string;
  summary: string | null;
  sortOrder: number;
  wordTarget: number | null;
  status: 'planned' | 'writing' | 'done';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** 伏笔状态 */
export type ForeshadowStatus = 'planned' | 'planted' | 'paid_off' | 'abandoned';

/** 伏笔 */
export interface Foreshadow {
  id: string;
  projectId: number;
  content: string;
  plantChapterId: string | null;
  plantSceneId: string | null;
  payoffChapterId: string | null;
  payoffSceneId: string | null;
  status: ForeshadowStatus;
  relatedForeshadows: string[];
  createdAt: string;
  updatedAt: string;
}

/** 循环节点配置 */
export interface LoopConfig {
  maxIterations: number;
  exitCondition: string;
  loopBodyAgents: string[];
  loopControlAgent: string;
}
```

#### 8.1.6 新增前端组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `OutlineTreeView` | `components/agent/OutlineTreeView.tsx` | 可折叠树形展示大纲，支持编辑节点 |
| `ForeshadowGraph` | `components/agent/ForeshadowGraph.tsx` | Mermaid 渲染伏笔依赖图 |
| `DialoguePlayer` | `components/agent/DialoguePlayer.tsx` | 对话气泡展示 + 情感曲线图表 |

---

### 8.2 P2接口（一致性管理）

**目标**：引入记忆库常驻 Agent 与一致性检查工作流，验证长篇创作的设定一致性保障。

**交付范围**：
- memory_keeper 常驻 Agent（P0 已实现基础服务，P2 扩展为跨任务常驻）
- 一致性检查工作流（`consistency_check`，写作前检索 + 写作后检查）
- 上下文检索工具（`agent.retrieve_context`）
- 一致性检查工具（`agent.check_consistency`）
- 漂移监控 Agent（`drift_monitor`）
- `story_memory` 表（P0 已建表，P2 扩展查询接口）

#### 8.2.1 新增工具处理器（3 个）

| tool_id | 签名 | 权限 | 说明 |
|---|---|---|---|
| `agent.retrieve_context` | `(project_id, query, top_k?) -> Vec<ContextFragment>` | ReadMemory + ReadDb | 综合检索：记忆库 + 设定卡 + 对话历史 + 大纲节点 |
| `agent.check_consistency` | `(project_id, chapter_content, character_ids?) -> ConsistencyReport` | ReadMemory + ReadDb | 检查章节内容与记忆库/设定卡的一致性 |
| `agent.update_memory` | `(project_id, section, data, merge_strategy) -> ()` | WriteMemory | 更新记忆库分区（P0 已实现 `agent.write_memory`，P2 重命名为 `update_memory` 并保留旧名兼容） |

**retrieve_context 参数 schema**：

```json
{
  "type": "object",
  "properties": {
    "project_id": {"type": "integer"},
    "query": {"type": "string", "description": "自然语言查询，如'主角林晚的异能描述'"},
    "top_k": {"type": "integer", "default": 5, "description": "返回的片段数量"},
    "sources": {
      "type": "array",
      "items": {"type": "string", "enum": ["memory", "setting_cards", "outline", "conversation_history"]},
      "default": ["memory", "setting_cards"]
    }
  },
  "required": ["project_id", "query"]
}
```

**check_consistency 返回结构**：

```json
{
  "consistency_report": {
    "overall_score": 0.85,
    "violations": [
      {
        "type": "character_setting",
        "severity": "high",
        "location": "第3段",
        "description": "主角林晚的异能从'时间回溯'变为'空间传送'",
        "expected": "时间回溯（来源：记忆库.characters.林晚.ability）",
        "actual": "空间传送",
        "suggestion": "修改为'时间回溯'或更新记忆库"
      },
      {
        "type": "timeline",
        "severity": "medium",
        "location": "第7段",
        "description": "事件顺序与时间线不符",
        "expected": "黑潮爆发在第1章",
        "actual": "文中提及'黑潮爆发已过半年'，但当前为第3章（灾后7天）"
      }
    ],
    "warnings": [
      {
        "type": "style_drift",
        "description": "文风从冷峻转为热血，可能与基线偏离"
      }
    ]
  }
}
```

#### 8.2.2 新增工作流（1 个）

**consistency_check 工作流**：

```rust
pub static CONSISTENCY_CHECK_WORKFLOW: Lazy<WorkflowDefinition> = Lazy::new(|| {
    WorkflowDefinition {
        workflow_id: "consistency_check".to_string(),
        name: "一致性检查".to_string(),
        description: "写作前检索相关设定 + 写作后检查章节一致性 + 漂移监控".to_string(),
        default_permission_mode: PermissionMode::HandsOff,
        nodes: vec![
            WorkflowNode {
                node_id: "n1".to_string(),
                agent_id: "context_retriever".to_string(),  // tool型
                input_mapping: serde_json::json!({
                    "project_id": "$user_input.project_id",
                    "query": "$user_input.chapter_summary",
                    "sources": ["memory", "setting_cards", "outline"]
                }),
                output_key: "context_fragments".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n2".to_string(),
                agent_id: "consistency_checker".to_string(),  // analytic
                input_mapping: serde_json::json!({
                    "chapter_content": "$user_input.chapter_content",
                    "context_fragments": "$node.n1.output.context_fragments",
                    "project_id": "$user_input.project_id"
                }),
                output_key: "consistency_report".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n3".to_string(),
                agent_id: "drift_monitor".to_string(),  // analytic
                input_mapping: serde_json::json!({
                    "chapter_content": "$user_input.chapter_content",
                    "baseline_style": "$node.n1.output.context_fragments.baseline_style"
                }),
                output_key: "drift_report".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
        ],
        edges: vec![
            WorkflowEdge { from_node: "n1".to_string(), to_node: "n2".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n1".to_string(), to_node: "n3".to_string(), data_mapping: serde_json::json!({}) },
        ],
        estimated_token_cost: 15000,
        token_estimate_key: "consistency_default".to_string(),
    }
});
```

#### 8.2.3 memory_keeper 跨任务常驻扩展

P0 阶段 memory_keeper 在工作流内被显式调用；P2 阶段扩展为**应用级常驻服务**：

```rust
// memory.rs 扩展

/// 应用启动时初始化全局记忆缓存
/// 在 lib.rs::setup 中调用
pub fn init_global_memory_service(db: &DbState) -> Result<(), String> {
    // 预加载所有项目的记忆库到 MEMORY_CACHE
    // 仅加载有最近活动的项目（最近30天有任务的项目）
}

/// 项目切换时切换记忆库缓存
/// 由前端 projectStore.currentProjectId 变化触发（通过 Tauri 事件）
pub fn switch_project_memory(project_id: i64) {
    memory::switch_project(&project_id);
}

/// 定时同步记忆库到数据库（每60秒）
/// 由 tauri::async_runtime::spawn 启动的后台任务
pub async fn memory_sync_loop(db: Arc<Mutex<Connection>>, app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(e) = memory::flush_dirty_to_db(&db) {
            log::warn!("记忆库同步失败: {}", e);
        }
    }
}
```

#### 8.2.4 新增前端类型

```typescript
/** 上下文检索片段 */
export interface ContextFragment {
  source: 'memory' | 'setting_cards' | 'outline' | 'conversation_history';
  relevanceScore: number;
  content: string;
  metadata: Record<string, unknown>;
}

/** 一致性违规 */
export interface ConsistencyViolation {
  type: 'character_setting' | 'timeline' | 'worldview' | 'plot_logic';
  severity: 'high' | 'medium' | 'low';
  location: string;
  description: string;
  expected: string;
  actual: string;
  suggestion: string;
}

/** 一致性报告 */
export interface ConsistencyReport {
  overallScore: number;
  violations: ConsistencyViolation[];
  warnings: { type: string; description: string }[];
}

/** 漂移报告 */
export interface DriftReport {
  styleDriftScore: number;
  characterDriftScore: number;
  plotDriftScore: number;
  details: string[];
}
```

#### 8.2.5 新增前端组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `ConsistencyReportView` | `components/agent/ConsistencyReportView.tsx` | 一致性报告展示（违规列表 + 严重度标记） |
| `MemoryBrowser` | `components/agent/MemoryBrowser.tsx` | 记忆库分区浏览（characters/timeline/locations/foreshadows/baseline_style） |

---

### 8.3 P3接口（百万字流水线+自定义Agent）

**目标**：引入并行执行、断点续传、后台任务、用户自定义 Agent，验证系统的长时间运行与可扩展性。

**交付范围**：
- 百万字流水线工作流（`mega_pipeline`，含并行批次调度）
- 并行执行支持（`parallel_group` 已在 P0 设计，P3 扩展为带最大并行度限制）
- 断点续传机制（P0 已实现 `agent_resume_task`，P3 扩展为并行任务恢复）
- 后台任务执行（任务在窗口最小化或切换项目时继续运行）
- 成本估算与预警
- 用户自定义 Agent CRUD + 导入导出
- `agent_definitions` 表（自定义 Agent 持久化）

#### 8.3.1 新增数据库表

**agent_definitions 表**（自定义 Agent，P0 已建表但仅用于覆盖静态定义，P3 扩展为完整 CRUD）：

```sql
CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY,                  -- UUID
    agent_id TEXT NOT NULL UNIQUE,        -- 业务ID（如 "my_custom_analyst"）
    name TEXT NOT NULL,
    category TEXT NOT NULL,               -- creative/analytic/structural/memory/tool
    description TEXT,
    system_prompt TEXT NOT NULL,
    required_tools TEXT NOT NULL DEFAULT '[]',   -- JSON数组
    optional_tools TEXT NOT NULL DEFAULT '[]',
    api_config_id INTEGER,
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    top_p REAL,
    input_schema TEXT NOT NULL,           -- JSON
    output_schema TEXT NOT NULL,          -- JSON
    version TEXT NOT NULL DEFAULT '1.0',
    project_id INTEGER,                   -- NULL=全局，非NULL=项目级
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_def_project ON agent_definitions(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_def_builtin ON agent_definitions(is_builtin);
```

#### 8.3.2 新增命令接口（5 个自定义 Agent CRUD）

| 命令名 | 签名 | 说明 |
|---|---|---|
| `agent_save_custom_agent` | `(agent_json: String) -> String` | 创建或更新自定义 Agent，返回 agent_id |
| `agent_list_custom_agents` | `(project_id: Option<i64>) -> Vec<AgentDefinition>` | 列出自定义 Agent（项目级 + 全局级） |
| `agent_delete_custom_agent` | `(agent_id: String) -> ()` | 删除自定义 Agent（内置 Agent 不可删） |
| `agent_export_agent` | `(agent_id: String) -> String` | 导出为 JSON 字符串（含完整定义） |
| `agent_import_agent` | `(json_content: String, project_id: Option<i64>) -> String` | 从 JSON 导入，返回新 agent_id |

**命令签名示例**：

```rust
#[tauri::command]
pub fn agent_save_custom_agent(
    db: State<'_, DbState>,
    agent_json: String,
) -> Result<String, String> {
    let agent: AgentDefinition = serde_json::from_str(&agent_json)
        .map_err(|e| format!("Agent定义解析失败: {}", e))?;

    // 校验：agent_id 不可与内置 Agent 冲突
    if registry::get_agent(&agent.agent_id).map(|a| a.is_builtin).unwrap_or(false) {
        return Err(format!("Agent ID '{}' 与内置 Agent 冲突", agent.agent_id));
    }

    // 校验：system_prompt 非空
    if agent.system_prompt.trim().is_empty() {
        return Err("system_prompt 不可为空".to_string());
    }

    // 写入 agent_definitions 表（INSERT OR REPLACE）
    save_custom_agent_to_db(&db, &agent)?;

    // 注册到动态注册表
    registry::register_dynamic_agent(agent.clone());

    Ok(agent.agent_id)
}

#[tauri::command]
pub fn agent_export_agent(
    db: State<'_, DbState>,
    agent_id: String,
) -> Result<String, String> {
    let agent = registry::get_agent(&agent_id)
        .ok_or_else(|| format!("Agent '{}' 未找到", agent_id))?;

    // 导出为 JSON（含 version 与 export_time 标记）
    let export_data = serde_json::json!({
        "agent": agent,
        "export_time": chrono::Utc::now().to_rfc3339(),
        "whisper_version": env!("CARGO_PKG_VERSION"),
    });

    serde_json::to_string_pretty(&export_data)
        .map_err(|e| format!("序列化失败: {}", e))
}
```

#### 8.3.3 新增工作流（百万字流水线）

**mega_pipeline 工作流**（简化版，实际实现按章节批次调度）：

```rust
pub static MEGA_PIPELINE_WORKFLOW: Lazy<WorkflowDefinition> = Lazy::new(|| {
    WorkflowDefinition {
        workflow_id: "mega_pipeline".to_string(),
        name: "百万字流水线".to_string(),
        description: "批量章节生成 + 段落拼接 + 一致性检查 + 记忆库更新".to_string(),
        default_permission_mode: PermissionMode::Autopilot,
        nodes: vec![
            WorkflowNode {
                node_id: "n1".to_string(),
                agent_id: "macro_planner".to_string(),  // structural
                input_mapping: serde_json::json!({
                    "outline_tree": "$user_input.outline_tree",
                    "target_words": "$user_input.target_words"
                }),
                output_key: "volume_plan".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n2".to_string(),
                agent_id: "volume_planner".to_string(),  // structural
                input_mapping: serde_json::json!({
                    "volume_plan": "$node.n1.output.volume_plan",
                    "memory": "$user_input.memory_snapshot"
                }),
                output_key: "chapter_batches".to_string(),
                parallel_group: None,
                is_checkpoint: true,  // 用户确认批次计划
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n3".to_string(),
                agent_id: "chapter_writer".to_string(),  // creative
                input_mapping: serde_json::json!({
                    "chapter_batch": "$loop.current_batch",
                    "context": "$node.n1.output.volume_plan"
                }),
                output_key: "chapters".to_string(),
                parallel_group: Some("chapter_writing".to_string()),
                is_checkpoint: false,
                loop_config: Some(LoopConfig {
                    max_iterations: 100,  // 最多100章
                    exit_condition: "$loop.batches_completed",
                    loop_body_agents: vec!["chapter_writer"],
                    loop_control_agent: "chapter_writer".to_string(),  // 自驱动
                }),
            },
            WorkflowNode {
                node_id: "n4".to_string(),
                agent_id: "chapter_stitcher".to_string(),  // structural
                input_mapping: serde_json::json!({
                    "chapters": "$node.n3.output.chapters"
                }),
                output_key: "stitched_volume".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
            WorkflowNode {
                node_id: "n5".to_string(),
                agent_id: "consistency_checker".to_string(),  // 复用P2
                input_mapping: serde_json::json!({
                    "volume_content": "$node.n4.output.stitched_volume",
                    "project_id": "$user_input.project_id"
                }),
                output_key: "final_report".to_string(),
                parallel_group: None,
                is_checkpoint: false,
                loop_config: None,
            },
        ],
        edges: vec![
            WorkflowEdge { from_node: "n1".to_string(), to_node: "n2".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n2".to_string(), to_node: "n3".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n3".to_string(), to_node: "n4".to_string(), data_mapping: serde_json::json!({}) },
            WorkflowEdge { from_node: "n4".to_string(), to_node: "n5".to_string(), data_mapping: serde_json::json!({}) },
        ],
        estimated_token_cost: 500000,  // 百万字预估50万token
        token_estimate_key: "mega_pipeline".to_string(),
    }
});
```

#### 8.3.4 并行执行扩展

P0 的 `parallel_group` 设计为简单并行（同组节点同时执行）；P3 扩展为带**最大并行度限制**：

```rust
// pipeline.rs 扩展

pub struct PipelineEngine {
    // ... 现有字段
    max_parallelism: usize,  // 默认3，可在agent_settings中配置
}

impl PipelineEngine {
    /// 执行并行组，限制最大并行度
    async fn execute_parallel_group(
        &mut self,
        nodes: Vec<&WorkflowNode>,
    ) -> Result<Vec<NodeOutput>, String> {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(self.max_parallelism));
        let mut handles = vec![];

        for node in nodes {
            let permit = semaphore.clone().acquire_owned().await
                .map_err(|e| format!("获取信号量失败: {}", e))?;
            let node_clone = node.clone();
            handles.push(tokio::spawn(async move {
                let _permit = permit;  // RAII释放
                // 执行节点...
                execute_node(&node_clone).await
            }));
        }

        let mut results = vec![];
        for handle in handles {
            results.push(handle.await
                .map_err(|e| format!("任务panic: {}", e))??);
        }
        Ok(results)
    }
}
```

#### 8.3.5 断点续传扩展

P0 的 `agent_resume_task` 仅支持串行节点恢复；P3 扩展为**并行任务恢复**：

```rust
// pipeline.rs 扩展

impl PipelineEngine {
    /// 从断点恢复执行
    pub async fn resume_from_checkpoint(&mut self) -> Result<(), String> {
        // 1. 从 agent_tasks 表读取 completed_nodes
        let completed: HashSet<String> = self.task.get_completed_nodes();

        // 2. 跳过已完成节点，从下一个待执行节点开始
        let pending_nodes: Vec<&WorkflowNode> = self.workflow.nodes()
            .iter()
            .filter(|n| !completed.contains(&n.node_id))
            .collect();

        // 3. 检查依赖：待执行节点的上游必须全部完成
        for node in &pending_nodes {
            for edge in self.workflow.edges() {
                if edge.to_node == node.node_id && !completed.contains(&edge.from_node) {
                    return Err(format!("节点 {} 的上游 {} 未完成", node.node_id, edge.from_node));
                }
            }
        }

        // 4. 按拓扑序执行待执行节点
        self.execute_nodes_in_order(pending_nodes).await
    }
}
```

#### 8.3.6 成本估算与预警

```rust
// commands.rs 新增

/// 预估任务成本（token数与费用）
#[tauri::command]
pub fn agent_estimate_cost(
    workflow_id: String,
    input_json: String,
) -> Result<CostEstimate, String> {
    let workflow = registry::get_workflow(&workflow_id)
        .ok_or_else(|| format!("工作流 {} 未注册", workflow_id))?;
    let input: serde_json::Value = serde_json::from_str(&input_json)
        .map_err(|e| format!("输入解析失败: {}", e))?;

    let estimated_tokens = workflow.estimated_token_cost(&input);
    let estimated_cost_usd = estimate_cost(estimated_tokens);

    Ok(CostEstimate {
        estimated_tokens,
        estimated_cost_usd,
        warning_threshold: 100000,  // 10万token预警
        is_warning: estimated_tokens > 100000,
    })
}

#[derive(Serialize)]
pub struct CostEstimate {
    pub estimated_tokens: i64,
    pub estimated_cost_usd: f64,
    pub warning_threshold: i64,
    pub is_warning: bool,
}
```

#### 8.3.7 新增前端类型与组件

```typescript
/** 自定义 Agent 编辑器输入 */
export interface CustomAgentInput {
  agentId: string;
  name: string;
  category: AgentCategory;
  description: string;
  systemPrompt: string;
  requiredTools: string[];
  optionalTools: string[];
  temperature: number;
  maxTokens: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  projectId: number | null;
}

/** 成本预估 */
export interface CostEstimate {
  estimatedTokens: number;
  estimatedCostUsd: number;
  warningThreshold: number;
  isWarning: boolean;
}
```

| 组件 | 路径 | 职责 |
|---|---|---|
| `CustomAgentEditor` | `components/agent/CustomAgentEditor.tsx` | 自定义 Agent 编辑器（提示词/工具选择/参数配置） |
| `AgentImportExport` | `components/agent/AgentImportExport.tsx` | Agent 导入导出 UI |
| `CostEstimateDialog` | `components/agent/CostEstimateDialog.tsx` | 成本预估弹窗（任务发起前展示） |
| `BatchProgressView` | `components/agent/BatchProgressView.tsx` | 批量章节进度展示（百万字流水线） |

#### 8.3.8 lib.rs 命令注册扩展

P3 阶段在 `generate_handler!` 中追加：

```rust
// src-tauri/src/lib.rs
generate_handler![
    // ... P0 命令（13个）
    // ... P1 命令（0个新增）
    // ... P2 命令（0个新增）
    // P3 新增命令（6个）
    agents::commands::agent_save_custom_agent,
    agents::commands::agent_list_custom_agents,
    agents::commands::agent_delete_custom_agent,
    agents::commands::agent_export_agent,
    agents::commands::agent_import_agent,
    agents::commands::agent_estimate_cost,
]
```

---

## 9. 集成测试场景

本章定义 P0 阶段的端到端集成测试场景，验证 Pipeline 引擎、executor、工具适配层、检查点机制、错误恢复等核心功能的协同工作。测试以**场景驱动**方式描述，每个场景包含：测试目标、前置条件、操作步骤、预期结果、验收标准。

**测试原则**：

1. **真实 LLM 调用**：测试使用真实 LLM API（非 Mock），验证提示词与输出解析的稳定性。建议使用低成本模型（如 GPT-4o-mini）进行回归测试。
2. **数据库隔离**：每个测试场景使用独立的临时项目（`project_id` 由测试 setup 创建），避免污染真实数据。
3. **断言柔性化**：LLM 输出具有非确定性，测试断言聚焦结构正确性而非内容精确匹配（如断言 `dimensions` 数组长度 >= 1，而非具体内容）。
4. **超时容忍**：LLM 调用可能耗时较长，单节点超时设置为 60 秒，整个工作流超时 5 分钟。

---

### 9.1 灵感矩阵端到端测试

**测试目标**：验证灵感矩阵工作流（`inspiration_matrix`）从用户输入到最终产出的完整流程，包括 5 个节点的串并行执行、记忆库查询、检查点交互、中间产出文件落盘。

**前置条件**：

1. 应用已启动，存在至少一个 API 配置（`is_default=true`）
2. 测试 setup 创建临时项目（name="灵感矩阵测试项目"，genre="玄幻"）
3. 测试项目记忆库为空（新项目，n2 返回空 `memory_snapshot`）
4. 前端 `AgentWorkspace` 组件已挂载，`agentStore` 已初始化

**操作步骤**：

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 在 `AgentTaskPanel` 选择工作流"灵感矩阵生成" | 显示输入表单（keywords 数组输入 + style_variants 配置） |
| 2 | 输入 keywords=["末世", "学园", "异能"]，style_variants=[{name:"冷峻写实", features:"短句克制"}, {name:"热血燃向", features:"动作密集"}] | 表单数据写入 agentStore.taskInput |
| 3 | 选择权限模式 "hands_off"（不干预） | permissionMode='hands_off' |
| 4 | 点击"开始任务"按钮 | 调用 `agent_start_task`，返回 task_id；Pipeline 启动；`PipelineVisualizer` 显示 n1 为 running |
| 5 | 等待 n1（keyword_analyst）完成 | n1 状态变为 completed；NodeCard 展示 dimensions 摘要；n2、n3 同时进入 running（并行组 after_n1） |
| 6 | 等待 n2（memory_keeper）完成 | n2 状态 completed；因记忆库为空，memory_snapshot={}；n2 应快速完成（< 2 秒，无 LLM 调用） |
| 7 | 等待 n3（idea_diverger）完成 | n3 状态 completed；NodeCard 展示 divergence 摘要（含 15-40 个灵感点）；token 计数器更新 |
| 8 | 等待 n4（inspiration_combiner）完成 | n4 状态 completed；因 hands_off 模式，不暂停，自动选择 estimated_potential>=0.7 的种子；NodeCard 展示 seeds 摘要 |
| 9 | 等待 n5（inspiration_matrix_writer）完成 | n5 状态 completed；NodeCard 展示 drafts 摘要；Pipeline 整体状态变为 done |
| 10 | 检查 `AgentOutputViewer` | 显示中间产出文件列表：n1_keyword_analyst.md, n3_idea_diverger.md, n4_inspiration_combiner.md, n5_drafts.md, n5_drafts.json |
| 11 | 点击 n5_drafts.md | 展示所有种子×文风的短文样本（Markdown 渲染） |
| 12 | 检查 `agent_tasks` 表 | task 记录 status='completed'，total_tokens > 0，completed_nodes 包含全部 5 个节点 |

**验收标准**：

- [ ] 5 个节点全部完成，无失败
- [ ] n2（memory_keeper）执行时间 < 2 秒（工具型 Agent 不调用 LLM）
- [ ] n3 的 divergence 数组长度 >= 15（至少 3 个维度 × 5 个灵感点）
- [ ] n4 的 seeds 数组长度 >= 5
- [ ] n5 的 drafts 数组长度 = 选中种子数 × 文风变体数（如 2×2=4）
- [ ] 每篇 draft 的 word_count 在 800-1500 之间
- [ ] 中间产出文件全部落盘，路径符合 `{output_dir}/n{X}_{agent_id}.md` 规范
- [ ] total_tokens 在预估范围 6000-20000 内（[6.1.5 token 预估](#615-token-预估)）
- [ ] 前端 `agent:chunk` / `agent:progress` / `agent:done` 事件全部触发，无监听器泄漏（StrictMode 兼容）

**异常分支测试**：

- **keywords 为空数组**：`agent_start_task` 应返回参数校验错误，不启动 Pipeline
- **keywords 超过 8 个**：输入校验失败，返回 `keywords 长度超过上限 8`
- **n1 LLM 输出非 JSON**：重试 3 次后降级为 `structured=None`，content 保留原文；Pipeline 标记 n1 为 failed，但根据错误处理策略（[6.1.4](#614-错误处理策略)）允许降级继续或终止

---

### 9.2 改写润色并行测试

**测试目标**：验证改写润色工作流（`rewrite_polish`）的串行执行与文风特征传递，特别是 r1 的 `style_features` 如何被 r2 和 r3 复用。

**前置条件**：

1. 存在默认 API 配置
2. 测试项目记忆库 `baseline_style` 分区为空（首次改写）
3. 准备测试文本：
   - `sample_text`：500-2000 字的文风样本（如一段冷峻风格的玄幻小说）
   - `target_text`：500-2000 字的待改写文本（如一段口语化的故事）

**操作步骤**：

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 选择工作流"多视角改写润色" | 显示输入表单（sample_text + target_text + project_id） |
| 2 | 输入测试文本，选择权限模式 "hands_off" | 表单数据就绪 |
| 3 | 点击"开始任务" | Pipeline 启动；r1 进入 running |
| 4 | 等待 r1（style_analyzer）完成 | r1 状态 completed；style_features 展示五维特征；r1 调用了 `agent.read_memory` 查询 baseline_style（返回空） |
| 5 | r2（style_rewriter）自动开始 | r2 状态 running；输入包含 original_text + r1.style_features |
| 6 | 等待 r2 完成 | r2 状态 completed；rewritten_text.content 为改写后文本；changes_summary.preserved_semantics >= 0.9 |
| 7 | r3（style_polisher）自动开始 | r3 状态 running；输入包含 r2.rewritten_text + r1.style_features |
| 8 | 等待 r3 完成 | r3 状态 completed；final_text.content 为润色定稿；Pipeline 整体 done |
| 9 | 检查 `AgentOutputViewer` | 显示 r1_style_features.json, r2_rewritten_text.md, r3_final_text.md, r3_final_text.json |
| 10 | 检查记忆库写入 | r3 完成后，`agent.write_memory` 被调用，baseline_style 分区更新为 r1 的 style_features（供下次改写复用） |

**验收标准**：

- [ ] 3 个节点全部完成，串行执行（r1 → r2 → r3）
- [ ] r1 的 style_features 包含全部五维字段（sentence_length / vocabulary / rhetoric / tone / pacing / summary）
- [ ] r1 调用 `agent.read_memory` 查询 baseline_style（返回空对象，不报错）
- [ ] r2 的 rewritten_text.word_count 与 target_text 字数差异 <= 30%
- [ ] r2 的 changes_summary.preserved_semantics >= 0.9
- [ ] r3 的 final_text.word_count 与 r2 的 rewritten_text 差异 <= 10%
- [ ] r3 的 style_consistency_score >= 0.6（否则触发降级，保留 r2 输出）
- [ ] r3 完成后，记忆库 baseline_style 分区被更新（下次改写可直接复用）
- [ ] total_tokens 在预估范围 6000-20000 内（[6.2.5 token 预估](#625-token-预估)）

**记忆库联动测试**：

- **首次改写**：r1 查询 baseline_style 返回空，基于 sample_text 分析；r3 完成后写入 baseline_style
- **二次改写**（同项目）：r1 查询 baseline_style 返回上次的特征，作为参考纳入分析；r3 完成后用加权融合更新 baseline_style（[6.2.6 与记忆库的联动](#626-与记忆库的联动可选)）

---

### 9.3 检查点交互测试

**测试目标**：验证检查点机制在 supervised 模式下的完整交互流程，包括 Pipeline 暂停、前端弹窗、用户决策、Pipeline 恢复。

**前置条件**：

1. 存在默认 API 配置
2. 测试项目已创建
3. 使用灵感矩阵工作流，权限模式设为 "supervised"

**操作步骤**：

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 启动灵感矩阵任务，权限模式 "supervised" | Pipeline 启动，n1-n4 正常执行 |
| 2 | 等待 n4（inspiration_combiner，检查点）完成 | n4 状态变为 checkpoint_pending；Pipeline 暂停，等待用户决策；前端 `CheckpointDialog` 弹窗显示 seeds 列表 |
| 3 | 在弹窗中查看 seeds 详情 | 每个种子展示 title / synopsis / estimated_potential / tags；可勾选多个种子 |
| 4 | 修改某个种子的 synopsis（编辑功能） | 编辑后的内容写入 `modified_input.seeds` |
| 5 | 勾选 2 个种子，点击"继续"按钮 | 调用 `agent_checkpoint_decision`，decision=Continue{modified_input:{selected_seeds:["s1","s2"]}}；Pipeline 恢复，n5 进入 running |
| 6 | 等待 n5 完成 | Pipeline 整体 done；drafts 仅包含选中种子的短文 |
| 7 | 检查 `agent_tasks` 表 | task 记录 status='completed'；current_node_id 最终为 n5；completed_nodes 包含 n1-n5 |

**决策分支测试**：

| 决策类型 | 操作 | 预期结果 |
|---|---|---|
| **Continue（无修改）** | 不修改任何内容，直接点击"继续" | Pipeline 使用 n4 原始输出继续 n5 |
| **Continue（修改输入）** | 修改 seeds 或 selected_seeds，点击"继续" | Pipeline 使用修改后的输入继续 n5 |
| **Skip** | 点击"跳过此节点" | n5 使用默认输入（所有 estimated_potential>=0.7 的种子）继续，跳过用户选择 |
| **Abort** | 点击"中止任务" | Pipeline 终止；task status='cancelled'；`agent:done` 事件触发，status='cancelled' |
| **超时未决策** | 5 分钟内无操作 | task 状态保持 'checkpoint_pending'；前端显示"等待决策"提示；用户可随时决策（无超时强制终止） |

**验收标准**：

- [ ] supervised 模式下，n4 完成后 Pipeline 确实暂停（n5 不自动开始）
- [ ] `CheckpointDialog` 正确展示 seeds 列表，支持勾选与编辑
- [ ] 4 种决策类型（Continue/Skip/Abort/Continue+修改）全部正常工作
- [ ] 决策提交后，Pipeline 在 1 秒内恢复执行
- [ ] `CHECKPOINT_SENDERS` 全局表正确管理 Sender：注册→提交决策后取出→发送→evict
- [ ] 决策后 `agent_tasks` 表的 `current_node_id` 与 `completed_nodes` 正确更新
- [ ] Abort 决策触发 `CancellationToken`，Pipeline 在 2 秒内完全终止（无残留任务）

**多检查点串联测试**（P1 场景，P0 仅验证单检查点）：

- P1 的 `outline_generation` 工作流有 2 个检查点（n3、n4），验证用户在第一个检查点决策后，Pipeline 恢复并执行到第二个检查点时再次暂停

---

### 9.4 错误恢复测试

**测试目标**：验证 Pipeline 在各类错误场景下的恢复能力，包括 LLM 调用失败、工具调用失败、节点超时、任务崩溃恢复。

**测试场景**：

#### 9.4.1 LLM 调用失败

| 场景 | 触发方式 | 预期处理 | 验收标准 |
|---|---|---|---|
| API 返回 401（认证失败） | 临时删除 API 配置的 api_key | 重试 3 次后标记节点 failed；Pipeline 根据 [6.1.4 错误处理策略](#614-错误处理策略) 决定降级或终止 | 节点 status='failed'；error_log 记录"API 认证失败"；前端展示错误提示 |
| API 返回 429（限流） | 短时间内高频调用 | 重试 3 次，每次间隔 2 秒；仍失败则降级 | 重试日志可见；最终失败时 error_log 记录"API 限流" |
| API 返回 500（服务端错误） | Mock API 返回 500 | 重试 3 次；仍失败则降级 | 同上 |
| LLM 输出非 JSON | 使用低温度 + 短 max_tokens 强制截断输出 | `parse_structured_output` 返回 None；重试时追加"请严格按格式输出"提示；3 次后降级为 content 原文 | 节点 status='completed' 但 structured=None；content 保留原文 |

#### 9.4.2 工具调用失败

| 场景 | 触发方式 | 预期处理 | 验收标准 |
|---|---|---|---|
| 工具参数校验失败 | LLM 生成缺少 required 字段的参数 | `ToolHandler::execute` 返回 Err；错误信息追加到 user 消息，LLM 重新生成参数 | 工具调用循环继续，最多 5 次后强制返回 |
| 工具内部函数失败 | `agent.query_setting_cards` 查询不存在的 project_id | 返回空数组（容错），不报错 | 工具调用成功，result 为空列表 |
| 工具权限不足 | 工具需要 WriteDb 权限但权限模式为 hands_off 且工具 is_dangerous=true | 拒绝执行，返回"权限不足"错误 | 工具调用失败，LLM 收到错误信息后调整策略 |
| 工具调用超时 | 工具内部函数执行超过 30 秒 | 超时后返回"工具执行超时"错误 | 同上 |

#### 9.4.3 节点超时

| 场景 | 触发方式 | 预期处理 | 验收标准 |
|---|---|---|---|
| 单节点超时 | 设置节点 timeout=5 秒，LLM 调用耗时 10 秒 | `tokio::time::timeout` 触发；节点标记 failed；Pipeline 根据错误处理策略降级或终止 | 节点 status='failed'；error_log 记录"节点执行超时" |
| 整体工作流超时 | 设置 Pipeline 总超时=30 秒，工作流预计 60 秒 | 30 秒后强制终止所有运行中节点；task status='timeout' | task status='timeout'；`agent:done` 事件触发，status='timeout' |

#### 9.4.4 任务崩溃恢复

**测试目标**：验证应用崩溃或重启后，未完成的任务能通过 `agent_resume_task` 恢复执行。

**操作步骤**：

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 启动灵感矩阵任务，等待 n1-n3 完成 | n1-n3 status='completed'，n4 running |
| 2 | 强制关闭应用（Task Manager 结束进程） | 应用终止；数据库中 task status 仍为 'running'，completed_nodes=[n1,n2,n3] |
| 3 | 重新启动应用 | 应用正常加载；`list_tasks` 返回该任务，状态为 'running'（但实际无 Pipeline 在执行） |
| 4 | 在 `TaskHistoryList` 点击"恢复"按钮 | 调用 `agent_resume_task`；Pipeline 从 n4 恢复执行（跳过已完成的 n1-n3） |
| 5 | 等待 n4、n5 完成 | Pipeline 整体 done；task status='completed' |

**验收标准**：

- [ ] 应用崩溃后，`agent_tasks` 表中的 task 记录未被删除（status 保持 'running'）
- [ ] `completed_nodes` 字段正确记录了崩溃前已完成的节点
- [ ] `agent_resume_task` 能从断点恢复，跳过已完成节点
- [ ] 恢复后 Pipeline 的 `node_outputs` 上下文从数据库重建（n1-n3 的产出可访问）
- [ ] 恢复后的任务最终完成时，`completed_at` 字段更新为恢复后的完成时间
- [ ] 恢复过程中的 token 计数累加到 `total_tokens`（不重置）

**检查点崩溃恢复**：

- 若崩溃发生在检查点等待期间（status='checkpoint_pending'），恢复后 Pipeline 重新注册 `CHECKPOINT_SENDERS`，前端重新弹出 `CheckpointDialog`
- 用户决策后，Pipeline 从检查点后的节点继续执行

#### 9.4.5 事件监听器泄漏测试

**测试目标**：验证前端事件监听器在 React StrictMode 双调用场景下不重复监听。

**操作步骤**：

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 在开发模式（StrictMode 开启）下挂载 `AgentWorkspace` 组件 | `useEffect` 触发两次（StrictMode 双调用） |
| 2 | 检查 `agentStore.initAgentListeners` 调用次数 | 调用 2 次，但 cleanup 函数也调用 2 次 |
| 3 | 启动一个任务，监听 `agent:chunk` 事件 | 前端只接收一次每个 chunk 事件（无重复渲染） |
| 4 | 卸载组件后重新挂载 | 监听器重新注册，无残留旧监听器 |

**验收标准**：

- [ ] `initAgentListeners` 返回的组合清理函数在 `useEffect` cleanup 中正确调用
- [ ] 同一事件不会被多个监听器处理（通过 `console.log` 计数验证）
- [ ] 组件卸载后，`agent:*` 事件不再触发任何回调（无内存泄漏）

---

### 9.5 测试自动化建议

**手动测试**：P0 阶段以手动测试为主，通过前端 UI 触发任务并人工验证结果。

**自动化测试方向**（P1+ 引入）：

1. **Rust 单元测试**：在 `src-tauri/src/agents/` 模块下添加 `#[cfg(test)]` 模块，测试工具处理器、Pipeline 引擎、记忆库服务等纯逻辑部分（不依赖 LLM）。
2. **Mock LLM 测试**：在 `executor.rs` 中抽象 `LLMClient` trait，测试时注入 Mock 实现，返回预设的 JSON 输出，验证消息组装、工具调用循环、输出解析等逻辑。
3. **端到端测试**：使用 Playwright 或 Tauri WebDriver 驱动前端，模拟用户操作（选择工作流、输入参数、点击开始、处理检查点），验证完整流程。
4. **回归测试套件**：建立固定输入（如标准 keywords=["末世","学园","异能"]）的回归测试，每次提示词修改后运行，对比输出结构是否稳定。

**测试数据管理**：

- 测试项目与测试 API 配置存储在独立的 `whisper_test.db` 中（通过环境变量 `WHISPER_DB_PATH` 指定）
- 测试 setup 自动创建临时项目，测试 teardown 自动清理（`DELETE FROM projects WHERE name LIKE '测试_%'`）
- 中间产出文件存储在临时目录（`{temp_dir}/whisper_test_outputs/`），测试后清理

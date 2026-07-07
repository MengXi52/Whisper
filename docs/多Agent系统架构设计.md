# 多Agent系统架构设计

> **版本**: 0.1 (草稿)
> **日期**: 2026-07-06
> **状态**: 撰写中
> **前置文档**: [多Agent写作助手需求规格说明书](./多Agent写作助手需求规格说明书.md)

---

## 目录

1. [架构概述](#1-架构概述)
2. [Rust后端架构](#2-rust后端架构)
3. [前端架构](#3-前端架构)
4. [接口设计](#4-接口设计)
5. [关键技术决策](#5-关键技术决策)
6. [数据流详解](#6-数据流详解)
7. [与现有系统的集成](#7-与现有系统的集成)
8. [开发规范与约束](#8-开发规范与约束)

---

## 1. 架构概述

### 1.1 与现有系统的关系

多Agent系统作为Whisper项目的**独立新模块**，与现有Chat系统并行存在，遵循"共享基础设施、隔离执行逻辑"的原则。

**共享层**（复用现有实现）：
- 数据库连接（`DbState`，同一SQLite文件）
- LLM客户端基础设施（reqwest + SSE模式）
- Tauri应用容器与事件系统
- 前端组件库（Toast、Button、Markdown渲染等）
- API配置数据（`api_configs`表）

**隔离层**（独立实现）：
- Rust模块：新增 `agents/` 目录，与 `commands/`、`llm/` 平级
- Tauri命令：独立命名空间（`agent_*` 前缀），不复用Chat命令
- 前端Store：新增 `agentStore.ts`，与 `chatStore.ts` 独立
- 前端组件：新增 `components/agent/` 目录
- 事件协议：新增 `agent:*` 事件命名空间
- 工具函数：新增 `tool_agent_*` 系列函数，与现有 `tool_*` 隔离

**演进关系**：Agent系统独立开发迭代，不影响Chat系统稳定性。未来可考虑在Chat中触发Agent任务，但属于后续扩展。

### 1.2 架构总览图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (React + Zustand)                    │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  ChatView       │  │  AgentTaskPanel │  │  SettingsPanel  │  │
│  │  chatStore      │  │  agentStore     │  │  (权限模式配置) │  │
│  │  chat:chunk     │  │  agent:* 事件   │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘  │
│           │                    │                                  │
│           └──────────┬─────────┘                                  │
│                      ▼                                            │
│           ┌─────────────────────┐                                 │
│           │  utils/tauri.ts     │  (统一invoke封装)               │
│           └──────────┬──────────┘                                 │
└──────────────────────┼───────────────────────────────────────────┘
                       │ Tauri IPC (扁平参数, camelCase↔snake_case)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Rust后端 (Tauri 2.0)                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    lib.rs (命令注册)                         │ │
│  │  generate_handler![                                          │ │
│  │    // Chat命令 (现有38个)                                    │ │
│  │    commands::chat::*, commands::project::*, ...              │ │
│  │    // Agent命令 (新增)                                       │ │
│  │    agents::commands::*                                       │ │
│  │  ]                                                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │  现有模块         │  │  agents/ (新增模块)                   │ │
│  │                  │  │                                      │ │
│  │  commands/       │  │  ├── mod.rs          (模块声明)       │ │
│  │  ├── chat.rs     │  │  ├── commands.rs     (Tauri命令层)    │ │
│  │  ├── project.rs  │  │  ├── registry.rs     (Agent注册表)    │ │
│  │  ├── settings.rs │  │  ├── tools.rs        (工具适配层)     │ │
│  │  └── ...         │  │  ├── pipeline.rs     (执行引擎)       │ │
│  │                  │  │  ├── executor.rs     (Agent执行器)    │ │
│  │  llm/            │  │  ├── memory.rs       (记忆库服务)     │ │
│  │  ├── client.rs   │  │  ├── definitions.rs  (内置定义)       │ │
│  │  └── prompt.rs   │  │  └── models.rs       (Agent数据模型)  │ │
│  │                  │  │                                      │ │
│  │  db.rs           │  └──────────────────────────────────────┘ │
│  │  models.rs       │                                             │
│  │  logger.rs       │  ┌──────────────────────────────────────┐ │
│  │                  │  │  共享基础设施 (复用)                  │ │
│  └──────────────────┘  │  DbState, CancellationTokenState     │ │
│                        │  llm::client::stream_chat (复用核心)  │ │
│                        │  logger宏, chrono, uuid               │ │
│                        └──────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    SQLite数据库                              │ │
│  │  现有表: projects, chapters, setting_cards, conversations,  │ │
│  │          messages, skills, api_configs, ...                  │ │
│  │  新增表: agent_definitions, agent_tasks, agent_tool_calls,   │ │
│  │          story_memory, foreshadows                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 设计原则

1. **最小侵入**：不修改现有模块的代码，仅通过 `lib.rs` 注册新命令、`db.rs` 新增表
2. **函数级复用**：复用现有Rust函数（如 `settings::create_card` 的内部逻辑），不通过Tauri命令复用
3. **事件隔离**：Agent事件使用 `agent:*` 前缀，与 `chat:chunk` 隔离，避免监听器冲突
4. **扁平参数**：遵循Tauri 2.0约束，所有命令参数扁平化，无嵌套struct
5. **同步DB + 异步执行**：数据库操作保持同步（rusqlite + Mutex），LLM调用和Pipeline编排用tokio异步
6. **渐进式实现**：按P0-P3路线图分阶段交付，每阶段可独立编译运行

---

## 2. Rust后端架构

### 2.1 模块划分

在 `src-tauri/src/` 下新增 `agents/` 目录，与现有 `commands/`、`llm/` 平级。在 [lib.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/lib.rs) 顶部添加 `mod agents;` 声明。

```
src-tauri/src/agents/
├── mod.rs              # 模块声明 + 公共重导出
├── models.rs           # Agent系统的数据结构定义
├── definitions.rs      # 内置Agent/工具/工作流的静态定义
├── registry.rs         # Agent注册表 + 工具注册表 + 工作流注册表
├── commands.rs         # Tauri命令层 (agent_* 前缀)
├── executor.rs         # Agent执行器 (单个Agent的LLM调用+工具循环)
├── pipeline.rs         # Pipeline执行引擎 (DAG编排+状态机+检查点)
├── tools.rs            # 工具适配层 (权限校验+分发+缓存)
└── memory.rs           # 记忆库服务 (memory_keeper常驻)
```

**模块职责**：

| 模块 | 职责 | 依赖 |
|---|---|---|
| `models.rs` | 定义 `AgentDefinition`、`ToolDefinition`、`WorkflowDefinition`、`TaskContext` 等struct | serde, chrono |
| `definitions.rs` | 静态声明27个内置Agent、20个原生工具、6个工作流 | models, registry |
| `registry.rs` | 提供 `get_agent(id)`、`get_tool(id)`、`get_workflow(id)` 查询接口，合并静态+动态注册表 | models, definitions, db |
| `commands.rs` | 暴露给前端的Tauri命令（任务发起、查询、控制） | pipeline, registry, db |
| `executor.rs` | 执行单个Agent：组装messages、调用LLM、处理工具调用循环、返回产出 | llm::client, tools |
| `pipeline.rs` | Pipeline编排：解析DAG、调度节点、管理状态机、检查点、错误处理 | executor, registry, models |
| `tools.rs` | 工具调用适配层：权限校验、参数校验、分发到内部函数、缓存 | db, models |
| `memory.rs` | memory_keeper常驻服务：加载/查询/更新记忆库 | db, models |

**依赖关系图**：
```
commands.rs ──→ pipeline.rs ──→ executor.rs ──→ llm::client (现有)
     │              │               │                │
     │              │               └──→ tools.rs ──→┘ (工具调用)
     │              │                      │
     │              │                      └──→ db.rs (复用)
     │              │                      └──→ commands/settings.rs (内部函数复用)
     │              │                      └──→ commands/project.rs (内部函数复用)
     │              │
     │              ├──→ registry.rs ──→ definitions.rs (静态)
     │              │         └──→ db.rs (动态agent_definitions表)
     │              │
     │              └──→ memory.rs ──→ db.rs (story_memory表)
     │
     └──→ db.rs (agent_tasks表)
```

### 2.2 核心Trait定义

Agent系统定义三个核心trait，描述Agent、工具、工作流的行为契约。

#### 2.2.1 AgentExecutor Trait

```rust
/// Agent执行器的行为契约
/// 每个Agent实例实现此trait，由Pipeline引擎调用
pub trait AgentExecutor: Send + Sync {
    /// Agent的唯一标识
    fn agent_id(&self) -> &str;

    /// Agent的分类
    fn category(&self) -> AgentCategory;

    /// 获取系统提示词（支持变量插值）
    fn system_prompt(&self, context: &TaskContext) -> String;

    /// 获取允许调用的工具定义（传给LLM）
    fn available_tools(&self) -> Vec<serde_json::Value>;

    /// 获取模型参数
    fn model_params(&self) -> ModelParams;

    /// 获取API配置（None表示用项目默认）
    fn api_config_id(&self) -> Option<i64>;

    /// 执行Agent（由executor.rs的通用实现提供，通常不需要手动实现）
    fn execute(
        &self,
        context: &mut TaskContext,
        input: serde_json::Value,
        app: &AppHandle,
        db: &DbState,
        cancel_token: &CancellationTokenState,
    ) -> Result<AgentOutput, String>;
}
```

#### 2.2.2 ToolHandler Trait

```rust
/// 工具处理器的行为契约
/// 每个原生工具实现此trait，由工具适配层调用
pub trait ToolHandler: Send + Sync {
    /// 工具的唯一标识（如 "agent.create_setting_card"）
    fn tool_id(&self) -> &str;

    /// 工具的LLM可见描述
    fn description(&self) -> &str;

    /// 工具的参数schema（JSON Schema格式，传给LLM）
    fn parameters_schema(&self) -> serde_json::Value;

    /// 工具所需的权限
    fn required_permission(&self) -> ToolPermission;

    /// 是否可缓存
    fn cacheable(&self) -> bool { false }

    /// 是否为高风险操作（影响检查点判定）
    fn is_dangerous(&self) -> bool { false }

    /// 执行工具
    fn execute(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, String>;
}

/// 工具执行上下文
pub struct ToolContext<'a> {
    pub task_id: String,
    pub agent_id: String,
    pub db: &'a DbState,
    pub project_id: i64,
    pub output_dir: std::path::PathBuf,  // 中间产出目录
}

/// 工具执行结果
pub struct ToolResult {
    pub content: String,           // 返回给LLM的文本内容
    pub structured: Option<serde_json::Value>,  // 结构化数据（可选）
    pub cacheable_result: bool,    // 此次结果是否值得缓存
}
```

#### 2.2.3 Workflow Trait

```rust
/// 工作流的行为契约
/// 每个功能（灵感矩阵、大纲生成等）实现此trait
pub trait Workflow: Send + Sync {
    /// 工作流唯一标识（如 "inspiration_matrix"）
    fn workflow_id(&self) -> &str;

    /// 显示名称
    fn name(&self) -> &str;

    /// 功能描述
    fn description(&self) -> &str;

    /// 默认权限模式
    fn default_permission_mode(&self) -> PermissionMode;

    /// 获取DAG节点列表
    fn nodes(&self) -> &[WorkflowNode];

    /// 获取DAG边列表
    fn edges(&self) -> &[WorkflowEdge];

    /// 获取检查点节点ID列表
    fn checkpoints(&self) -> &[String];

    /// 预估token消耗
    fn estimated_token_cost(&self, input: &serde_json::Value) -> i64;

    /// 解析用户输入为Pipeline初始上下文
    fn parse_input(&self, raw_input: &serde_json::Value) -> Result<serde_json::Value, String>;
}
```

### 2.3 核心数据结构

在 `agents/models.rs` 中定义以下struct，全部 `#[derive(Debug, Clone, Serialize, Deserialize)]`。

#### 2.3.1 Agent相关

```rust
/// Agent分类
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentCategory {
    Creative,     // 创意型
    Analytic,     // 分析型
    Structural,   // 结构型
    Memory,       // 记忆型
    Tool,         // 工具型（不调用LLM）
}

/// Agent定义（对应agent_definitions表 + 静态注册表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub agent_id: String,           // 如 "idea_diverger"
    pub name: String,               // 如 "灵感发散师"
    pub category: AgentCategory,
    pub description: String,
    pub system_prompt: String,      // 支持{{variable}}插值
    pub required_tools: Vec<String>,  // 工具ID列表
    pub optional_tools: Vec<String>,
    pub api_config_id: Option<i64>,  // None=用项目默认
    pub model_params: ModelParams,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub is_builtin: bool,
    pub version: String,
    pub project_id: Option<i64>,     // None=全局级（仅自定义Agent）
}

/// 模型参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParams {
    pub temperature: f32,       // 默认0.7
    pub max_tokens: i32,        // 默认4096
    pub top_p: Option<f32>,     // 默认None
}

impl Default for ModelParams {
    fn default() -> Self {
        Self { temperature: 0.7, max_tokens: 4096, top_p: None }
    }
}

/// Agent执行产出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutput {
    pub content: String,                       // LLM生成的文本内容
    pub structured: Option<serde_json::Value>, // 解析后的结构化数据
    pub token_usage: Option<TokenUsage>,       // token消耗
    pub tool_calls_log: Vec<ToolCallLog>,      // 工具调用记录
}
```

#### 2.3.2 工具相关

```rust
/// 工具权限
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermission {
    ReadDb,
    WriteDb,
    ReadFile,
    WriteFile,
    ReadMemory,
    WriteMemory,
}

/// 工具定义（静态声明，不存数据库）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub tool_id: String,             // 如 "agent.create_setting_card"
    pub name: String,
    pub description: String,
    pub parameters_schema: serde_json::Value,
    pub result_schema: serde_json::Value,
    pub required_permission: ToolPermission,
    pub internal_function: String,   // 如 "settings::create_card"
    pub is_dangerous: bool,
    pub cacheable: bool,
    pub cache_ttl: Option<i64>,      // 秒，None=整个Pipeline内有效
}

/// 工具调用日志（对应agent_tool_calls表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallLog {
    pub tool_id: String,
    pub parameters: serde_json::Value,
    pub result_summary: String,      // 截断后的结果摘要
    pub duration_ms: i64,
    pub success: bool,
    pub error_message: Option<String>,
    pub cache_hit: bool,
}
```

#### 2.3.3 工作流相关

```rust
/// 工作流节点定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub node_id: String,             // 如 "n1"
    pub agent_id: String,            // 如 "keyword_analyst"
    pub agent_overrides: Option<ModelParams>,  // 临时覆盖模型参数
    pub input_mapping: serde_json::Value,      // 从上游output_key提取
    pub output_key: String,          // 输出在上下文中的键名
    pub retry_limit: i32,            // 默认3
    pub timeout_sec: i32,            // 默认300
    pub parallel_group: Option<String>,
    pub is_loop: bool,
    pub loop_config: Option<LoopConfig>,
}

/// 循环节点配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopConfig {
    pub max_iterations: i32,             // 最大循环次数
    pub termination_field: String,       // 终止字段名，如 "should_end"
    pub loop_agents: Vec<LoopAgentStep>, // 循环内交替调用的Agent
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopAgentStep {
    pub agent_id: String,
    pub input_from: String,  // "prev_director" 或 "initial"
}

/// 工作流边定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdge {
    pub from_node: String,
    pub to_node: String,
    pub data_mapping: serde_json::Value,  // {from_output_key: to_input_param}
}

/// 权限模式
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    HandsOff,     // 不干预
    Supervised,   // 检查点干预
    Autopilot,    // 高权限全自动
}
```

#### 2.3.4 任务执行相关

```rust
/// 任务状态
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    PausedAtCheckpoint,
    FailedAwaitingDecision,
    Completed,
    Failed,
    Aborted,
}

/// Pipeline执行上下文（在一次任务执行中传递）
#[derive(Debug, Clone)]
pub struct TaskContext {
    pub task_id: String,
    pub project_id: i64,
    pub conversation_id: Option<i64>,
    pub workflow_id: String,
    pub permission_mode: PermissionMode,
    pub user_input: serde_json::Value,
    pub node_outputs: std::collections::HashMap<String, serde_json::Value>,  // node_id → output
    pub current_node_id: Option<String>,
    pub completed_nodes: Vec<String>,
    pub total_tokens: i64,
    pub cache: std::collections::HashMap<String, serde_json::Value>,  // 工具缓存
    pub output_dir: std::path::PathBuf,  // ./agent_outputs/{task_id}/
}

/// Agent任务（对应agent_tasks表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: i64,
    pub task_id: String,
    pub project_id: i64,
    pub conversation_id: Option<i64>,
    pub workflow_id: String,
    pub status: TaskStatus,
    pub permission_mode: PermissionMode,
    pub input: String,                    // JSON字符串
    pub output: Option<String>,           // JSON字符串
    pub current_node_id: Option<String>,
    pub completed_nodes: String,          // JSON数组字符串
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

### 2.4 Agent注册表实现

注册表位于 `agents/registry.rs`，合并静态注册表（代码定义）和动态注册表（数据库 `agent_definitions` 表）。

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

/// 全局注册表（静态+动态合并后的缓存）
static AGENT_REGISTRY: Lazy<RwLock<HashMap<String, AgentDefinition>>> = Lazy::new(|| {
    RwLock::new(HashMap::new())
});
static TOOL_REGISTRY: Lazy<HashMap<String, Box<dyn ToolHandler>>> = Lazy::new(|| {
    let mut map: HashMap<String, Box<dyn ToolHandler>> = HashMap::new();
    // 注册20个原生工具
    register_tools(&mut map);
    map
});
static WORKFLOW_REGISTRY: Lazy<HashMap<String, Box<dyn Workflow>>> = Lazy::new(|| {
    let mut map: HashMap<String, Box<dyn Workflow>> = HashMap::new();
    // 注册6个工作流
    register_workflows(&mut map);
    map
});

/// 初始化：加载内置Agent到注册表
/// 在应用启动时调用（lib.rs的setup钩子）
pub fn init_registry(db: &Connection) -> Result<(), String> {
    let mut registry = AGENT_REGISTRY.write().map_err(|e| format!("注册表锁失败: {}", e))?;

    // 1. 加载内置Agent（来自definitions.rs的静态数组）
    for agent in definitions::BUILTIN_AGENTS.iter() {
        registry.insert(agent.agent_id.clone(), agent.clone());
    }

    // 2. 加载数据库中的自定义Agent
    let mut stmt = db.prepare("SELECT * FROM agent_definitions")?;
    let custom_agents: Vec<AgentDefinition> = stmt.query_map([], |row| {
        // 行映射逻辑...
    })?.filter_map(|r| r.ok()).collect();

    for agent in custom_agents {
        registry.insert(agent.agent_id.clone(), agent);
    }

    Ok(())
}

/// 查询Agent定义
pub fn get_agent(agent_id: &str) -> Option<AgentDefinition> {
    AGENT_REGISTRY.read().ok()?.get(agent_id).cloned()
}

/// 查询工具处理器
pub fn get_tool(tool_id: &str) -> Option<&'static dyn ToolHandler> {
    TOOL_REGISTRY.get(tool_id).map(|b| b.as_ref())
}

/// 查询工作流
pub fn get_workflow(workflow_id: &str) -> Option<&'static dyn Workflow> {
    WORKFLOW_REGISTRY.get(workflow_id).map(|b| b.as_ref())
}

/// 列出所有Agent（供前端展示）
pub fn list_agents(category: Option<AgentCategory>) -> Vec<AgentDefinition> {
    let registry = AGENT_REGISTRY.read().ok();
    match registry {
        Some(r) => r.values()
            .filter(|a| category.map_or(true, |c| a.category == c))
            .cloned()
            .collect(),
        None => vec![],
    }
}

/// 重新加载自定义Agent（用户创建/导入/删除后调用）
pub fn reload_custom_agents(db: &Connection) -> Result<(), String> {
    let mut registry = AGENT_REGISTRY.write().map_err(|e| format!("注册表锁失败: {}", e))?;

    // 移除所有自定义Agent
    registry.retain(|_, a| a.is_builtin);

    // 重新加载
    let mut stmt = db.prepare("SELECT * FROM agent_definitions")?;
    // ... 同init_registry的加载逻辑

    Ok(())
}
```

### 2.5 工具适配层实现

工具适配层位于 `agents/tools.rs`，实现权限校验、参数校验、分发到内部函数、缓存。

#### 2.5.1 工具分发核心

```rust
/// 工具适配层入口：Agent执行器调用此函数
pub fn execute_tool(
    tool_id: &str,
    params: &serde_json::Value,
    context: &ToolContext,
    cache: &mut HashMap<String, serde_json::Value>,
) -> Result<ToolResult, String> {
    // 1. 查找工具
    let handler = registry::get_tool(tool_id)
        .ok_or_else(|| format!("工具 {} 未注册", tool_id))?;

    // 2. 权限校验（Agent是否有权调用此工具）
    let agent_def = registry::get_agent(&context.agent_id)
        .ok_or_else(|| format!("Agent {} 未注册", context.agent_id))?;
    if !check_tool_permission(&agent_def, tool_id) {
        return Err(format!("Agent {} 无权调用工具 {}", context.agent_id, tool_id));
    }

    // 3. 缓存检查
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

    // 4. 执行工具
    let start = std::time::Instant::now();
    let result = handler.execute(params, context);
    let duration_ms = start.elapsed().as_millis() as i64;

    // 5. 记录调用日志
    log_tool_call(context.task_id, context.agent_id, tool_id, params, &result, duration_ms, context.db)?;

    // 6. 写入缓存
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

/// 校验Agent是否有权调用工具
fn check_tool_permission(agent: &AgentDefinition, tool_id: &str) -> bool {
    // required_tools 和 optional_tools 中的工具都允许
    agent.required_tools.iter().any(|t| t == tool_id)
        || agent.optional_tools.iter().any(|t| t == tool_id)
}
```

#### 2.5.2 内置工具实现示例

每个工具实现 `ToolHandler` trait。以下以 `agent.create_setting_card` 为例，展示如何复用现有Rust函数：

```rust
/// 工具: agent.create_setting_card
/// 复用 commands/settings.rs 的内部函数
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
                "card_type": { "type": "string", "description": "卡片类型" },
                "name": { "type": "string", "description": "名称" },
                "fields": { "type": "object", "description": "字段键值对" }
            },
            "required": ["project_id", "card_type", "name", "fields"]
        })
    }

    fn execute(&self, params: &serde_json::Value, ctx: &ToolContext) -> Result<ToolResult, String> {
        let project_id: i64 = params["project_id"].as_i64()
            .ok_or("缺少project_id参数")?;
        let card_type: String = params["card_type"].as_str()
            .ok_or("缺少card_type参数")?.to_string();
        let name: String = params["name"].as_str()
            .ok_or("缺少name参数")?.to_string();
        let fields: serde_json::Value = params["fields"].clone();

        // 复用现有内部函数（不是Tauri命令，是模块内的纯函数）
        // 需要在commands/settings.rs中提取一个不带State参数的内部函数
        let card_id = crate::commands::settings::create_card_internal(
            ctx.db, project_id, card_type, name, fields.to_string()
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
```

#### 2.5.3 现有函数的复用改造

为了让工具适配层复用现有 `commands/settings.rs`、`commands/project.rs` 的逻辑，需要将这些模块中的命令函数拆分为**外部命令层**（带 `State` 参数）和**内部函数层**（带 `&Connection` 参数）。

改造示例（[commands/settings.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/commands/settings.rs)）：

```rust
// 改造前：命令和逻辑耦合
#[tauri::command]
pub fn create_setting_card(
    db: State<'_, DbState>,
    project_id: i64,
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    // ... 业务逻辑
    conn.execute(...)?;
    Ok(id)
}

// 改造后：命令层调用内部函数
#[tauri::command]
pub fn create_setting_card(
    db: State<'_, DbState>,
    project_id: i64,
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    create_card_internal(&db, project_id, card_type, name, fields)
}

/// 内部函数（可被agents模块复用）
pub fn create_card_internal(
    db: &DbState,
    project_id: i64,
    card_type: String,
    name: String,
    fields: String,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO setting_cards (id, project_id, card_type, name, fields, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, project_id, card_type, name, fields, now, now],
    ).map_err(|e| format!("创建设定卡失败: {}", e))?;
    Ok(id)
}
```

**需要改造的现有函数清单**（提取内部函数）：

| 现有命令 | 提取的内部函数 | 复用的工具 |
|---|---|---|
| `commands::settings::create_setting_card` | `create_card_internal` | `agent.create_setting_card` |
| `commands::settings::list_setting_cards` | `list_cards_internal` | `agent.query_setting_cards` |
| `commands::settings::update_setting_card` | `update_card_internal` | `agent.update_setting_card` |
| `commands::settings::delete_setting_card` | `delete_card_internal` | `agent.delete_setting_card` |
| `commands::project::create_chapter` | `create_chapter_internal` | `agent.create_outline_node` |
| `commands::project::list_chapters` | `list_chapters_internal` | `agent.query_outline` |
| `commands::project::update_chapter` | `update_chapter_internal` | `agent.update_outline_node` |
| `commands::project::delete_chapter` | `delete_chapter_internal` | `agent.delete_outline_node` |
| `commands::chat::get_messages` | `get_messages_internal` | `agent.query_conversation_history` |
| `commands::project::get_project` | `get_project_internal` | `agent.query_project_info` |

### 2.6 Pipeline引擎实现

Pipeline引擎位于 `agents/pipeline.rs`，负责DAG编排、状态机管理、检查点、错误处理。

#### 2.6.1 引擎核心结构

```rust
/// Pipeline执行引擎
pub struct PipelineEngine<'a> {
    db: &'a DbState,
    app: &'a AppHandle,
    cancel_token: &'a CancellationTokenState,
    workflow: &'a dyn Workflow,
    context: TaskContext,
}

impl<'a> PipelineEngine<'a> {
    pub fn new(
        db: &'a DbState,
        app: &'a AppHandle,
        cancel_token: &'a CancellationTokenState,
        workflow: &'a dyn Workflow,
        task: AgentTask,
    ) -> Self {
        let context = TaskContext {
            task_id: task.task_id.clone(),
            project_id: task.project_id,
            conversation_id: task.conversation_id,
            workflow_id: task.workflow_id.clone(),
            permission_mode: task.permission_mode,
            user_input: serde_json::from_str(&task.input).unwrap_or(serde_json::Value::Null),
            node_outputs: std::collections::HashMap::new(),
            current_node_id: task.current_node_id,
            completed_nodes: serde_json::from_str(&task.completed_nodes).unwrap_or_default(),
            total_tokens: task.total_tokens,
            cache: std::collections::HashMap::new(),
            output_dir: get_output_dir(&task.task_id),
        };
        Self { db, app, cancel_token, workflow, context }
    }

    /// 执行Pipeline（主循环）
    pub async fn execute(&mut self) -> Result<(), String> {
        let nodes = self.workflow.nodes();
        let edges = self.workflow.edges();

        // 确定起始节点（跳过已完成的）
        let start_node = self.find_start_node(nodes);

        // 按拓扑顺序执行
        let execution_order = self.topological_sort(nodes, edges)?;
        let start_idx = execution_order.iter().position(|n| n == &start_node).unwrap_or(0);

        for node_id in &execution_order[start_idx..] {
            // 检查取消
            if self.is_cancelled() {
                self.update_task_status(TaskStatus::Aborted).await?;
                return Err("任务已取消".to_string());
            }

            let node = nodes.iter().find(|n| &n.node_id == node_id).unwrap();

            // 跳过已完成节点（断点续传）
            if self.context.completed_nodes.contains(node_id) {
                continue;
            }

            // 更新当前节点
            self.context.current_node_id = Some(node_id.clone());
            self.update_task_status(TaskStatus::Running).await?;

            // 检查是否为并行组
            if let Some(group) = &node.parallel_group {
                self.execute_parallel_group(group, nodes).await?;
                continue;
            }

            // 检查是否为循环节点
            if node.is_loop {
                self.execute_loop_node(node).await?;
            } else {
                self.execute_single_node(node).await?;
            }

            // 标记节点完成
            self.context.completed_nodes.push(node_id.clone());
            self.persist_progress().await?;

            // 检查点处理
            if self.workflow.checkpoints().contains(node_id) {
                self.handle_checkpoint(node_id).await?;
            }
        }

        // Pipeline完成
        self.update_task_status(TaskStatus::Completed).await?;
        Ok(())
    }

    /// 执行单个节点
    async fn execute_single_node(&mut self, node: &WorkflowNode) -> Result<(), String> {
        // 1. 解析输入（从上游节点output_key提取）
        let input = self.resolve_input(node)?;

        // 2. 获取Agent定义
        let agent_def = registry::get_agent(&node.agent_id)
            .ok_or_else(|| format!("Agent {} 未注册", node.agent_id))?;

        // 3. 创建Agent执行器
        let executor = AgentExecutorImpl::new(agent_def, node.agent_overrides.clone());

        // 4. 执行Agent
        let output = executor.execute(&mut self.context, input, self.app, self.db, self.cancel_token).await?;

        // 5. 写入中间产出文件
        self.write_intermediate_output(node, &output).await?;

        // 6. 存入上下文
        self.context.node_outputs.insert(node.output_key.clone(), output.structured.unwrap_or(serde_json::Value::Null));

        // 7. 累计token
        if let Some(usage) = output.token_usage {
            self.context.total_tokens += usage.total_tokens;
        }

        // 8. 推送进度事件
        self.emit_progress(node, &output).await?;

        Ok(())
    }

    /// 检查点处理
    async fn handle_checkpoint(&mut self, node_id: &str) -> Result<(), String> {
        match self.context.permission_mode {
            PermissionMode::HandsOff | PermissionMode::Autopilot => {
                // 不暂停，继续执行
                Ok(())
            }
            PermissionMode::Supervised => {
                // 暂停等待用户决策
                self.update_task_status(TaskStatus::PausedAtCheckpoint).await?;
                self.emit_checkpoint_event(node_id).await?;

                // 等待用户决策（通过commands.rs的用户决策命令恢复）
                self.wait_for_user_decision().await
            }
        }
    }
}
```

#### 2.6.2 并行执行

```rust
/// 并行组执行
async fn execute_parallel_group(&mut self, group: &str, nodes: &[WorkflowNode]) -> Result<(), String> {
    let parallel_nodes: Vec<_> = nodes.iter().filter(|n| n.parallel_group.as_deref() == Some(group)).collect();
    let max_concurrent = get_max_concurrent();  // 默认3

    let mut futures = Vec::new();
    for node in parallel_nodes {
        let input = self.resolve_input(node)?;
        let agent_def = registry::get_agent(&node.agent_id).unwrap();
        // 创建独立的执行上下文（避免可变借用冲突）
        futures.push(self.execute_node_async(node.clone(), agent_def, input));
    }

    // 使用tokio的缓冲流控制并发度
    let mut stream = futures::stream::iter(futures)
        .buffer_unordered(max_concurrent);

    let mut outputs = Vec::new();
    while let Some(result) = stream.next().await {
        let (output_key, output) = result?;
        outputs.push((output_key, output));
    }

    // 合并并行结果到上下文
    for (output_key, output) in outputs {
        self.context.node_outputs.insert(output_key, output.structured.unwrap_or(serde_json::Value::Null));
    }

    Ok(())
}
```

### 2.7 记忆库服务实现

记忆库服务位于 `agents/memory.rs`，实现memory_keeper的常驻服务。

```rust
use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;

/// 全局记忆库缓存（项目ID → 记忆数据）
static MEMORY_CACHE: Lazy<RwLock<HashMap<i64, StoryMemory>>> = Lazy::new(|| {
    RwLock::new(HashMap::new())
});

/// 记忆库数据结构（对应story_memory表）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoryMemory {
    pub characters: Vec<MemoryEntry>,
    pub timeline: Vec<MemoryEntry>,
    pub locations: Vec<MemoryEntry>,
    pub foreshadows: Vec<MemoryEntry>,
    pub baseline_style: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub entity: String,
    pub field: String,
    pub value: String,
    pub chapter: Option<i32>,
    pub updated_at: String,
}

/// 记忆库服务
pub struct MemoryService;

impl MemoryService {
    /// 应用启动时加载当前项目的记忆库
    pub fn load(project_id: i64, db: &Connection) -> Result<(), String> {
        let memory = Self::load_from_db(project_id, db)?;
        let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
        cache.insert(project_id, memory);
        Ok(())
    }

    /// 查询记忆库（响应agent.query_memory工具调用）
    pub fn query(project_id: i64, query: &serde_json::Value) -> Result<serde_json::Value, String> {
        let cache = MEMORY_CACHE.read().map_err(|e| format!("记忆库锁失败: {}", e))?;
        let memory = cache.get(&project_id).ok_or("记忆库未加载")?;

        // 根据query的category字段返回对应数据
        let category = query["category"].as_str().unwrap_or("all");
        let result = match category {
            "characters" => serde_json::to_value(&memory.characters)?,
            "timeline" => serde_json::to_value(&memory.timeline)?,
            "locations" => serde_json::to_value(&memory.locations)?,
            "foreshadows" => serde_json::to_value(&memory.foreshadows)?,
            _ => serde_json::to_value(memory)?,
        };
        Ok(result)
    }

    /// 更新记忆库（响应agent.update_memory工具调用）
    pub fn update(project_id: i64, updates: &serde_json::Value, db: &Connection) -> Result<(), String> {
        let mut cache = MEMORY_CACHE.write().map_err(|e| format!("记忆库锁失败: {}", e))?;
        let memory = cache.get_mut(&project_id).ok_or("记忆库未加载")?;

        // 解析updates并应用到内存
        if let Some(entries) = updates["updates"].as_array() {
            for entry in entries {
                // 幂等更新：通过entity+field去重
                // ...
            }
        }

        // 持久化到数据库
        Self::save_to_db(project_id, memory, db)?;

        Ok(())
    }

    /// 项目切换时重新加载
    pub fn switch_project(project_id: i64, db: &Connection) -> Result<(), String> {
        Self::load(project_id, db)
    }

    fn load_from_db(project_id: i64, db: &Connection) -> Result<StoryMemory, String> {
        // SELECT * FROM story_memory WHERE project_id = ?
        // 若无记录则返回默认空记忆
        // ...
    }

    fn save_to_db(project_id: i64, memory: &StoryMemory, db: &Connection) -> Result<(), String> {
        // INSERT OR REPLACE INTO story_memory ...
        // ...
    }
}
```

---

## 3. 前端架构

### 3.1 目录结构

在前端 `src/` 下新增 `components/agent/` 目录，与现有 `chat/`、`settings/` 等平级。Store 新增 `agentStore.ts`，类型定义追加到现有 `types/index.ts`。

```
src/
├── components/
│   ├── agent/                    # 新增：Agent系统UI组件
│   │   ├── AgentTaskPanel.tsx    # 任务发起面板（功能选择+输入表单+权限模式）
│   │   ├── PipelineVisualizer.tsx # DAG可视化 + 执行进度
│   │   ├── AgentOutputViewer.tsx # 中间产出查看器
│   │   ├── CheckpointDialog.tsx  # 检查点交互弹窗
│   │   ├── ToolCallLog.tsx       # 工具调用日志列表
│   │   └── AgentDefinitionEditor.tsx # 自定义Agent编辑器（P3阶段）
│   ├── chat/                     # 现有
│   ├── common/                   # 现有
│   └── ...
├── stores/
│   ├── agentStore.ts             # 新增：Agent系统状态
│   ├── chatStore.ts              # 现有
│   └── ...
├── types/
│   └── index.ts                  # 追加Agent相关类型
└── utils/
    └── tauri.ts                  # 追加agent_*命令封装
```

### 3.2 Store设计

新增 `agentStore.ts`，遵循现有 Zustand `create<State>((set, get) => ({}))` 模式。

```typescript
// src/stores/agentStore.ts
import { create } from 'zustand';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import * as tauri from '@/utils/tauri';
import { AgentTask, AgentDefinition, PermissionMode, TaskStatus, AgentProgressEvent, CheckpointEvent, AgentChunkEvent } from '@/types';

interface AgentState {
  // === 数据状态 ===
  availableWorkflows: WorkflowInfo[];        // 可用工作流列表
  availableAgents: AgentDefinition[];        // 可用Agent列表
  currentTask: AgentTask | null;             // 当前执行的任务
  taskHistory: AgentTask[];                  // 任务历史
  progress: AgentProgressEvent | null;       // 实时执行进度
  streamingContent: string;                  // 当前Agent的流式输出
  checkpoint: CheckpointEvent | null;        // 当前检查点（若有）
  toolCallLogs: ToolCallLog[];               // 工具调用日志

  // === UI状态 ===
  isTaskRunning: boolean;
  showCheckpointDialog: boolean;
  showOutputViewer: boolean;
  selectedOutputFile: string | null;
  permissionModeOverride: PermissionMode | null;  // 任务级临时覆盖

  // === Actions ===
  loadWorkflows: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTaskHistory: () => Promise<void>;
  startTask: (workflowId: string, input: Record<string, unknown>, permissionMode?: PermissionMode) => Promise<void>;
  cancelTask: () => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string, fromStart: boolean) => Promise<void>;
  checkpointDecision: (decision: CheckpointDecision) => Promise<void>;
  setPermissionModeOverride: (mode: PermissionMode | null) => void;

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
  checkpoint: null,
  toolCallLogs: [],
  isTaskRunning: false,
  showCheckpointDialog: false,
  showOutputViewer: false,
  selectedOutputFile: null,
  permissionModeOverride: null,

  // 加载可用工作流
  loadWorkflows: async () => {
    const workflows = await tauri.agentListWorkflows();
    set({ availableWorkflows: workflows });
  },

  // 加载可用Agent
  loadAgents: async () => {
    const agents = await tauri.agentListAgents();
    set({ availableAgents: agents });
  },

  // 加载任务历史
  loadTaskHistory: async () => {
    const history = await tauri.agentListTasks();
    set({ taskHistory: history });
  },

  // 发起任务
  startTask: async (workflowId, input, permissionMode) => {
    const override = get().permissionModeOverride;
    const mode = permissionMode || override;
    const task = await tauri.agentStartTask({
      workflowId,
      input,
      permissionMode: mode,
    });
    set({
      currentTask: task,
      isTaskRunning: true,
      progress: null,
      streamingContent: '',
      toolCallLogs: [],
      checkpoint: null,
    });
  },

  // 取消任务
  cancelTask: async () => {
    const task = get().currentTask;
    if (!task) return;
    await tauri.agentCancelTask(task.task_id);
    set({ isTaskRunning: false });
  },

  // 恢复任务（断点续传）
  resumeTask: async (taskId) => {
    const task = await tauri.agentResumeTask(taskId);
    set({ currentTask: task, isTaskRunning: true });
  },

  // 检查点决策
  checkpointDecision: async (decision) => {
    const task = get().currentTask;
    if (!task) return;
    await tauri.agentCheckpointDecision({
      taskId: task.task_id,
      decision,
    });
    set({ showCheckpointDialog: false, checkpoint: null });
  },

  // 事件监听初始化
  initAgentListeners: async () => {
    const unlistenChunk = await listen<AgentChunkEvent>('agent:chunk', (event) => {
      const { content, done } = event.payload;
      if (done) {
        set((state) => ({ streamingContent: '' }));
      } else {
        set((state) => ({ streamingContent: state.streamingContent + content }));
      }
    });

    const unlistenProgress = await listen<AgentProgressEvent>('agent:progress', (event) => {
      set({ progress: event.payload });
    });

    const unlistenCheckpoint = await listen<CheckpointEvent>('agent:checkpoint', (event) => {
      set({
        checkpoint: event.payload,
        showCheckpointDialog: true,
        isTaskRunning: false,
      });
    });

    const unlistenToolCall = await listen<ToolCallLog>('agent:tool_call', (event) => {
      set((state) => ({ toolCallLogs: [...state.toolCallLogs, event.payload] }));
    });

    const unlistenDone = await listen<{ taskId: string; status: TaskStatus }>('agent:done', (event) => {
      set({
        isTaskRunning: false,
        streamingContent: '',
        currentTask: null,
      });
      // 刷新任务历史
      get().loadTaskHistory();
    });

    // 返回组合的清理函数
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

### 3.3 组件划分

#### 3.3.1 AgentTaskPanel（任务发起面板）

```tsx
// src/components/agent/AgentTaskPanel.tsx
// 职责：功能选择 + 动态输入表单 + 权限模式选择 + 任务发起
// 复用：common/Button, common/Toast

interface Props {}

export const AgentTaskPanel: React.FC<Props> = () => {
  const { availableWorkflows, startTask, isTaskRunning } = useAgentStore();
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('hands_off');

  // 根据选中工作流的input_schema动态生成表单
  const currentWorkflow = availableWorkflows.find(w => w.workflow_id === selectedWorkflow);
  const inputFields = currentWorkflow?.input_schema?.properties || {};

  return (
    <div className="flex flex-col h-full">
      {/* 工作流选择（卡片网格） */}
      <div className="grid grid-cols-2 gap-2 p-3">
        {availableWorkflows.map(w => (
          <WorkflowCard
            key={w.workflow_id}
            workflow={w}
            selected={selectedWorkflow === w.workflow_id}
            onClick={() => setSelectedWorkflow(w.workflow_id)}
          />
        ))}
      </div>

      {/* 动态输入表单 */}
      {currentWorkflow && (
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
        disabled={!selectedWorkflow || isTaskRunning}
        onClick={() => startTask(selectedWorkflow, inputValues, permissionMode)}
      >
        开始任务
      </Button>
    </div>
  );
};
```

#### 3.3.2 PipelineVisualizer（执行可视化）

```tsx
// src/components/agent/PipelineVisualizer.tsx
// 职责：DAG流程图展示 + 节点状态着色 + 流式输出 + token统计
// 复用：react-markdown（渲染流式内容）

export const PipelineVisualizer: React.FC = () => {
  const { currentTask, progress, streamingContent, toolCallLogs } = useAgentStore();

  if (!currentTask || !progress) return <EmptyState />;

  return (
    <div className="flex flex-col h-full">
      {/* 头部：任务信息 */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">{currentTask.workflow_id}</span>
        <StatusBadge status={currentTask.status} />
        <TokenCounter used={progress.total_tokens} estimated={progress.estimated_tokens} />
      </div>

      {/* 节点列表（纵向流程） */}
      <div className="flex-1 overflow-y-auto p-3">
        {progress.nodes.map(node => (
          <NodeCard
            key={node.node_id}
            node={node}
            isCurrent={node.node_id === progress.current_node_id}
            streamingContent={node.node_id === progress.current_node_id ? streamingContent : ''}
          />
        ))}
      </div>

      {/* 工具调用日志 */}
      <ToolCallLog logs={toolCallLogs} />

      {/* 取消按钮 */}
      <Button variant="danger" onClick={() => useAgentStore.getState().cancelTask()}>
        取消任务
      </Button>
    </div>
  );
};
```

#### 3.3.3 CheckpointDialog（检查点交互）

```tsx
// src/components/agent/CheckpointDialog.tsx
// 职责：展示当前产出 + 编辑 + 四个决策按钮
// 复用：common/Dialog, react-markdown

export const CheckpointDialog: React.FC = () => {
  const { checkpoint, showCheckpointDialog, checkpointDecision } = useAgentStore();
  const [editedOutput, setEditedOutput] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  if (!showCheckpointDialog || !checkpoint) return null;

  return (
    <Dialog open={showCheckpointDialog} onClose={() => {}} title="检查点确认">
      {/* Agent产出展示 */}
      <div className="max-h-96 overflow-y-auto">
        {isEditing ? (
          <textarea
            value={editedOutput}
            onChange={(e) => setEditedOutput(e.target.value)}
            className="w-full h-64 p-2 border rounded"
          />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {checkpoint.output_content}
          </ReactMarkdown>
        )}
      </div>

      {/* 决策按钮 */}
      <div className="flex gap-2 mt-4">
        <Button onClick={() => checkpointDecision('continue')}>继续</Button>
        <Button onClick={() => {
          setIsEditing(!isEditing);
          setEditedOutput(checkpoint.output_content);
        }}>
          {isEditing ? '取消编辑' : '修改'}
        </Button>
        <Button variant="ghost" onClick={() => checkpointDecision('skip')}>跳过</Button>
        <Button variant="danger" onClick={() => checkpointDecision('abort')}>中止</Button>
      </div>

      {/* 编辑模式下的保存按钮 */}
      {isEditing && (
        <Button
          onClick={() => checkpointDecision({ type: 'modify', content: editedOutput })}
        >
          保存修改
        </Button>
      )}
    </Dialog>
  );
};
```

### 3.4 事件监听

Agent系统使用 `agent:*` 前缀的事件命名空间，与 `chat:chunk` 隔离。监听器在 `AgentTaskPanel` 组件中挂载。

```typescript
// 事件协议定义（types/index.ts追加）

// Agent流式chunk事件
interface AgentChunkEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  content: string;
  done: boolean;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 进度事件
interface AgentProgressEvent {
  taskId: string;
  current_node_id: string;
  nodes: NodeProgress[];
  total_tokens: number;
  estimated_tokens: number;
  cache_hit_count: number;
  cache_miss_count: number;
}

interface NodeProgress {
  node_id: string;
  agent_id: string;
  agent_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  token_usage?: number;
  is_checkpoint?: boolean;
}

// 检查点事件
interface CheckpointEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  agentName: string;
  output_content: string;
  output_file_path: string;
  message: string;
}

// 工具调用事件
interface ToolCallEvent {
  taskId: string;
  nodeId: string;
  agentId: string;
  toolId: string;
  parameters: Record<string, unknown>;
  result_summary: string;
  duration_ms: number;
  success: boolean;
  cache_hit: boolean;
}

// 任务完成事件
interface AgentDoneEvent {
  taskId: string;
  status: TaskStatus;
  final_output?: string;
  total_tokens: number;
  error_log?: string;
}
```

**监听器生命周期**：

```tsx
// 在AgentTaskPanel组件中挂载
useEffect(() => {
  let cleanup: UnlistenFn | undefined;
  useAgentStore.getState().initAgentListeners().then((fn) => { cleanup = fn; });
  return () => { cleanup?.(); };
}, []);
```

### 3.5 UI入口与路由

Agent系统作为主区域的**第三种视图模式**，与 `ChatView`、`WritingEditor` 并列。通过 `uiStore` 的新阶段 `agent` 切换。

#### 3.5.1 MainLayout改造

```tsx
// src/components/layout/MainLayout.tsx 改造
// 中间区域增加 agent 阶段分支

<main className="flex-1 overflow-hidden flex flex-col min-w-0">
  {phase === 'writing' || phase === 'editing' ? (
    <WritingEditor />
  ) : phase === 'agent' ? (
    <AgentWorkspace />  {/* 新增 */}
  ) : (
    <ChatView />
  )}
</main>
```

#### 3.5.2 AgentWorkspace组件

```tsx
// src/components/agent/AgentWorkspace.tsx
// 职责：Agent系统的主工作区，左右分栏（任务发起 | 执行可视化）

export const AgentWorkspace: React.FC = () => {
  const { isTaskRunning } = useAgentStore();

  return (
    <div className="flex h-full">
      {/* 左侧：任务发起或任务历史 */}
      <div className="w-80 border-r overflow-y-auto">
        {isTaskRunning ? <TaskHistoryList /> : <AgentTaskPanel />}
      </div>

      {/* 右侧：执行可视化或空状态 */}
      <div className="flex-1 overflow-hidden">
        {isTaskRunning ? <PipelineVisualizer /> : <AgentEmptyState />}
      </div>

      {/* 检查点弹窗（全局） */}
      <CheckpointDialog />

      {/* 中间产出查看器（全局） */}
      <AgentOutputViewer />
    </div>
  );
};
```

#### 3.5.3 TopBar阶段切换改造

```tsx
// src/components/layout/TopBar.tsx 改造
// 在阶段切换标签中增加"Agent"标签

const phases = ['ideation', 'planning', 'writing', 'editing', 'agent'];
// agent 阶段使用专属图标（如 Bot、Workflow）
```

#### 3.5.4 权限模式设置

在现有 `SettingsPanel` 中新增"Agent系统"分组，配置权限模式默认值。

```tsx
// src/components/settings/SettingsPanel.tsx 追加
// 新增 Agent系统设置分组

<div className="space-y-3">
  <h3>Agent系统</h3>

  {/* 应用级默认权限模式 */}
  <SettingItem label="默认权限模式">
    <Select
      value={agentDefaultMode}
      onChange={setAgentDefaultMode}
      options={[
        { value: 'hands_off', label: '不干预（最快）' },
        { value: 'supervised', label: '检查点干预（平衡）' },
        { value: 'autopilot', label: '高权限全自动（无中断）' },
      ]}
    />
  </SettingItem>

  {/* 最大并行度 */}
  <SettingItem label="最大并行度">
    <Slider min={1} max={10} value={maxConcurrency} onChange={setMaxConcurrency} />
  </SettingItem>

  {/* token阈值预警 */}
  <SettingItem label="单任务token上限">
    <Input type="number" value={tokenThreshold} onChange={setTokenThreshold} />
  </SettingItem>
</div>
```

---

## 4. 接口设计

### 4.1 Tauri命令接口

在 [lib.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/lib.rs) 的 `generate_handler!` 中追加Agent命令分组，命名遵循现有 `verb_noun` 规范，统一 `agent_` 前缀。

#### 4.1.1 命令清单

| 命令名 | 签名简述 | 说明 | 阶段 |
|---|---|---|---|
| `agent_list_workflows` | `() -> Vec<WorkflowInfo>` | 列出可用工作流 | P0 |
| `agent_list_agents` | `(category: Option<String>) -> Vec<AgentDefinition>` | 列出可用Agent | P0 |
| `agent_start_task` | `(workflow_id, input_json, permission_mode) -> AgentTask` | 发起任务 | P0 |
| `agent_cancel_task` | `(task_id) -> ()` | 取消任务 | P0 |
| `agent_list_tasks` | `(project_id, limit) -> Vec<AgentTask>` | 任务历史 | P0 |
| `agent_get_task` | `(task_id) -> AgentTask` | 查询单个任务 | P0 |
| `agent_resume_task` | `(task_id) -> ()` | 恢复崩溃任务 | P0 |
| `agent_retry_task` | `(task_id, from_start) -> ()` | 重试任务 | P0 |
| `agent_checkpoint_decision` | `(task_id, decision_json) -> ()` | 检查点决策 | P1 |
| `agent_read_output` | `(task_id, file_name) -> String` | 读取中间产出 | P0 |
| `agent_list_outputs` | `(task_id) -> Vec<String>` | 列出中间产出文件 | P0 |
| `agent_save_custom_agent` | `(agent_json) -> String` | 保存自定义Agent | P3 |
| `agent_list_custom_agents` | `(project_id) -> Vec<AgentDefinition>` | 列出自定义Agent | P3 |
| `agent_delete_custom_agent` | `(agent_id) -> ()` | 删除自定义Agent | P3 |
| `agent_export_agent` | `(agent_id) -> String` | 导出为JSON | P3 |
| `agent_import_agent` | `(json_content, project_id) -> String` | 从JSON导入 | P3 |
| `agent_save_settings` | `(settings_json) -> ()` | 保存Agent设置 | P0 |
| `agent_load_settings` | `() -> AgentSettings` | 加载Agent设置 | P0 |

#### 4.1.2 命令实现示例

```rust
// src-tauri/src/agents/commands.rs

#[tauri::command]
pub async fn agent_start_task(
    db: State<'_, DbState>,
    app: AppHandle,
    cancel_token: State<'_, CancellationTokenState>,
    workflow_id: String,
    input_json: String,              // JSON字符串，避免嵌套参数
    permission_mode: Option<String>, // "hands_off" / "supervised" / "autopilot"
) -> Result<AgentTask, String> {
    // 1. 解析输入
    let input: serde_json::Value = serde_json::from_str(&input_json)
        .map_err(|e| format!("输入参数解析失败: {}", e))?;

    // 2. 查找工作流
    let workflow = registry::get_workflow(&workflow_id)
        .ok_or_else(|| format!("工作流 {} 未注册", workflow_id))?;

    // 3. 解析权限模式
    let mode = match permission_mode.as_deref() {
        Some("supervised") => PermissionMode::Supervised,
        Some("autopilot") => PermissionMode::Autopilot,
        _ => PermissionMode::HandsOff,
    };

    // 4. 解析用户输入
    let parsed_input = workflow.parse_input(&input)?;

    // 5. 创建任务记录
    let task_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let task = AgentTask {
        id: 0,
        task_id: task_id.clone(),
        project_id: get_current_project_id(&db)?,
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
        estimated_tokens: Some(workflow.estimated_token_cost(&input)),
        cache_hit_count: 0,
        cache_miss_count: 0,
        started_at: Some(now.clone()),
        completed_at: None,
        created_at: now,
    };

    // 6. 写入数据库
    save_task_to_db(&db, &task)?;

    // 7. 启动Pipeline（异步，不阻塞命令返回）
    let db_clone = db.inner().clone();  // DbState需要实现Clone或使用Arc
    let app_clone = app.clone();
    let cancel_clone = cancel_token.inner().clone();
    let task_clone = task.clone();

    tauri::async_runtime::spawn(async move {
        let mut engine = PipelineEngine::new(
            &db_clone, &app_clone, &cancel_clone,
            workflow, task_clone
        );
        if let Err(e) = engine.execute().await {
            let _ = app_clone.emit("agent:done", serde_json::json!({
                "task_id": task_clone.task_id,
                "status": "failed",
                "error_log": e,
            }));
        }
    });

    Ok(task)
}

#[tauri::command]
pub fn agent_list_workflows() -> Vec<WorkflowInfo> {
    registry::list_workflows().into_iter().map(|w| WorkflowInfo {
        workflow_id: w.workflow_id().to_string(),
        name: w.name().to_string(),
        description: w.description().to_string(),
        default_permission_mode: w.default_permission_mode(),
        input_schema: w.input_schema(),
        estimated_token_cost: w.estimated_token_cost(&serde_json::Value::Null),
    }).collect()
}

#[tauri::command]
pub fn agent_checkpoint_decision(
    db: State<'_, DbState>,
    task_id: String,
    decision_json: String,
) -> Result<(), String> {
    let decision: CheckpointDecision = serde_json::from_str(&decision_json)
        .map_err(|e| format!("决策参数解析失败: {}", e))?;

    // 将决策写入任务上下文，唤醒等待中的Pipeline
    pipeline::submit_checkpoint_decision(&db, &task_id, decision)
}
```

#### 4.1.3 前端封装

在 [utils/tauri.ts](file:///c:/Users/admin/Desktop/Whisper/src/utils/tauri.ts) 末尾追加Agent命令封装：

```typescript
// src/utils/tauri.ts 追加

// === Agent相关命令 ===
export const agentListWorkflows = () =>
  tauriInvoke<WorkflowInfo[]>('agent_list_workflows');

export const agentListAgents = (category?: string) =>
  tauriInvoke<AgentDefinition[]>('agent_list_agents', { category });

export const agentStartTask = (params: {
  workflowId: string;
  input: Record<string, unknown>;
  permissionMode?: PermissionMode;
}) => tauriInvoke<AgentTask>('agent_start_task', {
  workflowId: params.workflowId,
  inputJson: JSON.stringify(params.input),
  permissionMode: params.permissionMode ?? null,
});

export const agentCancelTask = (taskId: string) =>
  tauriInvoke<void>('agent_cancel_task', { taskId });

export const agentListTasks = (projectId: number, limit?: number) =>
  tauriInvoke<AgentTask[]>('agent_list_tasks', { projectId, limit: limit ?? 50 });

export const agentResumeTask = (taskId: string) =>
  tauriInvoke<void>('agent_resume_task', { taskId });

export const agentRetryTask = (taskId: string, fromStart: boolean) =>
  tauriInvoke<void>('agent_retry_task', { taskId, fromStart });

export const agentCheckpointDecision = (params: {
  taskId: string;
  decision: CheckpointDecision;
}) => tauriInvoke<void>('agent_checkpoint_decision', {
  taskId: params.taskId,
  decisionJson: JSON.stringify(params.decision),
});

export const agentReadOutput = (taskId: string, fileName: string) =>
  tauriInvoke<string>('agent_read_output', { taskId, fileName });

export const agentListOutputs = (taskId: string) =>
  tauriInvoke<string[]>('agent_list_outputs', { taskId });

export const agentSaveSettings = (settings: AgentSettings) =>
  tauriInvoke<void>('agent_save_settings', {
    settingsJson: JSON.stringify(settings),
  });

export const agentLoadSettings = () =>
  tauriInvoke<AgentSettings>('agent_load_settings');
```

### 4.2 事件协议

Agent系统使用5个事件，全部 `agent:` 前缀。

| 事件名 | 触发时机 | Payload结构 | 前端处理 |
|---|---|---|---|
| `agent:chunk` | Agent LLM流式输出 | `AgentChunkEvent` | 追加到streamingContent |
| `agent:progress` | 节点状态变更 | `AgentProgressEvent` | 更新进度UI |
| `agent:checkpoint` | 到达检查点(supervised模式) | `CheckpointEvent` | 弹出检查点弹窗 |
| `agent:tool_call` | 工具调用完成 | `ToolCallEvent` | 追加到工具日志 |
| `agent:done` | 任务结束（成功/失败/中止） | `AgentDoneEvent` | 重置状态，刷新历史 |

#### 4.2.1 事件发送示例（Rust端）

```rust
// 在pipeline.rs中发送事件

/// 发送流式chunk
async fn emit_chunk(&self, node: &WorkflowNode, content: &str, done: bool) {
    let _ = self.app.emit("agent:chunk", AgentChunkEvent {
        task_id: self.context.task_id.clone(),
        node_id: node.node_id.clone(),
        agent_id: node.agent_id.clone(),
        content: content.to_string(),
        done,
        usage: None,
    });
}

/// 发送进度更新
async fn emit_progress(&self) {
    let nodes: Vec<NodeProgress> = self.workflow.nodes().iter().map(|n| {
        let status = if self.context.completed_nodes.contains(&n.node_id) {
            "completed"
        } else if self.context.current_node_id.as_deref() == Some(&n.node_id) {
            "running"
        } else {
            "pending"
        };
        NodeProgress {
            node_id: n.node_id.clone(),
            agent_id: n.agent_id.clone(),
            agent_name: registry::get_agent(&n.agent_id).map(|a| a.name).unwrap_or_default(),
            status: status.to_string(),
            is_checkpoint: self.workflow.checkpoints().contains(&n.node_id),
            // ...
        }
    }).collect();

    let _ = self.app.emit("agent:progress", AgentProgressEvent {
        task_id: self.context.task_id.clone(),
        current_node_id: self.context.current_node_id.clone().unwrap_or_default(),
        nodes,
        total_tokens: self.context.total_tokens,
        estimated_tokens: 0, // 从task获取
        cache_hit_count: 0,
        cache_miss_count: 0,
    });
}
```

### 4.3 前后端类型映射

遵循现有约定：Rust snake_case ↔ TypeScript camelCase，Tauri 2.0自动转换。

```typescript
// src/types/index.ts 追加

// === Agent相关类型 ===

export type AgentCategory = 'creative' | 'analytic' | 'structural' | 'memory' | 'tool';
export type PermissionMode = 'hands_off' | 'supervised' | 'autopilot';
export type TaskStatus = 'pending' | 'running' | 'paused_at_checkpoint'
  | 'failed_awaiting_decision' | 'completed' | 'failed' | 'aborted';

export interface AgentDefinition {
  agentId: string;
  name: string;
  category: AgentCategory;
  description: string;
  systemPrompt: string;
  requiredTools: string[];
  optionalTools: string[];
  apiConfigId: number | null;
  modelParams: ModelParams;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  isBuiltin: boolean;
  version: string;
  projectId: number | null;
}

export interface ModelParams {
  temperature: number;
  maxTokens: number;
  topP: number | null;
}

export interface WorkflowInfo {
  workflowId: string;
  name: string;
  description: string;
  defaultPermissionMode: PermissionMode;
  inputSchema: Record<string, unknown>;
  estimatedTokenCost: number;
}

export interface AgentTask {
  id: number;
  taskId: string;
  projectId: number;
  conversationId: number | null;
  workflowId: string;
  status: TaskStatus;
  permissionMode: PermissionMode;
  input: string;       // JSON字符串
  output: string | null;
  currentNodeId: string | null;
  completedNodes: string;  // JSON数组字符串
  errorLog: string | null;
  totalTokens: number;
  estimatedTokens: number | null;
  cacheHitCount: number;
  cacheMissCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentSettings {
  defaultPermissionMode: PermissionMode;
  maxConcurrency: number;
  tokenThreshold: number;
  autoCleanupOutputs: boolean;
  cleanupAfterDays: number;
}

export type CheckpointDecision =
  | 'continue' | 'skip' | 'abort'
  | { type: 'modify'; content: string };

// 事件类型（见3.4节定义）
export interface AgentChunkEvent { /* ... */ }
export interface AgentProgressEvent { /* ... */ }
export interface CheckpointEvent { /* ... */ }
export interface ToolCallEvent { /* ... */ }
export interface AgentDoneEvent { /* ... */ }
```

---

## 5. 关键技术决策

### 5.1 异步运行时与并发控制

**决策**：复用Tauri内置的tokio运行时，不单独创建。

**理由**：
- Tauri 2.0已集成tokio，`tauri::async_runtime::spawn` 可直接使用
- 现有 `send_message` 命令已是async，验证了可行性
- 避免多运行时管理的复杂性

**并发控制**：
- **数据库操作**：保持同步（rusqlite + Mutex），避免引入async DB驱动
- **LLM调用**：async，复用现有 `stream_chat` 的SSE模式
- **Pipeline执行**：async，`tauri::async_runtime::spawn` 启动后台任务
- **并行节点**：`tokio::stream::buffer_unordered` 控制并发度
- **检查点等待**：使用 `tokio::sync::oneshot` 或 `tokio::sync::Notify` 实现异步等待用户决策

```rust
// 检查点异步等待示例
use tokio::sync::oneshot;

// 在Pipeline引擎中
let (tx, rx) = oneshot::channel::<CheckpointDecision>();
// 将tx存入全局等待表（task_id → tx）
CHECKPOINT_WAITERS.lock().unwrap().insert(task_id.clone(), tx);

// 等待用户决策
let decision = rx.await.map_err(|_| "等待决策时通道关闭".to_string())?;

// 用户决策命令唤醒
pub fn submit_checkpoint_decision(task_id: &str, decision: CheckpointDecision) -> Result<(), String> {
    let waiters = CHECKPOINT_WAITERS.lock().unwrap();
    if let Some(tx) = waiters.get(task_id) {
        tx.send(decision).map_err(|_| "发送决策失败".to_string())
    } else {
        Err("未找到等待中的任务".to_string())
    }
}
```

### 5.2 数据库事务与锁

**决策**：复用现有 `DbState(Mutex<Connection>)` 单连接模式。

**锁竞争风险与缓解**：
- **风险**：Pipeline长时间持锁会阻塞Chat命令
- **缓解**：Pipeline不长期持锁，仅在读写数据时短暂锁定
- **原则**：LLM调用和文件IO在锁外执行

```rust
// 正确模式：短暂持锁
async fn execute_single_node(&mut self, node: &WorkflowNode) -> Result<(), String> {
    // 1. 短暂持锁：读取Agent定义和工具数据
    let agent_def = {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        registry::get_agent(&node.agent_id).ok_or("Agent未注册")?
    };  // 锁已释放

    // 2. 无锁：执行LLM调用（耗时操作）
    let output = executor.execute(/* ... */).await?;

    // 3. 短暂持锁：写入中间产出到数据库
    {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        log_tool_call(&conn, /* ... */)?;
    }

    Ok(())
}
```

**新增表的迁移**：在 `db.rs` 的 `create_tables` 函数末尾追加建表语句。

```rust
// db.rs 的 create_tables 函数追加
fn create_tables(conn: &Connection) -> Result<(), String> {
    // ... 现有表 ...

    // Agent系统新表
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS agent_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            system_prompt TEXT NOT NULL,
            required_tools TEXT NOT NULL DEFAULT '[]',
            optional_tools TEXT NOT NULL DEFAULT '[]',
            api_config_id INTEGER,
            model_params TEXT NOT NULL DEFAULT '{}',
            input_schema TEXT NOT NULL DEFAULT '{}',
            output_schema TEXT NOT NULL DEFAULT '{}',
            is_builtin BOOLEAN NOT NULL DEFAULT 0,
            version TEXT NOT NULL DEFAULT '1.0',
            project_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        );

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
        CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id);

        CREATE TABLE IF NOT EXISTS agent_tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            parameters TEXT NOT NULL,
            result TEXT,
            duration_ms INTEGER,
            success BOOLEAN NOT NULL,
            error_message TEXT,
            cache_hit BOOLEAN NOT NULL DEFAULT 0,
            called_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES agent_tasks (task_id) ON DELETE CASCADE
        );

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
        CREATE INDEX IF NOT EXISTS idx_foreshadows_project ON foreshadows(project_id);
    "#).map_err(|e| format!("创建Agent表失败: {}", e))?;

    Ok(())
}
```

### 5.3 文件系统操作

**决策**：中间产出存于项目目录下的 `./agent_outputs/` 目录。

**路径规则**：
```
{项目数据目录}/agent_outputs/{task_id}/
  ├── n1_keyword_analyst.md
  ├── n2_idea_diverger.md
  ├── n3_conflict_designer.md
  ├── n4_feasibility_evaluator.md
  └── chapters/           # 百万字流水线的特殊子目录
      ├── chapter_1.md
      ├── chapter_2.md
      └── ...
```

**原子写入**：避免崩溃产生半成品文件。

```rust
/// 原子写入文件：先写.tmp再rename
pub fn write_output_atomic(dir: &Path, file_name: &str, content: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;
    let target = dir.join(file_name);
    let tmp = dir.join(format!("{}.tmp", file_name));

    std::fs::write(&tmp, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("重命名文件失败: {}", e))?;

    Ok(())
}
```

**项目目录位置**：复用现有项目数据目录策略。若现有项目无独立目录，则在应用数据目录 `%APPDATA%/Whisper/agent_outputs/` 下按task_id组织。

### 5.4 LLM调用复用策略

**决策**：复用 [llm/client.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs) 的 `stream_chat` 函数核心逻辑，但Agent系统使用独立的事件通道。

**复用方式**：
- **直接复用**：SSE解析、工具调用循环、取消机制、token累计的核心逻辑
- **独立事件**：Agent系统发 `agent:chunk` 而非 `chat:chunk`
- **参数差异**：Agent的temperature/max_tokens来自 `model_params`，不是固定值

**实现方案**：将 `stream_chat` 拆分为通用核心 + 事件发送回调。

```rust
// llm/client.rs 改造：提取通用核心

/// LLM调用的通用核心（不绑定特定事件名）
pub async fn stream_chat_core(
    db: &Mutex<Connection>,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    tools: Option<Vec<serde_json::Value>>,
    temperature: f32,
    max_tokens: i32,
    cancel_token: &Mutex<bool>,
    on_chunk: impl Fn(&str, bool) + Send,  // chunk回调
) -> Result<(String, Option<TokenUsage>), String> {
    // ... 现有stream_chat的逻辑，但通过on_chunk回调发送事件
}

// 现有Chat命令使用（保持兼容）
pub async fn stream_chat(
    app: &AppHandle,
    // ... 现有参数
) -> Result<(String, Option<TokenUsage>), String> {
    let app_clone = app.clone();
    let conversation_id = conversation_id.to_string();
    let message_id = message_id.to_string();
    stream_chat_core(
        db, base_url, api_key, model, messages, tools,
        0.7, 4096, cancel_token,
        move |content, done| {
            let _ = app_clone.emit("chat:chunk", &ChunkEvent {
                conversation_id: conversation_id.clone(),
                message_id: message_id.clone(),
                content: content.to_string(),
                done,
                usage: None,
            });
        },
    ).await
}

// Agent执行器使用
pub async fn stream_agent_chat(
    app: &AppHandle,
    task_id: &str,
    node_id: &str,
    agent_id: &str,
    // ... 其他参数
    model_params: &ModelParams,
) -> Result<(String, Option<TokenUsage>), String> {
    let app_clone = app.clone();
    let task_id = task_id.to_string();
    let node_id = node_id.to_string();
    let agent_id = agent_id.to_string();
    stream_chat_core(
        db, base_url, api_key, model, messages, tools,
        model_params.temperature, model_params.max_tokens, cancel_token,
        move |content, done| {
            let _ = app_clone.emit("agent:chunk", &AgentChunkEvent {
                task_id: task_id.clone(),
                node_id: node_id.clone(),
                agent_id: agent_id.clone(),
                content: content.to_string(),
                done,
                usage: None,
            });
        },
    ).await
}
```

### 5.5 错误处理与日志

**错误处理**：保持现有 `Result<T, String>` 模式，不引入自定义Error类型。

**日志**：复用现有 [logger.rs](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/logger.rs) 的宏，新增Agent专用标签。

```rust
use crate::logger::{log_info, log_error, log_section};

// Agent系统日志标签
const LOG_TAG_AGENT: &str = "AGENT";
const LOG_TAG_PIPELINE: &str = "PIPELINE";
const LOG_TAG_TOOL: &str = "TOOL";
const LOG_TAG_MEMORY: &str = "MEMORY";

// 使用示例
pub async fn execute_single_node(&mut self, node: &WorkflowNode) -> Result<(), String> {
    log_info(LOG_TAG_PIPELINE, &format!("开始执行节点: {} ({})", node.node_id, node.agent_id));

    match executor.execute(/* ... */).await {
        Ok(output) => {
            log_info(LOG_TAG_PIPELINE, &format!(
                "节点完成: {} (token: {})",
                node.node_id,
                output.token_usage.as_ref().map(|u| u.total_tokens).unwrap_or(0)
            ));
            Ok(())
        }
        Err(e) => {
            log_error(LOG_TAG_PIPELINE, &format!("节点失败: {} - {}", node.node_id, e));
            Err(e)
        }
    }
}
```

---

## 6. 数据流详解

### 6.1 任务发起流程

```
用户操作                          前端                          后端
─────────                         ────                          ────
1. 点击TopBar的"Agent"标签
                                  uiStore.setPhase('agent')
                                  MainLayout渲染AgentWorkspace

2. AgentTaskPanel加载
                                  agentStore.loadWorkflows() ──→ agent_list_workflows命令
                                                                registry::list_workflows()
                                  ←── 返回工作流列表 ────────

3. 选择"灵感矩阵生成"
                                  DynamicInputForm渲染
                                  (根据input_schema生成表单)

4. 填写关键词"末世、重生、复仇"
                                  选择权限模式(hands_off)
                                  点击"开始任务"

                                  agentStore.startTask() ────→ agent_start_task命令
                                                                1. 解析输入
                                                                2. 查找工作流
                                                                3. 创建AgentTask记录
                                                                4. 写入agent_tasks表
                                                                5. spawn Pipeline引擎
                                                                6. 返回AgentTask
                                  ←── 返回任务对象 ──────────

                                  set({ currentTask, isTaskRunning: true })
                                  PipelineVisualizer渲染
```

### 6.2 Agent执行流程

```
Pipeline引擎                     Agent执行器                    LLM客户端
───────────                      ──────────                    ─────────
1. 拓扑排序DAG
2. 取下一个节点n1
3. resolve_input(n1)
   (从user_input提取keywords)

4. registry::get_agent(n1.agent_id)
   → keyword_analyst定义

5. 创建AgentExecutorImpl ────→  6. 组装messages:
                                  [system_prompt, user_input]
                                7. 获取available_tools()
                                8. stream_agent_chat() ──────→ 9. POST /chat/completions
                                                                  (SSE流式)
                                                                ←── chunk1 ────
                                10. on_chunk回调 ────────────── emit("agent:chunk", ...)
                                                                  前端streamingContent追加
                                                                ←── chunk2 ────
                                                                  ...
                                                                ←── done ──────
                                ←── 返回(full_content, usage) ─

11. 写入中间产出文件
    ./agent_outputs/{task_id}/
    n1_keyword_analyst.md

12. 存入context.node_outputs
13. 累计token
14. emit("agent:progress", ...)
15. 标记n1完成
16. 持久化到agent_tasks表
17. 取下一个节点n2...
```

### 6.3 工具调用流程

```
Agent执行器                      工具适配层                     内部函数
──────────                      ──────────                    ─────────
LLM返回tool_calls:
  [{name: "agent.query_setting_cards",
    arguments: {"card_type": "character"}}]

1. 解析tool_calls
2. 对每个tool_call:
   execute_tool(
     "agent.query_setting_cards",
     {"card_type": "character"},
     context, cache
   ) ─────────────────────────→ 3. get_tool("agent.query_setting_cards")
                                  → QuerySettingCardsTool
                                4. check_tool_permission(agent, tool_id)
                                5. 缓存检查 (miss)
                                6. handler.execute(params, ctx) ──→ 7. list_cards_internal(
                                       db, project_id, card_type
                                   )
                                                                   8. SELECT * FROM setting_cards
                                                                   WHERE project_id=? AND card_type=?
                                                                   ←── 返回卡片列表 ──
                                ←── 返回ToolResult ───────────── 9. 格式化结果文本

                                10. log_tool_call() 写入agent_tool_calls表
                                11. 写入缓存
                                ←── 返回ToolResult ──────────────

12. 将tool_result拼入messages
13. 继续LLM调用循环
    (可能再次返回tool_calls，
     或返回最终content)
```

### 6.4 检查点交互流程

```
Pipeline引擎                     前端                          用户
───────────                      ────                          ────
1. 节点n2完成
2. 检查n2是否为检查点
   (checkpoints.contains("n2"))
3. permission_mode == Supervised
4. 更新task状态为
   PausedAtCheckpoint
5. emit("agent:checkpoint", {
     task_id, node_id: "n2",
     output_content: "...",
     output_file_path: "..."
   }) ─────────────────────────→ 6. agentStore收到事件
                                  set({ checkpoint, showCheckpointDialog: true })
                                  CheckpointDialog渲染
                                  展示n2的产出 ───────────────→ 7. 用户查看产出

                                                                8. 用户选择"修改"
                                                                   编辑产出内容
                                                                   点击"保存修改"

                                  9. checkpointDecision({       ←── 用户决策
                                       type: 'modify',
                                       content: editedContent
                                     })

                                  agentStore.checkpointDecision() ──→ 10. agent_checkpoint_decision命令
                                                                          11. submit_checkpoint_decision(task_id, decision)
                                                                          12. 通过oneshot通道唤醒Pipeline

13. 收到决策 Modify(content)
14. 用修改后的content更新
    context.node_outputs["premises"]
15. 继续执行n3
16. 更新task状态为Running
```

### 6.5 错误恢复流程

```
场景：n3节点LLM调用失败（API超时）

Pipeline引擎                     前端                          用户
───────────                      ────                          ────
1. n3执行失败
2. 根据permission_mode:

   [HandsOff模式]
   3a. 更新task状态为Failed
   4a. 记录error_log
   5a. emit("agent:done", {
         status: "failed",
         error_log: "API超时"
       }) ─────────────────────→ 显示错误提示 ───────────────→ 用户看到失败

   [Supervised模式]
   3b. 更新task状态为
       FailedAwaitingDecision
   4b. emit("agent:checkpoint", {
         type: "error",
         node_id: "n3",
         error: "API超时",
         options: ["retry", "skip", "modify_input", "abort"]
       }) ─────────────────────→ 显示错误决策弹窗 ───────────→ 用户选择"重试"

                                  checkpointDecision("retry") ──→ 5b. 唤醒Pipeline
   6b. 收到决策 Retry
   7b. 重新执行n3
   8b. 更新task状态为Running

   [Autopilot模式]
   3c. 自动重试（指数退避）
       1s后重试 → 失败
       2s后重试 → 失败
       4s后重试 → 成功
   4c. 若重试耗尽(retry_limit=3):
       标记n3为skipped_failed
       继续执行n4
   5c. emit("agent:progress", {
         nodes: [{ node_id: "n3", status: "skipped" }]
       })
```

---

## 7. 与现有系统的集成

### 7.1 数据库共享与隔离

**共享表**（只读或读写现有表）：
- `projects`：查询项目信息（`agent.query_project_info`）
- `setting_cards`：读写设定卡（`agent.create_setting_card` 等）
- `chapters`：读写章节/大纲（`agent.create_outline_node` 等）
- `conversations`：写入最终结果到对话历史
- `messages`：写入最终结果作为消息
- `api_configs`：查询API配置

**新增表**（Agent系统独占）：
- `agent_definitions`：自定义Agent定义
- `agent_tasks`：任务执行历史
- `agent_tool_calls`：工具调用日志
- `story_memory`：记忆库
- `foreshadows`：伏笔管理

**隔离原则**：
- Agent系统不修改现有表的结构
- Agent系统的命令不调用现有Tauri命令（通过内部函数复用）
- 数据库迁移仅追加新表，不修改现有表

### 7.2 LLM客户端复用

**复用内容**：
- SSE解析逻辑（eventsource-stream）
- 工具调用循环（had_tool_calls标志、tool_calls_accumulated）
- 取消机制（CancellationTokenState）
- token累计（accumulated_usage）

**隔离内容**：
- 事件名：`agent:chunk` 而非 `chat:chunk`
- 事件payload：`AgentChunkEvent` 而非 `ChunkEvent`
- 模型参数：来自Agent的 `model_params`，非固定值
- system_prompt：来自Agent定义，非 `llm::prompt::build_system_prompt`

**改造方式**：提取 `stream_chat_core` 通用函数（见5.4节），现有 `stream_chat` 和新的 `stream_agent_chat` 都调用它。

### 7.3 前端组件复用

**直接复用**：
- `common/Button`、`common/Dialog`、`common/Toast`：通用UI组件
- `react-markdown` + `remark-gfm`：Markdown渲染
- `clsx`：类名拼接
- `lucide-react`：图标

**模式复用**（参照实现，非直接引用）：
- Store定义模式：`create<State>((set, get) => ({}))`
- 事件监听模式：`initXxxListener` 返回 `unlisten`
- Tauri调用模式：`tauriInvoke<T>` 扁平参数
- 选择器优化：`useXxxStore((s) => s.field)`

**不复用**：
- `chatStore`：Agent系统有独立的 `agentStore`
- `MessageBubble`：Agent产出用独立的 `NodeCard` 组件展示
- `ChatInput`：Agent输入用独立的 `DynamicInputForm`

### 7.4 配置系统复用

**API配置复用**：
- Agent默认使用项目绑定的 `api_configs` 记录
- Agent的 `api_config_id` 字段指向 `api_configs.id`
- 若为None，使用项目的默认API配置

**设置存储**：
- Agent系统设置（权限模式默认值、最大并行度、token阈值）存入现有设置机制
- 可复用 `api_configs` 表的扩展字段，或新增 `agent_settings` 表（键值对存储）

```rust
// 新增agent_settings表（简化键值对）
CREATE TABLE IF NOT EXISTS agent_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 8. 开发规范与约束

### 8.1 Rust编码规范

遵循现有项目规范（来自项目工程实践记录）：

1. **命令参数扁平化**：所有 `#[tauri::command]` 参数为扁平类型，禁止嵌套struct
2. **命名规范**：snake_case（模块/函数/变量）、PascalCase（struct/trait）
3. **错误处理**：统一 `Result<T, String>`，`.map_err(|e| format!("xxx失败: {}", e))?`
4. **时间戳**：`chrono::Utc::now().to_rfc3339()`
5. **ID生成**：`uuid::Uuid::new_v4().to_string()`
6. **数据库锁**：`db.0.lock().map_err(|e| format!("获取数据库锁失败: {}", e))?`
7. **字符串截断**：使用 `chars().take(N).collect::<String>()`，禁止字节切片
8. **工具去重**：工具定义按function name去重后再发送给LLM
9. **空内容检查**：`if !content.trim().is_empty()` 才保存/处理
10. **工具调用消息**：必须包含 `tool_call_id`，assistant消息必须包含完整 `tool_calls` 数组

### 8.2 前端编码规范

1. **Store模式**：`create<State>((set, get) => ({}))`，无中间件
2. **跨Store调用**：`useXxxStore.getState()`，循环依赖用动态 `import()`
3. **Tauri调用**：通过 `utils/tauri.ts` 封装，扁平参数，camelCase
4. **事件监听**：在组件 `useEffect` 中挂载，返回 `unlisten` 清理函数
5. **选择器优化**：`useXxxStore((s) => s.field)` 细粒度订阅
6. **样式**：Tailwind + CSS变量，`clsx` 拼接
7. **图标**：`lucide-react`
8. **StrictMode**：保持禁用（避免重复事件监听器）

### 8.3 项目工程实践记录约束

以下约束来自Whisper项目的历史教训（项目工程实践记录），Agent系统必须遵守：

| 约束 | 说明 | 应用点 |
|---|---|---|
| Tauri 2.0扁平参数 | 嵌套struct导致反序列化失败 | 所有agent_*命令 |
| React StrictMode禁用 | 防止重复事件监听器 | 保持main.tsx现状 |
| 工具定义每轮发送 | 不仅是第一轮 | Agent执行器的LLM调用循环 |
| 工具定义去重 | 按function name去重 | 工具适配层组装tools数组 |
| tool_call_id关联 | 工具结果消息必须带此字段 | Agent执行器消息组装 |
| 完整tool_calls数组 | assistant消息必须包含 | Agent执行器消息组装 |
| 空内容不持久化 | trim后为空则不保存 | Agent产出写入数据库前检查 |
| had_tool_calls标志 | 不依赖数组is_empty判断 | Agent执行器工具调用循环 |
| 字符边界安全截断 | chars().take() | 工具结果摘要、LLM上下文裁剪 |
| 自动关联项目 | 无project_id时自动查找 | agent_start_task命令 |
| 项目不存在自动创建 | INSERT OR IGNORE | 工具执行时的外键约束处理 |

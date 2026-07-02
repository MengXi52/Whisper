# 大模型对话全流程详解

本文档详细描述了「轻语」项目中从用户输入到最终回复的完整流程，包含前端、后端、工具调用、流式响应等关键环节。

## 目录

- [一、整体架构](#一整体架构)
- [二、阶段一：前端触发](#二阶段一前端触发)
- [三、阶段二：后端处理](#三阶段二后端处理)
  - [3.1 STEP 1‑2：消息入库 + 获取会话信息](#31-step-12消息入库--获取会话信息)
  - [3.2 STEP 3：加载历史消息](#32-step-3加载历史消息)
  - [3.3 STEP 4：加载技能和工具](#33-step-4加载技能和工具)
  - [3.4 STEP 5‑6：注入设定卡和章节上下文](#34-step-56注入设定卡和章节上下文)
  - [3.5 STEP 7：构建 System Prompt](#35-step-7构建-system-prompt)
  - [3.6 STEP 8：确定工具列表](#36-step-8确定工具列表)
  - [3.7 STEP 9‑10：获取 API 配置 + 拼接消息](#37-step-910获取-api-配置--拼接消息)
  - [3.8 STEP 11：stream_chat — 多轮工具循环](#38-step-11stream_chat--多轮工具循环)
    - [3.8.1 SSE 流式解析](#381-sse-流式解析)
    - [3.8.2 工具调用累积](#382-工具调用累积)
    - [3.8.3 finish_reason 判断](#383-finish_reason-判断)
    - [3.8.4 工具执行](#384-工具执行)
    - [3.8.5 消息格式规范](#385-消息格式规范)
  - [3.9 STEP 12：保存结果 + 发送完成事件](#39-step-12保存结果--发送完成事件)
- [四、阶段三：前端收尾](#四阶段三前端收尾)
- [五、工具定义格式](#五工具定义格式)
- [六、可用工具列表](#六可用工具列表)
- [七、日志系统](#七日志系统)
- [八、常见问题排查](#八常见问题排查)

---

````
用户输入
  │
  ▼
┌─────────────────────────────────────────┐
│          前端 chatStore.ts              │
│  isGenerating=true, 显示加载状态          │
│  tauri.sendMessage(...)                  │
└──────────────┬──────────────────────────┘
               │ Tauri IPC
               ▼
┌─────────────────────────────────────────┐
│      Rust: send_message (chat.rs)       │
│  ┌─────────────────────────────────┐   │
│  │ STEP1  保存用户消息到 DB         │   │
│  │ STEP2  查询会话信息              │   │
│  │ STEP3  加载历史消息              │   │
│  │ STEP4  加载技能+工具             │   │
│  │ STEP5  查询设定卡摘要            │   │
│  │ STEP6  查询章节上下文            │   │
│  │ STEP7  构建 System Prompt       │   │
│  │ STEP8  确定工具列表              │   │
│  │ STEP9  获取 API 配置            │   │
│  │ STEP10 拼接消息列表              │   │
│  └──────────┬──────────────────────┘   │
│             ▼                          │
│  ┌─────────────────────────────────┐   │
│  │    stream_chat (client.rs)      │   │
│  │  ┌─────────────────────────┐    │   │
│  │  │ 循环 (最多10轮)          │    │   │
│  │  │  POST API → SSE 流式     │    │   │
│  │  │  ├─ content → 逐字推送   │    │   │
│  │  │  │  (emit chat:chunk)    │    │   │
│  │  │  └─ tool_calls → 执行    │    │   │
│  │  │     └─ 结果加入 messages  │    │   │
│  │  └─────────────────────────┘    │   │
│  │  → 返回最终 full_content       │   │
│  └──────────┬──────────────────────┘   │
│             ▼                          │
│  ┌─────────────────────────────────┐   │
│  │ STEP11 保存助手消息到 DB         │   │
│  │ STEP12 emit done:true           │   │
│  └─────────────────────────────────┘   │
└──────────────┬──────────────────────────┘
               │ Tauri Event: chat:chunk
               ▼
┌─────────────────────────────────────────┐
│          前端 chatStore.ts              │
│  done=true → 固定消息, isGenerating=false│
│  用户看到完整回复                        │
└─────────────────────────────────────────┘
````

## 一、整体架构

```
┌─────────────┐    Tauri IPC    ┌─────────────┐
│  前端 React │───────────────▶│ 后端 Rust  │
│  (chatStore)│◀───────────────│(Tauri 命令)│
└──────┬──────┘   chat:chunk    └──────┬──────┘
       │                               │
       │  SSE 流式事件                  │ 数据库操作
       │                               ▼
       │                          ┌─────────────┐
       │                          │  SQLite DB  │
       │                          │ (projects,  │
       │                          │  chapters,  │
       │                          │  settings,  │
       │                          │  messages)  │
       │                          └─────────────┘
       │                               │
       ▼                               │
┌─────────────┐                       │
│ 增量渲染    │                       │
│ (chat:chunk)◀────────────────────────┘
└─────────────┘
```

**核心特点：**
- 采用 OpenAI 兼容的 **Function Calling** 协议
- 支持**多轮工具调用循环**（最多 10 轮）
- **SSE 流式响应**，逐字渲染到前端
- 所有消息持久化存储到 SQLite
- 默认加载 11 个内置工具，LLM 在任何阶段都可调用

---

## 二、阶段一：前端触发

**文件：** [`src/stores/chatStore.ts`](file:///c:/Users/admin/Desktop/Whisper/src/stores/chatStore.ts#L148-L177)

```typescript
// 用户点击发送
sendMessage: async (content) => {
  const { currentConversation, activeSkillIds } = get();
  if (!currentConversation) return;

  // 1. 先将用户消息添加到本地列表（即时显示）
  const userMessage: Message = {
    id: crypto.randomUUID(),
    conversation_id: currentConversation.id,
    role: 'user',
    content,
    model: '',
    created_at: new Date().toISOString(),
  };
  set({
    messages: [...state.messages, userMessage],
    isGenerating: true,    // 显示加载状态
    streamingContent: '',  // 清空流式缓存
  });

  // 2. 调用后端 Tauri 命令
  await tauri.sendMessage(
    currentConversation.id,  // 当前对话ID
    content,                 // 用户输入
    getModel(),             // 使用的模型
    activeSkillIds          // 激活的技能ID列表
  );
}
```
```
用户输入 "创建琪亚娜设定卡"
│
▼
1. chatStore.sendMessage()
   ├─ 设置 isGenerating = true（显示加载状态）
   ├─ 创建临时 userMessage 加入消息列表
   └─ 调用 Tauri 命令:
   tauri.sendMessage(
   conversation_id,     // 当前对话ID
   content,             // 用户输入文本
   getModel(),          // 当前选中的模型
   activeSkillIds       // 激活的技能ID列表（[] 或 ["skill_id"]）
   )

**关键点：**
- `activeSkillIds = []` 表示不激活任何技能，后端会自动加载所有内置工具
- 用户输入先加入本地列表，避免发送后"消失不见"

---
```
## 三、阶段二：后端处理

**入口：** [`commands/chat.rs::send_message`](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/commands/chat.rs#L11-L285)

### 3.1 STEP 1‑2：消息入库 + 获取会话信息

```rust
// STEP 1: 保存用户消息
let user_msg_id = uuid::Uuid::new_v4().to_string();
conn.execute(
    "INSERT INTO messages (id, conversation_id, role, content, model, created_at) 
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![user_msg_id, conversation_id, "user", content, None, now],
);

// 更新会话时间
conn.execute(
    "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
    params![now, conversation_id],
);

// STEP 2: 获取会话信息
let (project_id, phase, context_chapter_id): (Option<String>, String, Option<String>) = 
    conn.query_row(
        "SELECT project_id, phase, context_chapter_id FROM conversations WHERE id = ?1",
        params![conversation_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
```

**日志输出：**
```
[STEP1] 收到用户消息 | 对话ID: a57e7cb4... | 内容: 创建崩坏三的琪亚娜设定卡
[STEP2] 会话信息 | project_id: None | phase: ideation | context_chapter: None
```

---

### 3.2 STEP 3：加载历史消息

```rust
// 查询该对话所有消息，按时间排序
let history: Vec<(String, String)> = conn
    .query_map(
        "SELECT role, content FROM messages 
         WHERE conversation_id = ?1 ORDER BY created_at ASC",
        params![conversation_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?
    .collect()?;
```

这些历史消息会拼入 LLM 请求的 `messages` 列表，作为对话上下文。

**日志输出：**
```
[STEP3] 历史消息 | 共 5 条 (含刚保存的用户消息)
```

---

### 3.3 STEP 4：加载技能和工具

```rust
let (skill_prompts, tools): (Vec<String>, Option<Vec<Value>>) = 
    if let Some(sids) = skill_ids {
        // 逐个技能加载
        for sid in sids {
            let (sp, tools_str): (String, String) = 
                conn.query_row(
                    "SELECT system_prompt, tools FROM skills WHERE id = ?1",
                    params![sid],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                ).unwrap_or_default();
            
            if !sp.is_empty() {
                prompts.push(sp);        // 收集 system prompt
            }
            if !tools_str.is_empty() {
                // 解析 JSON 工具定义，添加到列表
                serde_json::from_str(&tools_str) → all_tools.extend(...)
            }
        }
        (prompts, if all_tools.is_empty() { None } else { Some(all_tools) })
    } else {
        (Vec::new(), None)
    };
    
    如果 skill_ids = Some([...])：
├─ 逐个从 skills 表读取 system_prompt 和 tools JSON
├─ 合并所有 system_prompt → skill_prompts
└─ 合并所有 tools JSON → all_tools

如果 skill_ids = None/[]：
└─ skill_prompts = []，tools = None
```

**日志输出：**
```
[STEP4] 未加载技能 | skill_ids: None
[STEP4] 加载技能 | skill_ids: ["b69fe..."]
[STEP4]   - 技能system_prompt: 1234 字符
[STEP4]   - 加载工具定义: 11 个
```

---

### 3.4 STEP 5‑6：注入设定卡和章节上下文

```rust
// STEP 5: 设定卡摘要（如果有关联项目）
let setting_summary = if let Some(pid) = project_id {
    let cards: Vec<(name, card_type, fields)> = 
        conn.query("SELECT ... FROM setting_cards WHERE project_id = ?", pid)?
            .collect();
    // 格式化为:
    // 【项目设定摘要】
    // - [character] 琪亚娜·卡斯兰娜: {"基本信息": {...}}
}

// STEP 6: 章节内容（如果是写作阶段）
let chapter_context = if phase == "writing" && let Some(cid) = context_chapter_id {
    let content: String = conn.query_row("SELECT content FROM chapters WHERE id = ?", cid)?;
    // 格式化为:
    // 【当前章节内容】
    // ...正文...
}

如果 project_id 非空：
├─ SELECT name, card_type, fields FROM setting_cards
└─ 拼装成 【项目设定摘要】xxx

如果 phase == "writing" 且有 context_chapter_id：
├─ SELECT content FROM chapters
└─ 拼装成 【当前章节内容】xxx
```

**日志输出：**
```
[STEP5] 设定卡摘要 | 项目 xxx 暂无设定卡
[STEP6] 章节上下文 | 阶段为 ideation，不注入
```

---

### 3.5 STEP 7：构建 System Prompt

**文件：** [`llm/prompt.rs`](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/prompt.rs#L6-L62)

System Prompt 由多个段落拼接而成：

```rust
let mut parts = Vec::new();

// 段落 1: 基础角色设定
parts.push("你是「轻语」AI写作助手，一位专业的小说创作顾问...".to_string());

// 段落 2: 阶段提示
parts.push(match phase {
    "ideation" → "【当前阶段：构思】引导用户明确核心创意...",
    "planning" → "【当前阶段：计划】帮助用户构建完整的故事框架...",
    "writing" → "【当前阶段：写作】帮助用户完成章节内容的创作...",
    "editing" → "【当前阶段：修改/编辑】帮助用户改进和润色已有内容...",
});

// 段落 3: 技能注入（如果激活了技能）
for sp in skill_prompts {
    parts.push(format!("【技能注入】\n{}", sp));
}

// 段落 4: 设定卡摘要
if !setting_summary.is_empty() {
    parts.push(setting_summary);
}

// 段落 5: 章节上下文
if !chapter_context.is_empty() {
    parts.push(chapter_context);
}

// 段落 6: 工具调用上下文（关键！）
let tool_context = format!(
    "【工具调用上下文】\n\
     当前对话ID: {}\n\
     当前项目ID: {}\n\
     调用工具时，请使用上述 ID 作为 project_id 或 conversation_id 参数。",
    conversation_id,
    project_id.unwrap_or("无关联项目")
);
parts.push(tool_context);

// 拼接最终结果
parts.join("\n\n")


段落1: 【基础角色设定】
   "你是「轻语」AI写作助手，一位专业的小说创作顾问..."

段落2: 【阶段 prompt】（根据 phase 选择）
   "【当前阶段：构思】"     → ideation
   "【当前阶段：计划】"     → planning  
   "【当前阶段：写作】"     → writing
   "【当前阶段：修改/编辑】" → editing

段落3: 【技能注入】（如果有激活的技能）
   "精通古风言情风格的写作技能..."

段落4: 【项目设定摘要】（如果有设定卡）
   "【项目设定摘要】
    - [character] 琪亚娜: {...}"

段落5: 【工具调用上下文】（关键！）
   "当前对话ID: xxx
    当前项目ID: xxx  ← 无关联项目时为"无关联项目"
    调用工具时，请使用上述 ID 作为 project_id 或 conversation_id 参数。"
```

**关键点：** `【工具调用上下文】` 告诉 LLM 当前的 `project_id` 和 `conversation_id`，这样 LLM 调用工具时才能正确填入参数。

**日志输出：**
```
[PROMPT] 构建 System Prompt | phase: ideation | skills: 0 | 设定卡: 无 | 章节: 无
[PROMPT] 工具调用上下文 | project_id: None | conversation_id: a57e7cb4...
[PROMPT] System Prompt 构建完成 | 共 1234 字符 | 6 个段落
[DEBUG] 完整 System Prompt:
<完整文本输出到日志>
```

---

### 3.6 STEP 8：确定工具列表

**优先级规则：**

```rust
let tools = if tool_hint.is_some() {
    // 情况 1: 用户输入 /command → 强制加载所有内置工具
    Some(load_all_tools(db)?)
} else if tools.is_none() {
    // 情况 2: 没有激活技能 → 默认加载所有内置工具（去重后 11 个）
    let builtin = load_all_tools(db)?;
    if builtin.is_empty() { None } else { Some(builtin) }
} else {
    // 情况 3: 激活技能提供了工具 → 使用技能工具
    tools
};

1. 如果用户输入以 / 开头（如 /create_chapter）
   → load_all_tools() 加载所有内置工具（12个）
   → 并在 system prompt 追加 "你只能调用工具，不要输出任何内容"

2. 如果 tools 仍为 None（无激活技能，无 / 命令）
   → load_all_tools() 加载去重后的 11 个内置工具
   → 作为默认工具集

3. 如果 skill_ids 提供了工具
   → 直接使用技能提供的工具
```

`load_all_tools` 会：
1. 从 `skills` 表查询所有 `is_builtin = 1` 的技能
2. 收集所有 `tools` JSON 定义
3. **按工具名称去重**（避免多个内置技能重复定义同一个工具）
4. 返回 `Vec<Value>`

**日志输出：**
```
[STEP8] 工具列表 | 默认加载 12 个工具: ["query_outline", "create_chapter", ...]
```

---

### 3.7 STEP 9‑10：获取 API 配置 + 拼接消息

```rust
// 查询默认 API 配置
let (base_url, api_key, default_model) = conn.query_row(
    "SELECT base_url, api_key, model_thinking FROM api_configs WHERE is_default = 1 LIMIT 1",
    [],
    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
)?;

// 确定最终使用的模型
let use_model = model.unwrap_or(default_model);

// 拼接消息列表
let mut messages = Vec::new();

// 第一条: system prompt
messages.push(ChatMessage {
    role: "system".into(),
    content: final_system_prompt,
    tool_calls: None,
    tool_call_id: None,
});

// 追加历史消息
for (role, content) in &history {
    messages.push(ChatMessage {
        role: role.clone(),
        content: content.clone(),
        tool_calls: None,
        tool_call_id: None,
    });
}

SELECT base_url, api_key, model_thinking FROM api_configs WHERE is_default = 1

最终消息列表：
[
  { role: "system",   content: final_system_prompt },  ← 含工具上下文
  { role: "user",     content: "第一条历史消息" },
  { role: "assistant",content: "第一条回复" },
  ...
  { role: "user",     content: "创建琪亚娜设定卡" },    ← 最新用户输入
]
```

**数据结构：**
```rust
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Vec<Value>>,  // 工具调用列表（仅助手消息）
    pub tool_call_id: Option<String>,      // 关联调用ID（仅工具结果）
}
```

**日志输出：**
```
[STEP9] API配置 | base_url: https://api.openai.com | model: gpt-4o
[STEP10] 消息列表构建完成 | 共 6 条消息 (system + 5 条历史)
```

---

### 3.8 STEP 11：stream_chat — 多轮工具循环

**文件：** [`llm/client.rs::stream_chat`](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs#L21-L258)

这是整个流程的核心。实现了一个循环：**请求 → 流式接收 → 判断 → 工具执行 → 再次请求**，直到 LLM 返回纯文本。

```rust
let max_tool_rounds = 10;
let mut tool_round = 0;

loop {
    tool_round += 1;
    if tool_round > max_tool_rounds {
        return Err("工具调用次数超过最大限制");
    }

    // 构造请求体
    let request_body = ChatRequest {
        model: model.to_string(),
        messages: messages.clone(),
        stream: true,
        temperature: Some(0.7),
        max_tokens: Some(4096),
        tools: tools.clone(),  // 每轮都发送工具定义
    };

    // 发送 POST 请求
    let response = client.post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await?;

    // SSE 流式解析
    let stream = response.bytes_stream().eventsource();
    let mut full_content = String::new();
    let mut tool_calls_accumulated: Vec<ToolCallResult> = Vec::new();

    while let Some(event) = stream.next().await {
        // ... 逐 chunk 处理
    }

    // 如果本轮有工具调用 → 执行并继续下一轮
    if !tool_calls_accumulated.is_empty() {
        let tool_results = execute_tools(db, &tool_calls_accumulated)?;

        // 添加助手消息（包含 tool_calls）
        messages.push(ChatMessage {
            role: "assistant".into(),
            content: full_content.clone(),
            tool_calls: Some(tool_calls_json),
            tool_call_id: None,
        });

        // 添加工具结果（关联 tool_call_id）
        for (tc, result) in tool_calls_accumulated.iter().zip(tool_results.iter()) {
            messages.push(ChatMessage {
                role: "tool".into(),
                content: result.clone(),
                tool_calls: None,
                tool_call_id: Some(tc.tool_call_id.clone()),
            });
        }

        full_content.clear();
        tool_calls_accumulated.clear();
        continue;  // 进入下一轮循环
    }

    // 没有工具调用 → 返回最终结果
    return Ok(full_content);
}


          ┌────────────────────────────────────────────┐
          │             第 N 轮循环                     │
          │                                            │
          │   POST /chat/completions                   │
          │   { model, messages, stream:true, tools }  │
          │          │                                  │
          │          ▼                                  │
          │   SSE 流式响应                              │
          │   ├─ delta.content → 逐字推送给前端         │
          │   │   (emit chat:chunk with done:false)     │
          │   ├─ delta.tool_calls → 逐 chunk 累积       │
          │   │   (按 index 合并 name + arguments)      │
          │   └─ finish_reason:                         │
          │       ├─ "tool_calls" → 进入工具执行分支    │
          │       └─ "stop"       → 完成本轮            │
          │                                            │
          ▼                                            │
    finish_reason = "tool_calls"?                      │
          │                                            │
          ├─ YES:                                      │
          │   1. execute_tools() 查询 DB 执行操作       │
          │   2. 构造 assistant 消息 (含 tool_calls)    │
          │   3. 构造 tool 消息 (含 tool_call_id)       │
          │   4. 加入 messages 列表                       │
          │   5. clear full_content                     │
          │   6. continue → 第 N+1 轮                   │
          │                                            │
          └─ NO (finish_reason = "stop"):              │
               return full_content                     │
               (退出循环)                               │
                                                        │
          最大 10 轮，超过则返回错误                       │
          └────────────────────────────────────────┘
```

---

#### 3.8.1 SSE 流式解析

LLM API 返回 Server-Sent Events 格式：

```
data: {"choices":[{"delta":{"content":"我来"},"index":0}]}
data: {"choices":[{"delta":{"content":"为您创"},"index":0}]}
data: {"choices":[{"delta":{"content":"建设定卡"},"index":0}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"},"index":0}]}
data: [DONE]
```

后端每收到一个 `content` 增量，立即通过 Tauri 事件推送给前端：

```rust
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
```

---

#### 3.8.2 工具调用累积

当 LLM 返回 `tool_calls` 时，增量拼接参数：

```rust
if let Some(tc_array) = delta.get("tool_calls") {
    for tc in tc_array.as_array() {
        let index = tc.get("index").unwrap_or(0) as usize;
        let tc_id = tc.get("id").unwrap_or("");
        let name = tc["function"]["name"].unwrap_or("");
        let args = tc["function"]["arguments"].unwrap_or("");

        // 按 index 累积
        while tool_calls_accumulated.len() <= index {
            tool_calls_accumulated.push(ToolCallResult { ... });
        }
        let entry = &mut tool_calls_accumulated[index];
        entry.tool_call_id = tc_id;
        entry.name += name;          // 增量拼接名称
        entry.arguments += args;    // 增量拼接参数 JSON
    }
}
```

---

#### 3.8.3 finish_reason 判断

```rust
if let Some(reason) = finish_reason.as_str() {
    if reason == "tool_calls" {
        // LLM 要求调用工具 → 执行工具
        let tool_results = execute_tools(db, &tool_calls_accumulated)?;
        // ... 添加消息到 messages ...
        continue;  // 下一轮
    }
}
// reason == "stop" → 没有工具调用，返回结果
```

**日志输出：**
```
[STREAM] --- LLM 请求轮次 1 ---
[STREAM] 消息数: 6 | 工具数: 12
[STREAM] API响应状态: 200 OK
[STREAM] LLM 返回 tool_calls，共 1 个 (本轮已收内容: 0 字符)
[STREAM]   tool_call[0]: query_setting_cards | parameters: {"project_id": "xxx"}
```

---

#### 3.8.4 工具执行

**文件：** [`llm/client.rs::execute_tools`](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/llm/client.rs#L260-L285)

```rust
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
            _ => format!("工具 '{}' 未实现", tc.name),
        };
        let preview = result.chars().take(200).collect::<String>();
        log_info!("TOOL", "工具 {} 执行结果(前200字): {}", tc.name, preview);
        results.push(result);
    }
    Ok(results)
}

execute_tools() 根据 tool_call.name 分发到对应函数
├─ "create_setting_card" → 解析参数 → INSERT setting_cards
│   └─ 同时自动创建缺失的项目（INSERT OR IGNORE）
├─ "query_setting_cards" → SELECT 设定卡 → 格式化输出
├─ "create_chapter"      → INSERT 章节 → 自动创建项目
└─ 其他工具 → 对应的 SQL 操作
```

**关键点（解决 FOREIGN KEY 问题）：**

`create_chapter` 和 `create_setting_card` 会自动确保项目存在：

```rust
// 自动创建缺失的项目，避免 FOREIGN KEY 约束失败
conn.execute(
    "INSERT OR IGNORE INTO projects (id, name, ...) VALUES (?1, ?2, ...)",
    params![args.project_id, args.name, now],
).ok();
```

---

#### 3.8.5 消息格式规范

工具调用完成后，消息列表格式严格遵循 OpenAI 规范：

| 消息角色 | tool_calls 字段 | tool_call_id 字段 | 含义 |
|----------|----------------|------------------|------|
| `system` | `None` | `None` | 系统提示 |
| `user` | `None` | `None` | 用户消息 |
| `assistant` | `Some([...])` | `None` | LLM 返回的工具调用列表，每个元素包含 `id`, `type`, `function` |
| `tool` | `None` | `Some("call_id")` | 工具执行结果，`tool_call_id` 关联到上面的调用 |

示例（一轮工具调用后）：

```json
[
  {"role": "system", "content": "..."},
  {"role": "user", "content": "创建琪亚娜设定卡"},
  {"role": "assistant", "content": "", "tool_calls": [
    {
      "id": "call_123",
      "type": "function",
      "function": {"name": "create_setting_card", "arguments": "{...}"}
    }
  ]},
  {"role": "tool", "tool_call_id": "call_123", "content": "设定卡已创建: [character] 琪亚娜 (id: ...)"}
]
```

---

### 3.9 STEP 12：保存结果 + 发送完成事件

```rust
// 保存助手消息到数据库
conn.execute(
    "INSERT INTO messages (id, conversation_id, role, content, model, created_at) 
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![assistant_msg_id, conversation_id, "assistant", full_content, use_model, now],
);

// 如果是第一条消息，自动设置会话标题
conn.execute(
    "UPDATE conversations SET updated_at = ?1, 
              title = CASE WHEN title = '' THEN SUBSTR(?2, 1, 20) ELSE title END 
          WHERE id = ?3",
    params![now, content, conversation_id],
);

// 发送完成事件给前端
let done_event = ChunkEvent {
    conversation_id: conversation_id.clone(),
    message_id: assistant_msg_id.clone(),
    content: String::new(),
    done: true,
};
app.emit("chat:chunk", &done_event)?;
```

**日志输出：**
```
[STEP11] 助手消息已保存 | 消息ID: xxx
[STEP12] 完成事件已发送 | done: true
[SECTION] send_message 结束
```

---

## 四、阶段三：前端收尾

**文件：** [`chatStore.ts::initChunkListener`](file:///c:/Users/admin/Desktop/Whisper/src/stores/chatStore.ts#L235-L272)

前端启动时注册 `chat:chunk` 事件监听：

```typescript
const unlisten = await listen<{ content: string; done: boolean }>('chat:chunk', (event) => {
  const { content, done } = event.payload;

  if (done) {
    // 流式响应完成，保存消息
    set((state) => {
      const { streamingContent, currentConversation } = state;
      if (streamingContent && currentConversation) {
        const aiMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: currentConversation.id,
          role: 'assistant',
          content: streamingContent,
          model: getModel(),
          created_at: new Date().toISOString(),
        };
        return {
          messages: [...state.messages, aiMessage],
          streamingContent: '',
          isGenerating: false,  // 结束加载状态
        };
      }
      return { isGenerating: false, streamingContent: '' };
    });
    return;
  }

  // 增量追加流式内容
  set((state) => ({
    streamingContent: state.streamingContent + content,
  }));
});
```

**显示效果：**
- 收到 `done: false` → `streamingContent` 增量渲染，底部显示正在生成的文本
- 收到 `done: true` → 将累积的 `streamingContent` 转换为完整消息，清空缓存

---

## 五、工具定义格式

所有工具定义存储在 `skills` 表的 `tools` 字段，JSON 格式，遵循 OpenAI Function Calling：

```json
{
  "type": "function",
  "function": {
    "name": "create_setting_card",
    "description": "在指定项目中创建一张新的设定卡，人物/世界设定/物品都可以。字段内容需要是JSON格式的键值对。",
    "parameters": {
      "type": "object",
      "properties": {
        "project_id": {
          "type": "string",
          "description": "要创建设定卡的项目ID"
        },
        "name": {
          "type": "string",
          "description": "设定卡名称（例如：琪亚娜·卡斯兰娜）"
        },
        "card_type": {
          "type": "string",
          "description": "设定卡类型",
          "enum": ["character", "world", "item"]
        },
        "fields": {
          "type": "string",
          "description": "JSON格式的详细字段（例如：{\"基本信息\": {\"全名\": \"琪亚娜\"}}）"
        }
      },
      "required": ["project_id", "name", "card_type"]
    }
  }
}
```

---

## 六、可用工具列表

| 工具名 | 参数 | 功能 |
|--------|------|------|
| `query_outline` | `project_id` | 查询项目的章节大纲树 |
| `query_chapter` | `chapter_id` | 查询单个章节的完整内容 |
| `create_chapter` | `project_id`, `title`, `parent_id?`, `content?`, `sort_order?` | 创建新章节，自动创建缺失项目 |
| `update_chapter` | `chapter_id`, `content` | 更新章节内容 |
| `delete_chapter` | `chapter_id` | 删除章节 |
| `query_setting_cards` | `project_id`, `card_type?` | 查询项目的所有设定卡 |
| `create_setting_card` | `project_id`, `name`, `card_type`, `fields?` | 创建新设定卡，自动创建缺失项目 |
| `update_setting_card` | `card_id`, `name?`, `fields?` | 更新设定卡内容 |
| `delete_setting_card` | `card_id` | 删除设定卡 |
| `query_conversations` | `conversation_id?`, `limit?` | 查询对话历史摘要 |
| `list_skills` | - | 列出所有可用技能 |
| `use_skill` | `skill_id` | 激活技能，返回技能的 system prompt |

完整文档：[docs/tools.md](file:///c:/Users/admin/Desktop/Whisper/docs/tools.md)

---

## 七、日志系统

**文件：** [`src-tauri/src/logger.rs`](file:///c:/Users/admin/Desktop/Whisper/src-tauri/src/logger.rs)

每次启动应用时，在项目根目录 `logs/` 创建一个新文件：

```
Whisper/
└── logs/
    └── conversation_20260702_193000.log
```

**日志格式：**

```
[2026-07-02 19:30:00.123] [INFO] [STEP1] 收到用户消息 | 对话ID: xxx | 内容: 创建崩坏三的琪亚娜设定卡
[2026-07-02 19:30:00.200] [INFO] [PROMPT] 构建 System Prompt | phase: ideation | skills: 0 | 设定卡: 无 | 章节: 无
[2026-07-02 19:30:00.500] [INFO] [STREAM] --- LLM 请求轮次 1 ---
[2026-07-02 19:30:01.000] [INFO] [STREAM] LLM 返回 tool_calls，共 1 个
[2026-07-02 19:30:01.001] [INFO] [TOOL] 执行工具: query_setting_cards | 参数: {"project_id": "xxx"}
[2026-07-02 19:30:01.100] [INFO] [TOOL] 工具 query_setting_cards 执行结果: 该项目暂无设定卡
```

**日志标签：**

| 标签 | 位置 | 含义 |
|------|------|------|
| `STEP1-12` | chat.rs | `send_message` 的 12 个步骤 |
| `PROMPT` | prompt.rs | System Prompt 构建详情 |
| `STREAM` | client.rs | SSE 流式处理、多轮循环 |
| `TOOL` | client.rs | 工具执行详情 |
| `SECTION` | 各文件 | 大阶段分隔 |

---

## 八、常见问题排查

### Q1: LLM 调用工具后卡住，没有后续响应

**可能原因：**
1. `tool_calls` 或 `tool_call_id` 字段缺失 → API 拒绝请求 **✅ 已修复**
2. 重复工具定义（名称重复）→ API 解析失败 **✅ 已修复（去重）**
3. 字节截断切到中文中间 → Rust panic **✅ 已修复（按字符截断）**

**检查日志：**
- 如果看到 `thread ... panicked at ... end byte index ... is not a char boundary` → UTF-8 截断问题
- 如果看到 `FOREIGN KEY constraint failed` → 项目不存在 **✅ 已修复（自动创建）**

### Q2: LLM 不知道可以调用工具，只回复文字

**可能原因：**
1. 默认没有加载工具 → 现在默认加载，修复 ✅
2. `tools` 参数未发送 → 每轮都发送，修复 ✅

**检查日志：**
```
[STEP8] 工具列表 | 默认加载 12 个工具 → 正常
[STEP8] 工具列表 | 无可用工具 → 不正常
```

### Q3: 创建设定卡失败：FOREIGN KEY constraint failed

**已修复：** `create_setting_card` 现在会 `INSERT OR IGNORE INTO projects`，自动创建缺失的项目。

### Q4: 对话消失

检查日志：
- 如果日志显示 `LLM 返回最终内容 | 共 N 字符` → 前端问题
- 如果日志在 `LLM 请求轮次 2` 后没有输出 → API 没响应/后端 panic

---

## 完整调用示例

以下是创建琪亚娜设定卡的完整日志流程：

```
========================================
[SECTION] send_message
[STEP1] 收到用户消息 | 对话ID: a57e7cb4... | 内容: 创建崩坏三的琪亚娜设定卡
[STEP1] 用户消息已保存 | 消息ID: xxx
[STEP2] 会话信息 | project_id: 0245f8d3... | phase: ideation
[STEP3] 历史消息 | 共 1 条
[STEP4] 未加载技能 | skill_ids: None
[STEP5] 设定卡摘要 | 项目 0245f8d3... 暂无设定卡
[STEP6] 章节上下文 | 阶段为 ideation，不注入
[PROMPT] 构建 System Prompt | phase: ideation | skills: 0 | 设定卡: 有 | 章节: 无
[PROMPT] 工具调用上下文 | project_id: 0245f8d3... | conversation_id: a57e7cb4...
[PROMPT] System Prompt 构建完成 | 共 892 字符 | 6 个段落
[STEP8] 工具列表 | 默认加载 12 个工具: ["query_outline", ..., "create_setting_card"]
[STEP9] API配置 | base_url: https://api.openai.com | model: gpt-4o
[STEP10] 消息列表构建完成 | 共 3 条消息 (system + 1 条历史)
[SECTION] stream_chat 开始
[STREAM] --- LLM 请求轮次 1 ---
[STREAM] 消息数: 3 | 工具数: 12
[STREAM] API响应状态: 200 OK
[STREAM] LLM 返回 tool_calls，共 1 个
[STREAM]   tool_call[0]: query_setting_cards | parameters: {"project_id": "0245f8d3..."}
[TOOL] 执行工具: query_setting_cards | 参数: {"project_id": "0245f8d3..."}
[TOOL] 工具 query_setting_cards 执行结果: 该项目暂无设定卡
[STREAM] 有 1 个 tool_calls，进入第 2 轮 (累积消息: 5 条)
[STREAM] --- LLM 请求轮次 2 ---
[STREAM] 消息数: 5 | 工具数: 12
[STREAM] API响应状态: 200 OK
[STREAM] LLM 返回 tool_calls，共 1 个
[STREAM]   tool_call[0]: create_setting_card | parameters: {...完整参数...}
[TOOL] 执行工具: create_setting_card | 参数: {...}
[TOOL] 工具 create_setting_card 执行结果: 设定卡已创建: [character] 琪亚娜·卡斯兰娜 (id: ...)
[STREAM] 有 1 个 tool_calls，进入第 3 轮 (累积消息: 7 条)
[STREAM] --- LLM 请求轮次 3 ---
[STREAM] LLM 返回最终内容 | 共 268 字符 | 总轮次: 3 | 总 chunks: 124
[STEP11] 助手消息已保存 | 消息ID: ...
[STEP12] 完成事件已发送 | done: true
[SECTION] send_message 结束
```

---

## 修订记录

| 日期 | 修订内容 |
|------|----------|
| 2026-07-02 | 首次完整文档 |

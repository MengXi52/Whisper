# 工具列表文档

> 本文档记录所有已实现的 LLM 工具调用（Function Calling）。
> 新增工具时请同步更新此文档。

## 概览

| 分类 | 工具数量 | 说明 |
|------|---------|------|
| 章节 | 5 | 大纲查询、章节 CRUD |
| 设定卡 | 4 | 设定卡 CRUD |
| 对话 | 1 | 对话历史查询 |
| 技能 | 2 | 技能列表、技能激活 |
| **合计** | **13** | |

---

## 章节工具

### 1. query_outline

查询项目的章节大纲列表，获取章节层级结构和状态。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目ID |

**返回**：章节列表（id、标题、排序、状态、层级缩进）

---

### 2. query_chapter

查询指定章节的完整内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapter_id | string | 是 | 章节ID |

**返回**：章节标题 + 完整正文内容

---

### 3. create_chapter

创建新章节到项目大纲中。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目ID |
| title | string | 是 | 章节标题 |
| parent_id | string | 否 | 父章节ID（用于创建子章节） |
| content | string | 否 | 章节内容（可为空） |
| sort_order | integer | 否 | 排序顺序 |

**返回**：创建成功提示 + 章节ID

---

### 4. update_chapter

更新指定章节的内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapter_id | string | 是 | 章节ID |
| content | string | 是 | 新的章节内容 |

**返回**：更新成功提示 + 字数统计

---

### 5. delete_chapter

删除指定章节。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapter_id | string | 是 | 章节ID |

**返回**：删除成功提示 + 章节标题

---

## 设定卡工具

### 6. query_setting_cards

查询项目的设定卡（人物、世界观、势力等）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目ID |
| card_type | string | 否 | 设定卡类型：人物、世界观、势力、物品等 |

**返回**：设定卡列表（id、名称、类型、字段）

---

### 7. create_setting_card

为项目创建新的设定卡。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目ID |
| name | string | 是 | 设定卡名称 |
| card_type | string | 是 | 设定卡类型：人物、世界观、势力、物品、组织等 |
| fields | string | 否 | 设定卡字段（JSON格式字符串） |

**返回**：创建成功提示 + 设定卡ID

---

### 8. update_setting_card

更新指定设定卡的字段、名称或类型。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| card_id | string | 是 | 设定卡ID |
| name | string | 否 | 新的设定卡名称 |
| card_type | string | 否 | 新的设定卡类型 |
| fields | string | 否 | 新的设定卡字段（JSON格式字符串） |

**返回**：更新成功提示

---

### 9. delete_setting_card

删除指定设定卡。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| card_id | string | 是 | 设定卡ID |

**返回**：删除成功提示 + 设定卡名称

---

## 对话工具

### 10. query_conversations

查询指定对话的历史消息记录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conversation_id | string | 是 | 对话ID |
| limit | integer | 否 | 返回消息数量限制，默认20 |

**返回**：消息列表（角色标签 + 内容预览，超过200字截断）

---

## 技能工具

### 11. list_skills

列出所有可用的写作技能（内置和自定义）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 无 | - | - | - |

**返回**：技能列表（id、名称、描述、内置/自定义标签）

---

### 12. use_skill

激活指定技能，获取该技能的系统提示词以切换写作风格。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skill_id | string | 是 | 技能ID |

**返回**：技能名称 + 系统提示词 + 该技能可用工具

---

## 实现说明

### 文件位置

| 文件 | 职责 |
|------|------|
| `src-tauri/src/llm/client.rs` | 工具函数实现 + `execute_tools` 分发 |
| `src-tauri/src/db.rs` | 工具 JSON 定义（`init_builtin_skills`） |
| `src-tauri/src/commands/chat.rs` | 传递数据库连接到 `stream_chat` |

### 工具调用流程

```
用户消息 → send_message → stream_chat
  → LLM 返回 tool_calls
  → execute_tools 分发到具体函数
  → 工具函数操作数据库，返回结果字符串
  → 结果追加到 messages，重新请求 LLM
  → LLM 基于工具结果生成最终回复
  → 流式推送到前端
```

### 新增工具步骤

1. 在 `client.rs` 的 `execute_tools` match 中添加工具名分支
2. 在 `client.rs` 中实现 `tool_xxx` 函数
3. 在 `db.rs` 的 `init_builtin_skills` 中添加工具 JSON 定义
4. 更新本文档

### 注意事项

- 工具函数签名统一为 `fn tool_xxx(db: &Mutex<Connection>, args: &str) -> String`
- 参数解析使用 `serde::Deserialize` + `serde_json::from_str`
- 数据库操作失败时返回错误字符串，不中断流程
- 工具定义遵循 OpenAI Function Calling 格式
- 已有数据库的旧技能记录需手动更新 `tools` 字段才能生效

---

## / 斜杠命令

用户可以在聊天输入框中输入 `/` 触发工具命令下拉列表，直接指定要调用的工具。

### 使用方式

```
/query_outline                          → 调用 query_outline 工具
/query_chapter 章节ID                    → 调用 query_chapter，附带参数说明
/create_chapter 第一章 开头              → 调用 create_chapter，附带参数说明
```

### 实现机制

1. **前端** (`ChatInput.tsx`)：输入 `/` 后显示工具列表下拉，支持名称和描述模糊搜索，选中后插入 `/tool_name ` 到输入框
2. **后端** (`chat.rs`)：
   - `parse_slash_command` 解析 `/tool_name` 格式，生成工具调用提示注入 system prompt
   - `load_all_tools` 在用户使用 / 命令但未激活技能时，自动加载所有内置技能的工具定义
   - LLM 收到指令后调用对应工具，执行后基于结果回复用户

### 文件位置

| 文件 | 职责 |
|------|------|
| `src/components/chat/ChatInput.tsx` | / 命令下拉 UI + 工具列表 |
| `src-tauri/src/commands/chat.rs` | `parse_slash_command` + `load_all_tools` |

### 新增工具时的前端同步

在 `ChatInput.tsx` 的 `TOOLS` 数组中添加工具条目：

```typescript
{ name: 'tool_name', desc: '工具描述', category: '分类' },
```

# 轻语（Whisper）多Agent小说写作助手 - 无登录版设计文档

## 1. 概述

### 1.1 范围
本文档定义"轻语"无登录桌面版（MVP）的技术设计，覆盖基础聊天、写作全流程、设定卡管理、2种内置技能和本地存储。

### 1.2 技术栈
| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 |
| 前端 | React 18 + TypeScript + Zustand + TailwindCSS |
| UI组件库 | shadcn/ui (Radix UI + TailwindCSS) |
| 后端 | Rust (Tauri 原生) |
| 数据库 | SQLite (tauri-plugin-sql) |
| 模型API | DeepSeek API (OpenAI兼容格式, SSE流式) |
| 构建工具 | Vite |

### 1.3 不包含（后续版本）
- 多Agent角色扮演剧场
- MCP服务集成
- 技能市场
- 登录/云同步/发布服务

---

## 2. 项目结构

```
Whisper/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # Tauri 入口，注册命令与插件
│   │   ├── commands/       # Tauri commands（前端调用的API）
│   │   │   ├── mod.rs
│   │   │   ├── chat.rs     # 聊天：发送消息、流式响应、中断
│   │   │   ├── project.rs  # 项目CRUD、章节管理
│   │   │   ├── settings.rs # 设定卡CRUD、版本历史
│   │   │   ├── skill.rs    # 技能列表、激活/停用
│   │   │   └── export.rs   # 导出TXT/Markdown/DOCX
│   │   ├── db.rs           # SQLite 初始化、迁移、连接池
│   │   ├── models.rs       # Rust 数据结构（Project, Chapter等）
│   │   └── llm/            # LLM API 调用
│   │       ├── mod.rs
│   │       ├── client.rs   # HTTP客户端 + SSE流解析
│   │       └── prompt.rs   # System Prompt 模板与组装
│   ├── migrations/         # SQLite 迁移脚本
│   └── Cargo.toml
├── src/                    # React 前端
│   ├── components/
│   │   ├── layout/         # 三栏布局、顶栏、底栏
│   │   ├── chat/           # 对话界面、消息气泡、输入框
│   │   ├── editor/         # 写作编辑器、字数统计
│   │   ├── sidebar/        # 左侧资源树（大纲/设定/笔记）
│   │   ├── panel/          # 右侧动态面板
│   │   ├── settings/       # 设定卡编辑、版本历史
│   │   └── common/         # 通用组件（按钮、对话框等）
│   ├── stores/             # Zustand stores
│   │   ├── projectStore.ts
│   │   ├── chatStore.ts
│   │   ├── settingsStore.ts
│   │   └── uiStore.ts
│   ├── hooks/              # 自定义 hooks
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── tauri.conf.json
└── vite.config.ts
```

---

## 3. 数据模型

### 3.1 SQLite 表结构

#### projects（项目）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | 项目名称 |
| description | TEXT | 项目描述 |
| genre | TEXT | 类型（古风言情/悬疑推理/其他） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### chapters（章节）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| project_id | TEXT FK | 所属项目 |
| parent_id | TEXT FK | 父章节（支持多级大纲） |
| title | TEXT | 章节标题 |
| content | TEXT | 章节内容（Markdown） |
| sort_order | INTEGER | 排序序号 |
| status | TEXT | draft/completed/revising |
| word_count | INTEGER | 字数 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### setting_cards（设定卡）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| project_id | TEXT FK | 所属项目 |
| card_type | TEXT | character/faction/world/item/skill_system/event |
| name | TEXT | 设定名称 |
| fields | TEXT | JSON，存储各类设定的字段 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### setting_card_versions（设定卡版本历史）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| card_id | TEXT FK | 关联设定卡 |
| fields | TEXT | 该版本的字段快照 |
| created_at | DATETIME | 创建时间 |

#### conversations（对话会话）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| project_id | TEXT FK | 关联项目（可空） |
| title | TEXT | 会话标题 |
| phase | TEXT | ideation/planning/writing/editing |
| skill_ids | TEXT | JSON数组，激活的技能ID |
| context_chapter_id | TEXT FK | 关联章节（写作阶段） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### messages（消息）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| conversation_id | TEXT FK | 所属会话 |
| role | TEXT | user/assistant/system |
| content | TEXT | 消息内容 |
| model | TEXT | 使用的模型名 |
| created_at | DATETIME | 创建时间 |

#### skills（技能）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | 技能名称 |
| description | TEXT | 技能描述 |
| system_prompt | TEXT | 注入的System Prompt片段 |
| tools | TEXT | JSON数组，关联工具名 |
| trigger_scenarios | TEXT | JSON数组，触发场景 |
| is_builtin | BOOLEAN | 是否内置 |
| created_at | DATETIME | 创建时间 |

#### api_configs（API配置）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | 配置名称 |
| base_url | TEXT | API基础地址 |
| api_key | TEXT | API密钥（加密存储） |
| model_thinking | TEXT | 思考模型名 |
| model_writing | TEXT | 写作模型名 |
| is_default | BOOLEAN | 是否默认配置 |

### 3.2 本地文件存储
```
%APPDATA%/Whisper/
├── whisper.db       # SQLite 数据库
├── backups/         # 自动备份（压缩包）
└── exports/         # 导出文件临时目录
```

---

## 4. 核心功能设计

### 4.1 基础聊天与模型交互

#### DeepSeek API 集成
- Rust 后端使用 `reqwest` 发送 HTTP 请求，`eventsource-stream` 解析 SSE
- 请求格式遵循 OpenAI Chat Completions API（`/chat/completions`）
- 支持 `stream: true` 流式响应
- 流式 token 通过 Tauri Event（`chat:chunk`）推送到前端
- 前端监听事件，逐字追加到消息气泡，实现打字机效果

#### 双模型路由
- 思考任务（构思、计划、一致性检查）→ model_thinking（如 deepseek-chat）
- 写作任务（续写、润色、扩写）→ model_writing（如 deepseek-chat-flash）
- 用户可在对话中手动切换模型

#### 中断生成
- 前端点击停止按钮 → 调用 Tauri Command `abort_generation`
- Rust 端持有 `CancellationToken`，abort 时取消正在进行的 HTTP 请求
- 已接收的内容保留显示

#### 对话管理
- 新建会话：创建 conversation 记录，默认 phase=ideation
- 切换会话：加载历史消息列表
- 删除会话：级联删除消息
- 会话标题：自动取首条用户消息前20字，可手动修改

### 4.2 写作全流程

#### 构思阶段（Ideation）
- 对话式交互，System Prompt 引导 AI 扮演创作顾问
- 用户输入关键词/主题 → AI 生成选题列表、冲突设定、高概念梗概
- "如果…会怎样"发散问答：用户给出假设，AI 推演多种可能
- 构思结果可一键保存为项目描述或设定卡

#### 计划阶段（Planning）
- AI 基于构思结果生成多级章节大纲
- 大纲以树形结构展示在左侧资源树
- 支持拖拽调整章节顺序（前端拖拽 → 调用 Tauri Command 更新 sort_order）
- AI 提供分幕节奏建议、人物弧光规划、伏笔埋设提示
- 大纲节点可展开为章节，进入写作阶段

#### 写作阶段（Writing）
- 选择章节后进入写作模式
- 续写：AI 基于前文 + 设定卡 + 大纲上下文续写
- 多方案生成：一次请求生成2-3个备选段落，用户选择或组合
- 实时字数统计（前端计算）+ 目标进度条（用户设定目标字数）
- 专注写作模式：全屏，隐藏侧栏和面板

#### 修改/编辑阶段（Editing）
- 选中文字右键菜单：语法校正、语气调整、扩写、缩写
- 一致性检查：AI 对比当前文本与设定卡，检测人名/地名/设定冲突
- 检查结果以标注形式显示在编辑器中
- 修改建议可一键应用或手动调整后应用

### 4.3 设定卡管理

#### 预设模板
- **人物卡**：姓名、年龄、性别、性格、外貌、背景故事、所属势力、目标
- **势力卡**：名称、类型、首领、成员、领地、宗旨
- **世界/地点卡**：名称、类型、地理描述、历史、文化特征
- **物品卡**：名称、类型、外观、功能、来历
- **技能/魔法体系卡**：名称、类型、等级划分、修炼方式、限制
- **历史事件卡**：名称、时间、参与者、经过、影响

#### 智能采集
- AI 在对话中识别到新设定信息时，生成设定卡建议
- 前端弹出确认对话框，用户可编辑后保存
- 保存时自动创建版本快照

#### 版本历史
- 每次修改自动创建版本快照
- 侧滑面板展示历史列表
- 点击可预览差异，支持回滚

#### 导入/导出
- 导出：设定卡序列化为 JSON 文件
- 导入：解析 JSON 文件，创建设定卡记录

### 4.4 技能系统

#### 内置技能1：古风言情技能
```json
{
  "name": "古风言情",
  "system_prompt": "你是一位精通古风言情的写作助手。在所有输出中，请遵循以下规则：1) 使用文言与白话交织的古风措辞；2) 善用诗词典故、对仗修辞；3) 场景描写注重意境营造；4) 人物对话符合古代身份与礼节；5) 情感表达含蓄委婉，以景抒情。",
  "trigger_scenarios": ["genre:古风言情", "genre:仙侠", "genre:宫斗"]
}
```

#### 内置技能2：悬疑推理技能
```json
{
  "name": "悬疑推理",
  "system_prompt": "你是一位精通悬疑推理的写作助手。在所有输出中，请遵循以下规则：1) 严格维护逻辑链，所有推理必须有据可依；2) 主动管理伏笔，确保前后呼应；3) 线索布局遵循'显隐结合'原则；4) 人物行为必须符合其动机和已知信息；5) 每次输出后列出当前未解之谜和已埋伏笔清单。",
  "trigger_scenarios": ["genre:悬疑推理", "genre:侦探", "genre:犯罪"]
}
```

#### 技能调用机制
- 对话中输入 `@古风言情` 强制启用技能
- 创建项目时选择类型，自动关联对应技能
- 技能激活时，其 `system_prompt` 注入到对话的 system message 中
- 同一对话可激活多个技能，system_prompt 按顺序拼接

### 4.5 智能循环控制

#### 深度思考模式
- 用户在对话中点击"深度思考"按钮启用
- 系统自动执行多轮调用：
  1. 初始调用：生成结果
  2. 反思调用：AI 评估自身结果，指出不足
  3. 优化调用：基于反思改进结果
  4. 重复2-3直至满足条件或用户中止
- 终止条件：AI 自评满意度≥8/10，或达到最大轮次（默认3轮）

#### 用户干预
- 实时显示循环状态：当前轮次、AI自评分数
- 三个操作按钮：停止（终止循环）、采用当前结果（接受并结束）、手动调整后继续（用户编辑后继续下一轮）

---

## 5. UI 设计

### 5.1 三栏布局
```
┌─────────────────────────────────────────────────────┐
│  顶部栏：项目名 | 构思|计划|写作|修改 | ⚙设置      │
├──────────┬──────────────────────┬───────────────────┤
│ 左侧栏   │   中间主区域         │  右侧动态面板     │
│ (240px)  │   (flex-1)          │  (300px)          │
│          │                      │                   │
│ 📁 项目  │  [构思/计划模式]     │  随阶段变化       │
│  ├ 大纲  │  对话式交互          │                   │
│  │ ├ Ch1 │                      │                   │
│  │ └ Ch2 │  [写作模式]          │                   │
│  ├ 设定  │  富文本编辑器        │                   │
│  │ ├ 人物│                      │                   │
│  └ 笔记  │                      │                   │
├──────────┴──────────────────────┴───────────────────┤
│  底部状态栏：模型名 | Token数 | 已保存              │
└─────────────────────────────────────────────────────┘
```

### 5.2 关键交互
- **阶段切换**：顶部标签，切换时中间区域和右侧面板内容变化，左侧栏不变
- **流式显示**：AI 消息逐字出现，生成中显示停止按钮
- **右键菜单**：编辑器中选中文字，右键弹出AI操作菜单
- **拖拽排序**：左侧大纲树支持拖拽调整章节顺序
- **主题切换**：深色/浅色，设置中切换

### 5.3 组件库
- shadcn/ui（基于 Radix UI + TailwindCSS）
- 图标：Lucide React
- 拖拽：@dnd-kit/core
- 编辑器：Tiptap（基于 ProseMirror）

---

## 6. 数据流

### 6.1 聊天流程
```
用户输入 → chatStore.sendMessage()
  → invoke('send_message', {conversationId, content, model, skills})
    → Rust: 构建messages数组（含system prompt + 技能注入 + 历史消息）
    → Rust: 调用DeepSeek API (SSE)
    → Rust: 逐chunk通过emit('chat:chunk', {id, content})推送
  → 前端: chatStore监听chat:chunk事件，追加内容到当前消息
  → Rust: 流结束后保存完整消息到SQLite
  → 前端: 更新消息列表
```

### 6.2 写作流程
```
选择章节 → 加载章节内容到编辑器
点击续写 → invoke('continue_writing', {chapterId, context})
  → Rust: 组装上下文（前文 + 大纲 + 设定卡摘要）
  → Rust: 调用DeepSeek API
  → 流式返回续写内容
用户确认 → 保存到章节内容
```

---

## 7. 错误处理

- **API 调用失败**：显示错误提示，支持重试
- **API Key 无效**：设置页提示检查配置
- **网络断开**：提示网络错误，本地功能正常使用
- **数据库错误**：日志记录，提示用户重启
- **导出失败**：提示错误原因，建议重试

---

## 8. 性能考虑

- 流式首字响应 < 1.5秒（取决于网络和模型）
- SQLite 索引：conversations(project_id)、messages(conversation_id)、chapters(project_id)、setting_cards(project_id)
- 前端虚拟列表：消息列表超过100条时启用虚拟滚动
- 编辑器：Tiptap 懒加载，大文档分段渲染

# 多Agent写作助手需求规格说明书

> **版本**: 0.1 (草稿)
> **日期**: 2026-07-06
> **状态**: 撰写中

---

## 目录

1. [引言](#1-引言)
2. [产品概述](#2-产品概述)
3. [系统架构](#3-系统架构)
4. [Agent管理设计](#4-agent管理设计)
5. [工具管理设计](#5-工具管理设计)
6. [Pipeline执行引擎](#6-pipeline执行引擎)
7. [功能规格](#7-功能规格)
8. [数据模型](#8-数据模型)
9. [交互与可观测性](#9-交互与可观测性)
10. [非功能性需求](#10-非功能性需求)
11. [实现路线图](#11-实现路线图)

---

## 1. 引言

### 1.1 目的与范围

本规格说明书定义Whisper系统的多Agent写作助手模块的需求与设计。

**范围**：
- Agent管理子系统（注册表、分类、生命周期、通信）
- 工具管理子系统（注册表、权限矩阵、调用流程、缓存）
- Pipeline执行引擎（工作流、状态机、检查点、错误处理、并行）
- 六大核心功能（灵感矩阵、大纲生成、改写润色、角色对话、一致性管理、百万字流水线）
- 数据模型、交互设计、非功能性需求

**不在范围内**：
- 现有Chat系统的修改（Agent系统完全独立）
- 具体Agent系统提示词的撰写（属于实现阶段）
- UI视觉设计细节（属于设计阶段）

### 1.2 术语定义

| 术语 | 定义 |
|---|---|
| Agent | 具有特定职责的LLM调用单元，有独立系统提示词和工具权限 |
| Pipeline | 按DAG编排的Agent调用序列，完成一个完整功能 |
| DAG | 有向无环图，描述Agent节点的执行顺序与数据依赖 |
| 检查点 | Pipeline中可暂停等待用户决策的关键节点 |
| 权限模式 | 控制Pipeline自动化程度的三档配置（不干预/检查点干预/高权限全自动） |
| 工具适配层 | Agent与系统交互的通道，封装原生工具并管理权限 |
| 记忆库 | 跨任务持久化的故事状态数据库，由memory_keeper维护 |
| 中间产出 | Pipeline执行过程中每个Agent的输出，存于文件系统 |
| OOC | Out of Character，角色行为不符合设定 |
| 项目工程实践记录 | 指Whisper项目在历史开发中积累的工程教训文档（位于项目memory目录），本规格说明书引用其中的约束（如Tauri 2.0参数扁平化、UTF-8字符边界安全等） |
| 循环节点 | DAG节点的一种特殊执行模式，节点内部通过Agent多次调用实现循环逻辑，对DAG而言仍是单向无环 |
| 工作流注册表 | 所有可用工作流定义的中央清单，在代码中静态声明 |

### 1.3 目标读者

- **架构开发者**：负责实现Agent管理、工具管理、Pipeline引擎
- **功能开发者**：负责实现具体功能的Agent和工作流
- **产品决策者**：评估功能优先级和路线图

---

## 2. 产品概述

### 2.1 核心价值主张

为网文作者提供**更快更强**的创作辅助工具，通过多Agent协作解决单LLM无法胜任的创作场景：

1. **更快**：并行执行+管道流水线，将串行LLM调用的耗时压缩
2. **更强**：多Agent分工协作，突破单LLM在长文本、一致性、多视角上的瓶颈
3. **更可控**：三档权限模式，让作者在速度与掌控之间灵活权衡

### 2.2 用户痛点与解决方案

| 用户痛点 | 现有方案局限 | 多Agent方案 |
|---|---|---|
| 关键词模糊，不知道写什么 | 单LLM一次性给灵感，质量参差 | keyword_analyst解析→idea_diverger发散→conflict_designer设计→feasibility_evaluator评估，多视角产出 |
| 长篇写到50万字伏笔忘了 | 单LLM上下文窗口有限，无法记忆全文 | memory_keeper跨任务常驻，维护结构化记忆库 |
| 角色对话不像本人 | 单LLM一人分饰多角，声音混淆 | 每个角色独立roleplayer Agent，ooc_checker审查 |
| 改写后失去个人风格 | 单LLM改写容易同质化 | style_analyzer提取风格→reader_simulator找弱点→rewriter针对性改写 |
| 百万字一键生成 | 单LLM串行生成耗时数百小时 | volume_planner并行+chapter_writer并行，断点续传 |

### 2.3 与现有Whisper系统的关系

**共享**：
- 底层数据模型（项目、对话、设定卡、大纲、API配置）
- LLM客户端基础设施
- 数据库连接与迁移机制
- 前端组件库（MessageBubble、OutlinePanel等）

**独立**：
- 执行引擎（不复用Chat的stream_chat流程）
- 工具层（独立命名空间 `agent.*`，不复用Chat的Tauri命令）
- UI入口（独立Agent任务面板，不嵌入Chat界面）
- 状态管理（独立store，不与chatStore耦合）

**演进关系**：
- Agent系统作为独立模块开发，不依赖Chat系统的演进
- Chat系统可继续独立迭代，互不影响
- 未来可考虑Chat系统集成Agent能力（如Chat中触发Agent任务），但属于后续扩展

---

## 3. 系统架构

### 3.1 整体架构概览

多Agent写作助手作为**完全独立的新模块**嵌入Whisper系统，与现有Chat系统并行存在。两者共享底层数据模型（项目、对话、设定卡、大纲），但执行引擎、工具层、UI入口相互隔离。

系统采用**三层架构 + 一个适配层**：

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层 (UI)                          │
│   Agent任务面板 │ 任务发起 │ 执行可视化 │ 检查点干预         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│              Pipeline执行引擎 (控制流)                       │
│   工作流定义 │ 状态机 │ 检查点 │ 权限模式 │ 错误处理         │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────────┐      ┌───────────────────────────┐
│   Agent管理层 (执行体)   │      │   工具适配层 (能力层)     │
│  注册表 │ 工厂 │ 生命周期  │      │  原生工具壳 + 内部函数复用 │
│  分类体系 │ 模型路由      │      │  权限矩阵 │ 结果缓存      │
└──────────┬──────────────┘      └───────────┬───────────────┘
           │                                 │
           ▼                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    基础设施层 (共享)                          │
│  LLM客户端 │ SQLite数据库 │ 文件系统(中间产出) │ API配置     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 三大子系统

#### 3.2.1 Agent管理层

负责Agent的**定义、实例化、调度**。

- **Agent注册表**：静态声明所有Agent的元数据（id、分类、系统提示词模板、所需工具、模型参数、输入/输出schema）。内置Agent代码定义，用户自定义Agent存数据库。
- **Agent工厂**：按Pipeline步骤需求，从注册表实例化Agent，注入隔离上下文（独立消息历史、独立工具权限）。
- **分类体系**：按职责分五类（详见第4章），Pipeline按需调用对应分类的Agent。
- **模型路由**：每个Agent可指定不同API配置，默认复用项目绑定的API配置，高级设置可覆盖。

#### 3.2.2 工具适配层

Agent与系统交互的唯一通道，**不复用现有Tauri命令**，但内部可调用Rust核心函数。

- **原生工具壳**：每个工具是一个独立命名空间（如 `agent.create_setting_card`、`agent.query_outline`），与Chat模式的工具（`create_setting_card`）隔离，避免冲突。
- **内部函数复用**：工具壳内部调用现有Rust核心函数（如设定卡创建逻辑 `settings::create_card`），不重复实现业务逻辑。函数路径以模块名开头（如 `settings::create_card`、`outline::create_node`），不含 `crate::` 前缀。
- **权限矩阵**：声明每个Agent可调用哪些工具，写入数据库的Agent需要写权限，分析型Agent只需读权限。
- **结果缓存**：同一次Pipeline内，相同工具+相同参数的调用结果缓存，避免重复LLM调用。

#### 3.2.3 Pipeline执行引擎

负责工作流的**编排、状态管理、错误恢复**。

- **工作流定义**：每个功能（如灵感矩阵生成）是一个DAG（有向无环图），节点是Agent调用，边是数据依赖。
- **状态机**：任务有 `pending` / `running` / `paused_at_checkpoint` / `completed` / `failed` / `aborted` 六种状态。
- **检查点**：在DAG的关键节点（如灵感发散后、可行性评估前）插入检查点，根据权限模式决定是否暂停等待用户。
- **权限模式**：三档（详见3.3），决定检查点行为和错误处理策略。
- **错误处理**：根据权限模式自动选择策略（详见6.3）。

### 3.3 数据流与控制流

#### 3.3.1 权限模式（任务级配置）

权限模式在**设置中全局配置默认值**，用户也可在**任务发起时临时切换**。每个功能有推荐默认值。

**配置层级与优先级**（从高到低）：
1. **任务级临时切换**（最高优先级）：任务发起界面临时选择，仅对本次任务生效
2. **项目级设置**：在项目设置中配置，覆盖全局默认值，仅对当前项目生效
3. **应用级全局默认**（最低优先级）：在应用设置中配置，作为所有项目的兜底默认值

**与功能推荐默认值的关系**：功能推荐默认值是文档建议值（见下表），系统初始化时写入应用级全局默认。用户可在项目级或任务级覆盖。

| 模式 | 检查点行为 | 错误处理 | 适用场景 |
|---|---|---|---|
| **不干预 (Hands-off)** | 不暂停，全速执行 | 失败即中止任务，报告错误 | 低风险任务（灵感、改写） |
| **检查点干预 (Supervised)** | 关键节点暂停，等待用户决策（继续/修改/跳过/中止） | 失败时询问用户（重试/跳过/修改输入/中止） | 高成本任务（百万字流水线） |
| **高权限全自动 (Autopilot)** | 不暂停，跳过所有检查点 | 失败自动重试N次后跳过并标记 | 用户信任系统、追求速度 |

**默认值建议**：
- 灵感矩阵生成 → 不干预
- 多视角改写润色 → 不干预
- 结构化大纲生成 → 检查点干预
- 角色驱动对话 → 不干预
- 长篇一致性管理 → 检查点干预
- 百万字小说流水线 → 检查点干预

用户可在设置中覆盖默认值，或在任务发起时临时切换。

#### 3.3.2 数据流

```
用户输入
  │
  ▼
Pipeline启动 ──→ 加载工作流定义
  │
  ▼
按DAG顺序执行节点
  │
  ├─→ Agent工厂实例化Agent (注入工具权限)
  │     │
  │     ▼
  │   Agent调用LLM (使用指定API配置)
  │     │
  │     ├─→ (可选) Agent调用工具 ──→ 工具适配层 ──→ 内部函数
  │     │                                    └─→ 文件系统读写 (中间产出)
  │     │
  │     ▼
  │   Agent产出结果
  │     │
  │     ├─→ 写入中间产出文件 (./agent_outputs/{task_id}/{step_id}_{agent_id}.md)
  │     └─→ 传递给下一个Agent (作为输入)
  │
  ▼ (检查点处)
根据权限模式决定是否暂停
  │
  ▼
Pipeline完成 ──→ 最终结果输出到Chat界面 ──→ 存入数据库
```

#### 3.3.3 中间产出存储

- **根目录**：项目目录下 `./agent_outputs/`（与项目数据库同级，整体迁移项目时一并迁移）
- **任务目录**：`./agent_outputs/{task_id}/`
- **节点产出文件**：`./agent_outputs/{task_id}/{step_id}_{agent_id}.md`
- **特殊子目录**：对于大量同类产出（如百万字流水线的章节），可使用子目录 `./agent_outputs/{task_id}/chapters/chapter_{id}.md`
- **格式**：Markdown，便于用户直接查看和复用
- **生命周期**：不自动清理，由用户手动管理（或在设置中配置自动清理策略，清理后断点续传将不可用）
- **数据库记录**：仅在 `agent_tasks` 表中记录任务元数据（task_id、类型、状态、起止时间、token消耗），不存储中间内容
- **聊天记录**：最终结果作为一条消息存入对话历史，正常计入数据库
- **可移植性**：中间产出与项目数据库强绑定（task_id关联），项目整体迁移时可用，但单独复制产出文件无法跨项目使用
- **一致性**：若用户手动删除产出文件，断点续传会检测到文件缺失并要求用户选择"从头执行该节点"或"中止任务"

#### 3.3.4 控制流关键决策

1. **Agent隔离**：每个Agent实例有独立的消息历史，不互相污染。上下文通过Pipeline显式传递（上一个Agent的输出作为下一个Agent的输入参数）。
2. **工具调用隔离**：Agent调用工具时携带 `task_id` 和 `agent_id`，工具适配层据此校验权限和缓存结果。
3. **模型路由**：Agent实例化时根据其 `api_config_id` 字段（可空）选择API配置，为空则用项目默认配置。
4. **并行执行**：DAG中无依赖的节点可并行执行（如多章节生成），由Pipeline引擎调度。

---

## 4. Agent管理设计

### 4.1 Agent注册表

Agent注册表是所有可用Agent的**中央清单**，分为静态注册表和动态注册表两部分。

#### 4.1.1 静态注册表（内置Agent）

内置Agent在代码中定义，随系统发布。每个Agent声明以下元数据：

| 字段 | 类型 | 说明 |
|---|---|---|
| `agent_id` | string | 唯一标识符（snake_case，如 `idea_diverger`） |
| `name` | string | 显示名称（中文，如"灵感发散师"） |
| `category` | enum | 分类（creative/analytic/structural/memory/tool） |
| `description` | string | 一句话职责描述 |
| `system_prompt` | string | 系统提示词模板（支持变量插值） |
| `required_tools` | string[] | 必须可调用的工具ID列表 |
| `optional_tools` | string[] | 可选调用的工具ID列表 |
| `api_config_id` | i64? | 指定的API配置ID，空则用项目默认 |
| `model_params` | json | 模型参数（temperature、max_tokens等） |
| `input_schema` | json | 输入参数schema（JSON Schema格式） |
| `output_schema` | json | 输出结果schema |
| `is_builtin` | bool | 固定为true |
| `version` | string | 版本号，用于升级提示 |

#### 4.1.2 动态注册表（用户自定义Agent）

用户自定义Agent存入数据库 `agent_definitions` 表，结构与内置Agent相同，但：

- `is_builtin = false`
- `agent_id` 必须以 `custom_` 前缀，避免与内置ID冲突
- 用户可编辑的字段：`name`、`description`、`system_prompt`、`required_tools`、`optional_tools`、`api_config_id`、`model_params`
- `input_schema` 和 `output_schema` 默认与目标Pipeline节点匹配，高级用户可手动编辑

#### 4.1.3 Agent导入/导出

- **导出**：将单个Agent定义导出为JSON文件，包含所有元数据字段（不含 `project_id`，导入时由用户指定作用域）
- **导入**：从JSON文件导入Agent，自动添加 `custom_` 前缀，若ID冲突则追加序号
- **分享**：导出的JSON文件可直接分享给其他用户，导入后即可在内置Pipeline中使用

#### 4.1.4 自定义Agent接入Pipeline

用户自定义Agent可通过以下方式接入内置Pipeline：

**方式A：任务发起时替换节点Agent**
- 在任务发起界面，用户可展开"高级选项"
- 对工作流的每个节点，用户可选择"使用默认Agent"或"使用自定义Agent"
- 系统校验自定义Agent的 `input_schema` 和 `output_schema` 是否与节点要求兼容
- 校验通过则用自定义Agent替换该节点的默认Agent执行

**方式B：设置中配置默认替换**
- 在设置中，用户可为每个工作流节点配置"默认使用的自定义Agent"
- 配置后，该工作流启动时自动使用指定的自定义Agent
- 可随时清除配置恢复内置Agent

**Schema兼容性校验**：
- 自定义Agent的 `input_schema` 必须能接受节点 `input_mapping` 生成的数据
- 自定义Agent的 `output_schema` 必须能产生下游节点 `data_mapping` 期望的字段
- 校验由系统自动完成，不兼容时阻止使用并提示具体冲突字段

### 4.2 Agent分类体系

按职责分五类，分类决定了Agent的**默认工具权限**和**调用场景**。

#### 4.2.1 创意型 (creative)

负责内容生成，是Pipeline中的"生产者"。

- **默认权限**：可读数据库（查询设定卡、大纲）、可写文件系统（中间产出）
- **不可权限**：不可写数据库（避免未经验证的内容污染数据库）
- **产出写入**：creative Agent可直接调用 `agent.write_intermediate` 工具写入产出，或由Pipeline引擎代写
- **模型参数倾向**：高temperature（0.8-1.0），鼓励发散
- **内置Agent**：idea_diverger、conflict_designer、rewriter、character_roleplayer、scene_setter、chapter_writer、final_polisher

#### 4.2.2 分析型 (analytic)

负责评估、审查、模拟，是Pipeline中的"审视者"。

- **默认权限**：可读数据库、可读文件系统
- **不可权限**：不可写数据库、不可写文件系统
- **产出写入**：analytic Agent的产出由Pipeline引擎代为写入中间产出文件（Agent本身无写文件权限，但Pipeline引擎作为调度方有文件系统写权限）
- **模型参数倾向**：低temperature（0.3-0.5），追求严谨
- **内置Agent**：keyword_analyst、feasibility_evaluator、structure_selector、pace_reviewer、style_analyzer、reader_simulator、diff_explainer、dialogue_director、ooc_checker、consistency_checker、drift_monitor

#### 4.2.3 结构型 (structural)

负责大纲、章节、伏笔的结构规划，是Pipeline中的"架构师"。

- **默认权限**：可读数据库、可写数据库（大纲、伏笔等结构化数据）、可写文件系统
- **模型参数倾向**：中temperature（0.5-0.7），平衡发散与严谨
- **内置Agent**：chapter_splitter、foreshadow_planner、macro_planner、volume_planner、chapter_stitcher

#### 4.2.4 记忆型 (memory)

负责故事记忆库的维护，是长篇创作的"持久大脑"。

- **默认权限**：可读写 `story_memory` 表、可读写文件系统
- **特殊性**：**跨任务常驻**，应用启动时加载，应用关闭时持久化
- **LLM调用**：memory_keeper **不调用LLM**，是纯数据响应型Agent（类似tool类），被动响应工具调用；memory_updater **调用LLM**，需要LLM从章节内容中抽取结构化信息更新记忆库
- **内置Agent**：memory_keeper、memory_updater

**memory_keeper与memory_updater的职责区分**：
- **memory_keeper**：常驻服务，被动响应 `agent.query_memory` 和 `agent.update_memory` 工具调用，本身不发起LLM请求。相当于记忆库的"数据库连接器"。
- **memory_updater**：Pipeline节点，主动调用LLM分析章节内容，提取需要更新的记忆条目，然后通过 `agent.update_memory` 工具委托memory_keeper写入数据库。

#### 4.2.5 工具型 (tool)

负责数据加载、上下文检索等纯数据操作，不调用LLM。

- **默认权限**：按工具需求配置，通常只读
- **特殊性**：**不调用LLM**，直接执行工具并返回结果
- **内置Agent**：character_loader、context_retriever

### 4.3 Agent生命周期

#### 4.3.1 生命周期状态

```
[未实例化] ──实例化──→ [就绪] ──调用──→ [运行中]
                          │                  │
                          │                  ├─成功──→ [完成] ──资源释放──→ [销毁]
                          │                  ├─失败──→ [错误] ──重试/询问──→ [就绪/销毁]
                          │                  └─取消──→ [中止] ──资源释放──→ [销毁]
                          │
                          └─常驻Agent保持 [就绪] 状态
```

#### 4.3.2 实例化流程

1. Pipeline引擎请求实例化Agent，传入 `agent_id` 和 `task_id`
2. Agent工厂从注册表查询Agent定义
3. 校验工具权限（确保Agent所需工具都已在工具注册表中）
4. 创建Agent实例，注入隔离上下文：
   - 独立消息历史（空数组）
   - 工具权限白名单
   - `task_id` 和 `agent_id` 标识
   - API配置（Agent指定或项目默认）
5. 实例进入 `就绪` 状态

#### 4.3.3 常驻Agent（memory_keeper）

- 应用启动时实例化，加载当前项目的 `story_memory` 到内存
- 跨任务保持 `就绪` 状态，响应所有Pipeline的记忆查询/更新请求
- 项目切换时重新加载对应记忆库
- 应用关闭时持久化到数据库

#### 4.3.4 资源释放

- 普通Agent完成或中止后，释放消息历史和中间缓存
- 常驻Agent不释放，直到项目切换或应用关闭
- 所有Agent的中间产出已写入文件系统，不依赖内存

### 4.4 Agent间通信机制（管道模式）

采用**严格管道模式**，Agent之间**不可相互调用**，Pipeline编排器是唯一调度者。

#### 4.4.1 通信规则

- **禁止直接调用**：Agent A不能调用Agent B，所有调度由Pipeline引擎执行
- **显式数据传递**：Agent的输出由Pipeline引擎接收，作为下一个Agent的输入参数显式注入
- **上下文隔离**：每个Agent实例有独立消息历史，不互相污染
- **无共享状态**：Agent之间不共享内存状态，仅通过Pipeline传递的数据通信

#### 4.4.2 数据传递格式

Agent输出遵循其 `output_schema`，常见数据类型：

- **结构化数据**：JSON对象（如灵感卡片矩阵、大纲树）
- **文本内容**：Markdown字符串（如改写后的文本）
- **分析报告**：带标签的结构化报告（如节奏审查报告，含问题位置和严重程度）
- **引用数据**：对中间产出文件的引用路径（如 `./agent_outputs/{task_id}/step3_idea_diverger.md`）

#### 4.4.3 管道编排示例

以灵感矩阵生成为例：

```
[用户输入: "末世、重生、复仇"]
        │
        ▼
[keyword_analyst] ──输出──→ {题材标签, 情感基调, 读者画像}
        │
        ▼
[idea_diverger] ──输出──→ [前提1, 前提2, ..., 前提8]
        │
        ▼
[conflict_designer] ──输入──→ [前提列表]
                  ──输出──→ [{前提, 核心冲突, 钩子, 悬念点}, ...]
        │
        ▼
[feasibility_evaluator] ──输入──→ 冲突方案列表
                      ──输出──→ [{方案, 难度评分, 市场定位, 扩展潜力}, ...]
        │
        ▼
[Pipeline完成] ──→ 最终灵感卡片矩阵输出到Chat界面
```

#### 4.4.4 为什么禁止Agent相互调用

1. **可预测性**：严格管道使得执行路径唯一确定，便于调试和回退
2. **可观测性**：所有Agent调用都经过Pipeline引擎，便于记录和可视化
3. **避免递归风险**：防止Agent调用链陷入死循环
4. **简化权限管理**：工具权限按Agent独立配置，无需考虑调用链传递

#### 4.4.5 内置Agent完整清单

| Agent ID | 分类 | 名称 | 职责 | 所属功能 |
|---|---|---|---|---|
| keyword_analyst | analytic | 关键词解析师 | 解析模糊关键词为题材标签、读者画像 | 灵感矩阵 |
| idea_diverger | creative | 灵感发散师 | 从多视角生成故事前提 | 灵感矩阵 |
| conflict_designer | creative | 冲突设计师 | 为前提设计核心冲突与钩子 | 灵感矩阵 |
| feasibility_evaluator | analytic | 可行性评估师 | 评估灵感可行性与市场定位 | 灵感矩阵 |
| structure_selector | analytic | 结构选型师 | 根据题材选择叙事结构 | 大纲生成 |
| chapter_splitter | structural | 章节拆分师 | 按节奏切分卷/章/场景 | 大纲生成 |
| foreshadow_planner | structural | 伏笔规划师 | 规划伏笔埋设与回收点 | 大纲生成 |
| pace_reviewer | analytic | 节奏审查师 | 审查节奏与冲突密度 | 大纲生成 |
| style_analyzer | analytic | 文风分析师 | 提取文本风格特征 | 改写润色 |
| reader_simulator | analytic | 读者模拟器 | 模拟读者阅读，标记弱点 | 改写润色 |
| rewriter | creative | 改写师 | 改写文本，保持作者声音 | 改写润色 |
| diff_explainer | analytic | 变更说明师 | 生成变更说明 | 改写润色 |
| character_loader | tool | 角色档案加载器 | 从设定卡加载角色档案 | 角色对话 |
| character_roleplayer | creative | 角色扮演师 | 以特定角色身份说话 | 角色对话 |
| scene_setter | creative | 场景设定师 | 设定场景与目标 | 角色对话 |
| dialogue_director | analytic | 对话导演 | 判定对话节奏与冲突升级 | 角色对话 |
| ooc_checker | analytic | OOC检查器 | 检查角色是否符合设定 | 角色对话 |
| memory_keeper | memory | 记忆守护者 | 维护故事记忆库（常驻） | 一致性管理 |
| context_retriever | tool | 上下文检索器 | 写作前召回相关上下文 | 一致性管理 |
| consistency_checker | analytic | 一致性检查器 | 实时检查新内容冲突 | 一致性管理 |
| memory_updater | memory | 记忆更新器 | 章节后更新记忆库 | 一致性管理 |
| drift_monitor | analytic | 漂移监控器 | 监控风格漂移 | 一致性管理 |
| macro_planner | structural | 宏观规划师 | 生成卷级骨架 | 百万字流水线 |
| volume_planner | structural | 卷规划师 | 细化单卷到章节级 | 百万字流水线 |
| chapter_writer | creative | 章节写作师 | 生成单章内容 | 百万字流水线 |
| chapter_stitcher | structural | 章节衔接师 | 平滑章节边界 | 百万字流水线 |
| final_polisher | creative | 终审润色师 | 全文风格统一 | 百万字流水线 |

共27个内置Agent，覆盖6大功能。部分Agent（如memory_keeper、context_retriever）跨多个功能复用。

---

## 5. 工具管理设计

### 5.1 工具注册表

工具注册表声明所有Agent可调用的原生工具。每个工具是独立命名空间（以 `agent.` 前缀），与Chat模式工具隔离。

#### 5.1.1 工具元数据

| 字段 | 类型 | 说明 |
|---|---|---|
| `tool_id` | string | 唯一标识符（如 `agent.create_setting_card`） |
| `name` | string | 显示名称 |
| `description` | string | 工具功能描述（供LLM理解） |
| `parameters_schema` | json | 参数schema（JSON Schema格式，传给LLM） |
| `result_schema` | json | 返回结果schema |
| `required_permission` | enum | read_db / write_db / read_file / write_file / read_memory / write_memory |
| `internal_function` | string | 内部复用的Rust函数路径（如 `settings::create_card`，模块名开头，不含crate::前缀） |
| `is_dangerous` | bool | 是否为高风险操作（影响检查点判定） |
| `cacheable` | bool | 结果是否可缓存 |
| `cache_ttl` | i64? | 缓存有效期（秒），空表示整个Pipeline内有效 |

#### 5.1.2 工具分类与完整清单

**设定卡管理类**

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.create_setting_card` | write_db | 创建设定卡 | `settings::create_card` |
| `agent.query_setting_cards` | read_db | 查询设定卡列表（支持类型/名称过滤） | `settings::query_cards` |
| `agent.update_setting_card` | write_db | 更新设定卡字段 | `settings::update_card` |
| `agent.delete_setting_card` | write_db | 删除设定卡 | `settings::delete_card` |

**大纲管理类**

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.create_outline_node` | write_db | 创建大纲节点（卷/章/场景） | `outline::create_node` |
| `agent.query_outline` | read_db | 查询大纲树（支持层级过滤） | `outline::query_tree` |
| `agent.update_outline_node` | write_db | 更新大纲节点内容 | `outline::update_node` |
| `agent.delete_outline_node` | write_db | 删除大纲节点（级联删除子节点） | `outline::delete_node` |

**伏笔管理类**

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.create_foreshadow` | write_db | 创建伏笔记录（埋设点、回收点、状态） | 新增 |
| `agent.query_foreshadows` | read_db | 查询伏笔列表（支持状态过滤） | 新增 |
| `agent.update_foreshadow_status` | write_db | 更新伏笔状态（未埋/已埋/已回收） | 新增 |

**记忆库管理类**（新增）

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.query_memory` | read_memory | 从记忆库查询（人物状态/时间线/地理信息） | 新增 |
| `agent.update_memory` | write_memory | 更新记忆库条目 | 新增 |
| `agent.check_consistency` | read_memory | 检查给定内容与记忆库的冲突 | 新增 |

**文件系统类**

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.read_intermediate` | read_file | 读取中间产出文件 | 新增 |
| `agent.write_intermediate` | write_file | 写入中间产出文件 | 新增 |
| `agent.read_chapter` | read_file | 读取已生成章节文件 | 新增 |

**上下文检索类**

| 工具ID | 权限 | 说明 | 复用函数 |
|---|---|---|---|
| `agent.query_conversation_history` | read_db | 查询对话历史（支持范围/关键词） | `chat::query_messages` |
| `agent.query_project_info` | read_db | 查询项目元信息 | `project::get_info` |
| `agent.retrieve_context` | read_memory + read_db | 综合检索相关上下文（记忆库+对话+设定） | 新增 |

共计20个原生工具，其中复用现有Rust函数10个（设定卡4+大纲4+对话历史1+项目信息1），新增10个（伏笔3+记忆库3+文件系统3+综合检索1）。

### 5.2 工具权限矩阵

权限矩阵定义**每个Agent可调用哪些工具**。分为三层：

#### 5.2.1 分类级默认权限

| Agent分类 | 默认允许的权限 |
|---|---|
| creative | read_db, read_file, write_file, read_memory |
| analytic | read_db, read_file, read_memory |
| structural | read_db, write_db, read_file, write_file, read_memory |
| memory | read_db, read_memory, write_memory, read_file, write_file |
| tool | 按工具需求单独配置 |

#### 5.2.2 Agent级工具白名单

每个Agent的元数据中 `required_tools` 和 `optional_tools` 字段声明具体工具：

- `required_tools`：必须可调用，否则Agent实例化失败
- `optional_tools`：可调用但非必需，LLM自行决定是否使用

**示例**：
```
idea_diverger:
  required_tools: []
  optional_tools: [agent.query_setting_cards, agent.query_outline]

foreshadow_planner:
  required_tools: [agent.create_foreshadow, agent.query_outline]
  optional_tools: [agent.query_setting_cards]

memory_updater:
  required_tools: [agent.update_memory, agent.read_chapter]
  optional_tools: []
```

#### 5.2.3 用户自定义Agent的权限校验

用户创建自定义Agent时：
1. 系统根据Agent分类赋予默认权限范围
2. 用户在默认范围内勾选 `required_tools` 和 `optional_tools`
3. 系统校验所选工具是否在分类允许的权限范围内
4. 若用户尝试赋予超出分类的工具权限，系统警告并阻止（高级用户可强制覆盖，但标记风险）

### 5.3 工具调用流程

#### 5.3.1 调用链路

```
Agent (LLM决定调用工具)
  │
  ▼
工具调用请求 (tool_id, parameters, task_id, agent_id)
  │
  ▼
工具适配层
  ├─→ 1. 校验agent_id是否有权调用tool_id (查权限矩阵)
  ├─→ 2. 检查缓存 (若cacheable且缓存命中，直接返回)
  ├─→ 3. 校验参数 (按parameters_schema)
  ├─→ 4. 执行内部函数
  ├─→ 5. 校验返回结果 (按result_schema)
  ├─→ 6. 写入缓存 (若cacheable)
  └─→ 7. 记录调用日志 (tool_id, parameters, result, duration)
  │
  ▼
返回结果给Agent
```

#### 5.3.2 LLM工具调用协议

工具定义发送给LLM时，遵循与现有Chat系统相同的协议（参考1.2节"项目工程实践记录"中的约束）：

- **每轮请求都发送完整工具定义**（不仅是第一轮）
- **工具定义按function name去重**（避免API拒绝）
- **工具结果消息包含 `tool_call_id`**（关联对应工具调用）
- **Assistant消息包含完整 `tool_calls` 数组**
- **空内容Assistant消息不保存**（避免空消息污染历史）

#### 5.3.3 Tauri 2.0 兼容性

工具参数遵循项目约束：
- Rust后端使用snake_case
- 前端使用camelCase
- Tauri 2.0自动转换
- **参数必须扁平化**（不使用嵌套struct，避免反序列化失败）

#### 5.3.4 字符串安全

工具返回的字符串内容若需截断（如长文本喂给LLM）：
- 必须使用字符边界安全方法（`chars().take()`）
- 禁止字节切片（避免UTF-8边界panic，参考1.2节"项目工程实践记录"）

### 5.4 工具结果缓存

#### 5.4.1 缓存策略

- **缓存粒度**：以 `(tool_id, parameters_hash)` 为键
- **缓存范围**：单个Pipeline任务内（任务完成后清空缓存）
- **缓存条件**：工具的 `cacheable` 字段为true
- **缓存TTL**：
  - `cache_ttl` 为空 → 整个Pipeline内有效
  - `cache_ttl` 为N秒 → N秒后失效，重新调用

#### 5.4.2 缓存失效场景

以下情况缓存自动失效：
1. Pipeline任务完成或中止
2. 写操作后，相关读操作的缓存失效（如 `create_setting_card` 后，`query_setting_cards` 的缓存失效）
3. 用户在检查点修改了中间产出（相关缓存失效）

#### 5.4.3 缓存失效规则

写操作工具执行后，按工具关联性清除相关读缓存：

| 写操作 | 失效的读缓存 |
|---|---|
| `agent.create_setting_card` | `agent.query_setting_cards` |
| `agent.update_setting_card` | `agent.query_setting_cards` |
| `agent.delete_setting_card` | `agent.query_setting_cards` |
| `agent.create_outline_node` | `agent.query_outline` |
| `agent.update_outline_node` | `agent.query_outline` |
| `agent.delete_outline_node` | `agent.query_outline` |
| `agent.create_foreshadow` | `agent.query_foreshadows` |
| `agent.update_foreshadow_status` | `agent.query_foreshadows` |
| `agent.update_memory` | `agent.query_memory`, `agent.check_consistency`, `agent.retrieve_context` |
| `agent.write_intermediate` | `agent.read_intermediate` |

#### 5.4.4 缓存统计

Pipeline执行完成后，记录缓存命中率到 `agent_tasks` 表，用于性能优化分析。

---

## 6. Pipeline执行引擎

### 6.1 工作流定义

每个功能对应一个**工作流定义**（Workflow Definition），主体描述为DAG（有向无环图），节点间的数据依赖通过边表达。

**关于循环节点**：DAG的"无环"约束针对的是**节点间的数据依赖关系**（不允许节点A的输出最终依赖节点A自身的输入，避免死锁）。循环节点（如7.4.3的dialogue_loop）是**节点内部的执行模式**——循环节点本身在DAG中是一个普通节点，但其内部通过Agent的多次调用来实现循环逻辑。循环节点的输入是初始上下文，输出是循环结束后的最终结果，对DAG而言仍然是单向无环的。

#### 6.1.1 工作流元数据

| 字段 | 类型 | 说明 |
|---|---|---|
| `workflow_id` | string | 唯一标识符（如 `inspiration_matrix`） |
| `name` | string | 显示名称 |
| `description` | string | 功能描述 |
| `category` | enum | 功能分类（inspiration/outline/rewrite/dialogue/consistency/pipeline） |
| `default_permission_mode` | enum | 默认权限模式（hands_off/supervised/autopilot） |
| `nodes` | Node[] | DAG节点列表 |
| `edges` | Edge[] | DAG边列表（数据依赖） |
| `checkpoints` | string[] | 检查点节点ID列表 |
| `estimated_duration` | INTEGER | 预估耗时秒数（仅供UI展示） |
| `estimated_token_cost` | INTEGER | 预估token消耗（用于超限判断） |

#### 6.1.2 节点定义

| 字段 | 类型 | 说明 |
|---|---|---|
| `node_id` | string | 节点唯一标识符 |
| `agent_id` | string | 调用的Agent ID |
| `agent_overrides` | json? | Agent参数覆盖（如临时调整temperature） |
| `input_mapping` | json | 输入参数映射（从上游节点输出或用户输入提取） |
| `output_key` | string | 输出在Pipeline上下文中的键名 |
| `retry_limit` | i32 | 失败重试次数上限（默认3） |
| `timeout_sec` | i32 | 超时时间（秒，默认300） |
| `parallel_group` | string? | 并行组标识（同组节点并行执行） |
| `is_loop` | bool | 是否为循环节点（默认false） |
| `loop_config` | json? | 循环配置（当is_loop为true时必填） |

**loop_config结构**：
```json
{
  "max_iterations": 20,           // 最大循环次数
  "termination_field": "should_end",  // Agent输出中标志终止的字段名
  "loop_agents": [                // 循环内交替调用的Agent列表
    {"agent_id": "character_roleplayer", "input_from": "prev_director"},
    {"agent_id": "dialogue_director", "input_from": "prev_roleplayer"}
  ]
}
```

循环节点在DAG中表现为单一节点，内部通过`loop_agents`的多次交替调用实现循环。循环终止条件：达到`max_iterations`或某次调用的输出包含`termination_field: true`。

#### 6.1.3 边定义

| 字段 | 类型 | 说明 |
|---|---|---|
| `from_node` | string | 上游节点ID |
| `to_node` | string | 下游节点ID |
| `data_mapping` | json | 数据传递映射（from_node的output_key → to_node的input参数） |

### 6.2 状态机与检查点

#### 6.2.1 任务状态机

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │ 启动
                           ▼
                    ┌─────────────┐
              ┌─────│   running   │─────┐
              │     └──────┬──────┘     │
              │            │            │
         检查点暂停         │ 成功       失败
              │            │            │
              ▼            ▼            ▼
       ┌────────────┐ ┌────────┐ ┌──────────────────────────┐
       │ paused_at_ │ │completed│ │ failed_awaiting_decision │
       │ checkpoint │ └────────┘ └───────────┬──────────────┘
       └─────┬──────┘                         │
             │ 用户决策                        │ supervised: 询问用户
             ├─继续─→ running                  │ autopilot: 自动重试/跳过
             ├─修改─→ running(重跑)            │ hands_off: 直接进入 failed
             ├─跳过─→ running(下一节点)        │
             └─中止─→ aborted                  ▼
                                   ┌──────────────────────┐
                                   │ 重试/跳过/修改/中止   │
                                   └─┬───────┬───────┬────┘
                                     │       │       │
                                  重试     跳过    中止
                                     │       │       │
                                     ▼       ▼       ▼
                                  running  running  aborted
                                            (跳过该节点)
```

**状态说明**：
- `pending`：任务已创建未启动
- `running`：正在执行某节点
- `paused_at_checkpoint`：在检查点暂停，等待用户决策
- `failed_awaiting_decision`：节点失败，等待错误处理决策（仅supervised模式）
- `completed`：所有节点执行成功
- `failed`：任务彻底失败（hands_off模式失败、supervised用户选择中止、或重试耗尽）
- `aborted`：用户主动中止

**hands_off模式**：节点失败时 `running → failed`（不经过 `failed_awaiting_decision`）
**supervised模式**：节点失败时 `running → failed_awaiting_decision`，用户决策后可能回到 `running` 或转为 `failed`/`aborted`
**autopilot模式**：节点失败时自动重试，重试耗尽后跳过并继续 `running`，不进入 `failed_awaiting_decision`

#### 6.2.2 检查点机制

检查点是DAG中标记的关键节点（在 `checkpoints` 字段中声明），到达时根据权限模式决定行为：

| 权限模式 | 检查点行为 |
|---|---|
| hands_off | 不暂停，直接继续执行 |
| supervised | 暂停任务，展示当前Agent产出，等待用户决策 |
| autopilot | 不暂停，直接继续执行 |

#### 6.2.3 检查点用户决策

在 supervised 模式下，检查点暂停时提供四个选项：

1. **继续**：接受当前产出，继续执行下一节点
2. **修改**：用户编辑当前Agent的产出，用修改后的版本继续
3. **跳过**：丢弃当前产出，跳过本节点继续（若下游依赖此输出，则用空值或默认值）
4. **中止**：终止整个Pipeline任务

#### 6.2.4 检查点位置建议

每个功能的检查点位置在第7章详细定义，通用原则：
- 创意发散后、评估前（让用户筛选灵感）
- 结构规划完成后、写作前（让用户确认大纲）
- 高token消耗节点前（让用户确认是否继续）
- 不可逆写操作前（如删除大纲节点）

### 6.3 错误处理与回退

#### 6.3.1 错误分类

| 错误类型 | 说明 | 示例 |
|---|---|---|
| `LLMError` | LLM调用失败 | API超时、限流、认证失败 |
| `ToolError` | 工具调用失败 | 数据库错误、文件权限、参数校验失败 |
| `SchemaError` | 输出格式不符 | Agent输出不匹配output_schema |
| `TimeoutError` | 超时 | Agent执行超过timeout_sec |
| `DependencyError` | 上游依赖失败 | 输入数据缺失或格式错误 |

#### 6.3.2 错误处理策略（按权限模式）

**hands_off 模式**：
1. 单步失败立即中止整个Pipeline
2. 记录错误详情到 `agent_tasks.error_log`
3. 通知用户任务失败，展示错误信息
4. 不自动重试

**supervised 模式**：
1. 单步失败时暂停任务，进入 `failed` 状态
2. 询问用户选择：
   - **重试**：重新执行该节点（最多 `retry_limit` 次）
   - **跳过**：跳过该节点，继续后续（若下游依赖失败则级联标记）
   - **修改输入**：用户编辑输入参数后重试
   - **中止**：终止Pipeline
3. 超过重试上限后强制询问用户

**autopilot 模式**：
1. 单步失败自动重试，最多 `retry_limit` 次
2. 重试间隔指数退避（1s, 2s, 4s, ...）
3. 重试耗尽后跳过该节点，标记为 `skipped_failed`
4. 继续执行后续节点（若依赖失败则级联跳过）
5. 任务完成后报告所有失败节点

#### 6.3.3 回退机制

- **节点级回退**：重新执行某个节点（supervised模式的"修改输入"选项）
- **Pipeline级回退**：回退到上一个检查点，从检查点后重新执行
- **不支持中间状态回滚**：已写入数据库的操作（如 `create_setting_card`）不自动回滚，需用户手动处理或通过反向操作工具（如 `delete_setting_card`）

### 6.4 并行执行支持

#### 6.4.1 并行组机制

DAG中同一 `parallel_group` 的节点并行执行，所有节点完成后才继续下游节点。

```
[memory_keeper查询] ──→ ┌─[volume_planner卷1]─┐
                        ├─[volume_planner卷2]─┤──→ [chapter_stitcher]
                        └─[volume_planner卷3]─┘
                         (parallel_group: "volumes")
```

#### 6.4.2 并行限制

- **最大并行度**：可配置（默认3），避免API限流
- **API配置共享**：同一API配置的并行请求受其rate limit约束
- **不同API配置**：不同Agent使用不同API配置时，并行度可叠加
- **失败处理**：并行组内某节点失败，不阻塞其他节点，但下游节点若依赖失败输出则跳过

#### 6.4.3 并行结果合并

并行组完成后，结果按 `output_key` 合并为数组，传递给下游节点：

```json
{
  "volumes": [
    {"volume_id": 1, "chapters": [...]},
    {"volume_id": 2, "chapters": [...]},
    {"volume_id": 3, "chapters": [...]}
  ]
}
```

---

## 7. 功能规格

### 7.1 功能一：灵感矩阵生成

#### 7.1.1 功能概述

**用户场景**：作者输入模糊关键词（如"末世、重生、复仇"），系统生成结构化灵感卡片矩阵，激发创作思路。

**默认权限模式**：hands_off（不干预）

**Pipeline ID**：`inspiration_matrix`

#### 7.1.2 Pipeline DAG

```
[用户输入: 关键词]
        │
        ▼
[n1: keyword_analyst] ──→ 输出: keyword_analysis
        │
        ▼
[n2: idea_diverger] ──→ 输出: premises (5-8个故事前提)
        │
        ▼  ★检查点1
[n3: conflict_designer] ──→ 输出: conflict_solutions
        │
        ▼
[n4: feasibility_evaluator] ──→ 输出: inspiration_matrix
        │
        ▼
[输出最终结果到Chat界面]
```

**检查点**：
- 检查点1（n2之后）：让用户筛选/修改前提列表，再进入冲突设计

**完整edges列表**：
```json
[
  {"from_node": "n1", "to_node": "n2", "data_mapping": {"keyword_analysis": "keyword_analysis"}},
  {"from_node": "n2", "to_node": "n3", "data_mapping": {"premises": "premises"}},
  {"from_node": "n3", "to_node": "n4", "data_mapping": {"conflict_solutions": "conflict_solutions"}},
  {"from_node": "n1", "to_node": "n4", "data_mapping": {"keyword_analysis": "keyword_analysis"}}
]
```

注意n1→n4是跨节点数据边（跳过n2、n3），feasibility_evaluator需要keyword_analysis来评估市场定位和目标读者。

#### 7.1.3 节点详细规格

**n1: keyword_analyst**
- Agent: `keyword_analyst` (analytic)
- 输入: `{ keywords: string }`
- 输出:
  ```json
  {
    "genre_tags": ["末世", "重生", "复仇"],
    "emotional_tone": "压抑、抗争、救赎",
    "target_audience": "18-35岁男性，偏好热血爽文",
    "themes": ["人性崩塌", "重来一次", "以牙还牙"]
  }
  ```
- 工具: 无必需，可选 `agent.query_project_info`

**n2: idea_diverger**
- Agent: `idea_diverger` (creative)
- 输入: `{ keyword_analysis: n1.keyword_analysis }`
- 输出:
  ```json
  {
    "premises": [
      {
        "id": "p1",
        "perspective": "主角视角",
        "premise": "末世爆发当天，主角带着前世记忆重生到灾难前72小时",
        "hook": "72小时倒计时，能改变什么？"
      },
      // ... 5-8个
    ]
  }
  ```
- 工具: 无

**n3: conflict_designer**
- Agent: `conflict_designer` (creative)
- 输入: `{ premises: n2.premises }`
- 输出:
  ```json
  {
    "conflict_solutions": [
      {
        "premise_id": "p1",
        "core_conflict": "主角的预知能力 vs 不可改变的命运节点",
        "external_conflict": "幸存者阵营的资源争夺",
        "internal_conflict": "复仇执念 vs 救赎可能",
        "suspense_points": ["前世仇人的真实身份", "重生能力的代价"]
      }
    ]
  }
  ```
- 工具: 无

**n4: feasibility_evaluator**
- Agent: `feasibility_evaluator` (analytic)
- 输入: `{ conflict_solutions: n3.conflict_solutions, keyword_analysis: n1.keyword_analysis }`
- 输出（最终结果）:
  ```json
  {
    "inspiration_matrix": [
      {
        "premise": "...",
        "core_conflict": "...",
        "hook": "...",
        "suspense_points": [...],
        "difficulty_score": 7.5,
        "market_positioning": "末世重生爽文，适合连载",
        "expansion_potential": "可扩展3-5卷",
        "target_audience": "..."
      }
    ]
  }
  ```
- 工具: 无

#### 7.1.4 最终输出格式

以Markdown表格形式输出到Chat界面，每张灵感卡片包含：

| 字段 | 说明 |
|---|---|
| 前提 | 故事一句话概述 |
| 核心冲突 | 内外部冲突描述 |
| 钩子 | 吸引读者的悬念点 |
| 悬念点列表 | 关键悬念 |
| 难度评分 | 1-10分 |
| 市场定位 | 目标读者与类型 |
| 扩展潜力 | 可写多少字/卷 |

---

### 7.2 功能二：结构化大纲生成

#### 7.2.1 功能概述

**用户场景**：选定一个灵感后，生成可执行的三级大纲（卷→章→场景）+ 伏笔依赖图。

**默认权限模式**：supervised（检查点干预）

**Pipeline ID**：`outline_generation`

#### 7.2.2 Pipeline DAG

```
[用户输入: 选定灵感卡片 + 可选字数目标]
        │
        ▼
[n1: structure_selector] ──→ 输出: structure_type
        │
        ▼
[n2: chapter_splitter] ──→ 输出: outline_tree (卷/章/场景)
        │
        ▼  ★检查点1
[n3: foreshadow_planner] ──→ 输出: foreshadow_graph
        │
        ▼  ★检查点2
[n4: pace_reviewer] ──→ 输出: pace_report + revised_outline
        │
        ▼
[输出最终大纲到Chat界面 + 写入数据库outline表]
```

**检查点**：
- 检查点1（n2之后）：让用户确认/修改章节结构
- 检查点2（n3之后）：让用户确认/修改伏笔规划

#### 7.2.3 节点详细规格

**n1: structure_selector**
- Agent: `structure_selector` (analytic)
- 输入: `{ inspiration_card: object, target_words: number? }`
- 输出:
  ```json
  {
    "structure_type": "三幕式",
    "structure_rationale": "末世重生题材适合三幕式，灾前/灾中/重建",
    "act_breakdown": [
      {"act": 1, "proportion": 0.25, "focus": "重生与准备"},
      {"act": 2, "proportion": 0.5, "focus": "末世生存与冲突"},
      {"act": 3, "proportion": 0.25, "focus": "复仇与救赎"}
    ]
  }
  ```

**n2: chapter_splitter**
- Agent: `chapter_splitter` (structural)
- 输入: `{ inspiration_card, structure: n1, target_words }`
- 输出:
  ```json
  {
    "outline_tree": [
      {
        "volume_id": 1,
        "title": "第一卷：倒计时",
        "chapters": [
          {
            "chapter_id": 1,
            "title": "重生",
            "scenes": [
              {"scene_id": 1, "summary": "主角在末世第30天死亡"},
              {"scene_id": 2, "summary": "醒来发现回到灾前72小时"}
            ],
            "word_target": 3000
          }
        ]
      }
    ]
  }
  ```
- 工具: `agent.create_outline_node` (写入数据库), `agent.query_outline` (查已有)

**n3: foreshadow_planner**
- Agent: `foreshadow_planner` (structural)
- 输入: `{ outline_tree: n2.outline_tree }`
- 输出:
  ```json
  {
    "foreshadows": [
      {
        "id": "f1",
        "content": "主角前世的神秘戒指",
        "plant_chapter": 1,
        "plant_scene": 2,
        "payoff_chapter": 25,
        "payoff_scene": 3,
        "status": "planned"
      }
    ],
    "dependency_graph": {
      "nodes": [{"id": "f1", "label": "神秘戒指"}],
      "edges": [{"from": "f1", "to": "f3", "relation": "related"}]
    }
  }
  ```
- 工具: `agent.create_foreshadow`, `agent.query_foreshadows`

**n4: pace_reviewer**
- Agent: `pace_reviewer` (analytic)
- 输入: `{ outline_tree: n2.outline_tree, foreshadows: n3.foreshadows }`
- 输出:
  ```json
  {
    "pace_report": {
      "overall_score": 7.5,
      "weak_sections": [
        {"chapter_range": "5-8", "issue": "冲突密度过低", "suggestion": "增加支线冲突"}
      ]
    },
    "revised_outline": { /* 修正后的大纲，若pace_reviewer建议调整 */ }
  }
  ```

#### 7.2.4 最终输出

- 大纲树以可折叠树形展示（复用现有OutlinePanel组件）
- 伏笔依赖图以Mermaid图表形式渲染
- 节奏报告以Markdown展示
- 大纲数据写入数据库 `outline_nodes` 表，伏笔写入 `foreshadows` 表

---

### 7.3 功能三：多视角改写润色

#### 7.3.1 功能概述

**用户场景**：作者贴一段自己写的文字，系统生成改写版+变更说明+读者模拟报告。

**默认权限模式**：hands_off

**Pipeline ID**：`rewrite_polish`

#### 7.3.2 Pipeline DAG

```
[用户输入: 原文文本]
        │
        ├──────────────────────────┐
        ▼                          ▼
[n1: style_analyzer]      [n2: reader_simulator]
        │                          │
        └──────────┬───────────────┘
                   ▼
            [n3: rewriter] ──→ 输出: rewritten_text
                   │
                   ▼
            [n4: diff_explainer] ──→ 输出: change_report
                   │
                   ▼
            [输出最终结果到Chat界面]
```

**并行组**：n1和n2并行执行（parallel_group: "analysis"）

**检查点**：无（全程不干预）

#### 7.3.3 节点详细规格

**n1: style_analyzer**
- Agent: `style_analyzer` (analytic)
- 输入: `{ original_text: string }`
- 输出:
  ```json
  {
    "style_features": {
      "avg_sentence_length": 18.5,
      "vocabulary_level": "中等",
      "rhythm": "短促有力",
      "pov": "第三人称限制视角",
      "tone": "冷峻",
      "distinctive_patterns": ["多用动作描写", "对话简短"]
    }
  }
  ```

**n2: reader_simulator**
- Agent: `reader_simulator` (analytic)
- 输入: `{ original_text: string }`
- 输出:
  ```json
  {
    "reading_experience": {
      "boring_sections": [{"paragraph": 3, "reason": "描写冗长"}],
      "confusing_sections": [{"paragraph": 5, "reason": "视角切换突然"}],
      "immersion_breaks": [{"paragraph": 7, "reason": "现代词汇出戏"}],
      "emotional_curve": [0.3, 0.5, 0.4, 0.7, 0.6, 0.8]
    }
  }
  ```

**n3: rewriter**
- Agent: `rewriter` (creative)
- 输入: `{ original_text, style_features: n1, reading_experience: n2 }`
- 输出:
  ```json
  {
    "rewritten_text": "改写后的完整文本...",
    "preservation_notes": "保留了原作者的冷峻语调与短句节奏"
  }
  ```

**n4: diff_explainer**
- Agent: `diff_explainer` (analytic)
- 输入: `{ original_text, rewritten_text: n3.rewritten_text }`
- 输出:
  ```json
  {
    "changes": [
      {
        "location": "第3段",
        "original": "...",
        "rewritten": "...",
        "reason": "压缩冗长描写，提升节奏",
        "category": "压缩"
      }
    ],
    "summary": "共修改12处：压缩5处、视角修正3处、词汇替换4处"
  }
  ```

#### 7.3.4 最终输出

- 改写后文本以代码块展示，支持一键复制
- 变更说明以表格展示（位置|原文|改写|理由|类别）
- 读者模拟报告以分段列表展示

---

### 7.4 功能四：角色驱动对话生成

#### 7.4.1 功能概述

**用户场景**：作者选定角色设定卡 + 场景描述，系统生成多角色对话+情感曲线+OOC检查报告。

**默认权限模式**：hands_off

**Pipeline ID**：`character_dialogue`

#### 7.4.2 Pipeline DAG

```
[用户输入: 角色ID列表 + 场景描述 + 对话目标]
        │
        ▼
[n1: character_loader] ──→ 输出: character_profiles
        │
        ▼
[n2: scene_setter] ──→ 输出: scene_context
        │
        ▼  ★检查点1 (可选，supervised模式)
[n3: dialogue_loop] (多轮迭代)
        │  循环: character_roleplayer → dialogue_director → character_roleplayer → ...
        ▼
[n4: ooc_checker] ──→ 输出: ooc_report
        │
        ▼
[输出最终结果到Chat界面]
```

**检查点**：
- 检查点1（n2之后）：让用户确认场景设定（supervised模式时）

#### 7.4.3 对话生成循环（n3）

n3是一个**循环节点**，不是单次调用：

```
n3: dialogue_loop
  │
  ▼
[character_roleplayer_A] ──→ A的台词
  │
  ▼
[dialogue_director] ──→ {next_speaker: B, emotion_shift: "升级", should_end: false}
  │
  ▼
[character_roleplayer_B] ──→ B的台词
  │
  ▼
[dialogue_director] ──→ {next_speaker: A, emotion_shift: "缓和", should_end: false}
  │
  ... (循环直到 should_end: true 或达到轮次上限)
```

**循环控制**：
- **轮次定义**：一次循环 = 一个character_roleplayer发言 + 一次dialogue_director判定，默认最大20轮（即最多40次Agent调用，产生最多20句台词）
- **最大轮次配置**：在工作流节点的 `loop_config.max_iterations` 字段配置（6.1.2节）
- **提前结束**：dialogue_director输出中 `should_end` 字段为true时终止循环
- **should_end判定标准**（在dialogue_director的system_prompt中定义，实现阶段细化）：
  - 对话目标已达成（如双方达成协议、冲突解决）
  - 情感曲线收敛（tension降至0.3以下且持续2轮无升级）
  - 场景自然结束（如某方离开、外部事件打断）
- **每轮实例独立性**：每轮的character_roleplayer实例独立，但共享角色档案和对话历史

#### 7.4.4 节点详细规格

**n1: character_loader** (tool型，不调用LLM)
- 输入: `{ character_ids: number[] }`
- 输出: `{ character_profiles: [{id, name, personality, speech_style, background, relationships}] }`
- 工具: `agent.query_setting_cards`

**n2: scene_setter**
- 输入: `{ scene_description: string, dialogue_goal: string, character_profiles: n1 }`
- 输出:
  ```json
  {
    "scene_context": {
      "location": "废弃超市",
      "time": "末世第7天黄昏",
      "atmosphere": "紧张、压抑",
      "initial_tension": 0.6,
      "stakes": "最后的水源争夺"
    }
  }
  ```

**n3: dialogue_loop**
- 输入: `{ character_profiles, scene_context }`
- 输出:
  ```json
  {
    "dialogue": [
      {"speaker": "A", "line": "...", "emotion": "警惕", "tension": 0.6},
      {"speaker": "B", "line": "...", "emotion": "挑衅", "tension": 0.7},
      // ...
    ],
    "emotion_curve": [0.6, 0.7, 0.8, 0.7, 0.5],
    "final_tension": 0.5
  }
  ```

**n4: ooc_checker**
- 输入: `{ dialogue: n3.dialogue, character_profiles: n1 }`
- 输出:
  ```json
  {
    "ooc_report": {
      "issues": [
        {
          "line_index": 5,
          "speaker": "A",
          "issue": "A的设定是沉默寡言，此处台词过长",
          "severity": "medium",
          "suggestion": "压缩为短句"
        }
      ],
      "overall_consistency": 0.85
    }
  }
  ```

#### 7.4.5 最终输出

- 对话以剧本格式展示（角色名：台词）
- 情感曲线以折线图展示
- OOC报告以表格展示

---

### 7.5 功能五：长篇一致性管理

#### 7.5.1 功能概述

**用户场景**：写作过程中，系统持续维护故事记忆库，在写新章节前提供上下文，写完后检查一致性。

**默认权限模式**：supervised

**Pipeline ID**：`consistency_management`

**特殊性**：这不是一次性Pipeline，而是**常驻服务**，由用户手动触发。

**触发方式**：
- **手动触发**（唯一触发方式）：用户在Agent任务面板选择"一致性管理"功能，选择触发模式（写作前检索/写作后检查），输入章节号或粘贴章节内容
- 系统不自动检测写作进度，不自动触发检查（避免用户未准备好的章节被误分析）
- 未来可扩展"自动触发"模式（如检测到新章节文件时自动触发），但P2阶段仅支持手动

#### 7.5.2 触发模式

一致性管理有两种触发模式：

**模式A：写作前检索**（用户请求上下文）
```
[用户: "我要写第15章，给我上下文"]
        │
        ▼
[n1: context_retriever] ──→ 输出: relevant_context
        │
        ▼
[输出上下文摘要到Chat界面]
```

**模式B：写作后更新+检查**（章节完成时）
```
[用户: "第15章写完了，章节内容..."]
        │
        ▼
[n1: consistency_checker] ──→ 输出: consistency_report
        │
        ▼  ★检查点1 (若有冲突)
[n2: memory_updater] ──→ 输出: memory_updated
        │
        ▼
[n3: drift_monitor] ──→ 输出: drift_report
        │
        ▼
[输出报告到Chat界面]
```

#### 7.5.3 节点详细规格

**context_retriever** (tool型)
- 输入: `{ chapter_number: number, scene_summary?: string }`
- 输出:
  ```json
  {
    "relevant_context": {
      "character_states": [
        {"name": "主角", "current_state": "左臂受伤（第13章）", "location": "避难所"}
      ],
      "recent_events": ["第14章：与反派首次交锋"],
      "active_foreshadows": [{"id": "f1", "content": "神秘戒指", "status": "planted"}],
      "timeline": "末世第7-14天",
      "suggestions": ["第13章主角受伤，本章不宜激烈动作戏"]
    }
  }
  ```
- 工具: `agent.retrieve_context`, `agent.query_memory`, `agent.query_foreshadows`

**consistency_checker**
- 输入: `{ chapter_content: string, chapter_number: number }`
- 输出:
  ```json
  {
    "consistency_report": {
      "conflicts": [
        {
          "type": "character_state",
          "description": "主角左臂本应受伤，但本章有挥剑动作",
          "chapter_ref": 13,
          "severity": "high"
        }
      ],
      "foreshadow_opportunities": [
        {"foreshadow_id": "f1", "suggestion": "本章可回收神秘戒指伏笔"}
      ]
    }
  }
  ```
- 工具: `agent.check_consistency`

**memory_updater**
- 输入: `{ chapter_content, consistency_report }`
- 输出:
  ```json
  {
    "memory_updates": [
      {"entity": "主角", "field": "location", "old": "避难所", "new": "废弃超市"},
      {"entity": "反派", "field": "status", "old": "存活", "new": "重伤逃走"}
    ],
    "new_foreshadows": [{"id": "f5", "content": "反派遗留的地图"}]
  }
  ```
- 工具: `agent.update_memory`, `agent.create_foreshadow`

**drift_monitor**
- 输入: `{ chapter_content, chapter_number, baseline_style?: object }`
- 输出:
  ```json
  {
    "drift_report": {
      "style_drift": {"score": 0.15, "trend": "轻微幽默化", "baseline_chapter": 1},
      "character_drift": [
        {"name": "主角", "drift_score": 0.08, "note": "语气变得偏激"}
      ],
      "recommendation": "第15章主角语气偏离基线，建议回顾第1章人设"
    }
  }
  ```

#### 7.5.4 memory_keeper 常驻服务

- 跨任务常驻，应用启动时加载当前项目记忆库
- 响应 `agent.query_memory` 和 `agent.update_memory` 工具调用
- 记忆库结构（存数据库 `story_memory` 表）：
  ```json
  {
    "characters": [{"id": 1, "name": "主角", "state": {...}, "history": [...]}],
    "timeline": [{"chapter": 1, "event": "..."}],
    "locations": [{"name": "避难所", "description": "..."}],
    "foreshadows": [{"id": "f1", "status": "planted", ...}]
  }
  ```

---

### 7.6 功能六：百万字小说流水线

#### 7.6.1 功能概述

**用户场景**：给定核心设定，一键生成完整长篇小说（目标百万字）。

**默认权限模式**：supervised（强烈建议，成本极高）

**Pipeline ID**：`novel_pipeline`

**特殊性**：长时间运行任务，支持后台执行+断点续传。

#### 7.6.2 Pipeline DAG

```
[用户输入: 核心设定 + 目标字数 + 章节字数]
        │
        ▼
[n1: macro_planner] ──→ 输出: volume_skeleton (3卷骨架)
        │
        ▼  ★检查点1
[n2: volume_planner组] (并行, parallel_group: "volumes")
  ├─[n2a: volume_planner卷1] ──→ chapters_v1
  ├─[n2b: volume_planner卷2] ──→ chapters_v2
  └─[n2c: volume_planner卷3] ──→ chapters_v3
        │
        ▼  ★检查点2
[n3: chapter_writer组] (并行, 受最大并行度限制)
  ├─[chapter_writer ch1] ──→ chapter_1.md
  ├─[chapter_writer ch2] ──→ chapter_2.md
  └─... (每章调用consistency_management)
        │
        ▼
[n4: chapter_stitcher] ──→ 输出: stitched_novel
        │
        ▼
[n5: final_polisher] ──→ 输出: final_novel
        │
        ▼
[输出完成通知 + 文件路径]
```

**检查点**：
- 检查点1（n1之后）：让用户确认卷级骨架
- 检查点2（n2之后）：让用户确认章节级大纲

#### 7.6.3 节点详细规格

**n1: macro_planner**
- 输入: `{ core_setting: object, target_words: number, chapter_word_target: number }`
- 输出:
  ```json
  {
    "volume_skeleton": [
      {
        "volume_id": 1,
        "title": "第一卷：倒计时",
        "theme": "重生与准备",
        "chapter_count": 30,
        "word_target": 300000,
        "key_events": ["重生", "收集物资", "建立基地"]
      }
    ]
  }
  ```

**n2: volume_planner (并行)**
- 每卷一个实例，并行执行
- 输入: `{ volume: n1.volume_skeleton[i], core_setting }`
- 输出:
  ```json
  {
    "chapters": [
      {
        "chapter_id": 1,
        "title": "重生",
        "scenes": [...],
        "word_target": 10000,
        "summary": "..."
      }
    ]
  }
  ```
- 工具: `agent.create_outline_node`

**n3: chapter_writer (并行，限流)**
- 每章一个实例，按最大并行度分批执行
- 输入: `{ chapter: n2.chapters[i], relevant_context: from memory_keeper }`
- 输出: 写入文件 `./agent_outputs/{task_id}/chapters/chapter_{id}.md`
- **内嵌一致性检查流程**：chapter_writer作为Agent，在写作过程中通过工具调用实现一致性管理：
  - 写作前调用 `agent.retrieve_context` 工具获取上下文（由context_retriever工具型Agent提供服务）
  - 写作后调用 `agent.check_consistency` 工具检查冲突（由memory_keeper响应）
  - 调用 `agent.update_memory` 工具更新记忆库（由memory_keeper响应）
- **注意**：这里chapter_writer调用的是**工具**（`agent.retrieve_context`等），不是Pipeline节点。consistency_checker和memory_updater作为Pipeline节点的形式（7.5节）是供独立的一致性管理Pipeline使用；在百万字流水线内部，chapter_writer通过工具调用复用相同的基础设施（memory_keeper常驻服务），但不是嵌套调用Pipeline。
- 工具: `agent.write_intermediate`, `agent.retrieve_context`, `agent.check_consistency`, `agent.update_memory`

**n4: chapter_stitcher**
- 输入: `{ chapter_files: n3输出的文件列表 }`
- 输出: 合并后的完整小说文件
- 工具: `agent.read_chapter`, `agent.write_intermediate`

**n5: final_polisher**
- 输入: `{ stitched_novel: n4输出 }`
- 输出: 最终润色版，写入 `./agent_outputs/{task_id}/final_novel.md`
- 注：由于文本量大，final_polisher按章节分段处理，不做全文一次性处理

#### 7.6.4 断点续传

**正常持久化**：
- 任务每完成一个chapter_writer节点，状态持久化到 `agent_tasks` 表（更新 `current_node_id` 和 `completed_nodes` 数组）
- 已生成的章节文件已写入 `./agent_outputs/{task_id}/chapters/chapter_{id}.md`

**崩溃恢复流程**：
1. 应用启动时扫描 `agent_tasks` 表，查找状态为 `running` 但 `started_at` 时间超过合理范围的任务
2. 将这些任务标记为 `failed`，状态详情记录"应用崩溃导致中断"
3. 用户可在任务面板选择"恢复该任务"
4. 恢复时读取 `completed_nodes`，已完成节点的产出从文件系统加载复用
5. **并行批次崩溃处理**：以"最后完成"的章节为准，未完成的半成品文件（通过文件写入原子性保证：先写临时文件 `.tmp` 再rename）会被清理
6. **记忆库一致性**：memory_updater的更新操作是幂等的（通过章节ID去重，重复执行不会产生重复记录），崩溃前已更新的记忆条目保留，不会因重复执行而污染

**任务中断后恢复选项**：
- **从失败点重试**：复用已完成节点的产出（从中间产出文件加载），从崩溃点继续
- **从头开始**：清空所有中间产出和 `story_memory` 中本任务的更新，重新执行
- **中止任务**：保留已完成章节文件，标记任务为 `aborted`

**检查点回退**：
- 检查点前的节点不重新执行（除非用户主动选择"从头开始"）

#### 7.6.5 成本估算与预警

- 任务启动前估算总token消耗（基于章节数×平均章节token）
- 若估算超过用户设置的阈值（可在设置中配置），提示用户确认
- 执行过程中实时累计token消耗，超阈值时暂停并询问

---

## 8. 数据模型

### 8.1 Agent定义模型

#### 8.1.1 `agent_definitions` 表（用户自定义Agent）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `agent_id` | TEXT UNIQUE | 以 `custom_` 前缀的唯一标识 |
| `name` | TEXT | 显示名称 |
| `category` | TEXT | creative/analytic/structural/memory/tool |
| `description` | TEXT | 职责描述 |
| `system_prompt` | TEXT | 系统提示词模板 |
| `required_tools` | TEXT (JSON) | 必需工具ID数组 |
| `optional_tools` | TEXT (JSON) | 可选工具ID数组 |
| `api_config_id` | INTEGER? | 关联api_configs表，空则用项目默认 |
| `model_params` | TEXT (JSON) | 模型参数 |
| `input_schema` | TEXT (JSON) | 输入schema |
| `output_schema` | TEXT (JSON) | 输出schema |
| `is_builtin` | BOOLEAN | 固定为false |
| `version` | TEXT | 版本号 |
| `project_id` | INTEGER? | 关联项目，NULL表示全局级Agent（所有项目可用） |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

内置Agent不存数据库，在代码中静态定义。

### 8.2 工具定义模型

工具定义在代码中静态声明（工具注册表），不存数据库。但工具调用日志存数据库：

#### 8.2.1 `agent_tool_calls` 表（工具调用日志）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `task_id` | TEXT | 关联任务 |
| `agent_id` | TEXT | 调用方Agent |
| `tool_id` | TEXT | 工具ID |
| `parameters` | TEXT (JSON) | 调用参数 |
| `result` | TEXT (JSON) | 返回结果（可截断存储） |
| `duration_ms` | INTEGER | 执行耗时 |
| `success` | BOOLEAN | 是否成功 |
| `error_message` | TEXT? | 失败原因 |
| `cache_hit` | BOOLEAN | 是否命中缓存 |
| `called_at` | TEXT | 调用时间 |

### 8.3 任务执行历史模型

#### 8.3.1 `agent_tasks` 表

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `task_id` | TEXT UNIQUE | UUID |
| `project_id` | INTEGER | 关联项目 |
| `conversation_id` | INTEGER? | 关联对话（最终结果输出位置） |
| `workflow_id` | TEXT | 工作流ID |
| `status` | TEXT | pending/running/paused_at_checkpoint/completed/failed/aborted |
| `permission_mode` | TEXT | hands_off/supervised/autopilot |
| `input` | TEXT (JSON) | 用户输入参数 |
| `output` | TEXT (JSON)? | 最终输出（仅最终结果摘要） |
| `current_node_id` | TEXT? | 当前执行节点（用于断点续传） |
| `completed_nodes` | TEXT (JSON) | 已完成节点ID数组 |
| `error_log` | TEXT? | 错误详情 |
| `total_tokens` | INTEGER | 累计token消耗 |
| `estimated_tokens` | INTEGER? | 预估token |
| `cache_hit_count` | INTEGER | 缓存命中次数 |
| `cache_miss_count` | INTEGER | 缓存未命中次数 |
| `started_at` | TEXT | 开始时间 |
| `completed_at` | TEXT? | 完成时间 |
| `created_at` | TEXT | 创建时间 |

#### 8.3.2 `story_memory` 表（记忆库）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `project_id` | INTEGER UNIQUE | 关联项目（每项目一条记忆库） |
| `characters` | TEXT (JSON) | 角色状态数组 |
| `timeline` | TEXT (JSON) | 时间线事件数组 |
| `locations` | TEXT (JSON) | 地理信息数组 |
| `foreshadows` | TEXT (JSON) | 伏笔状态数组 |
| `baseline_style` | TEXT (JSON)? | 基线文风特征 |
| `updated_at` | TEXT | 最后更新时间 |

#### 8.3.3 `foreshadows` 表（伏笔管理）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `project_id` | INTEGER | 关联项目 |
| `foreshadow_id` | TEXT | 业务ID（如f1） |
| `content` | TEXT | 伏笔内容描述 |
| `plant_chapter` | INTEGER? | 埋设章节 |
| `plant_scene` | INTEGER? | 埋设场景 |
| `payoff_chapter` | INTEGER? | 回收章节 |
| `payoff_scene` | INTEGER? | 回收场景 |
| `status` | TEXT | planned/planted/payoff/abandoned |
| `related_ids` | TEXT (JSON) | 关联伏笔ID数组 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

#### 8.3.4 数据库迁移策略

- 新增表：`agent_definitions`、`agent_tool_calls`、`agent_tasks`、`story_memory`、`foreshadows`
- 现有表不修改结构（复用 `outline_nodes`、`setting_cards`、`conversations`、`messages`、`api_configs`）
- 迁移脚本遵循现有模式：检查表是否存在，不存在则创建

---

## 9. 交互与可观测性

### 9.1 用户交互流程

#### 9.1.1 任务发起

1. 用户在Agent任务面板选择功能（如"灵感矩阵生成"）
2. 系统展示该功能的输入表单（根据workflow的input_schema动态生成）
3. 用户填写输入，选择权限模式（默认值预填，可临时切换）
4. 点击"开始任务"
5. 系统创建 `agent_tasks` 记录，启动Pipeline

#### 9.1.2 任务执行中

- **实时流式输出**：每个Agent的LLM输出实时流式展示（复用现有chat:chunk机制）
- **进度指示**：显示当前节点、已完成节点、剩余节点
- **token消耗实时更新**：显示已消耗/预估token
- **取消按钮**：随时可取消任务

#### 9.1.3 检查点交互

检查点暂停时：
1. 任务状态变为 `paused_at_checkpoint`
2. 展示当前Agent的产出（可编辑）
3. 提供四个按钮：继续 / 修改 / 跳过 / 中止
4. 用户编辑产出后点击"修改"，系统用编辑后的版本继续

### 9.2 Agent执行可视化

#### 9.2.1 执行面板布局

```
┌─────────────────────────────────────────────────┐
│ 任务: 灵感矩阵生成  │ 状态: 运行中  │ Token: 1.2k │
├─────────────────────────────────────────────────┤
│ ▼ 执行进度                                       │
│   ✓ n1: keyword_analyst (完成, 320 token)       │
│   ▶ n2: idea_diverger (运行中...)               │
│     "主角视角：重生到末世前72小时..."            │
│   ○ n3: conflict_designer                        │
│   ○ n4: feasibility_evaluator                   │
├─────────────────────────────────────────────────┤
│ ▼ 中间产出                                       │
│   [n1输出] keyword_analysis.json  [查看]         │
│   [n2输出] premises.json  [查看] (生成中)        │
├─────────────────────────────────────────────────┤
│ ▼ 工具调用日志                                   │
│   14:32:05 agent.query_project_info  32ms ✓     │
│   14:32:08 (缓存命中) agent.query_outline        │
└─────────────────────────────────────────────────┘
```

#### 9.2.2 中间产出查看

- 每个Agent的产出可在面板中查看（Markdown或JSON格式）
- 点击"查看"打开模态框展示完整产出
- 中间产出文件路径：`./agent_outputs/{task_id}/`，用户可直接访问文件系统

#### 9.2.3 DAG可视化

- 以流程图展示DAG（节点+边）
- 已完成节点绿色，运行中节点蓝色，待执行节点灰色，失败节点红色
- 检查点节点用星标标记

### 9.3 回退与重试机制

#### 9.3.1 节点级回退

- 在执行面板右键某个已完成节点，选择"重新执行"
- 系统回退到该节点，重新实例化Agent并执行
- 下游节点全部标记为待重新执行

#### 9.3.2 检查点回退

- 在执行面板右键某个检查点，选择"回退到此处"
- 系统回退到该检查点后的第一个节点
- 已写入数据库的操作不自动回滚（需用户手动处理或通过反向工具）

#### 9.3.3 任务重试

- 失败的任务可"从失败点重试"或"从头开始"
- "从失败点重试"：复用已完成节点的产出（从中间产出文件加载）
- "从头开始"：清空所有中间产出，重新执行

---

## 10. 非功能性需求

### 10.1 性能与延迟

- **单Agent响应**：首个token应在3秒内返回（流式输出）
- **Pipeline启动**：任务发起后1秒内进入running状态
- **检查点暂停响应**：用户决策后2秒内恢复执行
- **并行执行**：最大并行度默认3，可在设置中配置（1-10）
- **中间产出写入**：每个Agent产出在5秒内写入文件系统

### 10.2 Token成本控制

- **预估机制**：任务启动前根据workflow的 `estimated_token_cost` 提示用户
- **实时统计**：执行过程中实时累计token消耗
- **阈值预警**：用户可设置单任务token上限，超限时暂停并询问
- **缓存优化**：工具结果缓存减少重复LLM调用
- **上下文裁剪**：长文本传递给Agent时，按字符边界安全截断（参考1.2节"项目工程实践记录"）

### 10.3 可扩展性

**注册表存储形式**：
- **Agent注册表**（静态部分）：Rust代码中声明，使用静态数组或HashMap初始化
- **Agent注册表**（动态部分）：数据库 `agent_definitions` 表，运行时合并到静态注册表
- **工具注册表**：Rust代码中声明，静态数组
- **工作流注册表**：Rust代码中声明，静态数组（工作流定义较重，不支持用户自定义工作流）

**新增功能的开发步骤**：

1. **定义Agent**：在Rust代码中添加Agent元数据声明（agent_id、分类、system_prompt模板、工具权限、模型参数、输入输出schema）
2. **定义工具**（如需新增）：在Rust代码中添加工具元数据声明（tool_id、权限、参数schema、内部函数路径）
3. **定义工作流**：在Rust代码中添加Workflow DAG定义（nodes、edges、checkpoints、loop_config）
4. **编写功能规格**：参照第7章格式撰写文档
5. **数据库迁移**（如需新增表）：在db.rs中添加表创建逻辑
6. **UI适配**：任务发起界面根据workflow的input_schema自动生成表单，DAG可视化自动渲染，通常无需额外UI开发

**各注册表的扩展方式**：
- **新增内置Agent**：在代码中添加Agent定义，注册到静态注册表
- **新增工具**：在代码中添加工具定义，注册到工具注册表
- **新增工作流**：在代码中定义新的Workflow DAG，注册到工作流注册表
- **用户自定义Agent**：通过UI创建，存入 `agent_definitions` 表
- **第三方Agent导入**：通过JSON文件导入

### 10.4 可调试性

- **完整日志**：所有Agent调用、工具调用、状态转换记录到数据库
- **中间产出持久化**：每个Agent的产出写入文件，便于离线分析
- **DAG可视化**：执行面板展示完整执行路径
- **错误详情**：失败时记录完整错误栈和上下文
- **缓存统计**：记录缓存命中率，便于优化

### 10.5 安全性

- **工具权限隔离**：Agent只能调用声明的工具
- **文件系统沙箱**：Agent只能读写 `./agent_outputs/` 目录下的文件
- **数据库写保护**：creative和analytic类Agent不可写数据库
- **API密钥隔离**：用户自定义Agent使用项目绑定的API配置，不可访问其他配置

---

## 11. 实现路线图

### 11.1 P0：灵感矩阵 + 改写润色

**目标**：验证多Agent架构可行性，交付最快可见价值的功能。

**交付内容**：
- Agent注册表（静态部分）
- Agent工厂
- Pipeline执行引擎（基础版：顺序执行，无并行）
- 工具适配层（基础工具：文件读写、查询设定卡）
- 灵感矩阵生成工作流（4个Agent）
- 多视角改写润色工作流（4个Agent，含并行组）
- 执行面板UI（进度展示、流式输出、取消）
- `agent_tasks` 表

**不含**：检查点交互、用户自定义Agent、复杂并行调度（如百万字流水线的批次并行）、记忆库

**关于并行**：P0支持基础的parallel_group并行（如改写润色的n1/n2并行），但不支持复杂场景（如百万字流水线的批次并行调度、并行度限制、断点续传中的并行恢复）。

**验证标准**：两个功能端到端可用，单Agent流式输出正常，中间产出到文件。

### 11.2 P1：大纲生成 + 角色对话

**目标**：引入检查点机制和数据库写入，验证结构型Agent。

**交付内容**：
- 检查点机制（supervised模式）
- 检查点交互UI（继续/修改/跳过/中止）
- 结构化大纲生成工作流（4个Agent，含数据库写入）
- 角色驱动对话工作流（含循环节点）
- 伏笔管理工具
- `foreshadows` 表
- 错误处理（supervised模式）

**不含**：用户自定义Agent、并行执行、记忆库

**验证标准**：大纲写入数据库，伏笔依赖图正确生成，对话循环正常终止。

### 11.3 P2：长篇一致性管理

**目标**：引入记忆库基础设施，验证常驻Agent。

**交付内容**：
- memory_keeper常驻Agent
- `story_memory` 表
- 记忆库管理工具（query/update/check_consistency）
- 一致性管理工作流（写作前检索 + 写作后检查）
- context_retriever工具
- 漂移监控

**验证标准**：记忆库跨任务持久化，一致性检查能发现明显冲突。

### 11.4 P3：百万字流水线

**目标**：验证并行执行、断点续传、长时间运行任务。

**交付内容**：
- 并行执行支持（parallel_group）
- 最大并行度限制
- 百万字流水线工作流
- 断点续传机制
- 后台任务执行
- 成本估算与预警
- 用户自定义Agent（UI编辑器）
- Agent导入/导出
- `agent_definitions` 表

**验证标准**：百万字任务可断点续传，并行执行不冲突，token消耗可控。

---

## 附录

### A. Agent清单汇总

共27个内置Agent，按分类汇总：

| 分类 | 数量 | Agent列表 |
|---|---|---|
| creative | 7 | idea_diverger, conflict_designer, rewriter, character_roleplayer, scene_setter, chapter_writer, final_polisher |
| analytic | 11 | keyword_analyst, feasibility_evaluator, structure_selector, pace_reviewer, style_analyzer, reader_simulator, diff_explainer, dialogue_director, ooc_checker, consistency_checker, drift_monitor |
| structural | 5 | chapter_splitter, foreshadow_planner, macro_planner, volume_planner, chapter_stitcher |
| memory | 2 | memory_keeper, memory_updater |
| tool | 2 | character_loader, context_retriever |

### B. 工具清单汇总

共20个原生工具：

| 分类 | 数量 | 工具列表 |
|---|---|---|
| 设定卡管理 | 4 | create_setting_card, query_setting_cards, update_setting_card, delete_setting_card |
| 大纲管理 | 4 | create_outline_node, query_outline, update_outline_node, delete_outline_node |
| 伏笔管理 | 3 | create_foreshadow, query_foreshadows, update_foreshadow_status |
| 记忆库管理 | 3 | query_memory, update_memory, check_consistency |
| 文件系统 | 3 | read_intermediate, write_intermediate, read_chapter |
| 上下文检索 | 3 | query_conversation_history, query_project_info, retrieve_context |
| 复用现有函数 | 10 | 设定卡4个+大纲4个+对话历史1个+项目信息1个 |
| 新增函数 | 10 | 伏笔3个+记忆库3个+文件系统3个+综合检索1个 |

### C. 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| Agent系统与Chat系统关系 | 完全独立新模块 | 避免相互污染，独立演进 |
| 用户控制粒度 | 三档权限模式（任务级） | 平衡速度与可控性，网文作者默认低摩擦 |
| Agent自定义 | 内置+用户自定义+可分享 | 满足高级用户扩展需求 |
| LLM调用配置 | 每Agent可指定不同API | 灵活但默认复用项目配置 |
| 错误恢复 | 按权限模式差异化处理 | hands_off快、supervised稳、autopilot自动 |
| 中间产出存储 | 文件系统（不存数据库） | 避免数据库膨胀，便于用户直接访问 |
| 工具复用方式 | 原生工具壳+内部函数复用 | 隔离命名空间，复用核心逻辑 |
| Agent间通信 | 严格管道模式 | 可预测、可观测、避免递归 |
| 记忆型Agent | 跨任务常驻 | 长篇创作需要持久记忆 |
| 协作模式 | 管道流水线 | 实现简单，调试友好，适合网文作者场景 |

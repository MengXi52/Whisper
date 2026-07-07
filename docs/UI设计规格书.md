# 多Agent写作助手 UI 设计规格书

| 版本 | 日期         | 作者   | 变更说明                |
| ---- | ------------ | ------ | ----------------------- |
| v1.0 | 2026-07-07   | Whisper | 初版，覆盖P0 UI全部范围 |

---

## 目录

- [1. 文档说明](#1-文档说明)
- [2. 设计系统](#2-设计系统)
- [3. 布局规范](#3-布局规范)
- [4. 通用组件规格](#4-通用组件规格)
- [5. 页面详细设计](#5-页面详细设计)
- [6. Agent 系统 UI](#6-agent-系统-ui)
- [7. 交互细节](#7-交互细节)
- [8. 状态机](#8-状态机)
- [9. 暗色模式适配](#9-暗色模式适配)
- [10. 无障碍设计](#10-无障碍设计)
- [11. 附录](#11-附录)

---

## 1. 文档说明

### 1.1 文档目的

本规格书为「多Agent写作助手」（以下简称"系统"）前端 UI 的唯一权威设计依据，服务于以下三类读者：

1. **前端工程师**：依据本规格书实现 React + Tailwind CSS 组件，无需再回头反推设计意图。
2. **后端工程师**：依据本规格书确认前端调用形态、事件协议与命令参数，对齐 Tauri 2.0 命令签名。
3. **产品与设计评审**：依据本规格书评审 UI 完整度、交互一致性、P0 范围边界。

### 1.2 范围

本规格书覆盖 **P0 阶段全部 UI**，并预留 P1-P3 的 UI 接口形态。

| 范围         | 内容                                                                 |
| ------------ | -------------------------------------------------------------------- |
| **P0 必交付** | 设计系统、三栏布局、四阶段切换、聊天视图、写作编辑器、动态面板、Agent 工作区、Pipeline 可视化、检查点对话框、灵感矩阵视图、改写润色面板 |
| **P1 预留**   | 大纲树扩展（三级树形）、伏笔管理、循环节点 UI 占位                    |
| **P2 预留**   | 一致性检查报告、跨任务记忆查看器占位                                  |
| **P3 预留**   | 自定义 Agent CRUD、并行任务监控、成本预警仪表盘占位                    |

### 1.3 术语

| 术语           | 定义                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 三栏布局       | Sidebar(240px) \| Main(flex-1) \| DynamicPanel(300px) 的固定结构     |
| 四阶段         | ideation → planning → writing → editing 的写作流程阶段                |
| 专注模式       | 隐藏 Sidebar / DynamicPanel / TopBar / StatusBar，仅保留编辑区       |
| Agent 工作区   | 系统新增的中间区域形态，替代 ChatView 显示 Pipeline 执行过程          |
| Pipeline 可视化 | 节点状态图形化展示，含 pending/running/success/failed/skipped 五态    |
| 检查点对话框    | Pipeline 执行到检查点节点时弹出的交互对话框，支持 Continue/Skip/Abort |
| 灵感矩阵       | P0 工作流 `inspiration_matrix` 的结果展示，二维表格式                 |
| 改写润色面板    | P0 工作流 `style_rewrite_polish` 的入口与结果对比面板                 |

### 1.4 技术栈约定

| 类别         | 选型                                  | 备注                                            |
| ------------ | ------------------------------------- | ----------------------------------------------- |
| UI 框架      | React 18 + TypeScript                 | StrictMode 已禁用（避免重复事件监听）            |
| 构建工具     | Vite                                  |                                                 |
| 样式方案     | Tailwind CSS + CSS 变量               | `darkMode: 'class'`，主题切换通过 `class="dark"` |
| 组件库       | 自研（Button/Dialog/Toast 等）         | 不引入 Ant Design / MUI 等重型库                 |
| 图标库       | lucide-react                          | 全项目唯一图标源                                |
| 类名拼接     | clsx                                  | 条件类名统一用 clsx                             |
| 状态管理     | Zustand                               | projectStore / chatStore / uiStore / settingsStore / apiConfigStore |
| Markdown 渲染 | ReactMarkdown + remark-gfm           | AI 消息内容渲染                                 |
| 桌面壳       | Tauri 2.0                             | 命令调用通过 `invoke()`，事件通过 `listen()`     |

### 1.5 评审与变更

- 本规格书一旦评审通过，前端实现**必须严格对齐**，偏差需走变更流程。
- 任何新增组件、新增交互模式、新增状态机，均需在本规格书补录章节后方可实现。
- 颜色 token、间距 token、动画时长 token 的调整，需同步更新 [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) 与 [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css)。

---

## 2. 设计系统

### 2.1 设计原则

系统面向「想要更快更强」的网文作者，UI 设计遵循以下五条原则，优先级从高到低：

1. **沉浸优先**：写作是核心动作，编辑区永远占据最大视觉权重，AI 辅助以非侵入式浮层或侧栏呈现，绝不遮挡正文。
2. **状态可见**：Pipeline 执行、流式生成、自动保存、检查点等待等所有异步状态，必须在 UI 上有即时且明确的反馈。
3. **阶段收敛**：四阶段（ideation/planning/writing/editing）将功能分组，同一阶段只暴露当前阶段需要的操作，避免界面过载。
4. **键盘友好**：所有高频操作（发送消息、切换阶段、新建章节、退出专注模式）必须有键盘快捷键，鼠标操作为辅。
5. **双主题等价**：浅色与深色主题为对等一等公民，任何新组件必须同时交付两套主题样式，不允许"先做浅色再补深色"。

### 2.2 颜色系统

#### 2.2.1 Token 命名规则

所有颜色 token 通过 CSS 变量定义，命名遵循 `--color-{语义类别}-{状态}` 模式。Tailwind 通过 `tailwind.config.js` 的 `theme.extend.colors` 将 CSS 变量映射为工具类（如 `bg-bg-primary`、`text-text-secondary`）。

| 语义类别 | 用途                       | Tailwind 前缀示例        |
| -------- | -------------------------- | ------------------------ |
| `bg`     | 背景色，按层级递进         | `bg-bg-primary`          |
| `text`   | 文本色，按重要度递减       | `text-text-secondary`    |
| `border` | 边框、分割线               | `border-border`          |
| `accent` | 强调色，主操作、选中态     | `bg-accent`、`text-accent` |
| `success`| 成功状态                   | `text-success`           |
| `warning`| 警告状态                   | `text-warning`           |
| `error`  | 错误、危险操作             | `bg-error`、`text-error` |

#### 2.2.2 浅色主题（默认）

定义于 [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css) 的 `:root` 选择器下：

| Token                       | 值         | 用途                       |
| --------------------------- | ---------- | -------------------------- |
| `--color-bg-primary`        | `#ffffff`  | 主背景（中间区域、对话框） |
| `--color-bg-secondary`      | `#f5f5f7`  | 次背景（输入框、状态栏）   |
| `--color-bg-tertiary`       | `#ebebef`  | 三级背景（按钮、卡片）     |
| `--color-bg-sidebar`        | `#f7f7f9`  | 左侧栏背景                 |
| `--color-bg-panel`          | `#f7f7f9`  | 右侧面板背景               |
| `--color-bg-hover`          | `#e2e2e7`  | hover 态背景               |
| `--color-bg-active`         | `#d4d4db`  | active 态背景              |
| `--color-text-primary`      | `#1f1f23`  | 主文本（正文、标题）       |
| `--color-text-secondary`    | `#5a5a66`  | 次文本（说明、辅助）       |
| `--color-text-tertiary`     | `#9b9ba8`  | 三级文本（占位、禁用）     |
| `--color-text-inverse`      | `#ffffff`  | 反色文本（accent 上的文字）|
| `--color-border`            | `#e2e2e7`  | 默认边框                   |
| `--color-border-light`      | `#ebebef`  | 浅色边框                   |
| `--color-accent`            | `#6366f1`  | 强调色（靛蓝）             |
| `--color-accent-hover`      | `#4f46e5`  | 强调色 hover               |
| `--color-accent-light`      | `#e0e7ff`  | 强调色浅底（选中态）       |
| `--color-accent-muted`      | `#c7d2fe`  | 强调色更浅                 |
| `--color-success`           | `#10b981`  | 成功                       |
| `--color-warning`           | `#f59e0b`  | 警告                       |
| `--color-error`             | `#ef4444`  | 错误                       |
| `--color-user-bubble`       | `#6366f1`  | 用户消息气泡               |
| `--color-ai-bubble`         | `#ebebef`  | AI 消息气泡                |

#### 2.2.3 深色主题

定义于 [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css) 的 `.dark` 选择器下，覆盖 `:root` 变量：

| Token                       | 值         | 备注                       |
| --------------------------- | ---------- | -------------------------- |
| `--color-bg-primary`        | `#0f0f1a`  | 主背景                     |
| `--color-bg-secondary`      | `#16162a`  | 次背景                     |
| `--color-bg-tertiary`       | `#1f1f33`  | 三级背景                   |
| `--color-bg-sidebar`        | `#13131f`  | 左侧栏                     |
| `--color-bg-panel`          | `#13131f`  | 右侧面板                   |
| `--color-bg-hover`          | `#2a2a40`  | hover                      |
| `--color-bg-active`         | `#3a3a55`  | active                     |
| `--color-text-primary`      | `#f0f0f5`  | 主文本                     |
| `--color-text-secondary`    | `#a8a8b8`  | 次文本                     |
| `--color-text-tertiary`     | `#6b6b80`  | 三级文本                   |
| `--color-text-inverse`      | `#ffffff`  | 反色文本                   |
| `--color-border`            | `#2a2a40`  | 边框                       |
| `--color-border-light`      | `#1f1f33`  | 浅边框                     |
| `--color-accent`            | `#818cf8`  | 强调色（深色态更亮）       |
| `--color-accent-hover`      | `#a5b4fc`  | 强调色 hover               |
| `--color-accent-light`      | `#312e81`  | 强调色浅底                 |
| `--color-accent-muted`      | `#3730a3`  | 强调色更浅                 |
| `--color-success`           | `#34d399`  | 成功                       |
| `--color-warning`           | `#fbbf24`  | 警告                       |
| `--color-error`             | `#f87171`  | 错误                       |
| `--color-user-bubble`       | `#4f46e5`  | 用户气泡                   |
| `--color-ai-bubble`         | `#1f1f33`  | AI 气泡                    |

#### 2.2.4 Agent 专用语义色

Pipeline 节点状态、Agent 任务状态在两套主题中保持一致语义，仅亮度调整：

| 语义             | 浅色         | 深色         | 用途                                 |
| ---------------- | ------------ | ------------ | ------------------------------------ |
| `pending`        | `#9b9ba8`    | `#6b6b80`    | 节点待执行                           |
| `running`        | `#6366f1`    | `#818cf8`    | 节点执行中（带脉冲动画）             |
| `success`        | `#10b981`    | `#34d399`    | 节点成功                             |
| `failed`         | `#ef4444`    | `#f87171`    | 节点失败                             |
| `skipped`        | `#f59e0b`    | `#fbbf24`    | 节点被跳过（用户 Skip 或条件跳过）   |
| `checkpoint`     | `#8b5cf6`    | `#a78bfa`    | 检查点等待用户决策                   |

Agent 专用色通过 Tailwind 的 `theme.extend.colors` 扩展为 `bg-agent-pending` / `text-agent-running` 等。

#### 2.2.5 透明度规范

需要叠加在背景上的半透明色统一使用 Tailwind 的 `/数字` 语法，避免新增 token：

| 场景                     | 类名示例              | 透明度 |
| ------------------------ | --------------------- | ------ |
| 强调色浅底（选中态）     | `bg-accent/10`        | 10%    |
| 强调色 hover 浅底        | `bg-accent/20`        | 20%    |
| 禁用态                   | `opacity-50`          | 50%    |
| 遮罩层                   | `bg-black/50`         | 50%    |
| 遮罩层毛玻璃             | `backdrop:backdrop-blur-sm` | - |
| Toast 入场偏移           | `translate-x-4`       | -      |

### 2.3 字体系统

#### 2.3.1 字体族

定义于 [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) 的 `theme.extend.fontFamily`：

| Token    | 字体栈                                                       | 用途                       |
| -------- | ------------------------------------------------------------ | -------------------------- |
| `serif`  | `Georgia, "Noto Serif SC", "SimSun", serif`                 | 正文编辑器、章节标题       |
| `sans`   | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` | UI 界面默认字体            |
| `mono`   | `ui-monospace, "Cascadia Code", "Source Code Pro", monospace` | 代码块、JSON 预览          |

> **设计意图**：网文作者长时间阅读/编辑正文，serif 字体提供更好的阅读体验；UI 控件用 sans 保证识别度。

#### 2.3.2 字号阶梯

统一使用 Tailwind 内置字号，禁止自定义任意字号值：

| Token      | 值        | 用途                                  |
| ---------- | --------- | ------------------------------------- |
| `text-[10px]` | 10px   | 极小标注（设定卡类型标签、快捷键提示）|
| `text-[11px]` | 11px   | 消息操作按钮、token 计数              |
| `text-xs`  | 12px      | 辅助文本、分组标题、Toast            |
| `text-sm`  | 14px      | 正文默认、消息内容、按钮文字          |
| `text-base`| 16px      | 编辑器正文、输入框                    |
| `text-lg`  | 18px      | 二级标题                              |
| `text-xl`  | 20px      | 章节标题                              |
| `text-2xl` | 24px      | 项目初始化屏标题                      |

#### 2.3.3 字重

| Token          | 值   | 用途                       |
| -------------- | ---- | -------------------------- |
| `font-normal`  | 400  | 正文                       |
| `font-medium`  | 500  | 按钮文字、卡片标题         |
| `font-semibold`| 600  | 分组标题、面板标题         |
| `font-bold`    | 700  | 章节标题、强调             |

#### 2.3.4 行高

| Token              | 值     | 用途                       |
| ------------------ | ------ | -------------------------- |
| `leading-none`     | 1      | 图标按钮                   |
| `leading-tight`    | 1.25   | 标题                       |
| `leading-normal`   | 1.5    | UI 文本                    |
| `leading-relaxed`  | 1.625  | 消息内容                   |
| `leading-loose`    | 2      | 编辑器正文（写作区）       |

> 编辑器正文的 `leading-loose` 配合 `font-serif` 是网文作者长时间写作的关键体验，不可调整。

### 2.4 间距系统

#### 2.4.1 基础间距

采用 Tailwind 默认 4px 基准，禁止使用任意像素值。常用档位：

| Token | 值   | 用途                              |
| ----- | ---- | --------------------------------- |
| `0.5` | 2px  | 图标与文字间微调                  |
| `1`   | 4px  | 紧凑间距（标签内图标+文字）       |
| `1.5` | 6px  | 按钮内边距微调                    |
| `2`   | 8px  | 同组元素间距                      |
| `3`   | 12px | 卡片内边距、列表项间距            |
| `4`   | 16px | 区块内边距、面板默认 padding      |
| `6`   | 24px | 编辑器外边距                      |
| `8`   | 32px | 大区块间距                        |

#### 2.4.2 固定布局尺寸

定义于 [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) 的 `theme.extend.spacing`：

| Token        | 值     | 用途                          |
| ------------ | ------ | ----------------------------- |
| `sidebar`    | 240px  | 左侧栏宽度                    |
| `panel`      | 300px  | 右侧面板宽度                  |
| -            | 48px   | TopBar 高度（`h-12`）         |
| -            | 28px   | StatusBar 高度（`h-7`）       |

#### 2.4.3 内边距规范

| 场景                | 类名                | 说明                       |
| ------------------- | ------------------- | -------------------------- |
| 面板外边距          | `p-4`               | 16px                       |
| 卡片内边距          | `p-3`               | 12px                       |
| 按钮内边距（md）    | `px-4 py-2`         | 16/8                       |
| 输入框内边距        | `px-3 py-2`         | 12/8                       |
| 编辑器外边距        | `p-6`               | 24px                       |
| 列表项内边距        | `px-2 py-1.5`       | 8/6                        |

### 2.5 圆角系统

定义于 [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) 的 `theme.extend.borderRadius`：

| Token | 值   | 用途                              | Tailwind 类 |
| ----- | ---- | --------------------------------- | ----------- |
| `sm`  | 6px  | 小组件（标签、徽章）              | `rounded-sm`|
| `md`  | 10px | 按钮、输入框、列表项              | `rounded-md`|
| `lg`  | 16px | 卡片、对话框、下拉菜单            | `rounded-lg`|
| `xl`  | 16px | 大圆角容器（@提及下拉、发送按钮） | `rounded-xl`|
| `full`| 9999 | 头像、圆角胶囊标签                | `rounded-full`|

> 项目中 `rounded-xl` 与 `rounded-lg` 暂用相同值（16px），保留 token 以便未来调整。

### 2.6 阴影系统

定义于 [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) 的 `theme.extend.boxShadow`，全部映射到 CSS 变量，便于深色模式下调整：

| Token | 浅色值                                       | 深色值                                       | 用途                       |
| ----- | -------------------------------------------- | -------------------------------------------- | -------------------------- |
| `sm`  | `0 1px 2px rgba(0,0,0,0.05)`                | `0 1px 2px rgba(0,0,0,0.3)`                 | 卡片                       |
| `md`  | `0 4px 6px rgba(0,0,0,0.1)`                 | `0 4px 6px rgba(0,0,0,0.4)`                 | 下拉菜单                   |
| `lg`  | `0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)` | `0 10px 15px rgba(0,0,0,0.5), 0 4px 6px rgba(0,0,0,0.3)` | 对话框、浮层               |

使用方式：`shadow-sm` / `shadow-md` / `shadow-lg`。

### 2.7 动画系统

#### 2.7.1 时长 token

| Token          | 值     | 用途                              |
| -------------- | ------ | --------------------------------- |
| `duration-150` | 150ms  | 默认过渡（颜色、背景）            |
| `duration-200` | 200ms  | 布局过渡（面板收起/展开）          |
| `duration-300` | 300ms  | 入场动画（Toast、消息）            |

#### 2.7.2 缓动函数

| Token              | 值                          | 用途                       |
| ------------------ | --------------------------- | -------------------------- |
| `ease`（默认）     | `cubic-bezier(0.4, 0, 0.2, 1)` | 通用                       |
| `ease-in-out`      | `cubic-bezier(0.4, 0, 0.2, 1)` | 面板收起                   |
| `ease-out`         | `cubic-bezier(0, 0, 0.2, 1)`| 入场（Toast 滑入）         |

#### 2.7.3 关键帧动画

定义于 [src/App.css](file:///c:/Users/admin/Desktop/Whisper/src/App.css)：

| 动画名              | 描述                                   | 用途                       |
| ------------------- | -------------------------------------- | -------------------------- |
| `messageSlideIn`    | `translateY(8px) opacity:0 → 0 1`      | 新消息入场                 |
| `blink`             | `opacity 1 → 0 → 1`                    | 流式生成光标               |
| `pulse`（Tailwind） | `opacity 1 → 0.5 → 1`                  | 流式消息体、running 节点   |

#### 2.7.4 过渡规范

| 场景                       | 类名                                       |
| -------------------------- | ------------------------------------------ |
| 按钮颜色变化               | `transition-colors duration-150`           |
| 面板宽度过渡               | `transition: width 0.2s ease`（CSS）       |
| Toast 滑入                 | `transition-all duration-300`              |
| 操作按钮显隐（hover）       | `transition-opacity duration-150`          |
| 拖拽排序                   | `transition-transform duration-150`        |

### 2.8 图标系统

#### 2.8.1 图标源

**唯一图标源**：[lucide-react](https://lucide.dev/)。禁止混用其他图标库（如 FontAwesome、Heroicons），禁止使用 emoji 作为功能图标。

#### 2.8.2 图标尺寸

统一使用以下尺寸，与字号阶梯对齐：

| 尺寸 | 值   | 用途                              |
| ---- | ---- | --------------------------------- |
| 10   | 10px | 极小（消息操作按钮）              |
| 11   | 11px | 小（复制、编辑按钮）              |
| 12   | 12px | 标签内图标                        |
| 14   | 14px | 按钮内图标                        |
| 16   | 16px | 默认（导航、面板标题）            |
| 18   | 18px | 大（TopBar 操作按钮）             |
| 20   | 20px | 特大（空状态占位）                |

#### 2.8.3 项目已用图标清单

| 图标              | 用途                              |
| ----------------- | --------------------------------- |
| `MessageSquare`   | 聊天空状态、对话历史分组          |
| `User` / `Bot`    | 消息头像                          |
| `Send` / `Square` | 发送 / 停止生成                   |
| `AtSign` / `Wrench` | @提及 / 斜杠命令                |
| `Moon` / `Sun`    | 主题切换                          |
| `Maximize2` / `Minimize2` | 专注模式进入 / 退出       |
| `Settings`        | 设置入口                          |
| `Cloud`           | 模型名（状态栏）                  |
| `Check` / `Loader2` / `CloudOff` | 保存状态 saved/saving/unsaved |
| `Copy` / `Pencil` / `X` | 复制 / 编辑 / 关闭            |
| `CheckCircle` / `AlertCircle` / `Info` / `AlertTriangle` | Toast 四类型 |
| `Lightbulb` / `ListTree` / `PenTool` / `CheckSquare` | 四阶段面板图标 |
| `Sparkles` / `Wand2` | 续写、生成操作                  |
| `ChevronRight`    | 面包屑、展开                      |
| `Plus` / `Trash2` | 新建 / 删除                       |

#### 2.8.4 Agent 系统新增图标

| 图标              | 用途                              |
| ----------------- | --------------------------------- |
| `Workflow`        | Pipeline 可视化总览               |
| `Cpu`             | Agent 节点                        |
| `GitBranch`       | 分支（检查点决策）                |
| `Database`        | 记忆库查看器                      |
| `Layers`          | 灵感矩阵                          |
| `Palette`         | 改写润色                          |
| `Pause` / `Play` / `SkipForward` | 检查点 Continue/Skip |
| `RotateCcw`       | 重试                              |
| `Activity`        | 任务监控（P3）                    |
| `Gauge`           | 成本预警（P3）                    |

---

## 3. 布局规范

### 3.1 全局布局结构

#### 3.1.1 三栏布局

应用主体采用三栏横向布局，定义于 [src/components/layout/MainLayout.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/MainLayout.tsx)：

```
┌──────────────────────────────────────────────────────────────────┐
│                            TopBar (h-12)                         │
├──────────┬───────────────────────────────────┬───────────────────┤
│          │                                   │                   │
│ Sidebar  │            Main Area              │  DynamicPanel     │
│ (240px)  │           (flex-1)                │   (300px)         │
│          │                                   │                   │
│          │  阶段为 writing/editing 时:       │  Tab: 助手/操作   │
│          │  WritingEditor                    │                   │
│          │  否则:                            │                   │
│          │  ChatView / AgentWorkspace        │                   │
│          │                                   │                   │
├──────────┴───────────────────────────────────┴───────────────────┤
│                          StatusBar (h-7)                         │
└──────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 布局容器规则

| 元素                | 类名                                                       | 说明                            |
| ------------------- | ---------------------------------------------------------- | ------------------------------- |
| `.layout-container` | `h-screen flex flex-col overflow-hidden`                   | 根容器，禁止页面级滚动          |
| `.layout-body`      | `flex-1 flex overflow-hidden`                              | 横向三栏容器                    |
| Sidebar             | `w-sidebar bg-bg-sidebar border-r border-border`           | 固定宽 240px                    |
| Main                | `flex-1 flex flex-col overflow-hidden bg-bg-primary`       | 中间区域                        |
| DynamicPanel        | `w-panel bg-bg-panel border-l border-border`               | 固定宽 300px                    |

#### 3.1.3 面板收起/展开

- **Sidebar 收起**：用户点击 Sidebar 右上角折叠按钮，Sidebar 宽度过渡为 0，内容 `opacity-0 pointer-events-none`。
- **DynamicPanel 收起**：用户点击面板内 TopBar 的折叠按钮，DynamicPanel 宽度过渡为 0；同时在屏幕右边缘垂直居中位置显示 `panel-expand-btn`（绝对定位，`top:50% + margin-top:-16px`，避免与 `transform: scale(0.97)` 冲突）。
- **过渡动画**：`transition: width 0.2s ease`，定义于 [src/App.css](file:///c:/Users/admin/Desktop/Whisper/src/App.css)。
- **状态持久化**：折叠状态存于 `uiStore`，重启应用恢复。

> **工程约束**：禁止使用 `transform: translateX` 隐藏面板，会导致 `panel-expand-btn` 不可见；禁止使用 `opacity:0` + `width:0` 组合，会丢失展开按钮。详见项目记忆。

### 3.2 四阶段切换

#### 3.2.1 阶段定义

| 阶段       | key          | 主区域内容                | DynamicPanel 助手 Tab    |
| ---------- | ------------ | ------------------------- | ------------------------ |
| 构思       | `ideation`   | ChatView / AgentWorkspace | IdeationPanel            |
| 计划       | `planning`   | ChatView / AgentWorkspace | PlanningPanel            |
| 写作       | `writing`    | WritingEditor             | WritingPanel             |
| 修改       | `editing`    | WritingEditor             | EditingPanel             |

> **关键判断**：`isWritingPhase = phase === 'writing' || phase === 'editing'` 决定中间区域显示编辑器还是聊天。

#### 3.2.2 阶段切换器

位于 TopBar 中部，定义于 [src/components/layout/TopBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/TopBar.tsx)：

```
┌─────────────────────────────────────────┐
│  构思  │  计划  │  写作  │  修改        │
└─────────────────────────────────────────┘
```

- **容器**：`bg-bg-tertiary rounded-lg p-0.5 flex`
- **每个标签**：`px-3 py-1 text-xs rounded-md transition-colors duration-150`
- **选中态**：`bg-accent text-text-inverse`
- **未选中**：`text-text-secondary hover:text-text-primary`
- **切换行为**：点击立即切换，无确认对话框；如当前有正在生成的 Pipeline，弹 Toast 提示"任务进行中，切换阶段不会中断"。

#### 3.2.3 阶段切换的连带影响

| 影响项                  | 行为                                                     |
| ----------------------- | -------------------------------------------------------- |
| Sidebar 底部按钮        | writing/editing 显示"新建章节"，否则显示"新建对话"        |
| DynamicPanel 助手 Tab   | 切换为对应阶段的 Panel                                   |
| 中间区域                | writing/editing 切换为 WritingEditor，否则 ChatView      |
| Sidebar 大纲区          | writing/editing 高亮当前章节，否则只读                   |
| Sidebar 对话历史        | writing/editing 仍可见但置灰                             |

### 3.3 专注模式

#### 3.3.1 触发与退出

- **进入**：TopBar 右侧 Maximize2 图标按钮，或快捷键 `F11`。
- **退出**：屏幕右上角 `focus-exit-btn`（opacity 0.3 hover 1），或快捷键 `Esc` / `F11`。
- **前置条件**：仅在 `phase === 'writing' || phase === 'editing'` 时可进入，否则 Toast 提示"请先切换到写作或修改阶段"。

#### 3.3.2 专注模式样式

定义于 [src/App.css](file:///c:/Users/admin/Desktop/Whisper/src/App.css) 的 `.focus-mode`：

| 元素           | 行为                                                 |
| -------------- | ---------------------------------------------------- |
| TopBar         | `display: none`                                     |
| Sidebar        | `display: none`                                     |
| DynamicPanel   | `display: none`                                     |
| StatusBar      | `display: none`                                     |
| WritingEditor  | 占满全屏，`max-w-3xl mx-auto` 保持正文居中           |
| focus-exit-btn | 固定 `top-4 right-4`，`opacity: 0.3`，hover `opacity: 1` |

### 3.4 响应式策略

本应用为 Tauri 桌面应用，**不做移动端适配**，但需处理窗口缩放：

| 窗口宽度    | 行为                                                       |
| ----------- | ---------------------------------------------------------- |
| ≥ 1280px    | 三栏完整显示（推荐尺寸）                                   |
| 1024-1279px | 三栏完整显示，DynamicPanel 可手动收起                      |
| 800-1023px  | DynamicPanel 默认收起，显示 `panel-expand-btn`             |
| < 800px     | Sidebar 默认收起，点击项目名展开；不显示推荐警告           |

> 最小窗口尺寸由 Tauri 配置锁定为 800×600。

### 3.5 滚动行为

| 区域            | 滚动方式                              |
| --------------- | ------------------------------------- |
| Sidebar         | 各分组独立滚动，6px 自定义滚动条      |
| ChatView        | 消息列表纵向滚动，自动滚到底部        |
| WritingEditor   | 编辑区纵向滚动，正文 `max-w-3xl` 居中 |
| DynamicPanel    | 各 Tab 内容独立滚动                   |
| Dialog          | 内容区 `max-h-[60vh] overflow-y-auto` |

**自定义滚动条**（定义于 [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css)）：

- 宽度：6px
- thumb 颜色：`var(--color-border)`
- thumb 圆角：`rounded-full`
- hover 时 thumb 颜色加深 10%

---

## 4. 通用组件规格

### 4.1 Button

定义于 [src/components/common/Button.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Button.tsx)。

#### 4.1.1 Props

| Prop        | 类型                                                        | 默认值     | 说明                       |
| ----------- | ----------------------------------------------------------- | ---------- | -------------------------- |
| `variant`   | `'primary' \| 'secondary' \| 'ghost' \| 'danger'`          | `'primary'`| 视觉样式                   |
| `size`      | `'xs' \| 'sm' \| 'md' \| 'lg'`                             | `'md'`     | 尺寸                       |
| `icon`      | `React.ReactNode`                                           | -          | 左侧图标，自动 `shrink-0`  |
| `iconRight` | `React.ReactNode`                                           | -          | 右侧图标                   |
| `loading`   | `boolean`                                                   | `false`    | 加载态，显示 Loader2 旋转  |
| `disabled`  | `boolean`                                                   | `false`    | 禁用                       |
| `onClick`   | `(e: React.MouseEvent) => void`                             | -          | 点击                       |
| `type`      | `'button' \| 'submit'`                                      | `'button'` | HTML type                  |
| `className` | `string`                                                    | -          | 附加类名                   |
| `children`  | `React.ReactNode`                                           | -          | 文字内容                   |

#### 4.1.2 Variant 矩阵

| Variant     | 类名                                                            |
| ----------- | --------------------------------------------------------------- |
| `primary`   | `bg-accent text-text-inverse hover:bg-accent-hover`            |
| `secondary` | `bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover` |
| `ghost`     | `bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary` |
| `danger`    | `bg-error text-text-inverse hover:bg-error/90`                 |

#### 4.1.3 Size 矩阵

| Size | 类名                              | 字号         |
| ---- | --------------------------------- | ------------ |
| `xs` | `px-1.5 py-0.5 gap-1`            | `text-[11px]`|
| `sm` | `px-2.5 py-1 gap-1.5`            | `text-xs`    |
| `md` | `px-4 py-2 gap-2`                | `text-sm`    |
| `lg` | `px-6 py-2.5 gap-2`              | `text-base`  |

#### 4.1.4 通用类名（所有 variant/size 共享）

```
inline-flex items-center justify-center
rounded-md font-medium
transition-colors duration-150
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
disabled:opacity-50 disabled:cursor-not-allowed
```

#### 4.1.5 状态扩展

| 状态       | 视觉                                    |
| ---------- | --------------------------------------- |
| loading    | 文字隐藏，显示 `Loader2 animate-spin`   |
| disabled   | `opacity-50 cursor-not-allowed`         |
| active     | 全局 `button:active:not(:disabled) { transform: scale(0.97) }` |

#### 4.1.6 使用约束

- 禁止在同一按钮混用 `variant=primary` 与 `size=xs`（视觉过小）。
- 危险操作（删除项目、清空对话）必须用 `variant=danger`，且需二次确认（ConfirmDialog）。
- 工具栏内按钮统一用 `size=sm`，对话框 footer 按钮统一用 `size=md`。

### 4.2 IconButton

Button 的图标专用变体，正方形，无文字。

#### 4.2.1 Props

继承 Button 所有 props，额外：

| Prop    | 类型                   | 默认值 | 说明           |
| ------- | ---------------------- | ------ | -------------- |
| `label` | `string`（必填）       | -      | aria-label     |

#### 4.2.2 Size 矩阵

| Size | 类名                  | 图标尺寸 |
| ---- | --------------------- | -------- |
| `xs` | `w-6 h-6 p-0`         | 12       |
| `sm` | `w-7 h-7 p-0`         | 14       |
| `md` | `w-8 h-8 p-0`         | 16       |
| `lg` | `w-10 h-10 p-0`       | 18       |

> `label` 强制必填，用于 `aria-label`，无障碍读屏依赖。

### 4.3 Dialog / ConfirmDialog

定义于 [src/components/common/Dialog.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Dialog.tsx)。

#### 4.3.1 Dialog Props

| Prop      | 类型                  | 默认值     | 说明                            |
| --------- | --------------------- | ---------- | ------------------------------- |
| `open`    | `boolean`             | -          | 是否显示                        |
| `onClose` | `() => void`          | -          | 关闭回调                        |
| `title`   | `string`              | -          | 标题                            |
| `size`    | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | 宽度档位                        |
| `children`| `React.ReactNode`     | -          | 内容                            |
| `footer`  | `React.ReactNode`     | -          | 底部按钮区                      |

#### 4.3.2 Size 矩阵

| Size | max-width     | 用途                       |
| ---- | ------------- | -------------------------- |
| `sm` | `max-w-sm` (384px)  | 简单确认               |
| `md` | `max-w-md` (448px)  | 默认，常规对话框        |
| `lg` | `max-w-2xl` (672px) | 检查点、设定卡编辑      |
| `xl` | `max-w-4xl` (896px) | 灵感矩阵、Pipeline 监控|

#### 4.3.3 结构

```
<dialog class="backdrop:bg-black/50 backdrop:backdrop-blur-sm bg-bg-primary rounded-lg shadow-lg p-0">
  <header class="flex items-center justify-between px-5 py-3 border-b border-border">
    <h2 class="text-base font-semibold text-text-primary">{title}</h2>
    <IconButton icon={X} label="关闭" onClick={onClose} />
  </header>
  <div class="px-5 py-4 max-h-[60vh] overflow-y-auto">{children}</div>
  {footer && <footer class="flex justify-end gap-2 px-5 py-3 border-t border-border">{footer}</footer>}
</dialog>
```

#### 4.3.4 ConfirmDialog Props

| Prop        | 类型                  | 默认值       | 说明                       |
| ----------- | --------------------- | ------------ | -------------------------- |
| `open`      | `boolean`             | -            |                            |
| `title`     | `string`              | -            |                            |
| `message`   | `string`              | -            | 确认提示语                 |
| `confirmText`| `string`             | `'确认'`     | 确认按钮文字               |
| `cancelText`| `string`              | `'取消'`     | 取消按钮文字               |
| `variant`   | `'primary' \| 'danger'` | `'primary'` | 确认按钮 variant           |
| `onConfirm` | `() => void`          | -            |                            |
| `onCancel`  | `() => void`          | -            |                            |

#### 4.3.5 行为约束

- 基于 HTML `<dialog>` 元素，使用 `showModal()` / `close()` 控制，**禁止**用 React Portal 自行实现遮罩。
- 按 `Esc` 关闭对话框，触发 `onClose` / `onCancel`。
- 点击遮罩（backdrop）不关闭，强制用户点击按钮，避免误操作丢失输入。
- 对话框内禁止嵌套对话框；如确需，先关闭外层再打开内层。

### 4.4 Toast

定义于 [src/components/common/Toast.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Toast.tsx)。

#### 4.4.1 API

全局单例，通过 `toast` 对象调用：

```ts
toast.success('保存成功');
toast.error('网络错误，请重试');
toast.info('已切换到计划阶段');
toast.warning('任务进行中，切换阶段不会中断');
```

#### 4.4.2 类型与样式

| Type      | 图标          | 颜色 token        | 类名                                          |
| --------- | ------------- | ----------------- | --------------------------------------------- |
| `success` | CheckCircle   | `text-success`    | `bg-bg-primary border-success/30`             |
| `error`   | AlertCircle   | `text-error`      | `bg-bg-primary border-error/30`               |
| `info`    | Info          | `text-accent`     | `bg-bg-primary border-accent/30`              |
| `warning` | AlertTriangle | `text-warning`    | `bg-bg-primary border-warning/30`             |

#### 4.4.3 单条 Toast 结构

```
<div class="flex items-start gap-2 bg-bg-primary border rounded-lg shadow-md p-3 min-w-[280px] max-w-[400px]">
  <Icon size={16} class="shrink-0 mt-0.5 {typeColor}" />
  <div class="flex-1 text-sm text-text-primary">{message}</div>
  <button onClick={dismiss} class="text-text-tertiary hover:text-text-primary">
    <X size={14} />
  </button>
</div>
```

#### 4.4.4 容器与动画

- **位置**：`fixed top-4 right-4 z-50 flex flex-col gap-2`
- **入场**：`translate-x-4 opacity-0 → translate-x-0 opacity-100`，`transition-all duration-300`
- **出场**：反向，`duration-200`
- **自动消失**：默认 3000ms，`error` 类型 5000ms
- **手动关闭**：点击 X 按钮立即消失
- **堆叠**：最多同时显示 3 条，超出挤掉最旧的

### 4.5 Input / Textarea

#### 4.5.1 Input

| Prop          | 类型                  | 默认值     | 说明                       |
| ------------- | --------------------- | ---------- | -------------------------- |
| `value`       | `string`              | -          | 受控                       |
| `onChange`    | `(v: string) => void` | -          |                            |
| `placeholder` | `string`              | -          |                            |
| `disabled`    | `boolean`             | `false`    |                            |
| `error`       | `boolean`             | `false`    | 红色边框                   |
| `size`        | `'sm' \| 'md'`        | `'md'`     |                            |
| `prefix`      | `React.ReactNode`     | -          | 前缀（如图标）             |
| `suffix`      | `React.ReactNode`     | -          | 后缀                       |

类名：

```
w-full bg-bg-secondary border border-border rounded-md
text-sm text-text-primary placeholder:text-text-tertiary
focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
disabled:opacity-50 disabled:cursor-not-allowed
```

size 扩展：

| Size | 类名                |
| ---- | ------------------- |
| `sm` | `px-2.5 py-1 text-xs` |
| `md` | `px-3 py-2 text-sm`  |

error 态：`border-error focus:border-error focus:ring-error`。

#### 4.5.2 Textarea

继承 Input 大部分 props，额外：

| Prop         | 类型      | 默认值 | 说明                          |
| ------------ | --------- | ------ | ----------------------------- |
| `autoResize` | `boolean` | `false`| 自动高度（chat 输入框使用）   |
| `maxHeight`  | `number`  | `160`  | autoResize 时的最大高度（px） |

autoResize 实现：`textarea.style.height = 'auto'; textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px'`。

### 4.6 Tooltip

轻量级提示，鼠标 hover 延迟 500ms 显示。

#### 4.6.1 Props

| Prop      | 类型                  | 默认值 | 说明               |
| --------- | --------------------- | ------ | ------------------ |
| `content` | `string`              | -      | 提示文字           |
| `side`    | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | 出现方向 |
| `children`| `React.ReactNode`     | -      | 触发元素           |

#### 4.6.2 样式

```
bg-bg-active text-text-inverse text-xs px-2 py-1 rounded
shadow-md
z-50
```

> 实现可选：基于 `title` 属性的纯原生方案，或自研 Portal 浮层。优先 `title` 属性以降低复杂度。

### 4.7 Tabs

定义于 [src/components/panel/DynamicPanel.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/panel/DynamicPanel.tsx) 内联使用，需抽象为通用组件。

#### 4.7.1 Props

| Prop        | 类型                    | 默认值 | 说明                       |
| ----------- | ----------------------- | ------ | -------------------------- |
| `tabs`      | `{ key, label, icon? }[]` | -    | 标签列表                   |
| `active`    | `string`                | -      | 当前激活 key               |
| `onChange`  | `(key: string) => void` | -      | 切换回调                   |
| `variant`   | `'underline' \| 'pill'` | `'underline'` | 样式               |

#### 4.7.2 Variant

**underline**（默认）：

```
容器：flex border-b border-border
标签：px-3 py-2 text-sm text-text-secondary hover:text-text-primary border-b-2 border-transparent
激活：text-accent border-accent
```

**pill**（用于 TopBar 阶段切换）：

```
容器：bg-bg-tertiary rounded-lg p-0.5 flex
标签：px-3 py-1 text-xs rounded-md transition-colors duration-150
激活：bg-accent text-text-inverse
未激活：text-text-secondary hover:text-text-primary
```

### 4.8 Dropdown / Select

#### 4.8.1 Select（项目选择器使用）

| Prop        | 类型                    | 默认值 | 说明                       |
| ----------- | ----------------------- | ------ | -------------------------- |
| `value`     | `string`                | -      | 当前选中                   |
| `options`   | `{ value, label }[]`    | -      | 选项列表                   |
| `onChange`  | `(v: string) => void`   | -      |                            |
| `placeholder`| `string`               | -      |                            |

样式：

```
触发器：w-full flex items-center justify-between px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm
下拉：absolute mt-1 w-full bg-bg-primary border border-border rounded-lg shadow-md py-1 max-h-60 overflow-y-auto
选项：px-3 py-1.5 text-sm hover:bg-bg-hover
选中项：text-accent bg-accent/5
```

#### 4.8.2 行为

- 点击触发器展开下拉，点击外部关闭。
- 键盘支持：`Enter`/`Space` 展开，`↑`/`↓` 选择，`Enter` 确认，`Esc` 关闭。

### 4.9 Badge

用于状态标签、计数、Agent 类型标记。

#### 4.9.1 Props

| Prop       | 类型                                                        | 默认值     | 说明           |
| ---------- | ----------------------------------------------------------- | ---------- | -------------- |
| `variant`  | `'default' \| 'accent' \| 'success' \| 'warning' \| 'error'` | `'default'`| 颜色           |
| `size`     | `'sm' \| 'md'`                                             | `'sm'`     | 尺寸           |
| `children` | `React.ReactNode`                                          | -          |                |

#### 4.9.2 Variant 矩阵

| Variant   | 类名                                          |
| --------- | --------------------------------------------- |
| `default` | `bg-bg-tertiary text-text-secondary`         |
| `accent`  | `bg-accent/10 text-accent`                   |
| `success` | `bg-success/10 text-success`                 |
| `warning` | `bg-warning/10 text-warning`                 |
| `error`   | `bg-error/10 text-error`                     |

#### 4.9.3 Size

| Size | 类名                          |
| ---- | ----------------------------- |
| `sm` | `px-1.5 py-0.5 text-[10px]`  |
| `md` | `px-2 py-0.5 text-xs`        |

通用：`inline-flex items-center gap-1 rounded-full font-medium`。

### 4.10 EmptyState

空状态占位组件。

#### 4.10.1 Props

| Prop        | 类型              | 默认值 | 说明           |
| ----------- | ----------------- | ------ | -------------- |
| `icon`      | `React.ReactNode` | -      | 大图标（48px） |
| `title`     | `string`          | -      | 主标题         |
| `description`| `string`         | -      | 副标题         |
| `action`    | `React.ReactNode` | -      | 操作按钮       |

#### 4.10.2 样式

```
容器：flex flex-col items-center justify-center h-full text-center p-8
图标：text-text-tertiary opacity-50 mb-3
标题：text-sm font-medium text-text-secondary mb-1
描述：text-xs text-text-tertiary
```

---

## 5. 页面详细设计

本章覆盖应用中所有"页面级"视图的详细设计。每个页面包含：布局结构、组件树、关键交互、数据绑定、空状态、加载状态、错误状态。

### 5.1 项目初始化屏 ProjectInitScreen

#### 5.1.1 触发条件

- 应用首次启动且无任何项目时
- 用户主动删除最后一个项目后

#### 5.1.2 布局

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                      [BookOpen 图标 64px]                        │
│                                                                  │
│                  欢迎使用 Whisper 写作助手                       │
│            从创建你的第一个项目开始，让 AI 协助你完成创作          │
│                                                                  │
│            ┌─────────────────────────────────────┐               │
│            │  输入项目名称...                     │               │
│            └─────────────────────────────────────┘               │
│                                                                  │
│            ┌─────────────────────────────────────┐               │
│            │  选择类型  [玄幻 ▾]                  │               │
│            └─────────────────────────────────────┘               │
│                                                                  │
│                  [  创建项目  ]  [  导入项目  ]                  │
│                                                                  │
│            首次使用？查看 快速入门指南                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.1.3 组件树

```
ProjectInitScreen
├── div.flex.flex-col.items-center.justify-center.h-screen
│   ├── BookOpen (icon, size=64, text-accent opacity-50)
│   ├── h1.text-2xl.font-bold.text-text-primary.mt-6  "欢迎使用 Whisper 写作助手"
│   ├── p.text-sm.text-text-secondary.mt-2             "从创建你的第一个项目开始..."
│   ├── div.flex.flex-col.gap-3.mt-8.w-96
│   │   ├── Input (项目名称, placeholder="输入项目名称...")
│   │   ├── Select (类型, 选项=玄幻/都市/科幻/历史/言情/悬疑/其他, 默认=玄幻)
│   │   └── div.flex.gap-3
│   │       ├── Button variant=primary size=md flex-1  "创建项目"  onClick=createProject
│   │       └── Button variant=secondary size=md       "导入项目"  onClick=importProject
│   └── a.text-xs.text-accent.hover:opacity-80.mt-6    "首次使用？查看快速入门指南"
```

#### 5.1.4 类型选项

| 类型   | 值        |
| ------ | --------- |
| 玄幻   | `fantasy` |
| 都市   | `urban`   |
| 科幻   | `scifi`   |
| 历史   | `history` |
| 言情   | `romance` |
| 悬疑   | `mystery` |
| 其他   | `other`   |

#### 5.1.5 交互

| 动作         | 行为                                                              |
| ------------ | ----------------------------------------------------------------- |
| 输入名称     | 实时校验非空，名称为空时"创建项目"按钮 disabled                   |
| 点击创建     | 调用 `create_project(name, genre)` Tauri 命令，成功后进入主界面   |
| 点击导入     | 打开文件选择对话框，支持 `.whisper.zip` 项目包                    |
| 失败         | Toast.error 显示错误信息，输入框保留                              |

#### 5.1.6 工程约束

- 此屏不显示 TopBar / Sidebar / DynamicPanel / StatusBar，占满全屏。
- 创建成功后，应用自动切换到 `ideation` 阶段，新建一条空对话。

### 5.2 顶部栏 TopBar

定义于 [src/components/layout/TopBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/TopBar.tsx)。

#### 5.2.1 布局

```
┌──────────────────────────────────────────────────────────────────┐
│ [项目名 ▾]      [构思][计划][写作][修改]      🌙 ▢ ⚙              │
│ 48px 高，px-4 py-0，bg-bg-primary border-b border-border           │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.2.2 组件树

```
TopBar
└── header.h-12.flex.items-center.justify-between.px-4.bg-bg-primary.border-b.border-border
    ├── div.flex.items-center.gap-2  (左侧：项目区)
    │   ├── BookOpen size=16 text-accent
    │   ├── Select (项目选择器，触发器无边框变体)
    │   └── IconButton icon=Plus size=sm label="新建项目"
    ├── Tabs variant=pill (中间：阶段切换器，4个标签)
    └── div.flex.items-center.gap-1  (右侧：操作区)
        ├── IconButton icon=Moon/Sun size=md label="切换主题"
        ├── IconButton icon=Maximize2/Minimize2 size=md label="进入/退出专注模式"
        └── IconButton icon=Settings size=md label="设置"
```

#### 5.2.3 项目选择器

- 触发器样式：`bg-transparent text-sm font-medium text-text-primary hover:bg-bg-hover px-2 py-1 rounded-md flex items-center gap-1`
- 下拉列表：显示所有项目，按 `updated_at` 倒序
- 底部固定项："➕ 新建项目"，点击触发 `createProject` 流程
- 当前项目带 ✓ 标记

#### 5.2.4 阶段切换器交互

| 状态                | 行为                                                          |
| ------------------- | ------------------------------------------------------------- |
| 默认                | 点击立即切换，无确认                                          |
| 有正在生成的任务    | 切换后弹 Toast.warning"任务进行中，切换阶段不会中断"           |
| 有未保存的编辑内容  | 切换不阻塞，自动保存继续进行                                  |
| 键盘快捷键          | `Ctrl+1/2/3/4` 切换到 ideation/planning/writing/editing        |

#### 5.2.5 右侧操作按钮

| 按钮         | 图标          | 行为                                                              |
| ------------ | ------------- | ----------------------------------------------------------------- |
| 主题切换     | Moon / Sun    | 切换 `class="dark"`，持久化到 `uiStore.theme`                     |
| 专注模式     | Maximize2     | 仅 writing/editing 阶段可用，否则 Toast.warning                   |
| 设置         | Settings      | 打开 `SettingsPanel`（Dialog 形式）                               |

### 5.3 左侧栏 Sidebar

定义于 [src/components/layout/Sidebar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/Sidebar.tsx)。

#### 5.3.1 布局

```
┌────────────────────┐
│ 项目选择器          │  h-12 border-b
├────────────────────┤
│ 对话历史            │
│ ─ 列表 ─            │  flex-1 overflow-y-auto
│                    │
├────────────────────┤
│ 大纲                │
│ ─ 树形 ─            │  max-h-48 overflow-y-auto
├────────────────────┤
│ 设定卡              │
│ ─ 列表 ─            │  max-h-48 overflow-y-auto
├────────────────────┤
│ [新建对话/章节]     │  h-12 border-t
└────────────────────┘
```

#### 5.3.2 组件树

```
Sidebar
└── aside.w-sidebar.h-full.flex.flex-col.bg-bg-sidebar.border-r.border-border
    ├── div.h-12.flex.items-center.px-4.border-b.border-border  (项目选择器区，复用 TopBar 的 Select)
    ├── div.flex-1.overflow-y-auto  (主内容区，各分组堆叠)
    │   ├── SidebarSection title="对话历史" icon=MessageSquare
    │   │   └── ConversationList
    │   ├── SidebarSection title="大纲" icon=ListTree
    │   │   └── OutlineTree
    │   └── SidebarSection title="设定卡" icon=Layers
    │       └── SettingCardList
    └── div.h-12.border-t.border-border.p-2  (底部新建按钮)
        └── Button variant=secondary size=sm w-full
            icon=Plus
            label={isWritingPhase ? "新建章节" : "新建对话"}
```

#### 5.3.3 SidebarSection

分组容器，统一样式：

```
div.px-3.py-2
├── div.flex.items-center.justify-between.mb-1
│   ├── div.flex.items-center.gap-1.5
│   │   ├── Icon size=12 text-text-tertiary
│   │   └── span.text-xs.font-semibold.text-text-secondary.uppercase.tracking-wider  (分组标题)
│   └── IconButton icon=Plus size=xs label="新建xxx"  (hover 显示)
└── div  (内容区)
```

#### 5.3.4 对话历史列表 ConversationList

| 项           | 样式/行为                                                      |
| ------------ | -------------------------------------------------------------- |
| 容器         | `space-y-0.5`                                                  |
| 单条对话     | `group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs` |
| 选中态       | `bg-accent/10 text-accent`                                     |
| 未选中       | `text-text-primary hover:bg-bg-hover`                          |
| 对话标题     | `flex-1 truncate`，显示对话的第一条用户消息前 20 字             |
| 时间         | `text-[10px] text-text-tertiary shrink-0`，相对时间（5分钟前）  |
| 删除按钮     | `opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error`，icon=Trash2 size=12 |
| 分页         | 默认显示 8 条，滚动到底部加载更多（`historyVisibleCount += 8`） |

#### 5.3.5 大纲树 OutlineTree

P0 阶段为二级树（卷/章），P1 扩展为三级（卷/章/场景）。

```
卷一 起源
├── 第一章 觉醒
├── 第二章 初遇
└── 第三章 试炼
卷二 成长
└── ...
```

| 项           | 样式                                                            |
| ------------ | --------------------------------------------------------------- |
| 卷节点       | `flex items-center gap-1 px-2 py-1 text-xs font-medium text-text-primary cursor-pointer` |
| 章/场景节点  | `flex items-center gap-1 px-2 py-1 pl-5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover rounded-md` |
| 选中章节     | `bg-accent/10 text-accent`                                      |
| 展开图标     | ChevronRight size=12，展开时 `rotate-90 transition-transform`   |
| 拖拽手柄     | 仅 writing/editing 阶段显示，icon=GripVertical size=10 opacity-0 group-hover:opacity-100 |

#### 5.3.6 设定卡列表 SettingCardList

| 项           | 样式                                                            |
| ------------ | --------------------------------------------------------------- |
| 容器         | `space-y-0.5`                                                   |
| 单条         | `group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs` |
| 选中态       | `bg-accent/10 text-accent`                                      |
| 卡名         | `flex-1 truncate`                                               |
| 类型徽章     | `Badge variant=default size=sm`，显示 card_type（角色/场景/道具/势力/概念） |
| 删除按钮     | hover 显示，Trash2 size=12，`text-text-tertiary hover:text-error` |

#### 5.3.7 底部新建按钮

| 阶段                 | 按钮文字   | 行为                                       |
| -------------------- | ---------- | ------------------------------------------ |
| ideation / planning  | 新建对话   | 创建空对话，自动选中                       |
| writing / editing    | 新建章节   | 弹出 Input 对话框输入章节名，创建后选中    |

#### 5.3.8 阶段可见性

| 区域       | ideation | planning | writing       | editing       |
| ---------- | -------- | -------- | ------------- | ------------- |
| 对话历史   | 正常     | 正常     | 置灰 opacity-50 | 置灰 opacity-50 |
| 大纲       | 只读     | 可编辑   | 可编辑+高亮   | 可编辑+高亮   |
| 设定卡     | 正常     | 正常     | 正常          | 正常          |

### 5.4 中间区域 Main Area

中间区域根据当前阶段显示不同内容，互斥：

```
if (isWritingPhase) {
  return <WritingEditor />;
}
if (activePipeline) {
  return <AgentWorkspace />;
}
return <ChatView />;
```

### 5.5 聊天视图 ChatView

定义于 [src/components/chat/ChatView.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/chat/ChatView.tsx)。

#### 5.5.1 布局

```
┌──────────────────────────────────────────────────┐
│                                                  │
│             消息列表（滚动区域）                  │
│                                                  │
│  [用户头像]  你好，帮我构思一个故事               │
│                                                  │
│              [AI头像]  好的，我们来...            │
│                                                  │
│  [用户头像]  嗯，可以围绕...                      │
│                                                  │
│              [AI头像]  ...（流式光标）            │
│                                                  │
├──────────────────────────────────────────────────┤
│  [激活技能标签] [激活技能标签]                    │
│  ┌────────────────────────────────────────────┐  │
│  │ 输入消息... @技能 /工具             [发送] │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### 5.5.2 组件树

```
ChatView
└── div.flex.flex-col.h-full.bg-bg-primary
    ├── div.flex-1.overflow-y-auto  (消息列表)
    │   ├── div.flex.flex-col.gap-0  (消息容器)
    │   │   └── messages.map(m => <MessageBubble message={m} isStreaming={...} onEdit={...} />)
    │   └── div.ref={messagesEndRef}  (滚动锚点)
    └── ChatInput
```

#### 5.5.3 空状态

```
EmptyState
├── icon = MessageSquare size=48
├── title = "开始一段新的对话"
├── description = "输入 @ 可启用写作技能"
└── (无 action 按钮)
```

#### 5.5.4 消息渲染规则

- **用户消息**：`flex-row-reverse`，头像在右，气泡 `bg-accent text-text-inverse`
- **AI 消息**：`flex-row`，头像在左，气泡 `bg-bg-tertiary text-text-primary`
- **流式消息**：消息体 `animate-pulse`，文本末尾显示闪烁光标（`w-1.5 h-4 bg-accent animate-pulse rounded-sm`）
- **自动滚动**：新消息入场或流式内容更新时，`messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })`
- **手动上滚**：用户向上滚动时，自动滚动暂停，显示"回到底部"悬浮按钮（仅当距离底部 > 200px）

#### 5.5.5 ChatInput 详解

定义于 [src/components/chat/ChatInput.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/chat/ChatInput.tsx)。

```
ChatInput
└── div.relative.bg-bg-secondary.px-3.py-2.5.border-t.border-border
    ├── SlashCommandDropdown  (/ 工具命令下拉)
    ├── MentionDropdown       (@ 技能提及下拉)
    ├── div.flex.flex-wrap.gap-1.mb-2  (已激活技能标签区)
    │   └── activeSkillIds.map(id => <SkillTag />)
    ├── div.flex.items-end.gap-2
    │   ├── textarea.flex-1.resize-none.bg-transparent.text-sm.text-text-primary
    │   │       placeholder="输入消息...  @ 技能  / 工具"
    │   │       rows=1
    │   │       className="max-h-40"
    │   └── IconButton  (发送/停止按钮)
    │       ├── !isGenerating: icon=Send, bg-accent, text-text-inverse
    │       └── isGenerating:  icon=Square, bg-error/10, text-error
    └── div.text-[10px].text-text-tertiary.mt-1  (快捷键提示)
        └── "Enter 发送 · Shift+Enter 换行 · @ 技能 · / 工具"
```

**已激活技能标签 SkillTag**：

```
div.inline-flex.items-center.gap-1.px-2.py-0.5.rounded-full.text-xs.bg-accent/10.text-accent
├── span  {skillName}
└── button.onClick={() => toggleSkill(id)}
    └── X size=10
```

**发送按钮**：

- 默认态：`w-9 h-9 rounded-xl bg-accent text-text-inverse hover:bg-accent-hover`
- 生成中：`w-9 h-9 rounded-xl bg-error/10 text-error hover:bg-error/20`，图标 Square
- disabled：输入框为空时 disabled

**输入框行为**：

| 操作             | 行为                                                          |
| ---------------- | ------------------------------------------------------------- |
| 输入 `@`         | 打开技能提及下拉，过滤匹配                                    |
| 输入 `/`         | 打开斜杠命令下拉，过滤匹配                                    |
| Enter            | 发送消息（trim 后非空且未在生成中）                           |
| Shift+Enter      | 换行                                                          |
| Esc              | 关闭 @ / / 下拉                                               |
| 选中技能         | 替换 `@xxx` 为 `@技能名 `，激活该技能                         |
| 选中工具         | 替换 `/xxx` 为 `/工具名 `，标记 `activeTool`                  |
| 内容变化         | 自适应高度，最大 160px 后出现滚动条                           |
| 发送后           | 清空输入框，高度重置为 auto，焦点保留                         |

### 5.6 写作编辑器 WritingEditor

定义于 [src/components/editor/WritingEditor.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/editor/WritingEditor.tsx)。

#### 5.6.1 布局

```
┌──────────────────────────────────────────────────────┐
│ EditorToolbar (字数 续写 撤销 重做)                    │  h-10 border-b
├──────────────────────────────────────────────────────┤
│                                                      │
│            第一章 觉醒                                │  (章节标题输入)
│                                                      │
│            黑暗中，少年猛地睁开眼睛...                │  (正文编辑区)
│            ...                                        │
│            ...                                        │
│                                                      │
│                  [AI 续写建议浮层]                    │  (生成中显示)
│                  ┌──────────────────┐                │
│                  │ 续写内容预览...   │                │
│                  │ [采用] [忽略]     │                │
│                  └──────────────────┘                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 5.6.2 组件树

```
WritingEditor
└── div.h-full.flex.flex-col.relative.onContextMenu={handleContextMenu}
    ├── EditorToolbar
    ├── div.flex-1.overflow-hidden.p-6
    │   └── div.max-w-3xl.mx-auto.h-full
    │       ├── input.text-xl.font-serif.font-bold  (章节标题)
    │       │       className="w-full bg-transparent text-text-primary
    │       │              placeholder:text-text-tertiary focus:outline-none mb-4"
    │       │       placeholder="章节标题"
    │       └── textarea.flex-1  (正文)
    │               className="w-full h-[calc(100%-3rem)] resize-none bg-transparent
    │                          text-text-primary font-serif text-base leading-loose
    │                          placeholder:text-text-tertiary focus:outline-none"
    │               placeholder="开始写作..."
    ├── ContinueWritePreview  (流式续写浮层，仅 isGenerating && streamingContent 时显示)
    └── ContextMenu  (右键菜单，仅 contextMenu 状态非空时显示)
```

#### 5.6.3 EditorToolbar

```
EditorToolbar
└── div.h-10.flex.items-center.justify-between.px-4.border-b.border-border
    ├── div.flex.items-center.gap-2  (左侧)
    │   ├── span.text-xs.text-text-tertiary  "字数"
    │   └── span.text-xs.font-medium.text-text-primary  {wordCount}
    └── div.flex.items-center.gap-1  (右侧)
        ├── Button variant=ghost size=sm icon=Wand2  "续写"  onClick=onContinueWrite
        ├── IconButton icon=Undo size=sm label="撤销"
        └── IconButton icon=Redo size=sm label="重做"
```

#### 5.6.4 续写预览浮层

```
div.absolute.bottom-4.left-1/2.-translate-x-1/2.max-w-2xl.w-full.px-6
└── div.bg-bg-tertiary.border.border-border.rounded-lg.p-4.shadow-lg
    ├── div.text-xs.text-text-tertiary.mb-2  "AI 续写建议"
    ├── div.text-sm.text-text-primary.whitespace-pre-wrap  {streamingContent}
    └── div.flex.gap-2.mt-3
        ├── Button variant=primary size=sm  "采用"  onClick=accept
        └── Button variant=ghost size=sm   "忽略"  onClick=dismiss
```

#### 5.6.5 右键菜单

```
div.absolute.bg-bg-primary.border.border-border.rounded-lg.shadow-lg.py-1.z-50
└── contextMenuItems.map(item =>
    button.w-full.text-left.px-4.py-2.text-sm.text-text-primary.hover:bg-bg-hover.transition-colors
    )
```

菜单项：语法校正 / 语气调整 / 扩写 / 缩写。

**触发条件**：仅在 textarea 有选中文本时显示，否则使用浏览器默认右键菜单。

#### 5.6.6 空状态

未选中任何章节时：

```
EmptyState
├── icon = PenTool size=48
├── title = "请在左侧选择一个章节开始写作"
├── description = "或新建一个章节"
└── (无 action)
```

#### 5.6.7 自动保存

| 触发       | 行为                                                              |
| ---------- | ----------------------------------------------------------------- |
| 内容变化   | 防抖 1500ms 后调用 `update_chapter`，状态栏显示 `saving`          |
| 切换章节   | 立即保存当前章节，再切换                                          |
| 切换阶段   | 立即保存                                                          |
| 关闭窗口   | Tauri `onCloseRequested` 钩子同步保存                             |
| 保存完成   | 状态栏切换为 `saved`，显示 Check 图标 1.5 秒后隐藏                |

### 5.7 右侧动态面板 DynamicPanel

定义于 [src/components/panel/DynamicPanel.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/panel/DynamicPanel.tsx)。

#### 5.7.1 布局

```
┌────────────────────┐
│ [助手] [操作]       │  Tab 头部，h-10 border-b
├────────────────────┤
│                    │
│  助手内容（按阶段） │  flex-1 overflow-y-auto
│  或                │
│  操作内容          │
│                    │
└────────────────────┘
```

#### 5.7.2 组件树

```
DynamicPanel
└── aside.h-full.flex.flex-col.bg-bg-panel.border-l.border-border.overflow-hidden
    ├── Tabs  (顶部 Tab 切换)
    │   ├── tab key="assistant" label="助手"
    │   └── tab key="operations" label="操作"
    └── div.flex-1.overflow-y-auto
        └── panelTab === 'assistant'
            ? phasePanelMap[phase]
            : <OperationsPanel />
```

#### 5.7.3 助手 Tab 按阶段切换

| 阶段       | 组件            | 标题         | 标题图标   | 标题颜色        |
| ---------- | --------------- | ------------ | ---------- | --------------- |
| ideation   | IdeationPanel   | 构思助手     | Lightbulb  | `text-warning`  |
| planning   | PlanningPanel   | 计划助手     | ListTree   | `text-accent`   |
| writing    | WritingPanel    | 写作助手     | PenTool    | `text-success`  |
| editing    | EditingPanel    | 修改助手     | CheckSquare| `text-error`    |

#### 5.7.4 IdeationPanel 快捷操作

```
IdeationPanel
└── div.p-4.space-y-4
    ├── div.flex.items-center.gap-2.mb-2  (标题)
    │   ├── Lightbulb size=16 text-warning
    │   └── h3.text-sm.font-semibold.text-text-primary  "构思助手"
    └── div.space-y-2
        ├── p.text-xs.text-text-tertiary  "快捷操作"
        ├── ActionButton  "生成选题列表"        onClick=sendPrompt(...)
        ├── ActionButton  ""如果…会怎样"发散"    onClick=sendPrompt(...)
        └── ActionButton  "生成高概念梗概"       onClick=sendPrompt(...)
```

**ActionButton 样式**：

```
button.w-full.text-left.px-3.py-2.rounded-md.bg-bg-tertiary.hover:bg-bg-hover
       .text-sm.text-text-primary.transition-colors.disabled:opacity-50
```

快捷操作内容详见 [src/components/panel/DynamicPanel.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/panel/DynamicPanel.tsx)。

#### 5.7.5 PlanningPanel 快捷操作

| 按钮           | 发送的 prompt                                          |
| -------------- | ------------------------------------------------------ |
| 生成章节大纲   | "请根据当前故事创意，生成一份章节大纲..."               |
| 人物弧光规划   | "请为主要角色规划人物弧光，包括起点、转折点和终点。"     |
| 分幕节奏建议   | "请根据当前大纲，给出分幕节奏建议..."                   |
| 伏笔埋设提示   | "请根据当前大纲，提示需要埋设的伏笔及其回收点。"         |

#### 5.7.6 WritingPanel

```
WritingPanel
└── div.p-4.space-y-4
    ├── (标题区)
    ├── div.space-y-2  (操作按钮组)
    │   ├── ActionButton  icon=Wand2 size=12  "续写当前章节"
    │   ├── ActionButton  "场景描写生成"
    │   └── ActionButton  "角色对话生成"
    └── div  (设定引用区)
        ├── p.text-xs.font-medium.text-text-secondary.mb-2  "设定引用"
        └── settingCards.length === 0
            ? p.text-xs.text-text-tertiary  "暂无设定卡"
            : div.space-y-1.max-h-40.overflow-y-auto
                └── settingCards.slice(0, 10).map(card =>
                    div.flex.items-center.gap-2.px-2.py-1.5.rounded-md.bg-bg-tertiary.hover:bg-bg-hover.cursor-pointer
                    ├── span.text-xs.text-text-primary.truncate  {card.name}
                    └── span.text-xs.text-text-tertiary.shrink-0  {card.card_type}
                    )
```

#### 5.7.7 EditingPanel 快捷操作

| 按钮           | 发送的 prompt                                          |
| -------------- | ------------------------------------------------------ |
| 一致性检查     | "请检查当前文本的一致性..."                              |
| 语气调整       | "请调整当前文本的语气..."                               |
| 语法校正       | "请校正当前文本中的语法和用词错误。"                     |
| 可读性分析     | "请分析当前文本的可读性..."                              |

#### 5.7.8 OperationsPanel

```
OperationsPanel
└── div.p-4.space-y-4
    ├── div  (设定卡管理)
    │   ├── div.flex.items-center.justify-between.mb-2
    │   │   ├── h3.text-sm.font-semibold.text-text-primary  "设定卡管理"
    │   │   └── button.text-xs.text-accent.hover:opacity-80  "+ 新建"
    │   └── settingCards.length === 0
    │       ? p.text-xs.text-text-tertiary.py-2  "暂无设定卡"
    │       : div.space-y-1.max-h-48.overflow-y-auto
    │           └── settingCards.map(card => <SettingCardItem />)
    ├── div.border-t.border-border.pt-3  (章节跳转)
    │   ├── h3.text-sm.font-semibold.text-text-primary.mb-2  "章节跳转"
    │   └── chapters.length === 0 ? ... : ...
    └── div.border-t.border-border.pt-3  (项目信息)
        ├── h3.text-sm.font-semibold.text-text-primary.mb-2  "项目信息"
        └── div.space-y-1.text-xs.text-text-secondary
            ├── div.flex.justify-between  "名称" | {currentProject.name}
            ├── div.flex.justify-between  "类型" | {currentProject.genre || '通用'}
            ├── div.flex.justify-between  "章节数" | {chapters.length}
            └── div.flex.justify-between  "设定卡数" | {settingCards.length}
```

#### 5.7.9 设定卡编辑器 SettingCardEditor

当 OperationsPanel 中选中某张设定卡时，面板顶部展开编辑区：

```
SettingCardEditor
└── div.border.border-border.rounded-lg.p-3.mb-3.bg-bg-primary
    ├── div.flex.items-center.justify-between.mb-2
    │   ├── input.text-sm.font-medium.text-text-primary  (名称)
    │   └── IconButton icon=X size=xs label="关闭编辑"
    ├── Select  (类型：角色/场景/道具/势力/概念)
    ├── div.space-y-2  (字段编辑区)
    │   └── Object.entries(card.content).map(([key, value]) =>
    │       div.flex.gap-2
    │       ├── input.text-xs.flex-1  {key}  (键名，只读)
    │       └── textarea.text-xs.flex-1  {value}  (值，可编辑)
    │       )
    └── div.flex.gap-2.mt-2
        ├── Button variant=primary size=sm  "保存"  onClick=save
        └── Button variant=ghost size=sm   "取消"
```

**字段模板**（角色卡推荐字段）：

| 英文 key    | 中文显示 |
| ----------- | -------- |
| name        | 全名     |
| age         | 年龄     |
| gender      | 性别     |
| personality | 性格     |
| appearance  | 外貌     |
| background  | 背景     |
| faction     | 阵营     |
| goal        | 目标     |

### 5.8 底部状态栏 StatusBar

定义于 [src/components/layout/StatusBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/StatusBar.tsx)。

#### 5.8.1 布局

```
┌──────────────────────────────────────────────────────────────────┐
│ ☁ gpt-4                          💬 12.3k tokens    ✓ 已保存     │
│ 28px 高，px-4，bg-bg-secondary border-t border-border              │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.8.2 组件树

```
StatusBar
└── footer.h-7.flex.items-center.justify-between.px-4.bg-bg-secondary.border-t.border-border.text-xs
    ├── div.flex.items-center.gap-2  (左侧：模型)
    │   ├── Cloud size=12 text-text-tertiary
    │   └── span.text-text-secondary  {currentModel}
    └── div.flex.items-center.gap-4  (右侧：token + 保存)
        ├── div.flex.items-center.gap-1
        │   ├── MessageSquare size=12 text-text-tertiary
        │   └── span.text-text-tertiary  "{formatTokens(totalTokens)} tokens"
        └── SaveStatus
```

#### 5.8.3 SaveStatus 三态

| 状态    | 图标          | 颜色          | 文字     | 触发                              |
| ------- | ------------- | ------------- | -------- | --------------------------------- |
| saved   | Check         | `text-success`| 已保存   | 保存成功后 1.5 秒                 |
| saving  | Loader2 spin  | `text-warning`| 保存中...| 自动保存触发时                    |
| unsaved | CloudOff      | `text-warning`| 未保存   | 内容有变化但未触发保存时           |

### 5.9 设置面板 SettingsPanel

通过 TopBar 设置按钮触发，以 Dialog 形式打开，size=`lg`。

#### 5.9.1 布局

```
┌──────────────────────────────────────────────────────────┐
│ 设置                                                  [X] │
├──────────────────────────────────────────────────────────┤
│ [API配置] [外观] [快捷键] [关于]                          │  内嵌 Tabs underline
├──────────────────────────────────────────────────────────┤
│                                                          │
│  (Tab 内容区)                                            │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                              [关闭]       │
└──────────────────────────────────────────────────────────┘
```

#### 5.9.2 API 配置 Tab

```
div.space-y-4
├── div  (Provider 选择)
│   ├── label.text-sm.font-medium  "服务商"
│   └── Select  options=[OpenAI / Anthropic / DeepSeek / 自定义]
├── div  (API Key)
│   ├── label.text-sm.font-medium  "API Key"
│   └── Input type=password suffix=Eye/EyeOff  (显隐切换)
├── div  (Base URL)
│   ├── label.text-sm.font-medium  "Base URL"
│   └── Input placeholder="https://api.openai.com/v1"
├── div  (Model)
│   ├── label.text-sm.font-medium  "模型"
│   └── Input placeholder="gpt-4"
└── div.flex.gap-2
    ├── Button variant=primary size=sm  "测试连接"
    └── Button variant=secondary size=sm  "保存"
```

#### 5.9.3 外观 Tab

```
div.space-y-4
├── div  (主题)
│   ├── label.text-sm.font-medium  "主题"
│   └── div.flex.gap-2
│       ├── Button variant={theme === 'light' ? 'primary' : 'secondary'}  "☀ 浅色"
│       └── Button variant={theme === 'dark' ? 'primary' : 'secondary'}   "🌙 深色"
├── div  (字体大小)
│   ├── label.text-sm.font-medium  "编辑器字号"
│   └── Slider min=14 max=20 step=1  value={editorFontSize}
└── div  (行高)
    ├── label.text-sm.font-medium  "编辑器行高"
    └── Slider min=1.5 max=2.5 step=0.1  value={editorLineHeight}
```

#### 5.9.4 快捷键 Tab

只读列表，展示所有快捷键：

| 操作           | 快捷键             |
| -------------- | ------------------ |
| 发送消息       | Enter              |
| 换行           | Shift+Enter        |
| 切换阶段       | Ctrl+1/2/3/4       |
| 进入专注模式   | F11                |
| 退出专注模式   | Esc / F11          |
| 关闭对话框     | Esc                |
| 保存编辑（消息）| Ctrl+Enter        |
| @ 提及         | @                  |
| 斜杠命令       | /                  |

#### 5.9.5 关于 Tab

```
div.text-center.space-y-2
├── BookOpen size=48 text-accent mx-auto
├── h2.text-lg.font-bold  "Whisper"
├── p.text-xs.text-text-tertiary  "版本 v1.0.0"
├── p.text-xs.text-text-tertiary  "AI 写作助手"
└── div.flex.gap-2.justify-center.mt-4
    ├── a.text-xs.text-accent  "查看源码"
    └── a.text-xs.text-accent  "报告问题"
```

---

## 6. Agent 系统 UI

本章定义多 Agent 系统新增的 UI 组件，对应 P0 工作流 `inspiration_matrix` 与 `style_rewrite_polish`，以及通用 Pipeline 执行可视化。

### 6.1 AgentWorkspace（Agent 工作区）

替代 ChatView 的中间区域形态，当有活跃 Pipeline 任务时显示。

#### 6.1.1 触发条件

- 用户在 ChatInput 中触发一个工作流（如点击"灵感矩阵"快捷操作）
- 系统调用 `start_pipeline` Tauri 命令成功
- 中间区域从 ChatView 切换为 AgentWorkspace

#### 6.1.2 布局

```
┌──────────────────────────────────────────────────────────┐
│ AgentWorkspace 头部                                       │  h-12 border-b
│ [Workflow 图标] 灵感矩阵生成  ·  task_xxx  [关闭]         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  PipelineVisualizer  (Pipeline 节点流)                    │  h-auto
│  ○─○─●─○─○                                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  AgentTaskPanel  (当前节点详情)                           │  flex-1
│  当前节点：idea_diverger                                 │
│  ─────────────────                                       │
│  输入：{...}                                              │
│  输出：{...}                                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [输入框]                                       [发送]    │  h-16 border-t
└──────────────────────────────────────────────────────────┘
```

#### 6.1.3 组件树

```
AgentWorkspace
└── div.flex.flex-col.h-full.bg-bg-primary
    ├── div.h-12.flex.items-center.justify-between.px-4.border-b.border-border  (头部)
    │   ├── div.flex.items-center.gap-2
    │   │   ├── Workflow size=16 text-accent
    │   │   ├── span.text-sm.font-medium.text-text-primary  {workflowName}
    │   │   ├── span.text-xs.text-text-tertiary  "·"
    │   │   └── span.text-xs.text-text-tertiary.font-mono  {taskId}
    │   └── IconButton icon=X size=sm label="关闭工作区"  onClick=onClose
    ├── PipelineVisualizer  taskId={taskId}
    ├── AgentTaskPanel  taskId={taskId}  (flex-1)
    └── div.h-16.border-t.border-border.p-3  (输入区，仅检查点时启用)
        └── ChatInput  (复用，但 placeholder="等待检查点决策...")
```

#### 6.1.4 与 ChatView 的切换

- AgentWorkspace 显示时，ChatView 不可见，但消息列表仍可在后台接收 `chat:chunk` 事件
- Pipeline 完成或失败后，自动切回 ChatView，结果作为 AI 消息追加到对话历史
- 用户点击"关闭工作区"按钮，立即切回 ChatView；Pipeline 在后台继续执行

### 6.2 PipelineVisualizer（Pipeline 可视化）

图形化展示 Pipeline 节点流与执行状态。

#### 6.2.1 布局

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ●──●──◐──○──○                                          │
│   关键词  发散  组合  矩阵  写入                          │
│   ✓     ✓    ⋯    ⋯    ⋯                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 6.2.2 节点状态与样式

| 状态        | 图标          | 颜色                    | 类名                                          |
| ----------- | ------------- | ----------------------- | --------------------------------------------- |
| pending     | ○ (空心圆)    | `text-agent-pending`    | `border-2 border-agent-pending bg-bg-primary` |
| running     | ◑ (半实心)    | `text-agent-running`    | `border-2 border-agent-running bg-agent-running/10 animate-pulse` |
| success     | ● (实心圆)    | `text-agent-success`    | `border-2 border-agent-success bg-agent-success/10` |
| failed      | ✕ (叉)        | `text-agent-failed`     | `border-2 border-agent-failed bg-agent-failed/10` |
| skipped     | ⊘ (禁止)      | `text-agent-skipped`    | `border-2 border-agent-skipped bg-agent-skipped/10` |
| checkpoint  | ◆ (菱形)      | `text-agent-checkpoint` | `border-2 border-agent-checkpoint bg-agent-checkpoint/10 animate-pulse` |

#### 6.2.3 节点尺寸

- 圆形节点：`w-10 h-10 rounded-full flex items-center justify-center`
- 连接线：`flex-1 h-0.5 bg-border`（已执行部分为 `bg-agent-success`）
- 标签：节点下方 `text-[10px] text-text-tertiary mt-1`，显示节点简称
- 状态图标：节点内居中，size=16

#### 6.2.4 组件树

```
PipelineVisualizer
└── div.p-4.border-b.border-border
    └── div.flex.items-center.justify-center.gap-1
        └── nodes.map((node, i) => (
            <Fragment>
                <div.flex.flex-col.items-center.gap-1
                    ├── div.w-10.h-10.rounded-full.flex.items-center.justify-center.cursor-pointer
                    │       className={statusClassMap[node.status]}
                    │       onClick={() => onNodeClick(node.id)}
                    │   └── Icon size=16  (状态图标)
                    └── span.text-[10px].text-text-tertiary  {node.shortLabel}
                {i < nodes.length - 1 && (
                    <div.flex-1.h-0.5.min-w-8
                        className={node.status === 'success' ? 'bg-agent-success' : 'bg-border'}
                    />
                )}
            </Fragment>
        ))
```

#### 6.2.5 交互

- 点击节点：在下方 AgentTaskPanel 切换显示该节点详情
- hover 节点：Tooltip 显示完整节点名、开始时间、耗时
- 检查点节点：状态为 `checkpoint` 时，自动弹出 CheckpointDialog

### 6.3 AgentTaskPanel（节点详情面板）

显示当前选中节点的输入、输出、日志。

#### 6.3.1 布局

```
┌──────────────────────────────────────────────────────────┐
│ 当前节点：idea_diverger  [LLM]  发散型  0.9 温度          │  h-10 border-b
├──────────────────────────────────────────────────────────┤
│ [输入] [输出] [日志]                                      │  Tab
├──────────────────────────────────────────────────────────┤
│                                                          │
│  输入：                                                   │
│  {                                                       │
│    "keywords": ["穿越", "重生", "系统"],                  │
│    "context": {...}                                       │
│  }                                                       │
│                                                          │
│  输出：                                                   │
│  - 重生后在异世界建立商业帝国                              │
│  - 系统赋予特殊能力的隐世家族子弟                          │
│  - ...                                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 6.3.2 组件树

```
AgentTaskPanel
└── div.flex-1.flex.flex-col.overflow-hidden
    ├── div.h-10.flex.items-center.justify-between.px-4.border-b.border-border
    │   ├── div.flex.items-center.gap-2
    │   │   ├── Cpu size=14 text-accent
    │   │   ├── span.text-sm.font-medium.text-text-primary  {nodeName}
    │   │   ├── Badge variant=accent  {agentType}  (LLM / 工具型)
    │   │   └── Badge variant=default  {category}  (analytic / creative_divergent / ...)
    │   └── div.text-xs.text-text-tertiary  "温度 {temp}"
    ├── Tabs variant=underline tabs=[输入, 输出, 日志]
    └── div.flex-1.overflow-y-auto.p-4
        └── activeTab === 'input' ? <NodeInputView />
            : activeTab === 'output' ? <NodeOutputView />
            : <NodeLogView />
```

#### 6.3.3 NodeInputView

JSON 格式化展示节点输入，使用 ReactMarkdown 的 code 块渲染：

```
div.text-xs.font-mono
└── pre.bg-bg-secondary.p-3.rounded-lg.overflow-x-auto
    └── code  {JSON.stringify(node.input, null, 2)}
```

支持 `{{variable}}` 变量插值的展开预览：将变量替换为实际值后展示。

#### 6.3.4 NodeOutputView

按节点输出类型差异化展示：

| 节点              | 输出类型     | 展示方式                              |
| ----------------- | ------------ | ------------------------------------- |
| keyword_analyst   | JSON         | 关键词列表，每个词带权重条             |
| idea_diverger     | JSON         | 创意列表，编号+内容                    |
| inspiration_combiner | JSON      | 组合列表，二维组合表                   |
| inspiration_matrix_writer | JSON | 完整矩阵 Markdown 预览                |
| style_analyzer    | JSON         | 风格维度雷达图（5 维度）               |
| style_rewriter    | Markdown     | 改写后文本，与原文对比                 |
| style_polisher    | Markdown     | 润色后文本，与改写版对比               |
| memory_keeper     | -            | 工具型，无输出展示，仅日志             |

**通用 JSON 展示**：非上述特殊节点，使用 NodeInputView 的 JSON 格式化展示。

#### 6.3.5 NodeLogView

执行日志，按时间倒序：

```
div.text-xs.font-mono.space-y-1
└── logs.map(log => (
    div.flex.gap-2
    ├── span.text-text-tertiary  {formatTime(log.timestamp)}
    ├── span.text-text-tertiary  "[{log.level}]"
    └── span.text-text-primary  {log.message}
    )
```

日志级别颜色：`INFO` 默认、`WARN` warning、`ERROR` error。

### 6.4 CheckpointDialog（检查点对话框）

Pipeline 执行到检查点节点时弹出的交互对话框。

#### 6.4.1 触发条件

- Pipeline 节点状态变为 `checkpoint`
- 后端通过 `pipeline:checkpoint` 事件通知前端
- 前端监听事件，弹出 CheckpointDialog

#### 6.4.2 布局

```
┌──────────────────────────────────────────────────────────┐
│ 检查点：灵感组合                              [X]         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  发散阶段生成了以下 8 个创意组合，请选择继续推进的方向：  │
│                                                          │
│  ┌────────────────────────────────────────────────┐      │
│  │ ☑ 组合 1：穿越+系统+商业帝国                    │      │
│  │ ☑ 组合 3：重生+隐世家族+特殊能力                │      │
│  │ ☐ 组合 5：系统+末世+生存                        │      │
│  │ ...                                            │      │
│  └────────────────────────────────────────────────┘      │
│                                                          │
│  用户反馈（可选）：                                       │
│  ┌────────────────────────────────────────────────┐      │
│  │ 请关注主角的成长曲线，避免开局过强...           │      │
│  └────────────────────────────────────────────────┘      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [跳过] [中止]                       [继续]              │
└──────────────────────────────────────────────────────────┘
```

#### 6.4.3 组件树

```
CheckpointDialog
└── Dialog open={open} size="lg" title="检查点：{checkpointName}"
    ├── div.space-y-4
    │   ├── p.text-sm.text-text-secondary  {prompt}  (检查点提示文案)
    │   ├── div.border.border-border.rounded-lg.p-3.max-h-60.overflow-y-auto  (选项区)
    │   │   └── options.map(opt => (
    │   │       label.flex.items-start.gap-2.cursor-pointer
    │   │       ├── input type=checkbox checked={selected.includes(opt.id)}
    │   │       └── span.text-sm.text-text-primary  {opt.content}
    │   │       )
    │   ├── div  (用户反馈区)
    │   │   ├── label.text-sm.font-medium.text-text-primary  "用户反馈（可选）"
    │   │   └── Textarea autoResize maxHeight=120  placeholder="补充你的要求或修改意见..."
    │   └── (检查点特定内容，如灵感组合的可视化预览)
    └── footer
        ├── Button variant=ghost size=md icon=SkipForward  "跳过"  onClick=onSkip
        ├── Button variant=danger size=md                  "中止"  onClick=onAbort
        └── Button variant=primary size=md icon=Play       "继续"  onClick=onContinue
```

#### 6.4.4 三种决策

| 决策     | 按钮       | 行为                                                              |
| -------- | ---------- | ----------------------------------------------------------------- |
| Continue | 继续（绿） | 将选中项 + 用户反馈作为下游节点输入，Pipeline 继续                |
| Skip     | 跳过（黄） | 跳过当前检查点，使用默认值继续                                    |
| Abort    | 中止（红） | 中止整个 Pipeline，已执行节点结果保留                             |

#### 6.4.5 检查点类型

不同工作流的检查点提示内容差异：

| 工作流              | 检查点节点                | 提示内容                                |
| ------------------- | ------------------------- | --------------------------------------- |
| inspiration_matrix  | combiner_checkpoint       | 选择继续推进的创意组合                  |
| style_rewrite_polish| rewriter_checkpoint       | 确认改写方向（保留原文风/ 强化某种风格）|
| outline_generation  | outline_checkpoint        | 确认大纲结构                            |
| character_dialogue  | dialogue_loop_checkpoint  | 是否继续生成下一轮对话                  |

### 6.5 InspirationMatrixView（灵感矩阵视图）

`inspiration_matrix` 工作流的最终结果展示。

#### 6.5.1 布局

```
┌──────────────────────────────────────────────────────────┐
│ 灵感矩阵                              [复制] [导入大纲]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         系统流    重生流    末世流    悬疑流              │
│  穿越   ┌─────┬─────┬─────┬─────┐                       │
│         │ ★★★ │  ★  │  ★  │  ★  │                       │
│  重生   │  ★  │ ★★★ │  ★  │  ★  │                       │
│  系统   │ ★★★ │  ★  │  ★  │  ★  │                       │
│  末世   │  ★  │  ★  │ ★★★ │  ★  │                       │
│         └─────┴─────┴─────┴─────┘                       │
│                                                          │
│  选中单元格详情：                                         │
│  ┌────────────────────────────────────────────────┐      │
│  │ 穿越 × 系统流                                   │      │
│  │                                                 │      │
│  │ 主角穿越后觉醒系统，在异世界建立...              │      │
│  │                                                 │      │
│  │ 创新度：★★★★☆  冲突性：★★★★★  可行性：★★★☆☆   │      │
│  └────────────────────────────────────────────────┘      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 6.5.2 组件树

```
InspirationMatrixView
└── div.h-full.flex.flex-col
    ├── div.h-10.flex.items-center.justify-between.px-4.border-b.border-border
    │   ├── div.flex.items-center.gap-2
    │   │   ├── Layers size=16 text-accent
    │   │   └── span.text-sm.font-medium  "灵感矩阵"
    │   └── div.flex.gap-2
    │       ├── Button variant=ghost size=sm icon=Copy  "复制"
    │       └── Button variant=primary size=sm icon=Plus  "导入大纲"
    ├── div.flex-1.overflow-auto.p-4
    │   ├── table  (二维矩阵表)
    │   │   ├── thead
    │   │   │   └── tr
    │   │   │       ├── th  (空，左上角)
    │   │   │       └── columns.map(col => th.text-xs.text-text-secondary.px-3.py-2  {col})
    │   │   └── tbody
    │   │       └── rows.map(row => (
    │   │           tr
    │   │           ├── th.text-xs.text-text-secondary.px-3.py-2.text-left  {row}
    │   │           └── columns.map(col => (
    │   │               td.px-3.py-2.text-center.cursor-pointer.hover:bg-bg-hover
    │   │                   className={selected === `${row}-${col}` ? 'bg-accent/10' : ''}
    │   │                   onClick={() => onSelect(row, col)}
    │   │               └── span.text-sm  {rating}  (★★★ 等)
    │   │               )
    │   │       )
    │   └── selectedCell && <MatrixCellDetail cell={selectedCell} />
    └── (无 footer)
```

#### 6.5.3 MatrixCellDetail

```
div.mt-4.border.border-border.rounded-lg.p-4
├── div.flex.items-center.justify-between.mb-2
│   ├── h3.text-sm.font-bold.text-text-primary  "{row} × {col}"
│   └── div.flex.gap-2
│       ├── Badge variant=accent  "创新度 ★★★★☆"
│       ├── Badge variant=accent  "冲突性 ★★★★★"
│       └── Badge variant=accent  "可行性 ★★★☆☆"
├── p.text-sm.text-text-primary.leading-relaxed  {cell.synopsis}  (梗概)
└── div.flex.gap-2.mt-3
    ├── Button variant=secondary size=sm  "复制梗概"
    └── Button variant=primary size=sm icon=Plus  "作为新章节"
```

#### 6.5.4 评分样式

- ★：`text-accent`
- ☆：`text-text-tertiary`
- 单元格整体评分用颜色区分：★★★ 以上为 `text-accent font-medium`，其他为 `text-text-secondary`

### 6.6 StyleRewritePanel（改写润色面板）

`style_rewrite_polish` 工作流的入口与结果对比面板。

#### 6.6.1 入口

从 ChatView 中触发：用户在 DynamicPanel 的 EditingPanel 中点击"改写润色"，或对选中文本右键选择"改写润色"。

#### 6.6.2 布局

```
┌──────────────────────────────────────────────────────────┐
│ 改写润色                              [关闭]              │
├──────────────────────────────────────────────────────────┤
│ 步骤：① 风格分析 → ② 改写 → ③ 润色                       │  步骤指示器
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┬──────────────────┐                │
│  │ 原文              │ 改写后            │                │
│  │                  │                  │                │
│  │ 少年猛地睁开眼睛  │ 黑暗中，少年骤然  │                │
│  │ 看着陌生的环境    │ 睁开双眼，眼前是  │                │
│  │ ...              │ 一片全然陌生的... │                │
│  │                  │                  │                │
│  └──────────────────┴──────────────────┘                │
│                                                          │
│  风格分析：                                               │
│  句子均长：12 字  |  对话占比：30%  |  描写密度：中        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [重新改写] [对比润色版]            [采用改写版]          │
└──────────────────────────────────────────────────────────┘
```

#### 6.6.3 组件树

```
StyleRewritePanel
└── Dialog open size="xl" title="改写润色"
    ├── StepIndicator steps=["风格分析", "改写", "润色"] current={currentStep}
    ├── div.flex.gap-3.mt-4
    │   ├── div.flex-1
    │   │   ├── div.flex.items-center.gap-2.mb-2
    │   │   │   ├── span.text-xs.font-medium.text-text-secondary  "原文"
    │   │   │   └── Badge variant=default  "{originalWordCount} 字"
    │   │   └── div.border.border-border.rounded-lg.p-3.bg-bg-secondary.max-h-80.overflow-y-auto
    │   │       └── p.text-sm.text-text-primary.leading-relaxed.whitespace-pre-wrap  {originalText}
    │   └── div.flex-1
    │       ├── div.flex.items-center.gap-2.mb-2
    │       │   ├── span.text-xs.font-medium.text-text-secondary  "改写后"
    │       │   ├── Badge variant=accent  "{rewrittenWordCount} 字"
    │       │   └── Badge variant=success  "+{delta} 字"
    │       └── div.border.border-accent.rounded-lg.p-3.bg-accent/5.max-h-80.overflow-y-auto
    │           └── p.text-sm.text-text-primary.leading-relaxed.whitespace-pre-wrap  {rewrittenText}
    ├── div.mt-4.border.border-border.rounded-lg.p-3.bg-bg-secondary  (风格分析区)
    │   ├── div.text-xs.font-medium.text-text-secondary.mb-2  "风格分析"
    │   └── div.grid.grid-cols-3.gap-3.text-xs
    │       ├── div  "句子均长：{avgSentLength} 字"
    │       ├── div  "对话占比：{dialogRatio}%"
    │       └── div  "描写密度：{descriptionDensity}"
    └── footer
        ├── Button variant=ghost size=md icon=RotateCcw  "重新改写"
        ├── Button variant=secondary size=md             "对比润色版"
        └── Button variant=primary size=md icon=Check    "采用改写版"
```

#### 6.6.4 StepIndicator

```
div.flex.items-center.justify-center.gap-2
└── steps.map((step, i) => (
    <Fragment>
        div.flex.items-center.gap-1.5
        ├── div.w-6.h-6.rounded-full.flex.items-center.justify-center.text-xs
        │       className={i < current ? 'bg-success text-text-inverse'
        │                    : i === current ? 'bg-accent text-text-inverse animate-pulse'
        │                    : 'bg-bg-tertiary text-text-tertiary'}
        │   └── i < current ? Check size=12 : span  {i+1}
        └── span.text-xs.text-text-secondary  {step}
    {i < steps.length - 1 && (
        div.flex-1.h-0.5.min-w-8
            className={i < current ? 'bg-success' : 'bg-border'}
    )}
    </Fragment>
)
```

#### 6.6.5 三步流程

| 步骤     | 节点              | 显示                                                |
| -------- | ----------------- | --------------------------------------------------- |
| 风格分析 | style_analyzer    | 右侧改写区为空，仅显示风格分析结果                  |
| 改写     | style_rewriter    | 右侧显示改写版本，"采用"按钮可用                    |
| 润色     | style_polisher    | 切换为三栏：原文 / 改写版 / 润色版，可对比          |

### 6.7 AgentMemoryViewer（记忆查看器，P2 预留）

P2 阶段的 memory_keeper 跨任务记忆查看器，P0 仅预留 UI 占位。

#### 6.7.1 占位形态

```
EmptyState
├── icon = Database size=48
├── title = "记忆库查看器（P2 上线）"
├── description = "memory_keeper 将在 P2 阶段提供跨任务长期记忆"
└── (无 action)
```

---

## 7. 交互细节

### 7.1 @ 提及（技能）

#### 7.1.1 触发

在 ChatInput 中输入 `@` 字符，触发技能提及下拉。

#### 7.1.2 下拉结构

```
div.absolute.bottom-full.left-3.right-3.mb-2.bg-bg-primary.border.border-border.rounded-xl.shadow-lg.overflow-hidden.z-10
└── filteredSkills.map(skill => (
    button.w-full.text-left.px-3.py-2.hover:bg-bg-hover.transition-colors.flex.items-center.gap-2
    ├── Sparkles size=12 text-accent
    └── div.flex-1
        ├── div.text-sm.font-medium.text-text-primary  {skill.name}
        └── div.text-xs.text-text-tertiary.mt-0.5  {skill.description}
    )
```

#### 7.1.3 过滤规则

- 输入 `@xxx` 后，`xxx` 作为过滤词匹配技能 name（不区分大小写）
- 无匹配项时下拉不显示
- 最多显示 8 条

#### 7.1.4 选中行为

- 替换 `@xxx` 为 `@技能名 `（结尾带空格）
- 调用 `toggleSkill(skillId)` 激活技能
- 焦点回到 textarea
- 已激活技能显示为标签：`bg-accent/10 text-accent rounded-full text-xs`

### 7.2 斜杠命令（工具）

#### 7.2.1 触发

在 ChatInput 中输入 `/` 字符，触发斜杠命令下拉。优先级高于 @。

#### 7.2.2 可用工具列表（P0）

| 工具名                  | 描述         | 分类   |
| ----------------------- | ------------ | ------ |
| `query_outline`         | 查询章节大纲 | 章节   |
| `query_chapter`         | 查询章节内容 | 章节   |
| `create_chapter`        | 创建新章节   | 章节   |
| `update_chapter`        | 更新章节内容 | 章节   |
| `delete_chapter`        | 删除章节     | 章节   |
| `query_setting_cards`   | 查询设定卡   | 设定卡 |
| `create_setting_card`   | 创建设定卡   | 设定卡 |
| `update_setting_card`   | 更新设定卡   | 设定卡 |
| `delete_setting_card`   | 删除设定卡   | 设定卡 |
| `query_conversations`   | 查询对话历史 | 对话   |
| `list_skills`           | 列出技能     | 技能   |
| `use_skill`             | 使用技能     | 技能   |

#### 7.2.3 下拉结构

```
div.absolute.bottom-full.left-3.right-3.mb-2.bg-bg-primary.border.border-border.rounded-xl.shadow-lg.overflow-hidden.z-10.max-h-64.overflow-y-auto
└── filteredTools.map(tool => (
    button.w-full.text-left.px-3.py-2.hover:bg-bg-hover.transition-colors.flex.items-center.gap-2
    ├── Wrench size=12 text-text-tertiary
    ├── div.flex-1
    │   ├── div.text-sm.font-medium  {tool.name}
    │   └── div.text-xs.text-text-tertiary.mt-0.5  {tool.desc}
    └── span.text-xs.text-text-tertiary  {tool.category}
    )
```

#### 7.2.4 过滤规则

- `xxx` 同时匹配工具 name 与 desc
- 选中后 `activeTool` 状态记录工具名
- 发送消息时，将 `activeTool` 作为消息的 tool 参数附加

### 7.3 右键菜单（编辑器）

#### 7.3.1 触发条件

仅在 WritingEditor 的 textarea 中，且 `selectionStart !== selectionEnd`（有选中文本）时阻止默认菜单，显示自定义菜单。否则放行浏览器默认菜单。

#### 7.3.2 菜单项

| 项       | operation | 行为                                       |
| -------- | --------- | ------------------------------------------ |
| 语法校正 | `grammar` | 调用 LLM 对选中文本进行语法校正            |
| 语气调整 | `tone`    | 调用 LLM 调整选中文本语气                  |
| 扩写     | `expand`  | 调用 LLM 扩写选中文本                      |
| 缩写     | `shrink`  | 调用 LLM 缩写选中文本                      |

#### 7.3.3 菜单样式

```
div.absolute.bg-bg-primary.border.border-border.rounded-lg.shadow-lg.py-1.z-50
└── items.map(item => (
    button.w-full.text-left.px-4.py-2.text-sm.text-text-primary.hover:bg-bg-hover.transition-colors
    {item.label}
    )
```

#### 7.3.4 行为

- 点击菜单项后，菜单消失
- 显示 Toast.info "正在{操作}..."
- LLM 返回结果后，弹出 StyleRewritePanel 进行对比

### 7.4 拖拽排序

#### 7.4.1 可拖拽区域

| 区域            | 拖拽项  | 触发阶段               |
| --------------- | ------- | ---------------------- |
| Sidebar 大纲树  | 章节    | writing / editing      |
| Sidebar 设定卡  | 设定卡  | 全阶段                 |

#### 7.4.2 视觉反馈

| 状态           | 样式                                                       |
| -------------- | ---------------------------------------------------------- |
| 拖拽中（源）   | `opacity-50`                                               |
| 拖拽悬停（目标）| `border-2 border-dashed border-accent bg-accent/5`        |
| 拖拽放置中     | `bg-accent/10`                                             |

#### 7.4.3 拖拽手柄

- 仅在 hover 时显示，`opacity-0 group-hover:opacity-100 transition-opacity`
- 图标 GripVertical size=10

### 7.5 键盘快捷键

#### 7.5.1 全局快捷键

| 快捷键             | 操作                       | 适用区域          |
| ------------------ | -------------------------- | ----------------- |
| `Ctrl+1`           | 切换到构思阶段             | 全局              |
| `Ctrl+2`           | 切换到计划阶段             | 全局              |
| `Ctrl+3`           | 切换到写作阶段             | 全局              |
| `Ctrl+4`           | 切换到修改阶段             | 全局              |
| `F11`              | 进入/退出专注模式          | 全局              |
| `Esc`              | 退出专注模式 / 关闭对话框  | 全局              |
| `Ctrl+,`           | 打开设置面板               | 全局              |
| `Ctrl+Shift+N`     | 新建项目                   | 全局              |
| `Ctrl+N`           | 新建对话/章节（按阶段）    | 全局              |

#### 7.5.2 聊天区快捷键

| 快捷键             | 操作                       |
| ------------------ | -------------------------- |
| `Enter`            | 发送消息                   |
| `Shift+Enter`      | 换行                       |
| `@`                | 触发技能提及               |
| `/`                | 触发斜杠命令               |

#### 7.5.3 编辑器快捷键

| 快捷键             | 操作                       |
| ------------------ | -------------------------- |
| `Ctrl+S`           | 手动保存（触发 saving 状态）|
| `Ctrl+Z`           | 撤销                       |
| `Ctrl+Y`           | 重做                       |
| `Ctrl+Shift+C`     | 续写                       |

#### 7.5.4 消息编辑快捷键

| 快捷键             | 操作                       |
| ------------------ | -------------------------- |
| `Ctrl+Enter`       | 保存编辑                   |
| `Esc`              | 取消编辑                   |

### 7.6 复制与编辑

#### 7.6.1 消息复制

- hover 消息气泡显示"复制"按钮
- 点击后调用 `navigator.clipboard.writeText`
- 成功后按钮变为"已复制" + Check 图标，1.5 秒后恢复
- 失败静默处理（剪贴板不可用时）

#### 7.6.2 消息编辑

- 仅用户消息可编辑（`onEdit` prop 存在）
- 编辑模式：textarea 自适应高度，原文本预填
- 保存：trim 后非空且与原内容不同才触发 `onEdit` 回调
- 取消：恢复原内容，退出编辑模式

---

## 8. 状态机

### 8.1 任务状态机（Pipeline）

```
       start_pipeline
            │
            ▼
       ┌─────────┐
       │ running │ ◄──── resume_from_checkpoint
       └─────────┘
        │  │  │
   success │  │ failed
        │  │  └──────► aborted
        │  │
        │  ▼
        │  checkpoint
        │  │
        │  ├─ Continue ──► running
        │  ├─ Skip ──────► running (跳过下游)
        │  └─ Abort ─────► aborted
        ▼
       ┌─────────┐
       │ success │
       └─────────┘
```

| 状态        | 触发                                  | UI 反馈                              |
| ----------- | ------------------------------------- | ------------------------------------ |
| running     | start_pipeline 成功                   | AgentWorkspace 显示，节点 running    |
| checkpoint  | 节点状态变为 checkpoint               | 弹出 CheckpointDialog                |
| success     | 所有节点完成                          | Toast.success，切回 ChatView，结果作为 AI 消息追加 |
| failed      | 任一节点失败且无 retry                | Toast.error，AgentWorkspace 显示失败节点详情 |
| aborted     | 用户中止或检查点 Abort                | Toast.warning"任务已中止"            |

### 8.2 保存状态机

```
       内容变化
         │
         ▼
     unsaved ◄────── 内容变化
         │
         │ (防抖 1500ms)
         ▼
     saving
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  saved    unsaved (保存失败)
    │
    │ (1.5s)
    ▼
  idle
```

| 状态    | StatusBar 显示              | 触发                              |
| ------- | --------------------------- | --------------------------------- |
| idle    | 无显示                      | 初始状态、saved 1.5 秒后          |
| unsaved | CloudOff + "未保存"         | 内容变化未触发保存                |
| saving  | Loader2 spin + "保存中..."  | 防抖后调用 update_chapter         |
| saved   | Check + "已保存"            | 保存成功                          |

### 8.3 生成状态机（流式）

```
       sendMessage
         │
         ▼
     generating
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  done     aborted
    │         │
    ▼         ▼
  idle     idle
```

| 状态        | UI 反馈                                                  |
| ----------- | -------------------------------------------------------- |
| idle        | 发送按钮显示 Send 图标                                   |
| generating  | 发送按钮显示 Square 图标（停止），消息体 animate-pulse   |
| done        | 流式光标消失，按钮恢复 Send                              |
| aborted     | 消息保留已生成部分，按钮恢复 Send，Toast.info"已停止"    |

**事件监听**：`chat:chunk` 事件，`done: true` 字段标记完成。

### 8.4 检查点状态机

```
    pipeline:checkpoint 事件
            │
            ▼
       waiting
            │
   ┌────────┼────────┐
   │        │        │
   ▼        ▼        ▼
continue  skip     abort
   │        │        │
   ▼        ▼        ▼
 running  running  aborted
```

| 状态     | UI 反馈                                                  |
| -------- | -------------------------------------------------------- |
| waiting  | CheckpointDialog 显示，PipelineVisualizer 节点 checkpoint 态 |
| continue | Dialog 关闭，节点状态切回 running                        |
| skip     | Dialog 关闭，节点状态切为 skipped，下游继续               |
| abort    | Dialog 关闭，整个 Pipeline 进入 aborted                  |

### 8.5 阶段切换状态机

```
       用户点击阶段标签 / 快捷键
                │
                ▼
          phaseChanging
                │
    ┌───────────┴───────────┐
    │                       │
    ▼                       ▼
  有生成中任务            无生成中任务
    │                       │
    │ Toast.warning         │ 直接切换
    │ "任务进行中..."       │
    │                       │
    └───────────┬───────────┘
                │
                ▼
            phaseChanged
```

| 状态          | UI 反馈                                                  |
| ------------- | -------------------------------------------------------- |
| idle          | 阶段标签可点击                                           |
| phaseChanging | 阶段标签瞬时禁用（50ms 防抖）                            |
| phaseChanged  | 中间区域、DynamicPanel、Sidebar 底部按钮同步切换         |

---

## 9. 暗色模式适配

### 9.1 切换机制

- 通过 `class="dark"` 在 `<html>` 元素上切换
- 持久化到 `uiStore.theme`，应用启动时恢复
- 切换按钮位于 TopBar 右侧（Moon/Sun 图标）

### 9.2 适配规则

#### 9.2.1 CSS 变量自动切换

所有颜色 token 通过 CSS 变量定义，`.dark` 选择器下覆盖值，Tailwind 工具类（如 `bg-bg-primary`）自动应用对应主题色。**禁止**在组件中硬编码颜色值。

#### 9.2.2 阴影加深

深色模式下阴影值通过 CSS 变量调整，alpha 通道加深（详见 2.6 节）。

#### 9.2.3 边框可见性

深色模式下边框颜色 `--color-border: #2a2a40`，确保在深背景上仍清晰可辨。

#### 9.2.4 图片与图标

- 图标使用 `currentColor`，自动跟随文本色
- 用户头像、AI 头像背景在两套主题中保持 accent / bg-tertiary 的语义色

#### 9.2.5 Markdown 渲染

- 代码块：浅色 `bg-bg-secondary`，深色自动同色（CSS 变量）
- 引用块边框：`border-accent/30`
- 表格边框：`border-border`

### 9.3 适配检查清单

每个新组件上线前，需在两套主题下验证：

- [ ] 文本对比度 ≥ 4.5:1（WCAG AA）
- [ ] 边框在深色背景可见
- [ ] hover/active 态有视觉差异
- [ ] 阴影在深色下仍可见
- [ ] 禁用态可识别（opacity-50）
- [ ] 图标颜色继承正确

---

## 10. 无障碍设计

### 10.1 键盘导航

#### 10.1.1 焦点顺序

按视觉顺序从左到右、从上到下：

1. TopBar 项目选择器
2. TopBar 阶段标签
3. TopBar 操作按钮（主题、专注、设置）
4. Sidebar 内容
5. 中间区域
6. DynamicPanel
7. StatusBar

#### 10.1.2 焦点样式

```
outline: 2px solid var(--color-accent);
outline-offset: 2px;
```

- 仅 `:focus-visible` 显示（鼠标点击不显示，键盘 Tab 显示）
- 输入框使用 `focus:ring-2 focus:ring-accent` 替代 outline

### 10.2 ARIA 标签

#### 10.2.1 图标按钮

所有 IconButton 必须有 `aria-label`，由 `label` prop 强制提供：

```html
<button aria-label="关闭">
  <X />
</button>
```

#### 10.2.2 对话框

```html
<dialog aria-labelledby="dialog-title">
  <h2 id="dialog-title">标题</h2>
</dialog>
```

#### 10.2.3 Toast

```html
<div role="alert" aria-live="polite">
  {message}
</div>
```

#### 10.2.4 加载状态

```html
<button aria-busy="true" disabled>
  <Loader2 class="animate-spin" />
</button>
```

### 10.3 对比度

所有文本与背景组合需满足 WCAG AA 标准：

| 组合                          | 浅色对比度 | 深色对比度 | 标准       |
| ----------------------------- | ---------- | ---------- | ---------- |
| text-primary / bg-primary     | 16.1:1     | 17.5:1     | ≥ 4.5:1 ✓  |
| text-secondary / bg-primary   | 7.2:1      | 8.4:1      | ≥ 4.5:1 ✓  |
| text-tertiary / bg-primary    | 3.8:1      | 4.2:1      | ≥ 3:1 ✓（大文本）|
| text-inverse / accent         | 4.8:1      | 4.6:1      | ≥ 4.5:1 ✓  |

> `text-tertiary` 仅用于辅助提示、占位符等非关键文本，且字号 ≥ 12px。

### 10.4 动画与可访问性

#### 10.4.1 减少动画偏好

响应系统 `prefers-reduced-motion: reduce`：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### 10.4.2 必要动画保留

`animate-pulse`（流式生成指示）是状态反馈的核心，不受 reduced-motion 影响。

### 10.5 屏幕阅读器

#### 10.5.1 动态内容

- 新消息入场：`aria-live="polite"` 通知
- Toast：`role="alert"` 即时通知
- Pipeline 状态变化：`aria-live="polite"` 通知节点状态

#### 10.5.2 隐藏内容

- 装饰性图标：`aria-hidden="true"`
- 折叠区域：`aria-expanded` 状态
- 加载中内容：`aria-busy="true"`

---

## 11. 附录

### 11.1 组件清单

#### 11.1.1 通用组件（common/）

| 组件          | 文件                              | 状态     |
| ------------- | --------------------------------- | -------- |
| Button        | [Button.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Button.tsx) | 已实现   |
| IconButton    | (Button 变体)                     | 已实现   |
| Dialog        | [Dialog.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Dialog.tsx) | 已实现   |
| ConfirmDialog | [Dialog.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Dialog.tsx) | 已实现   |
| Toast         | [Toast.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/common/Toast.tsx) | 已实现   |
| Input         | (待抽象)                          | 待实现   |
| Textarea      | (待抽象)                          | 待实现   |
| Tooltip       | (待实现)                          | 待实现   |
| Tabs          | (待抽象自 DynamicPanel)           | 待实现   |
| Select        | (待抽象自 TopBar)                 | 待实现   |
| Badge         | (待实现)                          | 待实现   |
| EmptyState    | (待抽象自 ChatView)               | 待实现   |

#### 11.1.2 布局组件（layout/）

| 组件          | 文件                              | 状态     |
| ------------- | --------------------------------- | -------- |
| MainLayout    | [MainLayout.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/MainLayout.tsx) | 已实现   |
| TopBar        | [TopBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/TopBar.tsx) | 已实现   |
| Sidebar       | [Sidebar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/Sidebar.tsx) | 已实现   |
| StatusBar     | [StatusBar.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/layout/StatusBar.tsx) | 已实现   |
| ProjectInitScreen | (待抽象)                      | 待实现   |

#### 11.1.3 聊天组件（chat/）

| 组件          | 文件                              | 状态     |
| ------------- | --------------------------------- | -------- |
| ChatView      | [ChatView.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/chat/ChatView.tsx) | 已实现   |
| ChatInput     | [ChatInput.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/chat/ChatInput.tsx) | 已实现   |
| MessageBubble | [MessageBubble.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/chat/MessageBubble.tsx) | 已实现   |

#### 11.1.4 面板组件（panel/）

| 组件          | 文件                              | 状态     |
| ------------- | --------------------------------- | -------- |
| DynamicPanel  | [DynamicPanel.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/panel/DynamicPanel.tsx) | 已实现   |
| IdeationPanel | (内联于 DynamicPanel)             | 已实现   |
| PlanningPanel | (内联于 DynamicPanel)             | 已实现   |
| WritingPanel  | (内联于 DynamicPanel)             | 已实现   |
| EditingPanel  | (内联于 DynamicPanel)             | 已实现   |
| OperationsPanel | (内联于 DynamicPanel)           | 已实现   |

#### 11.1.5 编辑器组件（editor/）

| 组件          | 文件                              | 状态     |
| ------------- | --------------------------------- | -------- |
| WritingEditor | [WritingEditor.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/editor/WritingEditor.tsx) | 已实现   |
| EditorToolbar | (内联)                            | 已实现   |

#### 11.1.6 设定卡组件（settings/）

| 组件              | 文件                              | 状态     |
| ----------------- | --------------------------------- | -------- |
| SettingCardEditor | [SettingCardEditor.tsx](file:///c:/Users/admin/Desktop/Whisper/src/components/settings/SettingCardEditor.tsx) | 已实现   |
| SettingCardList   | (内联于 Sidebar)                  | 已实现   |

#### 11.1.7 Agent 系统组件（agent/，新增）

| 组件                  | 文件（计划）                              | 状态     |
| --------------------- | ----------------------------------------- | -------- |
| AgentWorkspace        | src/components/agent/AgentWorkspace.tsx   | 待实现   |
| PipelineVisualizer    | src/components/agent/PipelineVisualizer.tsx | 待实现 |
| AgentTaskPanel        | src/components/agent/AgentTaskPanel.tsx   | 待实现   |
| CheckpointDialog      | src/components/agent/CheckpointDialog.tsx | 待实现   |
| InspirationMatrixView | src/components/agent/InspirationMatrixView.tsx | 待实现 |
| StyleRewritePanel     | src/components/agent/StyleRewritePanel.tsx | 待实现 |
| AgentMemoryViewer     | src/components/agent/AgentMemoryViewer.tsx | P2 预留 |

### 11.2 Zustand Store 清单

| Store            | 文件                              | 职责                              |
| ---------------- | --------------------------------- | --------------------------------- |
| projectStore     | [projectStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/projectStore.ts) | 项目、章节、对话的 CRUD 与当前选中 |
| chatStore        | [chatStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/chatStore.ts) | 消息列表、流式生成、技能管理      |
| uiStore          | [uiStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/uiStore.ts) | 阶段、主题、面板折叠、专注模式    |
| settingsStore    | [settingsStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/settingsStore.ts) | 设定卡列表与当前编辑卡            |
| apiConfigStore   | [apiConfigStore.ts](file:///c:/Users/admin/Desktop/Whisper/src/stores/apiConfigStore.ts) | API 配置（provider/key/url/model）|

### 11.3 Tauri 事件协议

#### 11.3.1 P0 事件

| 事件名                 | 方向       | Payload                                  | 用途                              |
| ---------------------- | ---------- | ---------------------------------------- | --------------------------------- |
| `chat:chunk`           | Rust→前端  | `{ message_id, content, done }`          | 流式生成内容推送                  |
| `pipeline:status`      | Rust→前端  | `{ task_id, node_id, status, output? }`  | Pipeline 节点状态变化             |
| `pipeline:checkpoint`  | Rust→前端  | `{ task_id, node_id, prompt, options }`  | 检查点等待用户决策                |
| `pipeline:completed`   | Rust→前端  | `{ task_id, success, result, error? }`   | Pipeline 完成或失败               |
| `pipeline:log`         | Rust→前端  | `{ task_id, node_id, level, message, ts }` | 节点日志推送                     |

#### 11.3.2 事件监听生命周期

- **组件 mount 时**：`listen('chat:chunk', handler)` 返回 cleanup 函数
- **组件 unmount 时**：调用 cleanup 取消监听，避免重复监听
- **React StrictMode 已禁用**：避免开发模式双 mount 导致重复监听

### 11.4 Tauri 命令清单（P0 UI 相关）

| 命令                  | 参数                              | 返回                | 用途                              |
| --------------------- | --------------------------------- | ------------------- | --------------------------------- |
| `create_project`      | `name, genre`                     | `project_id`        | 新建项目                          |
| `list_projects`       | -                                 | `Project[]`         | 项目列表                          |
| `list_conversations`  | `project_id`                      | `Conversation[]`    | 对话历史                          |
| `create_conversation` | `project_id`                      | `conversation_id`   | 新建对话                          |
| `send_message`        | `conversation_id, content, skill_ids?` | `message_id`   | 发送消息（触发流式生成）          |
| `abort_generation`    | `conversation_id`                 | -                   | 中止生成                          |
| `start_pipeline`      | `workflow_id, project_id, conversation_id, input` | `task_id` | 启动 Pipeline                     |
| `checkpoint_decide`   | `task_id, node_id, decision, payload` | -              | 检查点决策                        |
| `list_chapters`       | `project_id`                      | `Chapter[]`         | 章节列表                          |
| `create_chapter`      | `project_id, title`               | `chapter_id`        | 新建章节                          |
| `update_chapter`      | `chapter_id, title?, content?`    | -                   | 更新章节                          |
| `delete_chapter`      | `chapter_id`                      | -                   | 删除章节                          |
| `query_setting_cards` | `project_id, card_type?`          | `SettingCard[]`     | 查询设定卡                        |
| `create_setting_card` | `project_id, name, card_type, content` | `card_id`       | 创建设定卡                        |
| `update_setting_card` | `card_id, name?, content?`        | -                   | 更新设定卡                        |
| `delete_setting_card` | `card_id`                         | -                   | 删除设定卡                        |

### 11.5 设计系统变更影响范围

设计 token 的调整需同步以下文件：

| Token 类别   | 配置文件                                  | 影响                                    |
| ------------ | ----------------------------------------- | --------------------------------------- |
| 颜色         | [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js), [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css) | 所有组件颜色                           |
| 字体         | [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) | 全项目字体                             |
| 间距         | [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) | sidebar/panel 等固定尺寸               |
| 圆角         | [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js) | 全项目圆角                             |
| 阴影         | [tailwind.config.js](file:///c:/Users/admin/Desktop/Whisper/tailwind.config.js), [src/index.css](file:///c:/Users/admin/Desktop/Whisper/src/index.css) | 浮层、对话框                           |
| 动画         | [src/App.css](file:///c:/Users/admin/Desktop/Whisper/src/App.css) | 过渡、入场动画                         |

### 11.6 P1-P3 UI 预留接口

#### 11.6.1 P1 预留

| 组件              | 用途                              | 触发阶段 |
| ----------------- | --------------------------------- | -------- |
| OutlineTree 三级扩展 | 卷/章/场景三级树形               | P1       |
| ForeshadowManager | 伏笔管理面板                      | P1       |
| LoopNodeIndicator | 循环节点指示器（Pipeline 中）     | P1       |

#### 11.6.2 P2 预留

| 组件              | 用途                              | 触发阶段 |
| ----------------- | --------------------------------- | -------- |
| ConsistencyReport | 一致性检查报告                    | P2       |
| AgentMemoryViewer | 跨任务记忆查看器（6.7 节占位）     | P2       |

#### 11.6.3 P3 预留

| 组件              | 用途                              | 触发阶段 |
| ----------------- | --------------------------------- | -------- |
| CustomAgentCRUD   | 自定义 Agent 创建/编辑/删除        | P3       |
| ParallelMonitor   | 并行任务监控面板                   | P3       |
| CostDashboard     | 成本预警仪表盘                    | P3       |

### 11.7 评审记录

| 评审轮次 | 日期       | 评审人   | 结论   | 备注                  |
| -------- | ---------- | -------- | ------ | --------------------- |
| R1       | 2026-07-07 | 待评审   | 待定   | 初版提交评审          |

---

**文档结束**


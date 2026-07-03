/** TypeScript 类型定义 */

/** 写作阶段 */
export type WritingPhase = 'ideation' | 'planning' | 'writing' | 'editing';

/** 设定卡类型 */
export type CardType = 'character' | 'faction' | 'world' | 'item' | 'skill_system' | 'event';

/** 项目 */
export interface Project {
  id: string;
  name: string;
  description: string;
  genre: string;
  created_at: string;
  updated_at: string;
}

/** 章节 */
export interface Chapter {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  content: string;
  sort_order: number;
  status: 'draft' | 'completed' | 'revising';
  word_count: number;
  created_at: string;
  updated_at: string;
}

/** 设定卡 */
export interface SettingCard {
  id: string;
  project_id: string;
  card_type: CardType;
  name: string;
  fields: Record<string, string>;
  created_at: string;
  updated_at: string;
}

/** 设定卡版本 */
export interface SettingCardVersion {
  id: string;
  card_id: string;
  fields: Record<string, string>;
  created_at: string;
}

/** 对话会话 */
export interface Conversation {
  id: string;
  project_id: string | null;
  title: string;
  phase: WritingPhase;
  skill_ids: string[];
  context_chapter_id: string | null;
  /** 该对话累计消耗的总 token 数 */
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

/** 消息 */
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string;
  /** 该消息对应的 prompt token 数（仅 role=assistant 的最终回复消息有值） */
  prompt_tokens?: number;
  /** 该消息生成的 completion token 数 */
  completion_tokens?: number;
  /** 该消息对应的总 token 数 */
  total_tokens?: number;
  created_at: string;
  /** 助手消息携带的工具调用（JSON 字符串），仅 role=assistant 且触发了工具调用时有值 */
  tool_calls?: string;
  /** 工具结果消息关联的工具调用 ID，仅 role=tool 时有值（前端一般不展示 tool 消息） */
  tool_call_id?: string;
}

/** 技能 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  trigger_scenarios: string[];
  is_builtin: boolean;
  created_at: string;
}

/** API 配置 */
export interface ApiConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model_thinking: string;
  model_writing: string;
  is_default: boolean;
}

/** 设定卡字段模板映射 */
export const CARD_TYPE_TEMPLATES: Record<CardType, { label: string; fields: { key: string; label: string }[] }> = {
  character: {
    label: '人物',
    fields: [
      { key: 'name', label: '姓名' },
      { key: 'age', label: '年龄' },
      { key: 'gender', label: '性别' },
      { key: 'personality', label: '性格' },
      { key: 'appearance', label: '外貌' },
      { key: 'background', label: '背景故事' },
      { key: 'faction', label: '所属势力' },
      { key: 'goal', label: '目标' },
    ],
  },
  faction: {
    label: '势力',
    fields: [
      { key: 'name', label: '名称' },
      { key: 'type', label: '类型' },
      { key: 'leader', label: '首领' },
      { key: 'members', label: '成员' },
      { key: 'territory', label: '领地' },
      { key: 'purpose', label: '宗旨' },
    ],
  },
  world: {
    label: '世界/地点',
    fields: [
      { key: 'name', label: '名称' },
      { key: 'type', label: '类型' },
      { key: 'geography', label: '地理描述' },
      { key: 'history', label: '历史' },
      { key: 'culture', label: '文化特征' },
    ],
  },
  item: {
    label: '物品',
    fields: [
      { key: 'name', label: '名称' },
      { key: 'type', label: '类型' },
      { key: 'appearance', label: '外观' },
      { key: 'function', label: '功能' },
      { key: 'origin', label: '来历' },
    ],
  },
  skill_system: {
    label: '技能/魔法体系',
    fields: [
      { key: 'name', label: '名称' },
      { key: 'type', label: '类型' },
      { key: 'levels', label: '等级划分' },
      { key: 'practice', label: '修炼方式' },
      { key: 'restrictions', label: '限制' },
    ],
  },
  event: {
    label: '历史事件',
    fields: [
      { key: 'name', label: '名称' },
      { key: 'time', label: '时间' },
      { key: 'participants', label: '参与者' },
      { key: 'process', label: '经过' },
      { key: 'impact', label: '影响' },
    ],
  },
};

/** 阶段标签映射 */
export const PHASE_LABELS: Record<WritingPhase, string> = {
  ideation: '构思',
  planning: '计划',
  writing: '写作',
  editing: '修改',
};

/** 设定卡类型标签映射 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  character: '人物',
  faction: '势力',
  world: '世界/地点',
  item: '物品',
  skill_system: '技能/魔法体系',
  event: '历史事件',
};

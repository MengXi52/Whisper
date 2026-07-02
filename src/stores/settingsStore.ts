/** 设定卡状态管理 */
import { create } from 'zustand';
import type { SettingCard, SettingCardVersion } from '@/types';
import * as tauri from '@/utils/tauri';

/** 将嵌套 JSON 展平为字符串键值对（编辑器需要的是 Record<string, string>） */
function flattenFields(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  // 中文/自然语言键名 → 模板键名映射
  // 当 LLM 生成嵌套中文键名时，尝试映射到编辑器模板字段
  const keyMap: Record<string, string> = {
    '全名': 'name',
    '姓名': 'name',
    '名称': 'name',
    '年龄': 'age',
    '性别': 'gender',
    '核心性格': 'personality',
    '性格': 'personality',
    '性格特点': 'personality',
    '外貌': 'appearance',
    '外貌特征': 'appearance',
    '发型': 'appearance',
    '服装风格': 'appearance',
    '背景故事': 'background',
    '背景': 'background',
    '身世之谜': 'background',
    '童年经历': 'background',
    '所属': 'faction',
    '所属势力': 'faction',
    '目标': 'goal',
  };

  /** 检查并映射键名，如果有映射关系则填充到 result */
  function mapKey(sourceKey: string, value: string) {
    if (keyMap[sourceKey]) {
      result[keyMap[sourceKey]] = value;
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      result[key] = value;
      mapKey(key, value);
    } else if (typeof value === 'object' && value !== null) {
      // 嵌套对象：提取子键的字符串值到顶层
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        if (typeof nestedValue === 'string') {
          result[nestedKey] = nestedValue;
          mapKey(nestedKey, nestedValue);
        }
      }
      // 同时也保留格式化的 JSON 字符串，避免渲染为 [object Object]
      result[key] = JSON.stringify(value, null, 2);
    } else {
      result[key] = JSON.stringify(value, null, 2);
    }
  }
  return result;
}

interface SettingsState {
  /** 设定卡列表 */
  settingCards: SettingCard[];
  /** 当前编辑的设定卡 */
  currentCard: SettingCard | null;
  /** 版本历史列表 */
  versions: SettingCardVersion[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 加载设定卡列表 */
  loadSettingCards: (projectId: string) => Promise<void>;
  /** 选择设定卡进行编辑 */
  selectCard: (card: SettingCard | null) => void;
  /** 创建设定卡 */
  createSettingCard: (projectId: string, cardType: string, name: string, fields: string) => Promise<void>;
  /** 更新设定卡 */
  updateSettingCard: (id: string, name?: string, fields?: string, cardType?: string) => Promise<void>;
  /** 删除设定卡 */
  deleteSettingCard: (id: string) => Promise<void>;
  /** 加载版本历史 */
  loadVersions: (cardId: string) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settingCards: [],
  currentCard: null,
  versions: [],
  loading: false,
  error: null,

  loadSettingCards: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const rawCards = await tauri.getSettingCards(projectId);
      // 将 fields JSON 字符串解析并展平
      const settingCards = rawCards.map((card) => ({
        ...card,
        fields: typeof card.fields === 'string'
          ? flattenFields(JSON.parse(card.fields))
          : flattenFields(card.fields as Record<string, unknown>),
      }));
      set({ settingCards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectCard: (card) => {
    set({ currentCard: card, versions: [] });
    if (card) {
      get().loadVersions(card.id);
    }
  },

  createSettingCard: async (projectId, cardType, name, fields) => {
    set({ loading: true, error: null });
    try {
      const id = await tauri.createSettingCard(projectId, cardType, name, fields);
      /* 重新加载设定卡列表 */
      await get().loadSettingCards(projectId);
      /* 选中新创建的设定卡 */
      const newCard = get().settingCards.find((c) => c.id === id);
      if (newCard) {
        set({ currentCard: newCard, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSettingCard: async (id, name, fields, cardType) => {
    try {
      await tauri.updateSettingCard(id, name, fields, cardType);
      /* 重新加载当前项目的设定卡列表 */
      const projectId = get().settingCards.find((c) => c.id === id)?.project_id;
      if (projectId) {
        await get().loadSettingCards(projectId);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteSettingCard: async (id) => {
    try {
      await tauri.deleteSettingCard(id);
      set((state) => ({
        settingCards: state.settingCards.filter((c) => c.id !== id),
        currentCard: state.currentCard?.id === id ? null : state.currentCard,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadVersions: async (cardId) => {
    try {
      const rawVersions = await tauri.getSettingCardVersions(cardId);
      // 将 fields JSON 字符串解析并展平
      const versions = rawVersions.map((v) => ({
        ...v,
        fields: typeof v.fields === 'string'
          ? flattenFields(JSON.parse(v.fields))
          : flattenFields(v.fields as Record<string, unknown>),
      }));
      set({ versions });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

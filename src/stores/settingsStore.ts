/** 设定卡状态管理 */
import { create } from 'zustand';
import type { SettingCard, SettingCardVersion } from '@/types';
import * as tauri from '@/utils/tauri';

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
      // 将 fields JSON 字符串转为对象
      const settingCards = rawCards.map((card) => ({
        ...card,
        fields: typeof card.fields === 'string' ? JSON.parse(card.fields) : card.fields,
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
      // 将 fields JSON 字符串转为对象
      const versions = rawVersions.map((v) => ({
        ...v,
        fields: typeof v.fields === 'string' ? JSON.parse(v.fields) : v.fields,
      }));
      set({ versions });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

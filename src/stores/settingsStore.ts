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
  createSettingCard: (data: Omit<SettingCard, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  /** 更新设定卡 */
  updateSettingCard: (id: string, data: Partial<SettingCard>) => Promise<void>;
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
      const settingCards = await tauri.getSettingCards(projectId);
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

  createSettingCard: async (data) => {
    set({ loading: true, error: null });
    try {
      const card = await tauri.createSettingCard(data);
      set((state) => ({ settingCards: [...state.settingCards, card], loading: false }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSettingCard: async (id, data) => {
    try {
      const updated = await tauri.updateSettingCard(id, data);
      set((state) => ({
        settingCards: state.settingCards.map((c) => (c.id === id ? updated : c)),
        currentCard: state.currentCard?.id === id ? updated : state.currentCard,
      }));
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
      const versions = await tauri.getSettingCardVersions(cardId);
      set({ versions });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

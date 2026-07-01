/** API 配置状态管理 */
import { create } from 'zustand';
import type { ApiConfig } from '@/types';
import * as tauri from '@/utils/tauri';
import { useUIStore } from '@/stores/uiStore';

interface ApiConfigState {
  /** API 配置列表 */
  apiConfigs: ApiConfig[];
  /** 默认配置 */
  defaultConfig: ApiConfig | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 加载 API 配置列表 */
  loadApiConfigs: () => Promise<void>;
  /** 保存配置 */
  saveConfig: (data: Omit<ApiConfig, 'id'> & { id?: string }) => Promise<void>;
  /** 删除配置 */
  deleteConfig: (id: string) => Promise<void>;
  /** 设置默认配置 */
  setDefaultConfig: (id: string) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
}

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  apiConfigs: [],
  defaultConfig: null,
  loading: false,
  error: null,

  loadApiConfigs: async () => {
    set({ loading: true, error: null });
    try {
      const configs = await tauri.listApiConfigs();
      const defaultConfig = configs.find((c) => c.is_default) || null;
      set({ apiConfigs: configs, defaultConfig, loading: false });
      /* 同步当前模型名到 UI store */
      if (defaultConfig) {
        useUIStore.getState().setCurrentModel(defaultConfig.model_writing);
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveConfig: async (data) => {
    set({ loading: true, error: null });
    try {
      await tauri.saveApiConfig(data);
      await get().loadApiConfigs();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  deleteConfig: async (id) => {
    try {
      await tauri.deleteApiConfig(id);
      await get().loadApiConfigs();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setDefaultConfig: async (id) => {
    try {
      await tauri.setDefaultApiConfig(id);
      await get().loadApiConfigs();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

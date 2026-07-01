/** UI 状态管理 */
import { create } from 'zustand';
import type { WritingPhase } from '@/types';

interface UIState {
  /** 当前写作阶段 */
  phase: WritingPhase;
  /** 左侧栏是否展开 */
  sidebarOpen: boolean;
  /** 右侧面板是否展开 */
  panelOpen: boolean;
  /** 主题：dark 或 light */
  theme: 'dark' | 'light';
  /** 专注模式（全屏写作） */
  focusMode: boolean;
  /** 当前使用的模型名称 */
  currentModel: string;
  /** 当前 Token 数 */
  tokenCount: number;
  /** 保存状态 */
  saveStatus: 'saved' | 'saving' | 'unsaved';

  /** 切换写作阶段 */
  setPhase: (phase: WritingPhase) => void;
  /** 切换侧栏 */
  toggleSidebar: () => void;
  /** 切换右侧面板 */
  togglePanel: () => void;
  /** 切换主题 */
  toggleTheme: () => void;
  /** 切换专注模式 */
  toggleFocusMode: () => void;
  /** 设置当前模型 */
  setCurrentModel: (model: string) => void;
  /** 设置 Token 数 */
  setTokenCount: (count: number) => void;
  /** 设置保存状态 */
  setSaveStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
}

export const useUIStore = create<UIState>((set) => ({
  phase: 'ideation',
  sidebarOpen: true,
  panelOpen: true,
  theme: 'light',
  focusMode: false,
  currentModel: 'deepseek-chat',
  tokenCount: 0,
  saveStatus: 'saved',

  setPhase: (phase) => set({ phase }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      /* 同步更新 body 的 class */
      if (newTheme === 'dark') {
        document.body.classList.add('dark');
      } else {
        document.body.classList.remove('dark');
      }
      return { theme: newTheme };
    }),

  toggleFocusMode: () =>
    set((state) => ({
      focusMode: !state.focusMode,
      sidebarOpen: state.focusMode ? true : false,
      panelOpen: state.focusMode ? true : false,
    })),

  setCurrentModel: (model) => set({ currentModel: model }),
  setTokenCount: (count) => set({ tokenCount: count }),
  setSaveStatus: (status) => set({ saveStatus: status }),
}));

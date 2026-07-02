/** 项目状态管理 */
import { create } from 'zustand';
import type { Project, Chapter } from '@/types';
import * as tauri from '@/utils/tauri';
import { useSettingsStore } from './settingsStore';

interface ProjectState {
  /** 当前项目 */
  currentProject: Project | null;
  /** 项目列表 */
  projects: Project[];
  /** 当前项目的章节列表 */
  chapters: Chapter[];
  /** 当前选中的章节 */
  currentChapter: Chapter | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 加载项目列表 */
  loadProjects: () => Promise<void>;
  /** 选择项目 */
  selectProject: (project: Project) => Promise<void>;
  /** 创建项目 */
  createProject: (name: string, description: string, genre: string) => Promise<void>;
  /** 更新项目 */
  updateProject: (id: string, name?: string, description?: string, genre?: string) => Promise<void>;
  /** 删除项目 */
  deleteProject: (id: string) => Promise<void>;
  /** 加载章节列表 */
  loadChapters: (projectId: string) => Promise<void>;
  /** 选择章节 */
  selectChapter: (chapter: Chapter | null) => void;
  /** 创建章节 */
  createChapter: (projectId: string, parentId: string | null, title: string, sortOrder?: number) => Promise<void>;
  /** 更新章节 */
  updateChapter: (id: string, title?: string, content?: string, status?: string, parentId?: string | null) => Promise<void>;
  /** 删除章节 */
  deleteChapter: (id: string) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  projects: [],
  chapters: [],
  currentChapter: null,
  loading: false,
  error: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await tauri.getProjects();
      /* 如果没有选中项目且有项目存在，自动选中最新的项目 */
      const { currentProject } = get();
      if (!currentProject && projects.length > 0) {
        const latest = projects[0];
        set({ currentProject: latest, projects, loading: false });
        /* 加载该项目的章节和设定卡 */
        await get().loadChapters(latest.id);
        useSettingsStore.getState().loadSettingCards(latest.id);
      } else {
        set({ projects, loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectProject: async (project) => {
    set({ currentProject: project, currentChapter: null });
    await get().loadChapters(project.id);
    // 同时加载该项目的设定卡
    useSettingsStore.getState().loadSettingCards(project.id);
  },

  createProject: async (name, description, genre) => {
    set({ loading: true, error: null });
    try {
      const id = await tauri.createProject(name, description, genre);
      /* 重新加载项目列表 */
      await get().loadProjects();
      /* 选中新创建的项目 */
      const newProject = get().projects.find((p) => p.id === id);
      if (newProject) {
        set({ currentProject: newProject, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateProject: async (id, name, description, genre) => {
    try {
      await tauri.updateProject(id, name, description, genre);
      /* 重新加载项目列表 */
      await get().loadProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteProject: async (id) => {
    try {
      await tauri.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
        chapters: state.currentProject?.id === id ? [] : state.chapters,
        currentChapter: state.currentProject?.id === id ? null : state.currentChapter,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadChapters: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const chapters = await tauri.getChapters(projectId);
      set({ chapters, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectChapter: (chapter) => {
    set({ currentChapter: chapter });
  },

  createChapter: async (projectId, parentId, title, sortOrder) => {
    set({ loading: true, error: null });
    try {
      const id = await tauri.createChapter(projectId, parentId, title, sortOrder);
      /* 重新加载章节列表 */
      await get().loadChapters(projectId);
      /* 选中新创建的章节 */
      const newChapter = get().chapters.find((c) => c.id === id);
      if (newChapter) {
        set({ currentChapter: newChapter, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateChapter: async (id, title, content, status, parentId) => {
    try {
      await tauri.updateChapter(id, title, content, status, parentId);
      /* 重新加载当前项目的章节列表 */
      const projectId = get().currentProject?.id;
      if (projectId) {
        await get().loadChapters(projectId);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteChapter: async (id) => {
    try {
      await tauri.deleteChapter(id);
      set((state) => ({
        chapters: state.chapters.filter((c) => c.id !== id),
        currentChapter: state.currentChapter?.id === id ? null : state.currentChapter,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));

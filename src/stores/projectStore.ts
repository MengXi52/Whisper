/** 项目状态管理 */
import { create } from 'zustand';
import type { Project, Chapter } from '@/types';
import * as tauri from '@/utils/tauri';

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
  createProject: (data: Omit<Project, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  /** 更新项目 */
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
  /** 删除项目 */
  deleteProject: (id: string) => Promise<void>;
  /** 加载章节列表 */
  loadChapters: (projectId: string) => Promise<void>;
  /** 选择章节 */
  selectChapter: (chapter: Chapter | null) => void;
  /** 创建章节 */
  createChapter: (data: Omit<Chapter, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  /** 更新章节 */
  updateChapter: (id: string, data: Partial<Chapter>) => Promise<void>;
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
      set({ projects, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectProject: async (project) => {
    set({ currentProject: project, currentChapter: null });
    await get().loadChapters(project.id);
  },

  createProject: async (data) => {
    set({ loading: true, error: null });
    try {
      const project = await tauri.createProject(data);
      set((state) => ({ projects: [...state.projects, project], loading: false }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateProject: async (id, data) => {
    try {
      const updated = await tauri.updateProject(id, data);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updated : p)),
        currentProject: state.currentProject?.id === id ? updated : state.currentProject,
      }));
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

  createChapter: async (data) => {
    set({ loading: true, error: null });
    try {
      const chapter = await tauri.createChapter(data);
      set((state) => ({ chapters: [...state.chapters, chapter], loading: false }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateChapter: async (id, data) => {
    try {
      const updated = await tauri.updateChapter(id, data);
      set((state) => ({
        chapters: state.chapters.map((c) => (c.id === id ? updated : c)),
        currentChapter: state.currentChapter?.id === id ? updated : state.currentChapter,
      }));
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

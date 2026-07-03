/** 聊天状态管理 */
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { Conversation, Message, Skill } from '@/types';
import * as tauri from '@/utils/tauri';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useProjectStore } from '@/stores/projectStore';

/** 获取当前聊天模型名称 */
const getModel = (): string => {
  const defaultConfig = useApiConfigStore.getState().defaultConfig;
  return defaultConfig?.model_writing || 'deepseek-chat';
};

interface ChatState {
  /** 会话列表 */
  conversations: Conversation[];
  /** 当前会话 */
  currentConversation: Conversation | null;
  /** 消息列表 */
  messages: Message[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 当前流式消息内容（正在生成中的内容） */
  streamingContent: string;
  /** 可用技能列表 */
  skills: Skill[];
  /** 当前激活的技能ID列表 */
  activeSkillIds: string[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 加载会话列表 */
  loadConversations: () => Promise<void>;
  /** 获取当前项目下的会话列表 */
  projectConversations: () => Conversation[];
  /** 创建新会话 */
  newConversation: () => Promise<void>;
  /** 创建新会话（带参数） */
  createConversation: (data: Omit<Conversation, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  /** 选择会话 */
  selectConversation: (conversation: Conversation) => Promise<void>;
  /** 删除会话 */
  deleteConversation: (id: string) => Promise<void>;
  /** 发送消息 */
  sendMessage: (content: string) => Promise<void>;
  /** 中断生成 */
  abortGeneration: () => Promise<void>;
  /** 编辑消息（更新内容并删除后续所有消息） */
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  /** 加载技能列表 */
  loadSkills: () => Promise<void>;
  /** 切换技能激活状态 */
  toggleSkill: (skillId: string) => void;
  /** 初始化 SSE 监听 */
  initChunkListener: () => Promise<() => void>;
  /** 清除错误 */
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isGenerating: false,
  streamingContent: '',
  skills: [],
  activeSkillIds: [],
  loading: false,
  error: null,

  /** 获取当前项目下的会话列表 */
  projectConversations: () => {
    const { conversations } = get();
    const currentProject = useProjectStore.getState().currentProject;
    if (!currentProject) return [];
    return conversations.filter((c) => c.project_id === currentProject.id);
  },

  loadConversations: async () => {
    try {
      const conversations = await tauri.listConversations();
      set({ conversations });

      /* 如果没有对话，自动创建一个；否则自动选中最近的一个 */
      const { currentConversation } = get();
      if (!currentConversation) {
        /* 按当前项目过滤 */
        const currentProject = useProjectStore.getState().currentProject;
        const projectConvs = currentProject
          ? conversations.filter((c) => c.project_id === currentProject.id)
          : conversations;

        if (projectConvs.length === 0) {
          await get().newConversation();
        } else {
          await get().selectConversation(projectConvs[0]);
        }
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  newConversation: async () => {
    const { currentConversation, messages } = get();

    /* 如果当前是空对话（没有消息），直接复用，不创建新的 */
    if (currentConversation && messages.length === 0) {
      return;
    }

    try {
      /* 如果当前有选中的项目，将对话关联到该项目 */
      const currentProject = useProjectStore.getState().currentProject;
      const conversation = await tauri.createConversation({
        project_id: currentProject?.id ?? null,
        title: '',
        phase: 'ideation',
        skill_ids: [],
        context_chapter_id: null,
      });
      set({ currentConversation: conversation, messages: [], activeSkillIds: [] });
      /* 刷新列表 */
      await get().loadConversations();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createConversation: async (data) => {
    try {
      const conversation = await tauri.createConversation(data);
      set({ currentConversation: conversation, messages: [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectConversation: async (conversation) => {
    set({ loading: true, error: null });
    try {
      const messages = await tauri.getMessages(conversation.id);
      set({
        currentConversation: conversation,
        messages,
        loading: false,
        activeSkillIds: conversation.skill_ids || [],
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  deleteConversation: async (id) => {
    try {
      await tauri.deleteConversation(id);
      set((state) => ({
        currentConversation: state.currentConversation?.id === id ? null : state.currentConversation,
        messages: state.currentConversation?.id === id ? [] : state.messages,
      }));
      /* 刷新列表 */
      await get().loadConversations();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendMessage: async (content) => {
    const { currentConversation, activeSkillIds } = get();
    if (!currentConversation) return;

    /* 先将用户消息添加到列表 */
    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: currentConversation.id,
      role: 'user',
      content,
      model: '',
      created_at: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, userMessage],
      isGenerating: true,
      streamingContent: '',
    }));

    try {
      await tauri.sendMessage(
        currentConversation.id,
        content,
        getModel(),
        activeSkillIds
      );
    } catch (e) {
      set({ error: String(e), isGenerating: false });
    }
  },

  abortGeneration: async () => {
    try {
      await tauri.abortGeneration();
      /* 将已流式接收的内容保存为一条消息 */
      const { streamingContent, currentConversation } = get();
      if (streamingContent && currentConversation) {
        const aiMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: currentConversation.id,
          role: 'assistant',
          content: streamingContent,
          model: getModel(),
          created_at: new Date().toISOString(),
        };
        set((state) => ({
          messages: [...state.messages, aiMessage],
          streamingContent: '',
          isGenerating: false,
        }));
      } else {
        set({ isGenerating: false, streamingContent: '' });
      }
    } catch (e) {
      set({ error: String(e), isGenerating: false });
    }
  },

  editMessage: async (messageId, newContent) => {
    const { currentConversation, messages } = get();
    if (!currentConversation) return;

    try {
      /* 1. 更新消息内容 */
      await tauri.updateMessage(messageId, newContent);
      /* 2. 删除该消息之后的所有消息（保持上下文一致性） */
      await tauri.deleteMessagesAfter(currentConversation.id, messageId);
      /* 3. 更新本地消息列表 */
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;
      const updatedMessages = messages.slice(0, msgIndex + 1).map((m, i) =>
        i === msgIndex ? { ...m, content: newContent } : m
      );
      set({ messages: updatedMessages });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadSkills: async () => {
    try {
      const skills = await tauri.getSkills();
      set({ skills });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleSkill: (skillId) => {
    const state = get();
    const isActive = state.activeSkillIds.includes(skillId);
    const conversationId = state.currentConversation?.id;

    if (isActive) {
      /* 取消激活 */
      set({ activeSkillIds: state.activeSkillIds.filter((id) => id !== skillId) });
      if (conversationId) {
        tauri.deactivateSkill(conversationId, skillId).catch(console.error);
      }
    } else {
      /* 激活 */
      set({ activeSkillIds: [...state.activeSkillIds, skillId] });
      if (conversationId) {
        tauri.activateSkill(conversationId, skillId).catch(console.error);
      }
    }
  },

  initChunkListener: async () => {
    const unlisten = await listen<{ id: string; content: string; done: boolean }>('chat:chunk', (event) => {
      const { content, done } = event.payload;

      if (done) {
        /* 流式响应完成，保存消息 */
        set((state) => {
          const { streamingContent, currentConversation } = state;
          if (streamingContent && currentConversation) {
            const aiMessage: Message = {
              id: crypto.randomUUID(),
              conversation_id: currentConversation.id,
              role: 'assistant',
              content: streamingContent,
              model: getModel(),
              created_at: new Date().toISOString(),
            };
            return {
              messages: [...state.messages, aiMessage],
              streamingContent: '',
              isGenerating: false,
            };
          }
          return { isGenerating: false, streamingContent: '' };
        });

        /* 刷新侧边栏数据（LLM 可能通过工具创建了新的章节或设定卡） */
        const { currentConversation } = get();
        const convId = currentConversation?.id;
        if (convId) {
          Promise.all([
            import('@/utils/tauri').then((m) => m.getConversation(convId)),
            import('@/stores/projectStore'),
            import('@/stores/settingsStore'),
          ]).then(([updatedConv, { useProjectStore }, { useSettingsStore }]) => {
            /* 如果 conversation 的 project_id 发生了变化，更新本地状态 */
            if (currentConversation?.project_id !== updatedConv.project_id) {
              set({ currentConversation: updatedConv });
            }

            const pid = updatedConv.project_id;
            if (pid) {
              /* 刷新项目列表 */
              useProjectStore.getState().loadProjects();
              /* 加载该项目的章节和设定卡 */
              useProjectStore.getState().loadChapters(pid);
              useSettingsStore.getState().loadSettingCards(pid);
            } else {
              /* 没有 project_id，仅刷新项目列表 */
              useProjectStore.getState().loadProjects();
            }
          }).catch(console.error);
        }

        return;
      }

      /* 追加流式内容 */
      set((state) => {
        const newStreamingContent = state.streamingContent + content;
        return { streamingContent: newStreamingContent };
      });
    });

    /* 返回清理函数 */
    return unlisten;
  },

  clearError: () => set({ error: null }),
}));

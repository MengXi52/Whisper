/** Tauri invoke 封装 */
import { invoke } from '@tauri-apps/api/core';

/** 通用 Tauri 命令调用封装 */
export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

// ===== 项目相关 =====

/** 获取项目列表 */
export const getProjects = () => tauriInvoke<import('@/types').Project[]>('list_projects');

/** 获取单个项目 */
export const getProject = (id: string) => tauriInvoke<import('@/types').Project>('get_project', { id });

/** 创建项目 */
export const createProject = (name: string, description: string, genre: string) =>
  tauriInvoke<string>('create_project', { name, description, genre });

/** 更新项目 */
export const updateProject = (id: string, name?: string, description?: string, genre?: string) =>
  tauriInvoke<void>('update_project', { id, name, description, genre });

/** 删除项目 */
export const deleteProject = (id: string) => tauriInvoke<void>('delete_project', { id });

// ===== 章节相关 =====

/** 获取项目的章节列表 */
export const getChapters = (projectId: string) =>
  tauriInvoke<import('@/types').Chapter[]>('list_chapters', { projectId });

/** 创建章节 */
export const createChapter = (projectId: string, parentId: string | null, title: string, sortOrder?: number) =>
  tauriInvoke<string>('create_chapter', { projectId, parentId, title, sortOrder });

/** 更新章节 */
export const updateChapter = (id: string, title?: string, content?: string, status?: string, parentId?: string | null) =>
  tauriInvoke<void>('update_chapter', { id, title, content, status, parentId });

/** 删除章节 */
export const deleteChapter = (id: string) => tauriInvoke<void>('delete_chapter', { id });

// ===== 设定卡相关 =====

/** 获取项目的设定卡列表 */
export const getSettingCards = (projectId: string) =>
  tauriInvoke<import('@/types').SettingCard[]>('list_setting_cards', { projectId });

/** 创建设定卡 */
export const createSettingCard = (
  projectId: string,
  cardType: string,
  name: string,
  fields: string // JSON string
) =>
  tauriInvoke<string>('create_setting_card', { projectId, cardType, name, fields });

/** 更新设定卡 */
export const updateSettingCard = (
  id: string,
  name?: string,
  fields?: string, // JSON string
  cardType?: string
) =>
  tauriInvoke<void>('update_setting_card', { id, name, fields, cardType });

/** 删除设定卡 */
export const deleteSettingCard = (id: string) => tauriInvoke<void>('delete_setting_card', { id });

/** 获取设定卡版本历史 */
export const getSettingCardVersions = (cardId: string) =>
  tauriInvoke<import('@/types').SettingCardVersion[]>('list_setting_card_versions', { cardId });

// ===== 聊天相关 =====

/** 发送消息 */
export const sendMessage = (conversationId: string, content: string, model: string, skillIds: string[]) =>
  tauriInvoke<void>('send_message', { conversationId, content, model, skillIds });

/** 中断生成 */
export const abortGeneration = () => tauriInvoke<void>('abort_generation');

/** 创建会话 */
export const createConversation = (data: Omit<import('@/types').Conversation, 'id' | 'created_at' | 'updated_at'>) =>
  tauriInvoke<import('@/types').Conversation>('create_conversation', {
    project_id: data.project_id,
    title: data.title,
    phase: data.phase,
    skill_ids: data.skill_ids,
  });

/** 获取会话列表 */
export const listConversations = () =>
  tauriInvoke<import('@/types').Conversation[]>('list_conversations');

/** 获取会话消息 */
export const getMessages = (conversationId: string) =>
  tauriInvoke<import('@/types').Message[]>('get_messages', { conversationId });

/** 删除会话 */
export const deleteConversation = (id: string) => tauriInvoke<void>('delete_conversation', { id });

// ===== 技能相关 =====

/** 获取技能列表 */
export const getSkills = () => tauriInvoke<import('@/types').Skill[]>('list_skills');

/** 激活技能（关联到当前对话） */
export const activateSkill = (conversationId: string, skillId: string) =>
  tauriInvoke('activate_skill', { conversationId, skillId });

/** 取消激活技能 */
export const deactivateSkill = (conversationId: string, skillId: string) =>
  tauriInvoke('deactivate_skill', { conversationId, skillId });

// ===== API 配置相关 =====

/** 获取 API 配置列表 */
export const getApiConfigs = () => tauriInvoke<import('@/types').ApiConfig[]>('get_api_configs');

/** 获取 API 配置列表（别名） */
export const listApiConfigs = () => tauriInvoke<import('@/types').ApiConfig[]>('list_api_configs');

/** 保存 API 配置 */
export const saveApiConfig = (data: Omit<import('@/types').ApiConfig, 'id'> & { id?: string }) =>
  tauriInvoke<import('@/types').ApiConfig>('save_api_config', {
    id: data.id,
    name: data.name,
    base_url: data.base_url,
    api_key: data.api_key,
    model_thinking: data.model_thinking,
    model_writing: data.model_writing,
    is_default: data.is_default,
  });

/** 删除 API 配置 */
export const deleteApiConfig = (id: string) => tauriInvoke<void>('delete_api_config', { id });

/** 设置默认 API 配置 */
export const setDefaultApiConfig = (id: string) => tauriInvoke<void>('set_default_api_config', { id });

// ===== 续写相关 =====

/** 续写 */
export const continueWriting = (chapterId: string, context: string) =>
  tauriInvoke<void>('continue_writing', { chapterId, context });

/** 编辑操作（语法校正、语气调整、扩写、缩写） */
export const editText = (text: string, operation: string) =>
  tauriInvoke<string>('edit_text', { text, operation });

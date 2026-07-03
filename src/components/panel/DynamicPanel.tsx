/** 右侧动态面板 */
import React from 'react';
import { clsx } from 'clsx';
import {
  Lightbulb, ListTree, PenTool, CheckSquare, ChevronRight,
  Sparkles, Wand2,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { SettingCardEditor } from '@/components/settings/SettingCardEditor';

/* ============================================================ */
/* 助手面板：根据写作阶段显示不同的辅助内容                          */
/* ============================================================ */

/** 构思阶段面板 */
const IdeationPanel: React.FC = () => {
  const { sendMessage, isGenerating } = useChatStore();

  const sendPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendMessage(prompt);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb size={16} className="text-warning" />
        <h3 className="text-sm font-semibold text-text-primary">构思助手</h3>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-text-tertiary">快捷操作</p>
        <button
          onClick={() => sendPrompt('请帮我生成5个有趣的选题列表，每个选题附带一句话简介。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          生成选题列表
        </button>
        <button
          onClick={() => sendPrompt('请用"如果…会怎样"的发散方式，帮我从不同角度拓展当前故事创意。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          "如果…会怎样"发散
        </button>
        <button
          onClick={() => sendPrompt('请根据当前创意，生成一段高概念梗概（100-200字），突出核心冲突和卖点。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          生成高概念梗概
        </button>
      </div>
    </div>
  );
};

/** 计划阶段面板 */
const PlanningPanel: React.FC = () => {
  const { sendMessage, isGenerating } = useChatStore();

  const sendPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendMessage(prompt);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <ListTree size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">计划助手</h3>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-text-tertiary">大纲操作</p>
        <button
          onClick={() => sendPrompt('请根据当前故事创意，生成一份章节大纲，包含每章标题和简要内容描述。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          生成章节大纲
        </button>
        <button
          onClick={() => sendPrompt('请为主要角色规划人物弧光，包括起点、转折点和终点。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          人物弧光规划
        </button>
        <button
          onClick={() => sendPrompt('请根据当前大纲，给出分幕节奏建议，标明各幕的起承转合。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          分幕节奏建议
        </button>
        <button
          onClick={() => sendPrompt('请根据当前大纲，提示需要埋设的伏笔及其回收点。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          伏笔埋设提示
        </button>
      </div>
    </div>
  );
};

/** 写作阶段面板 */
const WritingPanel: React.FC = () => {
  const { settingCards } = useSettingsStore();
  const { currentChapter } = useProjectStore();
  const { sendMessage, isGenerating } = useChatStore();

  const sendPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendMessage(prompt);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <PenTool size={16} className="text-success" />
        <h3 className="text-sm font-semibold text-text-primary">写作助手</h3>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => sendPrompt(currentChapter ? `请续写当前章节「${currentChapter.title}」的内容，保持风格一致。` : '请帮我续写当前章节的内容，保持风格一致。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          <Wand2 size={12} className="inline mr-1" />
          续写当前章节
        </button>
        <button
          onClick={() => sendPrompt('请根据当前设定和剧情，描写一段生动的环境场景。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          场景描写生成
        </button>
        <button
          onClick={() => sendPrompt('请为当前剧情写一段角色对话，注意体现角色性格差异。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          角色对话生成
        </button>
      </div>

      <div>
        <p className="text-xs font-medium text-text-secondary mb-2">设定引用</p>
        {settingCards.length === 0 ? (
          <p className="text-xs text-text-tertiary">暂无设定卡</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {settingCards.slice(0, 10).map((card) => (
              <div
                key={card.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-tertiary hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <span className="text-xs text-text-primary truncate">{card.name}</span>
                <span className="text-xs text-text-tertiary shrink-0">{card.card_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** 修改阶段面板 */
const EditingPanel: React.FC = () => {
  const { sendMessage, isGenerating } = useChatStore();

  const sendPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendMessage(prompt);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <CheckSquare size={16} className="text-error" />
        <h3 className="text-sm font-semibold text-text-primary">修改助手</h3>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-text-tertiary">检查与调整</p>
        <button
          onClick={() => sendPrompt('请检查当前文本的一致性，包括人物、时间线、地点等是否前后矛盾。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          一致性检查
        </button>
        <button
          onClick={() => sendPrompt('请调整当前文本的语气，使其更加生动自然。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          语气调整
        </button>
        <button
          onClick={() => sendPrompt('请校正当前文本中的语法和用词错误。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          语法校正
        </button>
        <button
          onClick={() => sendPrompt('请分析当前文本的可读性，给出句子长度、段落结构等方面的建议。')}
          disabled={isGenerating}
          className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          可读性分析
        </button>
      </div>
    </div>
  );
};

/* ============================================================ */
/* 操作面板：设定卡管理、版本历史等快捷操作                          */
/* ============================================================ */

const OperationsPanel: React.FC = () => {
  const { settingCards, currentCard, selectCard, deleteSettingCard } = useSettingsStore();
  const { currentProject, currentChapter, selectChapter, chapters } = useProjectStore();
  const { sendMessage, isGenerating } = useChatStore();

  const handleDeleteCard = (e: React.MouseEvent, cardId: string) => {
    e.stopPropagation();
    deleteSettingCard(cardId);
  };

  const handleCreateCard = () => {
    if (isGenerating) return;
    const cardType = 'character';
    sendMessage(`请帮我创建一个角色设定卡，类型为 ${cardType}。`);
  };

  return (
    <div className="p-4 space-y-4">
      {/* 设定卡管理 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-primary">设定卡管理</h3>
          <button
            onClick={handleCreateCard}
            disabled={isGenerating}
            className="text-xs text-accent hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            + 新建
          </button>
        </div>
        {settingCards.length === 0 ? (
          <p className="text-xs text-text-tertiary py-2">暂无设定卡</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {settingCards.map((card) => (
              <div
                key={card.id}
                className={clsx(
                  'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                  currentCard?.id === card.id
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-tertiary hover:bg-bg-hover text-text-primary'
                )}
                onClick={() => selectCard(card)}
              >
                <span className="text-xs flex-1 truncate">{card.name}</span>
                <span className="text-[10px] text-text-tertiary shrink-0">{card.card_type}</span>
                <button
                  onClick={(e) => handleDeleteCard(e, card.id)}
                  className="text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 章节快捷跳转 */}
      <div className="border-t border-border pt-3">
        <h3 className="text-sm font-semibold text-text-primary mb-2">章节跳转</h3>
        {chapters.length === 0 ? (
          <p className="text-xs text-text-tertiary py-2">暂无章节</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {chapters.map((ch) => (
              <div
                key={ch.id}
                className={clsx(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs',
                  currentChapter?.id === ch.id
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-tertiary hover:bg-bg-hover text-text-primary'
                )}
                onClick={() => selectChapter(ch)}
              >
                <span className="truncate">{ch.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 项目信息 */}
      {currentProject && (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-text-primary mb-2">项目信息</h3>
          <div className="space-y-1 text-xs text-text-secondary">
            <div className="flex justify-between">
              <span>名称</span>
              <span className="text-text-primary">{currentProject.name}</span>
            </div>
            <div className="flex justify-between">
              <span>类型</span>
              <span className="text-text-primary">{currentProject.genre || '通用'}</span>
            </div>
            <div className="flex justify-between">
              <span>章节数</span>
              <span className="text-text-primary">{chapters.length}</span>
            </div>
            <div className="flex justify-between">
              <span>设定卡数</span>
              <span className="text-text-primary">{settingCards.length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================ */
/* 主面板组件                                                    */
/* ============================================================ */

export const DynamicPanel: React.FC = () => {
  const { phase, panelTab, setPanelTab, togglePanel } = useUIStore();
  const { currentCard } = useSettingsStore();

  /* 根据阶段选择助手面板内容 */
  const phasePanelMap: Record<string, React.ReactNode> = {
    ideation: <IdeationPanel />,
    planning: <PlanningPanel />,
    writing: <WritingPanel />,
    editing: <EditingPanel />,
  };

  return (
    <aside className="h-full flex flex-col bg-bg-panel border-l border-border overflow-hidden">
      {/* 选项卡 + 折叠按钮 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPanelTab('assistant')}
            className={clsx(
              'flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors',
              panelTab === 'assistant'
                ? 'bg-accent/10 text-accent'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            <Sparkles size={12} />
            助手
          </button>
          <button
            onClick={() => setPanelTab('operations')}
            className={clsx(
              'flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors',
              panelTab === 'operations'
                ? 'bg-accent/10 text-accent'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            <ListTree size={12} />
            操作
          </button>
        </div>
        <button
          onClick={togglePanel}
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* 阶段标签（仅助手 Tab 显示） */}
      {panelTab === 'assistant' && (
        <div className="px-3 py-1 border-b border-border bg-bg-secondary/50">
          <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
            {phase === 'ideation' && '构思阶段'}
            {phase === 'planning' && '计划阶段'}
            {phase === 'writing' && '写作阶段'}
            {phase === 'editing' && '修改阶段'}
          </span>
        </div>
      )}

      {/* 面板内容 */}
      <div className="flex-1 overflow-y-auto">
        {panelTab === 'assistant' ? phasePanelMap[phase] : <OperationsPanel />}

        {/* 设定卡编辑器（如果选中了设定卡） */}
        {currentCard && panelTab === 'operations' && (
          <div className="border-t border-border">
            <SettingCardEditor />
          </div>
        )}
      </div>
    </aside>
  );
};

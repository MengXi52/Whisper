/** 左侧栏组件 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, FolderOpen, BookOpen, Sparkles, MessageSquare, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { OutlineTree } from '@/components/sidebar/OutlineTree';
import { SettingCardList } from '@/components/sidebar/SettingCardList';
import { Button } from '@/components/common/Button';
import { clsx } from 'clsx';

export const Sidebar: React.FC = () => {
  const { currentProject, projects, selectProject } = useProjectStore();
  const { phase } = useUIStore();
  const { conversations, currentConversation, selectConversation, newConversation, deleteConversation } = useChatStore();
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  return (
    <aside className="w-[240px] h-full flex flex-col bg-bg-sidebar border-r border-border shrink-0 overflow-hidden">
      {/* 项目选择器 */}
      <div className="px-3 py-2.5 border-b border-border">
        <button
          onClick={() => setProjectSelectorOpen(!projectSelectorOpen)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors text-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen size={14} className="text-accent shrink-0" />
            <span className="text-text-primary font-medium truncate">
              {currentProject?.name ?? '选择项目'}
            </span>
          </div>
          <ChevronDown
            size={14}
            className={clsx(
              'text-text-tertiary shrink-0 transition-transform',
              projectSelectorOpen && 'rotate-180'
            )}
          />
        </button>

        {/* 项目下拉列表 */}
        {projectSelectorOpen && (
          <div className="mt-1 rounded-md border border-border bg-bg-primary shadow-md overflow-hidden">
            {projects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-tertiary">暂无项目</div>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    selectProject(project);
                    setProjectSelectorOpen(false);
                  }}
                  className={clsx(
                    'w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover transition-colors',
                    currentProject?.id === project.id && 'bg-bg-active text-accent'
                  )}
                >
                  {project.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 资源树 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* 对话历史 */}
        <div className="mb-2">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:bg-bg-hover rounded-md transition-colors"
          >
            {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <MessageSquare size={12} />
            <span>对话历史</span>
          </button>
          {historyOpen && (
            <div className="ml-1 space-y-0.5">
              {conversations.length === 0 ? (
                <div className="px-4 py-3 text-xs text-text-tertiary">暂无对话</div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={clsx(
                      'group flex items-center gap-1 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors',
                      currentConversation?.id === conv.id
                        ? 'bg-bg-active text-accent'
                        : 'text-text-primary hover:bg-bg-hover'
                    )}
                    onClick={() => selectConversation(conv)}
                  >
                    <MessageSquare size={12} className="shrink-0 opacity-50" />
                    <span className="truncate flex-1">
                      {conv.title || '新对话'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="shrink-0 p-0.5 rounded text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除对话"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 大纲区 */}
        <div className="mb-2">
          <button
            onClick={() => setOutlineOpen(!outlineOpen)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:bg-bg-hover rounded-md transition-colors"
          >
            {outlineOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <BookOpen size={12} />
            <span>大纲</span>
          </button>
          {outlineOpen && currentProject && (
            <div className="ml-1">
              <OutlineTree />
            </div>
          )}
          {outlineOpen && !currentProject && (
            <div className="px-4 py-3 text-xs text-text-tertiary">请先选择项目</div>
          )}
        </div>

        {/* 设定卡区 */}
        <div className="mb-2">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:bg-bg-hover rounded-md transition-colors"
          >
            {settingsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Sparkles size={12} />
            <span>设定</span>
          </button>
          {settingsOpen && currentProject && (
            <div className="ml-1">
              <SettingCardList />
            </div>
          )}
          {settingsOpen && !currentProject && (
            <div className="px-4 py-3 text-xs text-text-tertiary">请先选择项目</div>
          )}
        </div>
      </div>

      {/* 底部新建按钮 */}
      <div className="px-3 py-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          icon={<Plus size={14} />}
          onClick={() => newConversation()}
        >
          {phase === 'writing' ? '新建章节' : '新建对话'}
        </Button>
      </div>
    </aside>
  );
};

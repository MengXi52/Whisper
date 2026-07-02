/** 聊天输入组件 */
import React, { useState, useRef, useCallback } from 'react';
import { Send, Square, AtSign, Wrench } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { clsx } from 'clsx';

/** 可用工具列表（与 docs/tools.md 保持一致） */
const TOOLS = [
  { name: 'query_outline', desc: '查询章节大纲', category: '章节' },
  { name: 'query_chapter', desc: '查询章节内容', category: '章节' },
  { name: 'create_chapter', desc: '创建新章节', category: '章节' },
  { name: 'update_chapter', desc: '更新章节内容', category: '章节' },
  { name: 'delete_chapter', desc: '删除章节', category: '章节' },
  { name: 'query_setting_cards', desc: '查询设定卡', category: '设定卡' },
  { name: 'create_setting_card', desc: '创建设定卡', category: '设定卡' },
  { name: 'update_setting_card', desc: '更新设定卡', category: '设定卡' },
  { name: 'delete_setting_card', desc: '删除设定卡', category: '设定卡' },
  { name: 'query_conversations', desc: '查询对话历史', category: '对话' },
  { name: 'list_skills', desc: '列出技能', category: '技能' },
  { name: 'use_skill', desc: '使用技能', category: '技能' },
] as const;

export const ChatInput: React.FC = () => {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, abortGeneration, isGenerating, skills, activeSkillIds, toggleSkill } = useChatStore();

  /* 自动调整高度 */
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    adjustHeight();

    /* 检测 / 工具命令（优先级高于 @） */
    const lastSlash = value.lastIndexOf('/');
    if (lastSlash !== -1) {
      const afterSlash = value.slice(lastSlash + 1);
      if (!afterSlash.includes(' ') && afterSlash.length <= 30) {
        setSlashFilter(afterSlash);
        setSlashOpen(true);
        setMentionOpen(false);
        return;
      }
    }
    setSlashOpen(false);

    /* 检测 @ 提及 */
    const lastAtSymbol = value.lastIndexOf('@');
    if (lastAtSymbol !== -1) {
      const afterAt = value.slice(lastAtSymbol + 1);
      if (!afterAt.includes(' ') && afterAt.length <= 20) {
        setMentionFilter(afterAt);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    sendMessage(trimmed);
    setInput('');
    setActiveTool(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleMentionSelect = (skillId: string, skillName: string) => {
    const lastAt = input.lastIndexOf('@');
    const newInput = input.slice(0, lastAt) + `@${skillName} `;
    setInput(newInput);
    setMentionOpen(false);
    /* 激活技能 */
    toggleSkill(skillId);
    textareaRef.current?.focus();
  };

  const handleSlashSelect = (toolName: string) => {
    const lastSlash = input.lastIndexOf('/');
    const newInput = input.slice(0, lastSlash) + `/${toolName} `;
    setInput(newInput);
    setSlashOpen(false);
    setActiveTool(toolName);
    textareaRef.current?.focus();
  };

  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const filteredTools = TOOLS.filter((t) =>
    t.name.toLowerCase().includes(slashFilter.toLowerCase()) ||
    t.desc.toLowerCase().includes(slashFilter.toLowerCase())
  );

  return (
    <div className="relative bg-bg-secondary px-3 py-2.5 border-t border-border">
      {/* / 工具命令下拉 */}
      {slashOpen && filteredTools.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden z-10 max-h-64 overflow-y-auto">
          {filteredTools.map((tool) => (
            <button
              key={tool.name}
              onClick={() => handleSlashSelect(tool.name)}
              className={clsx(
                'w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors flex items-center gap-2',
                activeTool === tool.name && 'text-accent'
              )}
            >
              <Wrench size={12} className="shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{tool.name}</div>
                <div className="text-xs text-text-tertiary mt-0.5">{tool.desc}</div>
              </div>
              <span className="text-xs text-text-tertiary shrink-0">{tool.category}</span>
            </button>
          ))}
        </div>
      )}

      {/* 技能 @提及下拉 */}
      {mentionOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden z-10">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleMentionSelect(skill.id, skill.name)}
              className={clsx(
                'w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors',
                activeSkillIds.includes(skill.id) && 'text-accent'
              )}
            >
              <div className="font-medium">{skill.name}</div>
              <div className="text-xs text-text-tertiary mt-0.5">{skill.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* 已激活技能标签 */}
      {(activeSkillIds.length > 0 || activeTool) && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {/* 工具标签 */}
          {activeTool && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-500">
              <Wrench size={10} />
              {activeTool}
              <button
                onClick={() => setActiveTool(null)}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </span>
          )}
          {/* 技能标签 */}
          {activeSkillIds.map((id) => {
            const skill = skills.find((s) => s.id === id);
            if (!skill) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/10 text-accent"
              >
                <AtSign size={10} />
                {skill.name}
                <button
                  onClick={() => toggleSkill(id)}
                  className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* 输入区域 */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，@ 技能名，/ 工具命令…"
            rows={1}
            className="w-full resize-none rounded-xl border border-border bg-bg-primary px-4 py-2.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
          />
        </div>

        {isGenerating ? (
          <button
            onClick={abortGeneration}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-error/10 text-error hover:bg-error/20 transition-colors"
            title="停止生成"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={clsx(
              'shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-all',
              input.trim()
                ? 'bg-accent text-white hover:bg-accent/90 shadow-sm'
                : 'bg-transparent text-text-tertiary cursor-not-allowed'
            )}
            title="发送"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

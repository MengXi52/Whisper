/** 聊天输入组件 */
import React, { useState, useRef, useCallback } from 'react';
import { Send, Square, AtSign } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { clsx } from 'clsx';

export const ChatInput: React.FC = () => {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
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
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    sendMessage(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleMentionSelect = (skillName: string) => {
    const lastAt = input.lastIndexOf('@');
    const newInput = input.slice(0, lastAt) + `@${skillName} `;
    setInput(newInput);
    setMentionOpen(false);
    textareaRef.current?.focus();
  };

  const filteredSkills = skills.filter((s) =>
    s.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  return (
    <div className="relative bg-bg-secondary px-3 py-2.5 border-t border-border">
      {/* 技能 @提及下拉 */}
      {mentionOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden z-10">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleMentionSelect(skill.name)}
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
      {activeSkillIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
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
            placeholder="输入消息，@ 技能名 启用技能…"
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

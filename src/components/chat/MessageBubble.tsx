/** 消息气泡组件 */
import React, { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { User, Bot, Check, Copy, Pencil, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '@/types';

interface MessageBubbleProps {
  message: Message;
  /** 是否为流式内容（正在生成中） */
  isStreaming?: boolean;
  /** 编辑回调 */
  onEdit?: (messageId: string, newContent: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isStreaming = false, onEdit }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 进入编辑模式时聚焦并自适应高度 */
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [isEditing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const handleSaveEdit = () => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      setEditContent(message.content);
      return;
    }
    onEdit?.(message.id, trimmed);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(message.content);
  };

  return (
    <div
      className={clsx(
        'group flex gap-3 px-4 py-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* 头像 */}
      <div
        className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-accent' : 'bg-bg-tertiary'
        )}
      >
        {isUser ? (
          <User size={16} className="text-text-inverse" />
        ) : (
          <Bot size={16} className="text-accent" />
        )}
      </div>

      {/* 消息内容 */}
      <div className={clsx('flex flex-col', isUser ? 'items-end' : 'items-start', 'max-w-[75%]')}>
        <div
          className={clsx(
            'rounded-lg px-4 py-2.5 text-sm leading-relaxed w-full',
            isUser
              ? 'bg-accent text-text-inverse'
              : 'bg-bg-tertiary text-text-primary',
            isStreaming && 'animate-pulse'
          )}
        >
          {isEditing ? (
            /* 编辑模式 */
            <div className="flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelEdit();
                  }
                }}
                className={clsx(
                  'w-full resize-none rounded-md px-2 py-1.5 text-sm outline-none',
                  isUser
                    ? 'bg-white/10 text-text-inverse placeholder:text-white/50'
                    : 'bg-bg-secondary text-text-primary border border-border'
                )}
                rows={1}
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
                    isUser
                      ? 'text-text-inverse/70 hover:text-text-inverse'
                      : 'text-text-tertiary hover:text-text-primary'
                  )}
                >
                  <X size={12} />
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent text-text-inverse hover:opacity-90 transition-opacity"
                >
                  <Check size={12} />
                  保存
                </button>
              </div>
              <span className="text-[10px] opacity-50 text-right">
                Enter + Ctrl/⌘ 保存 · Esc 取消
              </span>
            </div>
          ) : isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="markdown-body text-sm leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children, className, ...props }) => {
                    const isTaskList = className?.includes('task-list-item');
                    if (isTaskList) {
                      return (
                        <li className="flex items-start gap-1.5 mb-0.5 list-none -ml-1" {...props}>
                          {children}
                        </li>
                      );
                    }
                    return <li className="text-text-primary">{children}</li>;
                  },
                  input: ({ checked }) => (
                    <span
                      className={clsx(
                        'inline-flex items-center justify-center w-3.5 h-3.5 mt-0.5 rounded-sm border shrink-0',
                        checked
                          ? 'bg-accent border-accent text-text-inverse'
                          : 'border-text-tertiary'
                      )}
                    >
                      {checked && <Check size={10} strokeWidth={3} />}
                    </span>
                  ),
                  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  code: ({ className, children, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="px-1 py-0.5 rounded bg-bg-secondary text-xs font-mono text-accent" {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <pre className="my-2 p-3 rounded-lg bg-bg-secondary overflow-x-auto text-xs font-mono leading-relaxed">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    );
                  },
                  h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 text-text-primary">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-2.5 text-text-primary">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 text-text-primary">{children}</h3>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline hover:opacity-80">
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-accent/30 pl-3 my-2 text-text-secondary italic">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-3 border-border" />,
                  table: ({ children }) => (
                    <div className="my-2 overflow-x-auto">
                      <table className="w-full text-xs border-collapse">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="bg-bg-secondary">{children}</thead>,
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
                  th: ({ children }) => (
                    <th className="px-3 py-1.5 text-left font-semibold text-text-primary whitespace-nowrap">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-1.5 text-text-primary">{children}</td>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent animate-pulse rounded-sm align-text-bottom" />
              )}
            </div>
          )}
        </div>

        {/* 操作按钮（非编辑、非流式时显示） */}
        {!isEditing && !isStreaming && (
          <div
            className={clsx(
              'flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity',
              isUser ? 'flex-row-reverse' : 'flex-row'
            )}
          >
            <button
              onClick={handleCopy}
              className={clsx(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                isUser
                  ? 'text-text-inverse/60 hover:text-text-inverse'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
              title="复制"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? '已复制' : '复制'}
            </button>
            {onEdit && (
              <button
                onClick={() => setIsEditing(true)}
                className={clsx(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors',
                  isUser
                    ? 'text-text-inverse/60 hover:text-text-inverse'
                    : 'text-text-tertiary hover:text-text-primary'
                )}
                title="编辑"
              >
                <Pencil size={11} />
                编辑
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

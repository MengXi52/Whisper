/** 消息气泡组件 */
import React from 'react';
import { clsx } from 'clsx';
import { User, Bot } from 'lucide-react';
import type { Message } from '@/types';

interface MessageBubbleProps {
  message: Message;
  /** 是否为流式内容（正在生成中） */
  isStreaming?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isStreaming = false }) => {
  const isUser = message.role === 'user';

  return (
    <div
      className={clsx(
        'flex gap-3 px-4 py-3',
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
      <div
        className={clsx(
          'max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-accent text-text-inverse'
            : 'bg-bg-tertiary text-text-primary',
          isStreaming && 'animate-pulse'
        )}
      >
        <div className="whitespace-pre-wrap break-words">
          {message.content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
};

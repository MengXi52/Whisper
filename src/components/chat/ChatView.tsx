/** 聊天界面 */
import React, { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import type { Message } from '@/types';

export const ChatView: React.FC = () => {
  const { messages, isGenerating, streamingContent, currentConversation, initChunkListener, editMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* 初始化 SSE 监听 */
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initChunkListener().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, [initChunkListener]);

  /* 自动滚动到底部 */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  /* 构造流式消息对象 */
  const streamingMessage: Message | null =
    isGenerating && streamingContent
      ? {
          id: 'streaming',
          conversation_id: currentConversation?.id ?? '',
          role: 'assistant',
          content: streamingContent,
          model: '',
          created_at: new Date().toISOString(),
        }
      : null;

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streamingMessage ? (
          /* 空状态 */
          <div className="h-full flex flex-col items-center justify-center text-text-tertiary">
            <MessageSquare size={48} className="mb-4 opacity-30" />
            <p className="text-sm">开始一段新的对话</p>
            <p className="text-xs mt-1">输入 @ 可启用写作技能</p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onEdit={editMessage} />
            ))}
            {streamingMessage && (
              <MessageBubble message={streamingMessage} isStreaming />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput />
    </div>
  );
};

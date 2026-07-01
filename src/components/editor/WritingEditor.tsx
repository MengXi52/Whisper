/** 写作编辑器 */
import React, { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { EditorToolbar } from './EditorToolbar';
import { toast } from '@/components/common/Toast';

/** 右键菜单项 */
const contextMenuItems = [
  { label: '语法校正', operation: 'grammar' },
  { label: '语气调整', operation: 'tone' },
  { label: '扩写', operation: 'expand' },
  { label: '缩写', operation: 'shrink' },
];

export const WritingEditor: React.FC = () => {
  const { currentChapter, updateChapter } = useProjectStore();
  const { isGenerating, streamingContent } = useChatStore();
  const [content, setContent] = useState(currentChapter?.content ?? '');
  const [selectedText, setSelectedText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 切换章节时更新内容 */
  useEffect(() => {
    setContent(currentChapter?.content ?? '');
  }, [currentChapter]);

  /* 字数统计 */
  const wordCount = content.length;

  /* 内容变更 */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    /* 自动保存（防抖由上层处理） */
    if (currentChapter) {
      updateChapter(currentChapter.id, {
        content: newContent,
        word_count: newContent.length,
      });
    }
  };

  /* 续写 */
  const handleContinueWrite = () => {
    if (!currentChapter || isGenerating) return;
    /* 通过 Tauri 调用续写 */
    toast.info('正在续写...');
  };

  /* 右键菜单 */
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selection = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (selection.trim()) {
      setSelectedText(selection);
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  /* 执行编辑操作 */
  const handleEditOperation = (operation: string) => {
    setContextMenu(null);
    if (!selectedText) return;
    toast.info(`正在${contextMenuItems.find((i) => i.operation === operation)?.label}...`);
  };

  /* 点击其他区域关闭右键菜单 */
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  if (!currentChapter) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-tertiary">
        <p className="text-sm">请在左侧选择一个章节开始写作</p>
        <p className="text-xs mt-1">或新建一个章节</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative" onContextMenu={handleContextMenu}>
      {/* 工具栏 */}
      <EditorToolbar onContinueWrite={handleContinueWrite} wordCount={wordCount} />

      {/* 编辑区域 */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-3xl mx-auto h-full">
          {/* 章节标题 */}
          <input
            type="text"
            value={currentChapter.title}
            onChange={(e) => updateChapter(currentChapter.id, { title: e.target.value })}
            className="w-full bg-transparent text-xl font-serif font-bold text-text-primary placeholder:text-text-tertiary focus:outline-none mb-4"
            placeholder="章节标题"
          />

          {/* Markdown 编辑器 */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            placeholder="开始写作..."
            className="w-full h-[calc(100%-3rem)] resize-none bg-transparent text-text-primary font-serif text-base leading-relaxed placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
      </div>

      {/* 流式续写内容预览 */}
      {isGenerating && streamingContent && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-2xl w-full px-6">
          <div className="bg-bg-tertiary border border-border rounded-lg p-4 shadow-lg">
            <div className="text-xs text-text-tertiary mb-2">AI 续写建议</div>
            <div className="text-sm text-text-primary whitespace-pre-wrap">{streamingContent}</div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => {
                  setContent((prev) => prev + '\n' + streamingContent);
                  if (currentChapter) {
                    updateChapter(currentChapter.id, {
                      content: content + '\n' + streamingContent,
                    });
                  }
                }}
                className="px-3 py-1 text-xs bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors"
              >
                采用
              </button>
              <button
                onClick={() => {}}
                className="px-3 py-1 text-xs bg-bg-hover text-text-secondary rounded-md hover:bg-bg-active transition-colors"
              >
                忽略
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="absolute bg-bg-primary border border-border rounded-lg shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenuItems.map((item) => (
            <button
              key={item.operation}
              onClick={() => handleEditOperation(item.operation)}
              className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

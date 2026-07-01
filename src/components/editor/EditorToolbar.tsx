/** 编辑器工具栏 */
import React from 'react';
import { Bold, Italic, Heading, List, Quote, Undo2, Redo2, Wand2 } from 'lucide-react';
import { Button } from '@/components/common/Button';

interface EditorToolbarProps {
  onContinueWrite?: () => void;
  wordCount?: number;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ onContinueWrite, wordCount = 0 }) => {
  const toolbarButtons = [
    { icon: <Bold size={15} />, title: '加粗' },
    { icon: <Italic size={15} />, title: '斜体' },
    { icon: <Heading size={15} />, title: '标题' },
    { icon: <List size={15} />, title: '列表' },
    { icon: <Quote size={15} />, title: '引用' },
  ];

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary">
      {/* 左侧：格式按钮 */}
      <div className="flex items-center gap-0.5">
        {toolbarButtons.map((btn, i) => (
          <button
            key={i}
            title={btn.title}
            className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {btn.icon}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        <button
          title="撤销"
          className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Undo2 size={15} />
        </button>
        <button
          title="重做"
          className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Redo2 size={15} />
        </button>
      </div>

      {/* 右侧：字数 + 续写 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-tertiary">{wordCount} 字</span>
        <Button
          variant="primary"
          size="sm"
          icon={<Wand2 size={13} />}
          onClick={onContinueWrite}
        >
          续写
        </Button>
      </div>
    </div>
  );
};

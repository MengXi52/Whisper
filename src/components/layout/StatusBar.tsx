/** 底部状态栏组件 */
import React from 'react';
import { Cloud, CloudOff, Loader2, Check } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { clsx } from 'clsx';

export const StatusBar: React.FC = () => {
  const { currentModel, tokenCount, saveStatus } = useUIStore();

  const saveStatusConfig = {
    saved: { icon: <Check size={12} />, text: '已保存', color: 'text-success' },
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: '保存中...', color: 'text-warning' },
    unsaved: { icon: <CloudOff size={12} />, text: '未保存', color: 'text-warning' },
  };

  const status = saveStatusConfig[saveStatus];

  return (
    <footer className="h-7 flex items-center justify-between px-4 border-t border-border bg-bg-secondary text-xs text-text-tertiary shrink-0">
      {/* 左侧：模型名 */}
      <div className="flex items-center gap-2">
        <Cloud size={12} />
        <span>{currentModel}</span>
      </div>

      {/* 右侧：Token 数 + 保存状态 */}
      <div className="flex items-center gap-4">
        <span>Token: {tokenCount.toLocaleString()}</span>
        <div className={clsx('flex items-center gap-1', status.color)}>
          {status.icon}
          <span>{status.text}</span>
        </div>
      </div>
    </footer>
  );
};

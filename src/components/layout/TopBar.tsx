/** 顶部栏组件 */
import React, { useState } from 'react';
import { Settings, Moon, Sun, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { PHASE_LABELS } from '@/types';
import type { WritingPhase } from '@/types';
import { clsx } from 'clsx';
import { SettingsPanel } from '@/components/settings/SettingsPanel';

const phases: WritingPhase[] = ['ideation', 'planning', 'writing', 'editing'];

export const TopBar: React.FC = () => {
  const { phase, setPhase, theme, toggleTheme, focusMode, toggleFocusMode } = useUIStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-bg-secondary shrink-0">
      {/* 左侧：项目名 */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-sm font-semibold text-text-primary truncate">
          {currentProject?.name ?? '轻语'}
        </h1>
      </div>

      {/* 中间：阶段标签 */}
      <nav className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-0.5">
        {phases.map((p) => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            className={clsx(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors duration-150',
              phase === p
                ? 'bg-accent text-text-inverse shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            {PHASE_LABELS[p]}
          </button>
        ))}
      </nav>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={toggleFocusMode}
          className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={focusMode ? '退出专注模式' : '专注模式'}
        >
          {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="设置"
        >
          <Settings size={16} />
        </button>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
};

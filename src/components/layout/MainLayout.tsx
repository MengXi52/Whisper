/** 三栏布局组件 */
import React from 'react';
import { ChevronLeft, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useUIStore } from '@/stores/uiStore';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { Sidebar } from './Sidebar';
import { DynamicPanel } from '@/components/panel/DynamicPanel';
import { ChatView } from '@/components/chat/ChatView';
import { WritingEditor } from '@/components/editor/WritingEditor';

export const MainLayout: React.FC = () => {
  const { phase, sidebarOpen, panelOpen, focusMode, togglePanel, toggleFocusMode } = useUIStore();

  /* 根据阶段决定中间区域内容 */
  const isWritingPhase = phase === 'writing' || phase === 'editing';

  return (
    <div className="h-full w-full flex flex-col bg-bg-primary relative">
      {/* 顶部栏 */}
      {!focusMode && <TopBar />}

      {/* 专注模式退出按钮 */}
      {focusMode && (
        <button
          onClick={toggleFocusMode}
          className="focus-exit-btn"
          title="退出专注模式"
        >
          <Minimize2 size={16} />
        </button>
      )}

      {/* 主体三栏区域 */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧栏 */}
        {sidebarOpen && !focusMode && <Sidebar />}

        {/* 中间主区域 */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {isWritingPhase ? <WritingEditor /> : <ChatView />}
        </main>

        {/* 右侧动态面板 */}
        {!focusMode && (
          <div className={clsx('panel-container shrink-0', !panelOpen && 'collapsed')}>
            <DynamicPanel />
          </div>
        )}

        {/* 面板收起时的展开按钮 */}
        {!panelOpen && !focusMode && (
          <button
            onClick={togglePanel}
            className="panel-expand-btn"
            title="展开右侧面板"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* 底部状态栏 */}
      {!focusMode && <StatusBar />}
    </div>
  );
};

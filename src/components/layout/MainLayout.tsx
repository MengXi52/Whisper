/** 三栏布局组件 */
import React from 'react';
import { useUIStore } from '@/stores/uiStore';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { Sidebar } from './Sidebar';
import { DynamicPanel } from '@/components/panel/DynamicPanel';
import { ChatView } from '@/components/chat/ChatView';
import { WritingEditor } from '@/components/editor/WritingEditor';

export const MainLayout: React.FC = () => {
  const { phase, sidebarOpen, panelOpen, focusMode } = useUIStore();

  /* 根据阶段决定中间区域内容 */
  const isWritingPhase = phase === 'writing' || phase === 'editing';

  return (
    <div className="h-full w-full flex flex-col bg-bg-primary">
      {/* 顶部栏 */}
      {!focusMode && <TopBar />}

      {/* 主体三栏区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧栏 */}
        {sidebarOpen && !focusMode && <Sidebar />}

        {/* 中间主区域 */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {isWritingPhase ? <WritingEditor /> : <ChatView />}
        </main>

        {/* 右侧动态面板 */}
        {panelOpen && !focusMode && <DynamicPanel />}
      </div>

      {/* 底部状态栏 */}
      {!focusMode && <StatusBar />}
    </div>
  );
};

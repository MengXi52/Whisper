/** 主应用组件 - 三栏布局框架 */
import React, { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { ToastContainer } from '@/components/common/Toast';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import './App.css';

const App: React.FC = () => {
  const { theme } = useUIStore();

  /* 初始化：加载项目列表、技能列表、对话历史和 API 配置 */
  useEffect(() => {
    useProjectStore.getState().loadProjects();
    useChatStore.getState().loadSkills();
    useChatStore.getState().loadConversations();
    useApiConfigStore.getState().loadApiConfigs();
  }, []);

  return (
    <div className={`app-root ${theme}`}>
      <MainLayout />
      <ToastContainer />
    </div>
  );
};

export default App;

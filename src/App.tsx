/** 主应用组件 - 三栏布局框架 */
import React, { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { ToastContainer } from '@/components/common/Toast';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import './App.css';

const App: React.FC = () => {
  const { theme } = useUIStore();

  /* 初始化：加载项目列表和技能列表 */
  useEffect(() => {
    useProjectStore.getState().loadProjects();
    useChatStore.getState().loadSkills();
  }, []);

  return (
    <div className={`app-root ${theme}`}>
      <MainLayout />
      <ToastContainer />
    </div>
  );
};

export default App;

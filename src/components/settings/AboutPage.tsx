/** 关于页面（内嵌于设置面板） */
import React from 'react';
import { Feather, Github, FileText } from 'lucide-react';

export const AboutPage: React.FC = () => {
  return (
    <div className="flex flex-col h-full">
      {/* 页面头 */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">关于</h2>
        <p className="text-xs text-text-tertiary mt-0.5">应用信息与帮助</p>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 应用标识 */}
        <div className="flex flex-col items-center py-6">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
            <Feather size={32} className="text-accent" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary">轻语</h3>
          <p className="text-xs text-text-tertiary mt-1">AI 写作助手 · v0.1.0</p>
        </div>

        {/* 功能介绍 */}
        <div className="mt-4 px-4 py-3 rounded-md bg-bg-tertiary">
          <p className="text-xs text-text-secondary leading-relaxed">
            轻语是一款基于 Tauri 2.0 + React + Rust 构建的桌面 AI 写作助手，
            支持多阶段创作流程（构思 / 大纲 / 写作 / 修改）、设定卡管理、章节大纲、
            流式对话、工具调用以及多种 LLM 接口配置。
          </p>
        </div>

        {/* 技术栈 */}
        <div className="mt-4">
          <h4 className="text-xs font-medium text-text-secondary mb-2">技术栈</h4>
          <div className="flex flex-wrap gap-1.5">
            {['Tauri 2.0', 'React 18', 'TypeScript', 'Rust', 'Zustand', 'TailwindCSS', 'rusqlite', 'Vite'].map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* 链接 */}
        <div className="mt-4 space-y-1">
          <button
            onClick={() => window.open('https://tauri.app/', '_blank')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <FileText size={14} className="text-text-tertiary" />
            Tauri 官方文档
          </button>
          <button
            onClick={() => window.open('https://github.com/', '_blank')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <Github size={14} className="text-text-tertiary" />
            项目仓库
          </button>
        </div>

        {/* 版权 */}
        <div className="mt-6 pt-4 border-t border-border text-center">
          <p className="text-[11px] text-text-tertiary">© 2026 轻语 Whisper · 保留所有权利</p>
        </div>
      </div>
    </div>
  );
};

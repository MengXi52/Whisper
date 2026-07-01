/** 右侧动态面板 */
import React from 'react';
import { Lightbulb, ListTree, PenTool, CheckSquare, ChevronRight } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { SettingCardEditor } from '@/components/settings/SettingCardEditor';

/** 构思阶段面板 */
const IdeationPanel: React.FC = () => (
  <div className="p-4 space-y-4">
    <div className="flex items-center gap-2 mb-2">
      <Lightbulb size={16} className="text-warning" />
      <h3 className="text-sm font-semibold text-text-primary">构思助手</h3>
    </div>

    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">关键词</label>
      <input
        type="text"
        placeholder="输入关键词，用逗号分隔"
        className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>

    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">灵感记录</label>
      <textarea
        placeholder="随时记录你的灵感…"
        rows={4}
        className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>

    <div className="space-y-2">
      <p className="text-xs text-text-tertiary">快捷操作</p>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        💡 生成选题列表
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        🔮 "如果…会怎样"发散
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        📖 生成高概念梗概
      </button>
    </div>
  </div>
);

/** 计划阶段面板 */
const PlanningPanel: React.FC = () => (
  <div className="p-4 space-y-4">
    <div className="flex items-center gap-2 mb-2">
      <ListTree size={16} className="text-accent" />
      <h3 className="text-sm font-semibold text-text-primary">计划助手</h3>
    </div>

    <div className="space-y-2">
      <p className="text-xs text-text-tertiary">大纲操作</p>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        📋 生成章节大纲
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        🎭 人物弧光规划
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        🎵 分幕节奏建议
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        🧵 伏笔埋设提示
      </button>
    </div>
  </div>
);

/** 写作阶段面板 */
const WritingPanel: React.FC = () => {
  const { settingCards } = useSettingsStore();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <PenTool size={16} className="text-success" />
        <h3 className="text-sm font-semibold text-text-primary">写作助手</h3>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">续写风格</label>
        <select className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
          <option>默认风格</option>
          <option>古风言情</option>
          <option>悬疑推理</option>
          <option>轻松幽默</option>
          <option>严肃文学</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">续写长度</label>
        <select className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
          <option>短（100-200字）</option>
          <option>中（200-500字）</option>
          <option>长（500-1000字）</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-medium text-text-secondary mb-2">设定引用</p>
        {settingCards.length === 0 ? (
          <p className="text-xs text-text-tertiary">暂无设定卡</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {settingCards.slice(0, 10).map((card) => (
              <div
                key={card.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-tertiary hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <span className="text-xs text-text-primary truncate">{card.name}</span>
                <span className="text-xs text-text-tertiary shrink-0">{card.card_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** 修改阶段面板 */
const EditingPanel: React.FC = () => (
  <div className="p-4 space-y-4">
    <div className="flex items-center gap-2 mb-2">
      <CheckSquare size={16} className="text-error" />
      <h3 className="text-sm font-semibold text-text-primary">修改助手</h3>
    </div>

    <div className="space-y-2">
      <p className="text-xs text-text-tertiary">检查与调整</p>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        🔍 一致性检查
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        ✏️ 语气调整
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        📏 语法校正
      </button>
      <button className="w-full text-left px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover text-sm text-text-primary transition-colors">
        📊 可读性分析
      </button>
    </div>
  </div>
);

export const DynamicPanel: React.FC = () => {
  const { phase, togglePanel } = useUIStore();
  const { currentCard } = useSettingsStore();

  /* 根据阶段选择面板内容 */
  const phasePanelMap: Record<string, React.ReactNode> = {
    ideation: <IdeationPanel />,
    planning: <PlanningPanel />,
    writing: <WritingPanel />,
    editing: <EditingPanel />,
  };

  return (
    <aside className="w-[300px] h-full flex flex-col bg-bg-panel border-l border-border shrink-0 overflow-hidden">
      {/* 面板标题 + 折叠按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          {phase === 'ideation' && '构思'}
          {phase === 'planning' && '计划'}
          {phase === 'writing' && '写作'}
          {phase === 'editing' && '修改'}
        </span>
        <button
          onClick={togglePanel}
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* 阶段对应内容 */}
      <div className="flex-1 overflow-y-auto">
        {phasePanelMap[phase]}

        {/* 设定卡编辑器（如果选中了设定卡） */}
        {currentCard && (
          <div className="border-t border-border">
            <SettingCardEditor />
          </div>
        )}
      </div>
    </aside>
  );
};

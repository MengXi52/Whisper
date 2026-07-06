/** 设置面板：左侧目录 + 右侧内容页 */
import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { X, Cloud, Info } from 'lucide-react';
import { ApiConfigPage } from './ApiConfigPage';
import { AboutPage } from './AboutPage';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 配置项定义 */
type SettingsSection = 'api' | 'about';

interface SectionDef {
  key: SettingsSection;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'api',
    label: 'API 配置',
    desc: '大模型接口与模型',
    icon: <Cloud size={14} />,
  },
  {
    key: 'about',
    label: '关于',
    desc: '应用信息与帮助',
    icon: <Info size={14} />,
  },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const [section, setSection] = useState<SettingsSection>('api');

  /* ESC 关闭：仅在未聚焦输入框/文本域时关闭面板，避免编辑表单时误触 */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      const tag = active?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (active as HTMLElement | null)?.isContentEditable) {
        /* 在输入控件中按 ESC：让控件失焦，不关闭面板 */
        (active as HTMLElement | null)?.blur();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 面板主体 */}
      <div className="relative w-[720px] h-[520px] max-w-[90vw] max-h-[90vh] rounded-lg bg-bg-primary shadow-lg border border-border overflow-hidden flex">
        {/* 左侧：配置目录 */}
        <aside className="w-[180px] shrink-0 border-r border-border bg-bg-secondary flex flex-col">
          {/* 头部（含关闭按钮） */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">设置</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="关闭 (Esc)"
            >
              <X size={14} />
            </button>
          </div>

          {/* 目录列表 */}
          <nav className="flex-1 p-2 space-y-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={clsx(
                  'w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left transition-colors',
                  section === s.key
                    ? 'bg-accent text-text-inverse'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                )}
              >
                <span className={clsx('shrink-0 mt-0.5', section === s.key ? 'text-text-inverse' : 'text-text-tertiary')}>
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{s.label}</div>
                  <div
                    className={clsx(
                      'text-[11px] truncate mt-0.5',
                      section === s.key ? 'text-text-inverse/70' : 'text-text-tertiary'
                    )}
                  >
                    {s.desc}
                  </div>
                </div>
              </button>
            ))}
          </nav>
        </aside>

        {/* 右侧：内容页 */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* 内容区 */}
          <div className="flex-1 min-h-0">
            {section === 'api' && <ApiConfigPage />}
            {section === 'about' && <AboutPage />}
          </div>
        </main>
      </div>
    </div>
  );
};

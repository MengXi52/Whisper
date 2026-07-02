/** 项目初始化页面 - 无项目时要求用户先创建项目 */
import React, { useState } from 'react';
import { BookOpen, PenLine, Sparkles } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/common/Button';

type Genre = 'general' | 'xianxia' | 'fantasy' | 'sci-fi' | 'romance' | 'mystery' | 'horror' | 'history' | 'other';

const GENRE_OPTIONS: { value: Genre; label: string }[] = [
  { value: 'general', label: '通用' },
  { value: 'fantasy', label: '奇幻' },
  { value: 'xianxia', label: '仙侠' },
  { value: 'sci-fi', label: '科幻' },
  { value: 'romance', label: '言情' },
  { value: 'mystery', label: '悬疑' },
  { value: 'horror', label: '恐怖' },
  { value: 'history', label: '历史' },
  { value: 'other', label: '其他' },
];

export const ProjectInitScreen: React.FC = () => {
  const { createProject, loading } = useProjectStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState<Genre>('general');
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createProject(name.trim(), description.trim(), genre);
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-bg-primary">
      {/* 欢迎区域 */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
          <PenLine size={32} className="text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">欢迎来到轻语</h1>
        <p className="text-sm text-text-tertiary max-w-md">
          创建你的第一个项目，开始写作之旅
        </p>
      </div>

      {/* 快速创建按钮 */}
      {!showForm ? (
        <div className="flex flex-col items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            icon={<Sparkles size={18} />}
            onClick={() => setShowForm(true)}
          >
            创建新项目
          </Button>
          <p className="text-xs text-text-tertiary">需要先创建一个项目才能开始写作</p>
        </div>
      ) : (
        /* 创建表单 */
        <div className="w-full max-w-md mx-auto px-6">
          <div className="bg-bg-panel rounded-xl border border-border p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <BookOpen size={18} className="text-accent" />
              <h2 className="text-base font-semibold text-text-primary">新建项目</h2>
            </div>

            <div className="space-y-4">
              {/* 项目名称 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  项目名称 <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="给你的作品取个名字"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) {
                      handleCreate();
                    }
                  }}
                />
              </div>

              {/* 作品类型 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  作品类型
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {GENRE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setGenre(opt.value)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        genre === opt.value
                          ? 'bg-accent text-text-inverse'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 项目简介 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  项目简介 <span className="text-text-tertiary">（可选）</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="简单描述你的作品..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                返回
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!name.trim() || loading}
                onClick={handleCreate}
              >
                {loading ? '创建中...' : '创建项目'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
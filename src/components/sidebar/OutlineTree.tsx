/** 大纲树组件 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { clsx } from 'clsx';

export const OutlineTree: React.FC = () => {
  const { chapters, currentChapter, selectChapter, createChapter, deleteChapter } = useProjectStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 按层级组织章节 */
  const rootChapters = chapters.filter((c) => !c.parent_id);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAddChapter = async () => {
    if (!currentProject) return;
    await createChapter({
      project_id: currentProject.id,
      parent_id: null,
      title: `第${chapters.length + 1}章`,
      content: '',
      sort_order: chapters.length,
      status: 'draft',
      word_count: 0,
    });
  };

  const handleDelete = async (id: string) => {
    await deleteChapter(id);
  };

  const renderChapter = (chapter: typeof chapters[0], depth: number = 0) => {
    const children = chapters.filter((c) => c.parent_id === chapter.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(chapter.id);
    const isSelected = currentChapter?.id === chapter.id;

    return (
      <div key={chapter.id}>
        <div
          className={clsx(
            'group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-sm',
            'hover:bg-bg-hover transition-colors',
            isSelected && 'bg-accent-light text-accent'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => selectChapter(chapter)}
        >
          {/* 展开/折叠图标 */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(chapter.id);
              }}
              className="p-0.5 text-text-tertiary hover:text-text-primary"
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-4" />
          )}

          {/* 章节图标 */}
          <FileText size={13} className="text-text-tertiary shrink-0" />

          {/* 标题 */}
          <span className="flex-1 truncate text-text-primary">{chapter.title}</span>

          {/* 状态标记 */}
          {chapter.status === 'completed' && (
            <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" title="已完成" />
          )}
          {chapter.status === 'revising' && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" title="修改中" />
          )}

          {/* 删除按钮（hover 显示） */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(chapter.id);
            }}
            className="p-0.5 rounded text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* 子章节 */}
        {hasChildren && isExpanded && (
          <div>
            {children.map((child) => renderChapter(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="py-1">
      {rootChapters.length === 0 ? (
        <div className="px-4 py-3 text-xs text-text-tertiary">暂无章节</div>
      ) : (
        rootChapters.map((chapter) => renderChapter(chapter))
      )}

      {/* 新增章节按钮 */}
      <button
        onClick={handleAddChapter}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-tertiary hover:text-accent hover:bg-bg-hover rounded-md transition-colors mt-1"
      >
        <Plus size={12} />
        <span>新增章节</span>
      </button>
    </div>
  );
};

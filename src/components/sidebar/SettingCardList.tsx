/** 设定卡列表组件 */
import React, { useState } from 'react';
import { Users, Castle, Globe, Package, Zap, Clock, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { CARD_TYPE_LABELS } from '@/types';
import type { CardType } from '@/types';
import { clsx } from 'clsx';

/** 设定卡类型图标映射 */
const cardTypeIcons: Record<CardType, React.ReactNode> = {
  character: <Users size={13} />,
  faction: <Castle size={13} />,
  world: <Globe size={13} />,
  item: <Package size={13} />,
  skill_system: <Zap size={13} />,
  event: <Clock size={13} />,
};

/** 设定卡类型颜色映射 */
const cardTypeColors: Record<CardType, string> = {
  character: 'text-blue-400',
  faction: 'text-red-400',
  world: 'text-green-400',
  item: 'text-yellow-400',
  skill_system: 'text-purple-400',
  event: 'text-orange-400',
};

export const SettingCardList: React.FC = () => {
  const { settingCards, selectCard, createSettingCard, deleteSettingCard } = useSettingsStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const { setPanelTab, panelOpen, togglePanel } = useUIStore();

  /* 每个类型分组独立的折叠状态 + 分页可见数量 */
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
  const [visibleCountByType, setVisibleCountByType] = useState<Record<string, number>>({});

  /* 每个类型初始显示 5 条，点击"查看更多"再加 10 条 */
  const INITIAL_VISIBLE = 5;
  const LOAD_STEP = 10;

  const handleToggleType = (type: string) => {
    setCollapsedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const handleLoadMore = (type: string) => {
    setVisibleCountByType((prev) => ({
      ...prev,
      [type]: (prev[type] ?? INITIAL_VISIBLE) + LOAD_STEP,
    }));
  };

  const handleSelectCard = (card: typeof settingCards[number]) => {
    selectCard(card);
    /* 自动展开右侧面板并切换到操作 Tab */
    setPanelTab('operations');
    if (!panelOpen) {
      togglePanel();
    }
  };

  const handleCreate = async (type: CardType) => {
    if (!currentProject) return;
    await createSettingCard(
      currentProject.id,
      type,
      `新${CARD_TYPE_LABELS[type]}`,
      '{}' // 空 JSON 对象
    );
  };

  /* 按类型分组 */
  const grouped = settingCards.reduce<Record<string, typeof settingCards>>((acc, card) => {
    if (!acc[card.card_type]) acc[card.card_type] = [];
    acc[card.card_type].push(card);
    return acc;
  }, {} as Record<string, typeof settingCards>);

  return (
    <div className="py-1">
      {Object.keys(grouped).length === 0 ? (
        <div className="px-3 py-2 text-xs text-text-tertiary">暂无设定卡</div>
      ) : (
        (Object.entries(grouped) as [string, typeof settingCards][]).map(([type, cards]) => {
          const collapsed = collapsedTypes[type] ?? false;
          const visibleCount = visibleCountByType[type] ?? INITIAL_VISIBLE;
          const visibleCards = collapsed ? [] : cards.slice(0, visibleCount);
          const hasMore = !collapsed && cards.length > visibleCount;

          return (
            <div key={type} className="mb-1">
              {/* 类型标题（可点击折叠） */}
              <button
                onClick={() => handleToggleType(type)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover rounded-md transition-colors"
              >
                {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                <span className={cardTypeColors[type as CardType]}>{cardTypeIcons[type as CardType]}</span>
                <span>{CARD_TYPE_LABELS[type as CardType]}</span>
                <span className="text-text-tertiary">({cards.length})</span>
              </button>

              {/* 该类型下的设定卡 */}
              {visibleCards.map((card) => (
                <div
                  key={card.id}
                  className="group flex items-center gap-1 px-2 py-1 hover:bg-bg-hover rounded-md transition-colors cursor-pointer ml-2"
                  onClick={() => handleSelectCard(card)}
                >
                  <span className="flex-1 text-xs text-text-primary truncate min-w-0">
                    {card.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSettingCard(card.id);
                    }}
                    className="shrink-0 p-0.5 rounded text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除设定卡"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              {/* 查看更多 */}
              {hasMore && (
                <button
                  onClick={() => handleLoadMore(type)}
                  className="w-full text-left px-3 py-1 text-[11px] text-text-tertiary hover:text-accent hover:bg-bg-hover rounded transition-colors ml-2"
                >
                  查看更多...
                </button>
              )}
            </div>
          );
        })
      )}

      {/* 快速新建按钮 */}
      <div className="mt-2 px-2">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((type) => (
            <button
              key={type}
              onClick={() => handleCreate(type)}
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-1 rounded text-xs',
                'text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors',
                cardTypeColors[type]
              )}
            >
              {cardTypeIcons[type]}
              <span>{CARD_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

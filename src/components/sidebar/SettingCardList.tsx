/** 设定卡列表组件 */
import React from 'react';
import { Users, Castle, Globe, Package, Zap, Clock, Trash2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
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

  /* 按类型分组 */
  const grouped = settingCards.reduce<Record<CardType, typeof settingCards>>((acc, card) => {
    if (!acc[card.card_type]) acc[card.card_type] = [];
    acc[card.card_type].push(card);
    return acc;
  }, {} as Record<CardType, typeof settingCards>);

  const handleCreate = async (type: CardType) => {
    if (!currentProject) return;
    await createSettingCard(
      currentProject.id,
      type,
      `新${CARD_TYPE_LABELS[type]}`,
      '{}' // 空 JSON 对象
    );
  };

  return (
    <div className="py-1">
      {Object.keys(grouped).length === 0 ? (
        <div className="px-3 py-2 text-xs text-text-tertiary">暂无设定卡</div>
      ) : (
        (Object.entries(grouped) as [CardType, typeof settingCards][]).map(([type, cards]) => (
          <div key={type} className="mb-1">
            {/* 类型标题 */}
            <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-text-secondary">
              <span className={cardTypeColors[type]}>{cardTypeIcons[type]}</span>
              <span>{CARD_TYPE_LABELS[type]}</span>
              <span className="text-text-tertiary">({cards.length})</span>
            </div>

            {/* 该类型下的设定卡 */}
            {cards.map((card) => (
              <div
                key={card.id}
                className="group flex items-center gap-1 px-2 py-1 hover:bg-bg-hover rounded-md transition-colors cursor-pointer"
                onClick={() => selectCard(card)}
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
          </div>
        ))
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

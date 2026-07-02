/** 设定卡编辑器 */
import React, { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { CARD_TYPE_TEMPLATES } from '@/types';
import type { CardType } from '@/types';
import { Button } from '@/components/common/Button';

export const SettingCardEditor: React.FC = () => {
  const { currentCard, updateSettingCard, selectCard } = useSettingsStore();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [name, setName] = useState('');

  useEffect(() => {
    if (currentCard) {
      setFields({ ...currentCard.fields });
      setName(currentCard.name);
    }
  }, [currentCard]);

  if (!currentCard) {
    return (
      <div className="h-full flex items-center justify-center text-text-tertiary text-sm">
        选择一个设定卡进行编辑
      </div>
    );
  }

  const template = CARD_TYPE_TEMPLATES[currentCard.card_type as CardType];

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await updateSettingCard(currentCard.id, name, JSON.stringify(fields));
  };

  const handleCancel = () => {
    selectCard(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-accent-light text-accent">
            {template?.label ?? currentCard.card_type}
          </span>
          <h3 className="text-sm font-semibold text-text-primary">{name}</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleCancel} icon={<X size={14} />}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} icon={<Save size={14} />}>
            保存
          </Button>
        </div>
      </div>

      {/* 表单 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* 名称字段 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-text-secondary mb-1">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* 模板字段 */}
        {template?.fields.map((field) => (
          <div key={field.key} className="mb-4">
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {field.label}
            </label>
            {field.key === 'background' || field.key === 'process' || field.key === 'geography' || field.key === 'history' ? (
              <textarea
                value={fields[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent"
              />
            ) : (
              <input
                type="text"
                value={fields[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            )}
          </div>
        ))}

        {/* 自定义字段区域 */}
        <div className="border-t border-border pt-3 mt-3">
          <p className="text-xs text-text-tertiary mb-2">自定义字段</p>
          {Object.entries(fields)
            .filter(([key]) => !template?.fields.some((f) => f.key === key))
            .map(([key, value]) => (
              <div key={key} className="mb-3">
                <label className="block text-xs font-medium text-text-secondary mb-1">{key}</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

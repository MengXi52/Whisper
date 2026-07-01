/** 版本历史列表 */
import React from 'react';
import { Clock, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/common/Button';

export const SettingCardVersionList: React.FC = () => {
  const { versions, currentCard, updateSettingCard } = useSettingsStore();

  if (!currentCard) return null;

  const handleRollback = async (versionId: string) => {
    const version = versions.find((v) => v.id === versionId);
    if (!version) return;
    await updateSettingCard(currentCard.id, { fields: version.fields });
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-text-tertiary" />
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">版本历史</h4>
      </div>

      {versions.length === 0 ? (
        <p className="text-xs text-text-tertiary">暂无版本记录</p>
      ) : (
        <div className="space-y-2">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-bg-tertiary hover:bg-bg-hover transition-colors"
            >
              <div>
                <p className="text-xs text-text-primary">
                  {index === 0 ? '当前版本' : `版本 ${versions.length - index}`}
                </p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {new Date(version.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw size={12} />}
                  onClick={() => handleRollback(version.id)}
                >
                  回滚
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

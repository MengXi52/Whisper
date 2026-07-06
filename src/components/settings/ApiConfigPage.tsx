/** API 配置页（内嵌于设置面板） */
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, Pencil, X, Save } from 'lucide-react';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { toast } from '@/components/common/Toast';
import type { ApiConfig } from '@/types';

export const ApiConfigPage: React.FC = () => {
  const { apiConfigs, loadApiConfigs, saveConfig, deleteConfig, setDefaultConfig } = useApiConfigStore();
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelThinking, setModelThinking] = useState('');
  const [modelWriting, setModelWriting] = useState('');
  /* 编辑时保留原配置的 is_default 状态，避免编辑默认配置后被取消默认 */
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadApiConfigs();
  }, [loadApiConfigs]);

  const resetForm = () => {
    setEditing(false);
    setEditId(undefined);
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModelThinking('');
    setModelWriting('');
    setIsDefault(false);
  };

  const handleNew = () => {
    resetForm();
    setEditing(true);
  };

  const handleEdit = (config: ApiConfig) => {
    setEditId(config.id);
    setName(config.name);
    setBaseUrl(config.base_url);
    setApiKey(config.api_key);
    setModelThinking(config.model_thinking);
    setModelWriting(config.model_writing);
    setIsDefault(config.is_default);
    setEditing(true);
  };

  const handleSave = async () => {
    /* 必填项校验 */
    if (!name.trim()) {
      toast.warning('请填写配置名称');
      return;
    }
    if (!baseUrl.trim()) {
      toast.warning('请填写 Base URL');
      return;
    }
    if (!apiKey.trim()) {
      toast.warning('请填写 API Key');
      return;
    }
    if (!modelWriting.trim()) {
      toast.warning('请填写聊天/写作模型');
      return;
    }
    setSaving(true);
    try {
      await saveConfig({
        id: editId,
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        /* 允许 model_thinking 留空（不为空时直接使用原值） */
        model_thinking: modelThinking.trim(),
        model_writing: modelWriting.trim(),
        is_default: isDefault,
      });
      toast.success(editId ? '配置已更新' : '配置已添加');
      resetForm();
    } catch (e) {
      toast.error('保存配置失败：' + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 页面头 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">API 配置</h2>
          <p className="text-xs text-text-tertiary mt-0.5">配置大模型 API 接口与模型</p>
        </div>
        {!editing && (
          <button
            onClick={handleNew}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-accent text-text-inverse hover:opacity-90 transition-opacity"
          >
            <Plus size={12} /> 添加配置
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {editing ? (
          /* 编辑表单 */
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：DeepSeek"
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">思考模型</label>
                <input
                  type="text"
                  value={modelThinking}
                  onChange={(e) => setModelThinking(e.target.value)}
                  placeholder="deepseek-reasoner"
                  className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">聊天/写作模型</label>
                <input
                  type="text"
                  value={modelWriting}
                  onChange={(e) => setModelWriting(e.target.value)}
                  placeholder="deepseek-chat"
                  className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
            {/* 设为默认 */}
            <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-text-secondary">设为默认配置</span>
            </label>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-accent text-text-inverse hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={12} /> {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={resetForm}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-50"
              >
                <X size={12} /> 取消
              </button>
            </div>
          </div>
        ) : (
          /* 配置列表 */
          <div className="space-y-2">
            {apiConfigs.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-8">
                暂无配置，点击右上角"添加配置"
              </p>
            ) : (
              apiConfigs.map((config) => (
                <div
                  key={config.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-bg-tertiary hover:bg-bg-hover transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{config.name}</span>
                      {config.is_default && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent-light text-accent">默认</span>
                      )}
                    </div>
                    <div className="text-xs text-text-tertiary mt-0.5 truncate">
                      {config.base_url} · {config.model_writing}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!config.is_default && (
                      <button
                        onClick={async () => {
                          try {
                            await setDefaultConfig(config.id);
                            toast.success('已设为默认');
                          } catch (e) {
                            toast.error('设置默认失败：' + String(e));
                          }
                        }}
                        className="p-1 rounded text-text-tertiary hover:text-success transition-colors"
                        title="设为默认"
                      >
                        <Check size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(config)}
                      className="p-1 rounded text-text-tertiary hover:text-text-primary transition-colors"
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`确认删除配置「${config.name}」？`)) return;
                        try {
                          await deleteConfig(config.id);
                          toast.success('配置已删除');
                        } catch (e) {
                          toast.error('删除失败：' + String(e));
                        }
                      }}
                      className="p-1 rounded text-text-tertiary hover:text-error transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

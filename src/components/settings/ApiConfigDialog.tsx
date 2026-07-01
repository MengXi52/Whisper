/** API 配置对话框 */
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, Pencil } from 'lucide-react';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { Dialog } from '@/components/common/Dialog';
import { Button } from '@/components/common/Button';

interface ApiConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export const ApiConfigDialog: React.FC<ApiConfigDialogProps> = ({ open, onClose }) => {
  const { apiConfigs, loadApiConfigs, saveConfig, deleteConfig, setDefaultConfig } = useApiConfigStore();
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelThinking, setModelThinking] = useState('');
  const [modelWriting, setModelWriting] = useState('');

  useEffect(() => {
    if (open) {
      loadApiConfigs();
      resetForm();
    }
  }, [open]);

  const resetForm = () => {
    setEditing(false);
    setEditId(undefined);
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModelThinking('');
    setModelWriting('');
  };

  const handleNew = () => {
    resetForm();
    setEditing(true);
  };

  const handleEdit = (config: import('@/types').ApiConfig) => {
    setEditId(config.id);
    setName(config.name);
    setBaseUrl(config.base_url);
    setApiKey(config.api_key);
    setModelThinking(config.model_thinking);
    setModelWriting(config.model_writing);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!name || !baseUrl || !apiKey || !modelWriting) return;
    await saveConfig({
      id: editId,
      name,
      base_url: baseUrl,
      api_key: apiKey,
      model_thinking: modelThinking || modelWriting,
      model_writing: modelWriting,
      is_default: false,
    });
    resetForm();
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteConfig(id);
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultConfig(id);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="API 配置"
      width="max-w-lg"
      footer={
        !editing ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
            <Button variant="primary" onClick={handleNew} icon={<Plus size={14} />}>
              添加配置
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={handleCancel}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave}>
              保存
            </Button>
          </>
        )
      }
    >
      {editing ? (
        /* 编辑表单 */
        <div className="space-y-4">
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
        </div>
      ) : (
        /* 配置列表 */
        <div className="space-y-2">
          {apiConfigs.length === 0 ? (
            <p className="text-sm text-text-tertiary text-center py-4">暂无配置，点击下方按钮添加</p>
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
                      onClick={() => handleSetDefault(config.id)}
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
                    onClick={() => handleDelete(config.id)}
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
    </Dialog>
  );
};

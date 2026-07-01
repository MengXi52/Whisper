/** Toast 通知组件 */
import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-success" />,
  error: <AlertCircle size={18} className="text-error" />,
  info: <Info size={18} className="text-accent" />,
  warning: <AlertTriangle size={18} className="text-warning" />,
};

const bgMap: Record<ToastType, string> = {
  success: 'border-success/30',
  error: 'border-error/30',
  info: 'border-accent/30',
  warning: 'border-warning/30',
};

/* 全局 Toast 列表状态 */
let toastList: ToastItem[] = [];
let listeners: Array<() => void> = [];

function emitChange() {
  listeners.forEach((l) => l());
}

function addToast(type: ToastType, message: string, duration = 3000) {
  const id = crypto.randomUUID();
  toastList = [...toastList, { id, type, message, duration }];
  emitChange();
  if (duration > 0) {
    setTimeout(() => {
      toastList = toastList.filter((t) => t.id !== id);
      emitChange();
    }, duration);
  }
}

function removeToast(id: string) {
  toastList = toastList.filter((t) => t.id !== id);
  emitChange();
}

/** Toast 工具方法 */
export const toast = {
  success: (msg: string, duration?: number) => addToast('success', msg, duration),
  error: (msg: string, duration?: number) => addToast('error', msg, duration),
  info: (msg: string, duration?: number) => addToast('info', msg, duration),
  warning: (msg: string, duration?: number) => addToast('warning', msg, duration),
};

/** Toast 容器组件，放在 App 根节点 */
export const ToastContainer: React.FC = () => {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toastList.map((item) => (
        <ToastMessage key={item.id} item={item} onClose={() => removeToast(item.id)} />
      ))}
    </div>
  );
};

/** 单条 Toast */
const ToastMessage: React.FC<{ item: ToastItem; onClose: () => void }> = ({ item, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={clsx(
        'pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg',
        'bg-bg-secondary border shadow-md',
        'transition-all duration-300',
        bgMap[item.type],
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
      )}
    >
      {iconMap[item.type]}
      <span className="text-sm text-text-primary flex-1">{item.message}</span>
      <button
        onClick={onClose}
        className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};

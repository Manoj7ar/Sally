export type ToastTone = 'error' | 'info';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();

export function showToast(toast: Omit<ToastMessage, 'id'>): void {
  const nextToast: ToastMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tone: toast.tone || 'info',
    durationMs: toast.durationMs ?? 4000,
    ...toast,
  };

  listeners.forEach((listener) => listener(nextToast));
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

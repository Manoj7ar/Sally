import { useEffect, useState } from 'react';
import type { ToastMessage } from '../lib/toastBus';
import { subscribeToasts } from '../lib/toastBus';
import { THEME } from '../theme/tokens';

const TOAST_SPACING = 12;

export default function ToastViewport() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, toast.durationMs ?? 4000);
    });
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 2000000,
        display: 'flex',
        flexDirection: 'column',
        gap: TOAST_SPACING,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const isError = toast.tone === 'error';
        return (
          <div
            key={toast.id}
            style={{
              width: 320,
              padding: '12px 14px',
              borderRadius: 14,
              background: isError ? THEME.toast.errorBackground : THEME.toast.background,
              border: `1px solid ${isError ? THEME.toast.errorBorder : THEME.toast.border}`,
              boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
              color: THEME.text.inverse,
              backdropFilter: 'blur(16px) saturate(140%)',
              WebkitBackdropFilter: 'blur(16px) saturate(140%)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: toast.description ? 4 : 0 }}>
              {toast.title}
            </div>
            {toast.description ? (
              <div style={{ fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.86)' }}>
                {toast.description}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

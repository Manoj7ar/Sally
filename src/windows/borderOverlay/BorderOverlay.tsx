import { useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { OverlayHighlightPayload } from '../../../shared/types';

const OVERLAY_BLUE = '#2563EB';
const SCRIM = 'rgba(2, 6, 23, 0.45)';
const WAITING_SCRIM = 'rgba(2, 6, 23, 0.58)';
const WAITING_PANEL = 'rgba(15, 23, 42, 0.8)';
const WAITING_PANEL_BORDER = 'rgba(148, 163, 184, 0.28)';
const DANGER_PANEL = 'rgba(127, 29, 29, 0.84)';
const DANGER_PANEL_BORDER = 'rgba(248, 113, 113, 0.38)';

export default function BorderOverlay() {
  const [overlay, setOverlay] = useState<OverlayHighlightPayload | null>({ mode: 'border' });
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    const unsubs = [
      ipc.subscribe('sally:overlay-highlight', (payload) => {
        setOverlay(payload);
      }),
      ipc.subscribe('sally:overlay-clear', () => {
        setOverlay(null);
      }),
    ];

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    if (overlay?.mode !== 'waiting') {
      setIsCancelling(false);
    }
  }, [overlay]);

  const handleEndAgent = async () => {
    if (isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      await ipc.invoke('sally:cancel');
    } catch (error) {
      console.error('Failed to cancel active task:', error);
      setIsCancelling(false);
    }
  };

  const isWaitingOverlay = overlay?.mode === 'waiting';
  const rect = overlay?.mode === 'target' ? overlay.rect : null;
  const targetLabel = overlay?.mode === 'target' ? overlay.label : null;

  return (
    <>
      <style>{`
        @keyframes sallyTargetPulse {
          0% { transform: scale(1); box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.55), 0 0 22px rgba(37, 99, 235, 0.35), 0 0 0 9999px ${SCRIM}; }
          50% { transform: scale(1.006); box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.78), 0 0 34px rgba(37, 99, 235, 0.5), 0 0 0 9999px ${SCRIM}; }
          100% { transform: scale(1); box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.55), 0 0 22px rgba(37, 99, 235, 0.35), 0 0 0 9999px ${SCRIM}; }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          border: `3px solid ${OVERLAY_BLUE}`,
          borderRadius: '12px',
          boxShadow: 'inset 0 0 20px rgba(37, 99, 235, 0.3), 0 0 20px rgba(37, 99, 235, 0.2)',
          zIndex: 999998,
          opacity: overlay && !isWaitingOverlay ? 1 : 0,
          transition: 'opacity 140ms ease',
        }}
      />
      {rect && (
        <>
          <div
            style={{
              position: 'fixed',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none',
              borderRadius: 12,
              border: `3px solid ${OVERLAY_BLUE}`,
              animation: 'sallyTargetPulse 1.2s ease-in-out infinite',
              zIndex: 999999,
            }}
          />
          {targetLabel ? (
            <div
              style={{
                position: 'fixed',
                left: rect.x,
                top: Math.max(14, rect.y - 34),
                maxWidth: 320,
                padding: '6px 10px',
                borderRadius: 999,
                background: 'rgba(15, 23, 42, 0.88)',
                border: '1px solid rgba(96, 165, 250, 0.55)',
                color: 'rgba(255,255,255,0.94)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.01em',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                pointerEvents: 'none',
                zIndex: 1000000,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {targetLabel}
            </div>
          ) : null}
        </>
      )}
      {isWaitingOverlay ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
            background: WAITING_SCRIM,
            backdropFilter: 'blur(18px) saturate(128%)',
            WebkitBackdropFilter: 'blur(18px) saturate(128%)',
            zIndex: 1000001,
          }}
        >
          <div
            style={{
              width: 'min(420px, calc(100vw - 48px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              alignItems: 'stretch',
            }}
          >
            <div
              style={{
                padding: '18px 22px',
                borderRadius: 18,
                background: WAITING_PANEL,
                border: `1px solid ${WAITING_PANEL_BORDER}`,
                color: 'rgba(255,255,255,0.96)',
                textAlign: 'center',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '0.01em',
                boxShadow: '0 28px 60px rgba(2, 6, 23, 0.38)',
              }}
            >
              {overlay.message}
            </div>
            <button
              type="button"
              onClick={() => { void handleEndAgent(); }}
              disabled={isCancelling}
              style={{
                appearance: 'none',
                border: `1px solid ${DANGER_PANEL_BORDER}`,
                borderRadius: 18,
                background: DANGER_PANEL,
                color: 'rgba(255,255,255,0.96)',
                padding: '16px 22px',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: '0.01em',
                cursor: isCancelling ? 'default' : 'pointer',
                boxShadow: '0 24px 54px rgba(69, 10, 10, 0.28)',
                opacity: isCancelling ? 0.72 : 1,
              }}
            >
              {isCancelling ? 'Ending...' : (overlay.actionLabel || 'End Agent')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

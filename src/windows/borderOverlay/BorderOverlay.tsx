import { useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { OverlayHighlightPayload } from '../../../shared/types';

const OVERLAY_BLUE = '#2563EB';
const SCRIM = 'rgba(2, 6, 23, 0.45)';

export default function BorderOverlay() {
  const [overlay, setOverlay] = useState<OverlayHighlightPayload | null>({ mode: 'border' });

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

  const rect = overlay?.mode === 'target' ? overlay.rect : null;

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
          opacity: overlay ? 1 : 0,
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
          {overlay?.label ? (
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
              {overlay.label}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

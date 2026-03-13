import { useEffect, useMemo, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { BrowserUiState } from '../../../shared/types';

const CHROME_HEIGHT = 108;

const EMPTY_STATE: BrowserUiState = {
  tabs: [],
  activeTabId: null,
  activeTitle: '',
  activeUrl: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

function hostLabel(url: string): string {
  if (!url) return 'New Tab';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function tabLabel(title: string, url: string): string {
  return title.trim() || hostLabel(url) || 'New Tab';
}

export default function BrowserWindow() {
  const [browserState, setBrowserState] = useState<BrowserUiState>(EMPTY_STATE);
  const [addressValue, setAddressValue] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadState = async () => {
      const state = await ipc.invoke('browser:get-state');
      if (mounted) {
        setBrowserState(state);
      }
    };

    void loadState();
    const unsubscribe = ipc.subscribe('browser:state-changed', (state) => {
      setBrowserState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isEditingAddress) {
      setAddressValue(browserState.activeUrl);
    }
  }, [browserState.activeUrl, isEditingAddress]);

  const activeHost = useMemo(() => hostLabel(browserState.activeUrl), [browserState.activeUrl]);

  const handleNavigate = async () => {
    const next = addressValue.trim();
    if (!next) return;
    setIsEditingAddress(false);
    await ipc.invoke('browser:navigate', { url: next });
  };

  return (
    <div
      data-testid="browser-shell"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#081120',
        color: '#e6eef8',
      }}
    >
      <div
        className="drag-region"
        style={{
          height: CHROME_HEIGHT,
          padding: '12px 16px 14px',
          background: 'linear-gradient(180deg, #0f172a 0%, #111d34 70%, #0f172a 100%)',
          borderBottom: '1px solid rgba(148,163,184,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {browserState.tabs.map((tab) => (
              <button
                key={tab.id}
                className="no-drag"
                data-testid={tab.isActive ? 'browser-tab-active' : 'browser-tab'}
                onClick={() => ipc.invoke('browser:switch-tab', { tabId: tab.id })}
                style={{
                  minWidth: 0,
                  maxWidth: 220,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0 12px',
                  borderRadius: 14,
                  border: tab.isActive ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.05)',
                  background: tab.isActive ? 'rgba(37,99,235,0.22)' : 'rgba(15,23,42,0.72)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: tab.isLoading ? '#60a5fa' : '#1e293b',
                    color: '#dbeafe',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {(hostLabel(tab.url).charAt(0) || 'S').toUpperCase()}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12.5,
                    fontWeight: tab.isActive ? 700 : 600,
                    minWidth: 0,
                  }}
                >
                  {tabLabel(tab.title, tab.url)}
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    void ipc.invoke('browser:close-tab', { tabId: tab.id });
                  }}
                  style={{
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.06)',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.72)',
                    flexShrink: 0,
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>

          <button
            className="no-drag"
            data-testid="browser-new-tab"
            onClick={() => ipc.invoke('browser:new-tab')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: '1px solid rgba(96,165,250,0.25)',
              background: 'rgba(37,99,235,0.18)',
              color: '#dbeafe',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            +
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="no-drag">
            <button
              data-testid="browser-go-back"
              onClick={() => ipc.invoke('browser:go-back')}
              disabled={!browserState.canGoBack}
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                background: browserState.canGoBack ? 'rgba(15,23,42,0.9)' : 'rgba(15,23,42,0.5)',
                color: browserState.canGoBack ? '#e2e8f0' : 'rgba(226,232,240,0.32)',
                cursor: browserState.canGoBack ? 'pointer' : 'default',
              }}
            >
              ←
            </button>
            <button
              data-testid="browser-go-forward"
              onClick={() => ipc.invoke('browser:go-forward')}
              disabled={!browserState.canGoForward}
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                background: browserState.canGoForward ? 'rgba(15,23,42,0.9)' : 'rgba(15,23,42,0.5)',
                color: browserState.canGoForward ? '#e2e8f0' : 'rgba(226,232,240,0.32)',
                cursor: browserState.canGoForward ? 'pointer' : 'default',
              }}
            >
              →
            </button>
            <button
              data-testid="browser-reload"
              onClick={() => ipc.invoke('browser:reload')}
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(15,23,42,0.9)',
                color: '#e2e8f0',
                cursor: 'pointer',
              }}
            >
              ↻
            </button>
          </div>

          <div
            className="no-drag"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              height: 42,
              padding: '0 14px',
              borderRadius: 16,
              background: 'rgba(15,23,42,0.82)',
              border: '1px solid rgba(148,163,184,0.16)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            <div
              style={{
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flex: 1,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: browserState.isLoading ? '#60a5fa' : '#22c55e',
                  boxShadow: `0 0 12px ${browserState.isLoading ? 'rgba(96,165,250,0.55)' : 'rgba(34,197,94,0.4)'}`,
                  flexShrink: 0,
                }}
              />
              <input
                data-testid="browser-address-input"
                value={addressValue}
                onChange={(event) => setAddressValue(event.target.value)}
                onFocus={() => setIsEditingAddress(true)}
                onBlur={() => setIsEditingAddress(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleNavigate();
                  }
                }}
                placeholder="Search or enter a URL"
                style={{
                  width: '100%',
                  height: 30,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: '#f8fafc',
                  fontSize: 13,
                }}
              />
            </div>

            <button
              data-testid="browser-address-go"
              onClick={() => void handleNavigate()}
              style={{
                height: 30,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid rgba(96,165,250,0.22)',
                background: 'rgba(37,99,235,0.18)',
                color: '#dbeafe',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Go
            </button>
          </div>

          <button
            className="no-drag"
            data-testid="browser-open-settings"
            onClick={() => ipc.invoke('window:show-config')}
            style={{
              height: 34,
              padding: '0 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(15,23,42,0.9)',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Settings
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: 'linear-gradient(180deg, rgba(8,17,32,0.35) 0%, rgba(8,17,32,0) 100%)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 18,
            right: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            color: 'rgba(226,232,240,0.68)',
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          <span>{browserState.isLoading ? 'Loading live tab...' : 'Live tab ready'}</span>
          <span>{activeHost}</span>
        </div>
      </div>
    </div>
  );
}

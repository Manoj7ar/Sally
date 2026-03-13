import { useState, useEffect, useCallback } from 'react';
import { ipc } from '../../lib/ipc';
import { rendererLogger } from '../../lib/logger';
import { THEME } from '../../theme/tokens';
import type { SallyConfig } from '../../../shared/types';

// ── Reusable Components ──

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: THEME.surface.muted,
        border: `1px solid ${THEME.border.subtle}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  description,
  right,
  indicator,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  indicator?: 'green' | 'gray';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: description ? 12 : 8 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: THEME.text.primary, margin: 0 }}>{title}</h3>
          {indicator && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: indicator === 'green' ? THEME.status.success : THEME.border.muted,
              }}
            />
          )}
        </div>
        {description && (
          <p style={{ fontSize: 12, color: THEME.text.secondary, margin: '4px 0 0 0' }}>{description}</p>
        )}
      </div>
      {right}
    </div>
  );
}

function KeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: `1px solid ${THEME.border.subtle}`,
        background: THEME.surface.base,
        color: THEME.text.primary,
        fontSize: 13,
        fontFamily: 'monospace',
        outline: 'none',
        boxSizing: 'border-box',
      }}
      onFocus={(e) => { e.target.style.borderColor = THEME.accent.primary; }}
      onBlur={(e) => { e.target.style.borderColor = THEME.border.subtle; }}
    />
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px',
        borderRadius: 8,
        border: 'none',
        background: disabled ? THEME.accent.primaryDisabledBg : THEME.accent.primary,
        color: disabled ? THEME.accent.primaryDisabledText : THEME.text.inverse,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.accent.primaryHover;
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.accent.primary;
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  children,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px',
        borderRadius: 8,
        border: `1px solid ${THEME.border.subtle}`,
        background: THEME.surface.base,
        color: disabled ? THEME.border.muted : danger ? THEME.status.danger : THEME.text.secondary,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.surface.hover;
          e.currentTarget.style.color = danger ? THEME.status.dangerHover : THEME.text.primary;
          e.currentTarget.style.transform = 'scale(1.03)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = THEME.surface.base;
          e.currentTarget.style.color = danger ? THEME.status.danger : THEME.text.secondary;
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {children}
    </button>
  );
}

// ── Main Component ──

export default function ConfigWindow() {
  const [config, setConfig] = useState<SallyConfig | null>(null);
  const [providerKey, setProviderKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [geminiBackendUrl, setGeminiBackendUrl] = useState('');
  const [autoResearchScreenQuestions, setAutoResearchScreenQuestions] = useState(false);
  const [backendHealth, setBackendHealth] = useState<{
    status: 'idle' | 'configured' | 'checking' | 'connected' | 'failed';
    model: string | null;
  }>({ status: 'idle', model: null });
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const checkBackendHealth = useCallback(async (url?: string) => {
    const target = (url || geminiBackendUrl || config?.geminiBackendUrl || '').trim();
    if (!target) return;

    setBackendHealth((current) => ({ status: 'checking', model: current.model }));

    try {
      const response = await fetch(`${target.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null) as { model?: unknown } | null;
        setBackendHealth({
          status: 'connected',
          model: typeof payload?.model === 'string' ? payload.model : null,
        });
      } else {
        setBackendHealth({ status: 'failed', model: null });
      }
    } catch {
      setBackendHealth({ status: 'failed', model: null });
    }
  }, [config?.geminiBackendUrl, geminiBackendUrl]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await ipc.invoke('sally:get-config');
      setConfig(cfg);
      setGeminiBackendUrl(cfg.geminiBackendUrl);
      setAutoResearchScreenQuestions(cfg.autoResearchScreenQuestions);
      if (cfg.geminiBackendUrl.trim()) {
        setBackendHealth({ status: 'configured', model: null });
        void checkBackendHealth(cfg.geminiBackendUrl);
      } else {
        setBackendHealth({ status: 'idle', model: null });
      }
    } catch (e) {
      rendererLogger.error('Failed to load config:', e);
    }
  }, [checkBackendHealth]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSaveProviderKey = async () => {
    if (!providerKey) return;
    await ipc.invoke('sally:set-api-key', { provider: 'gemini', key: providerKey });
    setProviderKey('');
    loadConfig();
  };

  const handleTestProviderKey = async () => {
    if (!providerKey) return;
    setTesting(true);
    const result = await ipc.invoke('sally:test-api-key', { provider: 'gemini', key: providerKey });
    setTestResult(result);
    setTesting(false);
  };

  const handleClearProviderKey = async () => {
    await ipc.invoke('sally:clear-api-key');
    loadConfig();
  };

  const handleSaveElevenLabsKey = async () => {
    if (!elevenLabsKey) return;
    await ipc.invoke('sally:set-elevenlabs-key', elevenLabsKey);
    setElevenLabsKey('');
    loadConfig();
  };

  const handleSaveGeminiBackendUrl = async () => {
    const nextUrl = geminiBackendUrl.trim();
    await ipc.invoke('sally:set-gemini-backend-url', nextUrl);
    setGeminiBackendUrl(nextUrl);
    await loadConfig();
    if (nextUrl) {
      setBackendHealth({ status: 'configured', model: null });
      void checkBackendHealth(nextUrl);
    } else {
      setBackendHealth({ status: 'idle', model: null });
    }
  };

  const handleClearGeminiBackendUrl = async () => {
    await ipc.invoke('sally:set-gemini-backend-url', '');
    setGeminiBackendUrl('');
    setBackendHealth({ status: 'idle', model: null });
    loadConfig();
  };

  const handleToggleAutoResearchScreenQuestions = async () => {
    const nextValue = !autoResearchScreenQuestions;
    setAutoResearchScreenQuestions(nextValue);
    await ipc.invoke('sally:set-auto-research-screen-questions', nextValue);
    await loadConfig();
  };

  if (!config) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: THEME.surface.base }}>
        <p style={{ color: THEME.text.secondary }}>Loading...</p>
      </div>
    );
  }

  const pushToTalkKeyLabel = ipc.getPlatform() === 'darwin' ? 'Right Option' : 'Right Alt';
  const backendUrlChanged = geminiBackendUrl.trim() !== config.geminiBackendUrl;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: THEME.surface.base, color: THEME.text.primary }}>
      {/* Title bar drag region */}
      <div
        className="drag-region"
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          paddingTop: 8,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: THEME.text.primary }}>Sally</h1>
          <p style={{ fontSize: 11, color: THEME.text.secondary, margin: '2px 0 0 0' }}>Voice-first AI assistant</p>
        </div>
      </div>

      {/* Launch Assistant button */}
      <div style={{ padding: '12px 24px 0', flexShrink: 0, display: 'flex', gap: 10 }}>
        <button
          onClick={() => ipc.invoke('window:show-pill')}
          data-testid="launch-assistant-button"
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: `1px solid ${THEME.accent.primaryBorder}`,
            background: THEME.accent.primarySoft,
            color: THEME.accent.primary, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s, transform 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = THEME.accent.primarySoftHover;
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = THEME.accent.primarySoft;
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke={THEME.accent.primary} strokeWidth="2" />
            <line x1="12" y1="2" x2="12" y2="7" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12" y2="22" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="2" y1="12" x2="7" y2="12" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
            <line x1="17" y1="12" x2="22" y2="12" stroke={THEME.accent.primary} strokeWidth="2" strokeLinecap="round" />
          </svg>
          Launch Assistant
        </button>
        <button
          onClick={() => ipc.invoke('window:show-browser')}
          data-testid="open-browser-button"
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: `1px solid ${THEME.accent.secondaryBorder}`,
            background: THEME.accent.secondarySoft,
            color: THEME.accent.secondary, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s, transform 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = THEME.accent.secondarySoftHover;
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = THEME.accent.secondarySoft;
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M3 8H21" stroke="currentColor" strokeWidth="2" />
            <circle cx="6.5" cy="6" r="1" fill="currentColor" />
            <circle cx="9.5" cy="6" r="1" fill="currentColor" />
          </svg>
          Open Browser
        </button>
      </div>

      {/* Content */}
      <div
        className="scrollbar-hide"
        style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px', minHeight: 0 }}
      >
        {/* AI Model */}
        <Card>
          <CardHeader
            title="AI Model"
            description="Gemini powers screen understanding, browser automation, and the default speech-to-text path."
            indicator={config.hasGeminiKey ? 'green' : 'gray'}
          />
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, color: THEME.text.secondary, marginBottom: 6 }}>Gemini API Key</label>
            <KeyInput
              value={providerKey}
              onChange={setProviderKey}
              placeholder={config.hasGeminiKey ? 'Key configured (hidden)' : 'Enter Gemini API key...'}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PrimaryButton onClick={handleSaveProviderKey} disabled={!providerKey}>
              Save
            </PrimaryButton>
            <SecondaryButton onClick={handleTestProviderKey} disabled={!providerKey || testing}>
              {testing ? 'Testing...' : 'Test'}
            </SecondaryButton>
            {config.hasGeminiKey && (
              <SecondaryButton onClick={handleClearProviderKey} danger>
                Clear
              </SecondaryButton>
            )}
            {testResult !== null && (
              <span style={{ fontSize: 12, color: testResult ? THEME.status.successText : THEME.status.danger, marginLeft: 4 }}>
                {testResult ? 'Valid' : 'Invalid'}
              </span>
            )}
          </div>
        </Card>

        {/* Voice Settings */}
        <Card>
          <CardHeader title="Voice" description="Configure speech services" />

          {/* TTS */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: THEME.text.primary }}>Text-to-Speech</span>
              <span style={{ fontSize: 11, color: THEME.text.secondary }}>ElevenLabs</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: config.hasElevenLabsKey ? THEME.status.success : THEME.border.muted,
                  marginLeft: 'auto',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <KeyInput
                  value={elevenLabsKey}
                  onChange={setElevenLabsKey}
                  placeholder={config.hasElevenLabsKey ? 'Key configured' : 'Enter ElevenLabs key...'}
                />
              </div>
              <PrimaryButton onClick={handleSaveElevenLabsKey} disabled={!elevenLabsKey}>
                Save
              </PrimaryButton>
            </div>
          </div>

          <div style={{ height: 1, background: THEME.border.subtle, margin: '0 0 16px' }} />

          {/* STT */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: THEME.text.primary }}>Speech-to-Text</span>
              <span style={{ fontSize: 11, color: THEME.text.secondary }}>Gemini 2.5 Flash</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: config.hasGeminiKey ? THEME.status.success : THEME.border.muted,
                  marginLeft: 'auto',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: THEME.text.secondary, margin: '0 0 10px 0' }}>
              Speech-to-text uses the Gemini API key configured above.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sally Vision Backend"
            description="Cloud Run URL for Gemini screen interpretation (optional — falls back to direct Gemini API calls)."
            indicator={backendHealth.status === 'connected' || config.geminiBackendUrl ? 'green' : 'gray'}
          />
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={geminiBackendUrl}
              onChange={(e) => setGeminiBackendUrl(e.target.value)}
              placeholder="https://sally-backend-xxx.run.app"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${THEME.border.subtle}`,
                background: THEME.surface.base,
                color: THEME.text.primary,
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = THEME.accent.primary; }}
              onBlur={(e) => { e.target.style.borderColor = THEME.border.subtle; }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PrimaryButton onClick={handleSaveGeminiBackendUrl} disabled={!backendUrlChanged}>
              Save URL
            </PrimaryButton>
            {config.geminiBackendUrl && (
              <>
                <SecondaryButton onClick={() => checkBackendHealth()} disabled={backendHealth.status === 'checking'}>
                  {backendHealth.status === 'checking' ? 'Checking...' : 'Check Cloud Run'}
                </SecondaryButton>
                <SecondaryButton onClick={handleClearGeminiBackendUrl}>
                  Clear URL
                </SecondaryButton>
              </>
            )}
          </div>
          {config.geminiBackendUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    backendHealth.status === 'connected' ? THEME.status.success :
                    backendHealth.status === 'failed' ? THEME.status.danger :
                    backendHealth.status === 'checking' ? THEME.status.warning :
                    backendHealth.status === 'configured' ? THEME.accent.primary : THEME.border.muted,
                }}
              />
              <span style={{
                fontSize: 11,
                color:
                  backendHealth.status === 'connected' ? THEME.status.successText :
                  backendHealth.status === 'failed' ? THEME.status.danger :
                  backendHealth.status === 'checking' ? THEME.status.warning :
                  backendHealth.status === 'configured' ? THEME.accent.primary : THEME.text.secondary,
              }}>
                {backendHealth.status === 'connected'
                  ? `Connected to Cloud Run${backendHealth.model ? ` (${backendHealth.model})` : ''}`
                  : backendHealth.status === 'failed'
                    ? 'Cloud Run connection failed'
                    : backendHealth.status === 'checking'
                      ? 'Checking Cloud Run health...'
                      : backendHealth.status === 'configured'
                        ? 'Cloud Run URL configured'
                        : 'Cloud Run not configured'}
              </span>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Screen Questions"
            description="Let Sally answer open-ended questions about what is visible on screen. Auto research opens the browser only when a screen question explicitly asks for more information."
            indicator={autoResearchScreenQuestions ? 'green' : 'gray'}
          />
          <button
            onClick={handleToggleAutoResearchScreenQuestions}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${THEME.border.subtle}`,
              background: autoResearchScreenQuestions ? THEME.status.successSoft : THEME.surface.base,
              color: THEME.text.primary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Auto Research for Screen Questions
              </div>
              <div style={{ fontSize: 12, color: THEME.text.secondary }}>
                {autoResearchScreenQuestions
                  ? 'When a visual question asks for more info, Sally can answer from the screenshot and then look it up on the web.'
                  : 'Sally answers screen questions from the screenshot only and does not auto-open the browser.'}
              </div>
            </div>
            <div
              style={{
                width: 42,
                height: 24,
                borderRadius: 999,
                background: autoResearchScreenQuestions ? THEME.status.success : THEME.border.muted,
                position: 'relative',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: THEME.surface.base,
                  position: 'absolute',
                  top: 3,
                  left: autoResearchScreenQuestions ? 21 : 3,
                  transition: 'left 0.15s',
                  boxShadow: THEME.shadow.small,
                }}
              />
            </div>
          </button>
        </Card>

        {/* Getting Started */}
        <Card style={{ background: THEME.accent.primaryMuted, borderColor: THEME.accent.primaryBorder }}>
          <CardHeader title="Getting Started" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { num: '1', text: `Hold ${pushToTalkKeyLabel} to speak a command` },
              { num: '2', text: 'Release to send your command' },
              { num: '3', text: 'Say "cancel" to stop the current action' },
            ].map((step) => (
              <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: THEME.accent.primarySoftHover,
                    color: THEME.accent.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {step.num}
                </span>
                <span style={{ fontSize: 13, color: THEME.text.primary }}>{step.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
